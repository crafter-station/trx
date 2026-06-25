import type { PegasusModel } from "../utils/config.ts";

export interface PegasusTranscribeResult {
	srtPath: string;
	txtPath: string;
	text: string;
}

interface AnalyzeResponse {
	data?: string;
	code?: string;
	message?: string;
}

export function getTwelveLabsKey(): string {
	const key = process.env.TWELVELABS_API_KEY;
	if (!key) {
		throw new Error("TWELVELABS_API_KEY not set. Export it in your shell: export TWELVELABS_API_KEY=tlk_...");
	}
	return key;
}

const DEFAULT_PROMPT =
	"Transcribe all spoken words in this video verbatim, in the order they are spoken. " +
	"Output only the transcript text with no commentary, labels, or timestamps.";

/**
 * Transcribe a video via TwelveLabs Pegasus video-understanding.
 *
 * Unlike the local/openai backends, Pegasus reads the video directly from a
 * public URL server-side — there is no local download or audio cleaning step.
 * It uses the full audiovisual context, so on-screen text and speaker cues can
 * improve transcripts of noisy or multi-speaker footage.
 *
 * @param videoUrl Direct http(s) URL to the source media (share links are not accepted).
 * @param model Pegasus model name.
 * @param outBase Output path prefix; ".srt" and ".txt" are appended.
 * @param language Optional ISO 639-1 code to bias output language; "auto" is ignored.
 * @param prompt Optional override for the transcription prompt.
 */
export async function transcribePegasus(
	videoUrl: string,
	model: PegasusModel,
	outBase: string,
	language?: string,
	prompt?: string,
): Promise<PegasusTranscribeResult> {
	const apiKey = getTwelveLabsKey();

	let effectivePrompt = prompt || DEFAULT_PROMPT;
	if (language && language !== "auto") {
		effectivePrompt += ` Transcribe in the language with ISO 639-1 code "${language}".`;
	}

	const response = await fetch("https://api.twelvelabs.io/v1.3/analyze", {
		method: "POST",
		headers: {
			"x-api-key": apiKey,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			video: { type: "url", url: videoUrl },
			model_name: model,
			prompt: effectivePrompt,
			max_tokens: 2048,
			stream: false,
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`TwelveLabs API error (${response.status}): ${body}`);
	}

	const json = (await response.json()) as AnalyzeResponse;
	if (!json.data) {
		throw new Error(`TwelveLabs returned no transcript: ${json.message || JSON.stringify(json)}`);
	}

	const text = json.data.trim();

	// Pegasus returns prose, not timed segments — emit a single cue covering the clip.
	const srtContent = text ? `1\n00:00:00,000 --> 00:00:00,000\n${text}\n` : "";

	const srtPath = `${outBase}.srt`;
	const txtPath = `${outBase}.txt`;

	await Bun.write(srtPath, srtContent);
	await Bun.write(txtPath, text);

	return { srtPath, txtPath, text };
}
