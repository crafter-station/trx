import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Backend, TrxConfig } from "../utils/config.ts";
import { cleanAudio, durationMs, lastCueEndMs } from "./audio.ts";
import { downloadMedia } from "./download.ts";
import { transcribeElevenLabs } from "./elevenlabs.ts";
import { transcribeOpenAI } from "./openai.ts";
import { transcribeVercel } from "./vercel.ts";
import { transcribe, type WhisperProgress } from "./whisper.ts";

export interface PipelineOptions {
	input: string;
	inputType: "url" | "file";
	config: TrxConfig;
	outputDir: string;
	language?: string;
	backend?: Backend;
	noDownload?: boolean;
	noClean?: boolean;
	noChunk?: boolean;
	/** Separate speakers. Only the elevenlabs backend implements this. */
	diarize?: boolean;
	/** Hint for how many speakers are present, when known. */
	numSpeakers?: number;
	cookiesFromBrowser?: string;
	/** Initial prompt for the model, already resolved to the spoken language. */
	prompt?: string | null;
	onStep?: (step: string) => void;
	onProgress?: (progress: WhisperProgress) => void;
}

export interface PipelineResult {
	success: true;
	input: string;
	backend: Backend;
	files: {
		wav: string;
		srt: string;
		txt: string;
	};
	metadata: {
		language: string;
		model: string;
		/** How long the file handed in ran, in milliseconds. Null when it could not be read. */
		inputDurationMs: number | null;
		/** How long the audio that reached the model ran. */
		transcribedDurationMs: number | null;
		/** Where the last cue ends. The gap to transcribedDurationMs is audio that produced no words. */
		lastCueEndMs: number | null;
	};
	text: string;
}

/**
 * Three numbers rather than a verdict. A short transcript reads the same whether the
 * recording is mostly silence, the model stopped early, or the file handed in was not the one
 * intended; the gaps between these separate those cases. The caller decides what is suspicious
 * for its own material, which beats a threshold picked here.
 */
async function coverage(
	inputFile: string,
	audioInput: string,
	srtPath: string,
): Promise<{
	inputDurationMs: number | null;
	transcribedDurationMs: number | null;
	lastCueEndMs: number | null;
}> {
	return {
		inputDurationMs: await durationMs(inputFile),
		transcribedDurationMs: await durationMs(audioInput),
		lastCueEndMs: lastCueEndMs(
			await Bun.file(srtPath)
				.text()
				.catch(() => ""),
		),
	};
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
	const { config, outputDir } = opts;
	const backend = opts.backend || config.backend || "local";
	let inputFile: string;

	await mkdir(outputDir, { recursive: true });

	if (opts.inputType === "url" && !opts.noDownload) {
		opts.onStep?.("Downloading media...");
		const downloaded = await downloadMedia(opts.input, outputDir, { cookiesFromBrowser: opts.cookiesFromBrowser });
		inputFile = downloaded.filePath;
	} else {
		inputFile = resolve(opts.input);
	}

	const name = basename(inputFile).replace(/\.[^.]+$/, "");
	let wavPath = resolve(outputDir, `${name}.wav`);
	if (wavPath === resolve(inputFile)) {
		wavPath = resolve(outputDir, `${name}_clean.wav`);
	}

	if (!opts.noClean) {
		opts.onStep?.("Cleaning audio...");
		await cleanAudio(inputFile, wavPath);
	}

	const audioInput = opts.noClean ? inputFile : wavPath;

	if (backend === "vercel") {
		const model = config.vercel.model;
		opts.onStep?.(`Transcribing with Vercel AI Gateway (${model})...`);
		const result = await transcribeVercel(audioInput, model, opts.language, {
			onStep: opts.onStep,
			noChunk: opts.noChunk,
		});

		return {
			success: true,
			input: opts.input,
			backend: "vercel",
			files: {
				wav: wavPath,
				srt: result.srtPath,
				txt: result.txtPath,
			},
			metadata: {
				language: opts.language || "auto",
				model,
				...(await coverage(inputFile, audioInput, result.srtPath)),
			},
			text: result.text,
		};
	}

	if (backend === "elevenlabs") {
		const model = config.elevenlabs.model;
		const diarize = opts.diarize ?? config.elevenlabs.diarize;
		opts.onStep?.(`Transcribing with ElevenLabs ${model}${diarize ? " (diarized)" : ""}...`);
		const result = await transcribeElevenLabs(audioInput, model, opts.language, {
			onStep: opts.onStep,
			diarize,
			numSpeakers: opts.numSpeakers,
		});

		return {
			success: true,
			input: opts.input,
			backend: "elevenlabs",
			files: {
				wav: wavPath,
				srt: result.srtPath,
				txt: result.txtPath,
			},
			metadata: {
				language: opts.language || "auto",
				model,
				...(await coverage(inputFile, audioInput, result.srtPath)),
			},
			text: result.text,
		};
	}

	if (backend === "openai") {
		const model = config.openai.model;
		opts.onStep?.(`Transcribing with OpenAI ${model}...`);
		const result = await transcribeOpenAI(audioInput, model, opts.language, {
			onStep: opts.onStep,
			noChunk: opts.noChunk,
		});

		return {
			success: true,
			input: opts.input,
			backend: "openai",
			files: {
				wav: wavPath,
				srt: result.srtPath,
				txt: result.txtPath,
			},
			metadata: {
				language: opts.language || "auto",
				model,
				...(await coverage(inputFile, audioInput, result.srtPath)),
			},
			text: result.text,
		};
	}

	opts.onStep?.("Transcribing with Whisper...");
	const result = await transcribe(audioInput, config, opts.language, opts.onProgress, opts.prompt);

	return {
		success: true,
		input: opts.input,
		backend: "local",
		files: {
			wav: wavPath,
			srt: result.srtPath,
			txt: result.txtPath,
		},
		metadata: {
			language: opts.language || "auto",
			model: config.modelSize,
			...(await coverage(inputFile, audioInput, result.srtPath)),
		},
		text: result.text,
	};
}
