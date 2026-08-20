import { readFileSync, statSync } from "node:fs";
import type { ElevenLabsModel } from "../utils/config.ts";
import { spawn } from "../utils/spawn.ts";

export interface ElevenLabsTranscribeResult {
	srtPath: string;
	txtPath: string;
	text: string;
	/**
	 * Where the per-word timings were written, when `--words` asked for them.
	 *
	 * Scribe returns one entry per word with its own start and end, and this
	 * backend has always requested them: `timestamps_granularity: word` is not
	 * optional here, because `wordsToCues` builds the SRT out of them. They were
	 * then discarded, so a caller that needed a word boundary had to make a
	 * second identical request to the same endpoint for data this process
	 * already held. Measured downstream: 10.1s of API wait to re-fetch what the
	 * first call returned.
	 */
	wordsPath?: string;
}

const API_URL = "https://api.elevenlabs.io/v1/speech-to-text";

/**
 * The documented per-file ceiling for the speech-to-text endpoint. Well past anything
 * ffmpeg produces from a normal recording, so this backend has no chunking path: the
 * other two chunk because their limits (25 MB, 100 MB) are reachable by a long meeting,
 * and 5 GB is not.
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

/** The API rejects anything above this, so reject it here with a message that names the flag. */
const MAX_SPEAKERS = 32;

export interface ElevenLabsTranscribeOptions {
	/** Write the per-word timings alongside the SRT. No extra request: the words
	 *  are already in the response this backend parses. */
	words?: boolean;
	onStep?: (step: string) => void;
	diarize?: boolean;
	numSpeakers?: number;
}

/**
 * A word carries `type: "word"`; the gaps between them come back as separate entries with
 * `type: "spacing"` and no meaning of their own. Counting or rendering those would inflate
 * every word count and put empty cues in the SRT, so everything downstream filters on type.
 */
export interface ScribeWord {
	text: string;
	type?: string;
	start?: number;
	end?: number;
	speaker_id?: string;
	logprob?: number;
}

interface ScribeResponse {
	language_code?: string;
	language_probability?: number;
	text?: string;
	words?: ScribeWord[];
}

const KEY_HELP =
	"ELEVENLABS_API_KEY not set. Export it in your shell: export ELEVENLABS_API_KEY=... (on macOS trx also reads the `elevenlabs` entry from your login Keychain).";

/**
 * Env first, to match the other cloud backends and to keep CI and containers working with
 * no Keychain at all. The Keychain fallback is macOS-only and exists so a key already stored
 * there does not have to be re-exported into every shell.
 */
export async function getElevenLabsKey(): Promise<string> {
	const fromEnv = process.env.ELEVENLABS_API_KEY;
	if (fromEnv) return fromEnv;

	if (process.platform === "darwin") {
		const result = await spawn(["security", "find-generic-password", "-s", "elevenlabs", "-w"]);
		const key = result.stdout.trim();
		if (result.exitCode === 0 && key) return key;
	}

	throw new Error(KEY_HELP);
}

/**
 * How long a silence between two words starts a new cue. Scribe timestamps every word, so
 * without a rule the SRT would be one cue per word: unreadable as subtitles and useless as a
 * transcript. 0.6s sits above the pauses inside a spoken sentence and below the beat between
 * sentences, which is the boundary a reader already perceives as a break.
 */
const CUE_GAP_SECONDS = 0.6;

/**
 * Characters after which a cue is cut even if the speaker has not paused. Two 42-character
 * lines is the long-standing subtitle convention, and a run-on cue is the failure mode a
 * pause-only rule produces on fast speech.
 */
const CUE_MAX_CHARS = 84;

export interface Cue {
	start: number;
	end: number;
	text: string;
	speaker?: string;
}

/**
 * Word-level timestamps into readable cues.
 *
 * Three cut rules, in priority order:
 *   1. A change of `speaker_id` always cuts. Two speakers inside one cue would misattribute
 *      the line, which is worse than a short cue, so this one is not negotiable and is not
 *      subject to the length or gap thresholds.
 *   2. A silence of at least CUE_GAP_SECONDS cuts, approximating a sentence boundary without
 *      needing punctuation, which Scribe does not always emit.
 *   3. CUE_MAX_CHARS caps the rest.
 *
 * Debatable by design: both thresholds are conventions, not measurements. They were picked to
 * read well, not derived from this corpus.
 */
export function wordsToCues(words: ScribeWord[]): Cue[] {
	const spoken = words.filter((word) => word.type === "word" && typeof word.start === "number");
	const cues: Cue[] = [];
	let current: Cue | null = null;
	let previousEnd: number | null = null;

	for (const word of spoken) {
		const start = word.start as number;
		const end = typeof word.end === "number" ? word.end : start;
		const speaker = word.speaker_id;

		const speakerChanged = current !== null && current.speaker !== speaker;
		const gapTooLong = previousEnd !== null && start - previousEnd >= CUE_GAP_SECONDS;
		const cueTooLong = current !== null && current.text.length + word.text.length + 1 > CUE_MAX_CHARS;

		if (current === null || speakerChanged || gapTooLong || cueTooLong) {
			current = { start, end, text: word.text.trim(), speaker };
			cues.push(current);
		} else {
			current.text = `${current.text} ${word.text.trim()}`.trim();
			current.end = end;
		}

		previousEnd = end;
	}

	return cues.filter((cue) => cue.text.length > 0);
}

