import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import { type PipelineResult, runPipeline } from "../core/pipeline.ts";
import { readConfig } from "../utils/config.ts";
import { type OutputFormat, output, outputError } from "../utils/output.ts";
import { validateBackend, validateInput, validateLanguage, validateModel, validateOpenAIModel } from "../validation/input.ts";

function filterFields(result: PipelineResult, fields?: string): Record<string, unknown> {
	if (!fields) return result;

	const requested = fields.split(",").map((f) => f.trim());
	const filtered: Record<string, unknown> = { success: true };

	for (const field of requested) {
		if (field === "text") filtered.text = result.text;
		if (field === "srt") filtered.files = { srt: result.files.srt };
		if (field === "metadata") filtered.metadata = result.metadata;
		if (field === "files") filtered.files = result.files;
	}

	return filtered;
}

export function createTranscribeCommand(): Command {
	return new Command("transcribe")
		.description("Transcribe audio/video from URL or local file")
		.argument("<input>", "URL or file path to transcribe")
		.option("-l, --language <lang>", "force language (default: auto-detect)")
		.option("-m, --model <size>", "override model size")
		.option("--fields <fields>", "limit output fields: text,srt,metadata,files")
		.option("--dry-run", "validate input without transcribing")
		.option("--json <payload>", "raw JSON input for agents")
		.option("--output-dir <dir>", "output directory", ".")
		.option("-w, --words", "word-level timestamps in SRT")
		.option("-b, --backend <backend>", "transcription backend (local, openai)")
		.option("--no-download", "skip yt-dlp (input must be local)")
		.option("--no-clean", "skip ffmpeg audio cleaning")
		.action(async (inputArg, opts, cmd) => {
			const format: OutputFormat = cmd.optsWithGlobals().output;
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const config = readConfig();
				if (!config) {
					outputError('No configuration found. Run "trx init" first.', format);
					return;
				}

				let parsedInput: { type: "url" | "file"; value: string };
				let language = opts.language;
				let modelOverride = opts.model;
				let backendOverride = opts.backend;

				if (opts.json) {
					const payload = JSON.parse(opts.json);
					parsedInput = validateInput(payload.input || inputArg);
					language = payload.language || language;
					modelOverride = payload.model || modelOverride;
					backendOverride = payload.backend || backendOverride;
				} else {
					parsedInput = validateInput(inputArg);
				}

				if (language) validateLanguage(language);
				const effectiveBackend = backendOverride ? validateBackend(backendOverride) : config.backend;
				if (modelOverride) {
					if (effectiveBackend === "openai") {
						validateOpenAIModel(modelOverride);
					} else {
						validateModel(modelOverride);
					}
				}

				const outputDir = resolve(opts.outputDir);

				if (opts.dryRun) {
					const transcribeStep =
						effectiveBackend === "openai"
							? `transcribe via OpenAI ${modelOverride || config.openai.model}`
							: "transcribe via whisper-cli";
					output(format, {
						json: {
							dryRun: true,
							input: parsedInput.value,
							inputType: parsedInput.type,
							backend: effectiveBackend,
							language: language || "auto",
							model:
								effectiveBackend === "openai"
									? modelOverride || config.openai.model
									: modelOverride || config.modelSize,
							outputDir,
							steps: [
								...(parsedInput.type === "url" && opts.download !== false ? ["download via yt-dlp"] : []),
								...(opts.clean !== false ? ["clean audio via ffmpeg"] : []),
								transcribeStep,
								"generate .srt and .txt",
							],
						},
					});
					return;
				}

				let spinner: ReturnType<typeof p.spinner> | null = null;
				let done = false;
				if (isTTY) {
					spinner = p.spinner();
				}

				const effectiveConfig = { ...config };
				if (effectiveBackend === "openai" && modelOverride) {
					effectiveConfig.openai = { ...config.openai, model: modelOverride as typeof config.openai.model };
				} else if (modelOverride) {
					effectiveConfig.modelSize = modelOverride;
					effectiveConfig.modelPath = config.modelPath.replace(/ggml-[\w.-]+\.bin/, `ggml-${modelOverride}.bin`);
				}

				if (opts.words) effectiveConfig.wordTimestamps = true;

				const result = await runPipeline({
					input: parsedInput.value,
					inputType: parsedInput.type,
					config: effectiveConfig,
					outputDir,
					language: language || "auto",
					backend: effectiveBackend,
					noDownload: opts.download === false,
					noClean: opts.clean === false,
					onStep: (step) => {
						if (spinner && !done) spinner.start(step);
					},
					onProgress: (progress) => {
						if (spinner && !done) {
							const pct = progress.percent;
							const filled = Math.round(pct / 5);
							const bar = "\u2588".repeat(filled) + "\u2591".repeat(20 - filled);
							spinner.message(`Transcribing ${bar} ${pct}%`);
						}
					},
				});

				done = true;
				if (spinner) spinner.stop("Transcription complete");

				const filtered = opts.fields ? filterFields(result, opts.fields) : result;
				output(format, {
					json: filtered,
					table: {
						headers: ["Property", "Value"],
						rows: [
							["Input", result.input],
							["Backend", result.backend],
							["Language", result.metadata.language],
							["Model", result.metadata.model],
							["TXT", result.files.txt],
							["SRT", result.files.srt],
						],
					},
				});

				if (isTTY) {
					const wordCount = result.text.split(/\s+/).filter(Boolean).length;
					const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
					const quotedPath = result.files.txt.includes(" ") ? `"${result.files.txt}"` : result.files.txt;
					p.note(`${wordCount} words transcribed\n\n${openCmd} ${quotedPath}`, "Next");
					process.exit(0);
				}
			} catch (e) {
				outputError((e as Error).message, format);
			}
		});
}
