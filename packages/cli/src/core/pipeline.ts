import { basename, resolve } from "node:path";
import type { Backend, TrxConfig } from "../utils/config.ts";
import { cleanAudio } from "./audio.ts";
import { downloadMedia } from "./download.ts";
import { transcribeOpenAI } from "./openai.ts";
import { transcribePegasus } from "./twelvelabs.ts";
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
	};
	text: string;
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
	const { config, outputDir } = opts;
	const backend = opts.backend || config.backend || "local";
	let inputFile: string;

	// Pegasus analyses the video directly from its URL server-side — no local
	// download or audio cleaning, so it short-circuits the whisper/openai pipeline.
	if (backend === "pegasus") {
		if (opts.inputType !== "url") {
			throw new Error(
				"Pegasus backend requires a direct media URL (it analyses video server-side). Use --backend local or openai for local files.",
			);
		}
		const model = config.pegasus.model;
		opts.onStep?.(`Transcribing with TwelveLabs ${model}...`);
		const name = basename(opts.input.split(/[?#]/)[0]).replace(/\.[^.]+$/, "") || "pegasus";
		const outBase = resolve(outputDir, name);
		const result = await transcribePegasus(opts.input, model, outBase, opts.language);

		return {
			success: true,
			input: opts.input,
			backend: "pegasus",
			files: {
				wav: "",
				srt: result.srtPath,
				txt: result.txtPath,
			},
			metadata: {
				language: opts.language || "auto",
				model,
			},
			text: result.text,
		};
	}

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

	const audioInput = opts.noClean ? inputFile : wavPath;

	if (backend === "openai") {
		const model = config.openai.model;
		opts.onStep?.(`Transcribing with OpenAI ${model}...`);
		const result = await transcribeOpenAI(audioInput, model, opts.language);

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
			},
			text: result.text,
		};
	}

	opts.onStep?.("Transcribing with Whisper...");
	const result = await transcribe(audioInput, config, opts.language, opts.onProgress);

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
		},
		text: result.text,
	};
}
