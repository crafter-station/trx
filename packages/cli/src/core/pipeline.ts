import { basename, resolve } from "node:path";
import type { TrxConfig } from "../utils/config.ts";
import { cleanAudio } from "./audio.ts";
import { downloadMedia } from "./download.ts";
import { type WhisperProgress, transcribe } from "./whisper.ts";

export interface PipelineOptions {
	input: string;
	inputType: "url" | "file";
	config: TrxConfig;
	outputDir: string;
	language?: string;
	noDownload?: boolean;
	noClean?: boolean;
	onStep?: (step: string) => void;
	onProgress?: (progress: WhisperProgress) => void;
}

export interface PipelineResult {
	success: true;
	input: string;
	files: {
		wav: string;
		srt: string;
		txt: string;
	};
	metadata: {
		language: string;
		model: string;
	};
	text: string;
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
	const { config, outputDir } = opts;
	let inputFile: string;

	if (opts.inputType === "url" && !opts.noDownload) {
		opts.onStep?.("Downloading media...");
		const downloaded = await downloadMedia(opts.input, outputDir);
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

	const whisperInput = opts.noClean ? inputFile : wavPath;
	opts.onStep?.("Transcribing with Whisper...");
	const result = await transcribe(whisperInput, config, opts.language, opts.onProgress);

	return {
		success: true,
		input: opts.input,
		files: {
			wav: wavPath,
			srt: result.srtPath,
			txt: result.txtPath,
		},
		metadata: {
			language: opts.language || "auto",
			model: config.modelSize,
		},
		text: result.text,
	};
}