export function formatTimestamp(seconds: number): string {
	const safe = seconds > 0 ? seconds : 0;
	const h = Math.floor(safe / 3600);
	const m = Math.floor((safe % 3600) / 60);
	const s = Math.floor(safe % 60);
	const ms = Math.round((safe % 1) * 1000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function cuesToSrt(cues: Cue[], labelSpeakers: boolean): string {
	return cues
		.map((cue, i) => {
			const label = labelSpeakers && cue.speaker ? `[${cue.speaker}] ` : "";
			return `${i + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${label}${cue.text}\n`;
		})
		.join("\n");
}

/**
 * With diarization the TXT reads as a conversation: one paragraph per turn, prefixed with the
 * speaker, consecutive cues from the same speaker merged. Without it the plain `text` field
 * the API already returns is what a reader wants, so this is only used for the diarized case.
 */
export function cuesToTranscript(cues: Cue[]): string {
	const turns: Array<{ speaker: string | undefined; text: string }> = [];

	for (const cue of cues) {
		const last = turns[turns.length - 1];
		if (last && last.speaker === cue.speaker) {
			last.text = `${last.text} ${cue.text}`;
		} else {
			turns.push({ speaker: cue.speaker, text: cue.text });
		}
	}

	return turns.map((turn) => (turn.speaker ? `[${turn.speaker}] ${turn.text}` : turn.text)).join("\n\n");
}

export async function transcribeElevenLabs(
	audioPath: string,
	model: ElevenLabsModel,
	language?: string,
	options: ElevenLabsTranscribeOptions = {},
): Promise<ElevenLabsTranscribeResult> {
	const apiKey = await getElevenLabsKey();

	const stat = statSync(audioPath);
	if (stat.size > MAX_FILE_SIZE) {
		const sizeGB = (stat.size / 1024 / 1024 / 1024).toFixed(1);
		throw new Error(
			`File is ${sizeGB} GB, the ElevenLabs API limit is 5 GB. Use --backend local for larger files, or pre-split with ffmpeg.`,
		);
	}

	if (options.numSpeakers !== undefined) {
		if (!Number.isInteger(options.numSpeakers) || options.numSpeakers < 1 || options.numSpeakers > MAX_SPEAKERS) {
			throw new Error(`--speakers must be an integer between 1 and ${MAX_SPEAKERS}, got "${options.numSpeakers}".`);
		}
	}

	const diarize = options.diarize === true;
	const fileBuffer = readFileSync(audioPath);
	const fileName = audioPath.split("/").pop() || "audio.wav";

	const form = new FormData();
	form.append("file", new Blob([fileBuffer]), fileName);
	form.append("model_id", model);
	form.append("timestamps_granularity", "word");
	form.append("diarize", String(diarize));
	if (language && language !== "auto") {
		form.append("language_code", language);
	}
	if (diarize && options.numSpeakers !== undefined) {
		form.append("num_speakers", String(options.numSpeakers));
	}

	const response = await fetch(API_URL, {
		method: "POST",
		headers: { "xi-api-key": apiKey },
		body: form,
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`ElevenLabs API error (${response.status}): ${body}`);
	}

	const json = (await response.json()) as ScribeResponse;
	const words = Array.isArray(json.words) ? json.words : [];
	const cues = wordsToCues(words);

	const srtContent = cuesToSrt(cues, diarize);
	const text = diarize && cues.length > 0 ? cuesToTranscript(cues) : json.text || "";

	const srtPath = `${audioPath}.srt`;
	const txtPath = audioPath.replace(/\.[^.]+$/, ".txt");

	await Bun.write(srtPath, srtContent);
	await Bun.write(txtPath, text);

	// The words are already parsed. Writing them costs a file and no request;
	// not writing them costs a caller a second call to this endpoint.
	let wordsPath: string | undefined;
	if (options.words === true) {
		wordsPath = `${audioPath}.words.json`;
		const spoken = words
			.filter((word) => word.type === "word" && typeof word.start === "number")
			.map((word) => ({
				text: word.text,
				startMs: Math.round((word.start as number) * 1000),
				endMs: Math.round((word.end as number) * 1000),
				...(word.speaker_id !== undefined ? { speaker: word.speaker_id } : {}),
				// The provider's own token score, on its own scale. Passed through
				// rather than normalised: it scores the word, not the boundary.
				...(word.logprob !== undefined ? { logprob: word.logprob } : {}),
			}));
		await Bun.write(wordsPath, `${JSON.stringify({ words: spoken }, null, 1)}\n`);
	}

	return { srtPath, txtPath, text, ...(wordsPath ? { wordsPath } : {}) };
}
