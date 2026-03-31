import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import { type PipelineResult, runPipeline } from "../core/pipeline.ts";
import { readConfig } from "../utils/config.ts";
import { type OutputFormat, output, outputError } from "../utils/output.ts";
import { validateInput, validateLanguage, validateModel } from "../validation/input.ts";

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
		.option("-l, --language <lang>", "language code (default: from config)")
		.option("-m, --model <size>", "override model size")
		.option("--fields <fields>", "limit output fields: text,srt,metadata,files")
		.option("--dry-run", "validate input without transcribing")
		.option("--json <payload>", "raw JSON input for agents")
		.option("--output-dir <dir>", "output directory", ".")
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

				if (opts.json) {
					const payload = JSON.parse(opts.json);
					parsedInput = validateInput(payload.input || inputArg);
					language = payload.language || language;
					modelOverride = payload.model || modelOverride;
				} else {
					parsedInput = validateInput(inputArg);
				}

				if (language) validateLanguage(language);
				if (modelOverride) validateModel(modelOverride);

				const outputDir = resolve(opts.outputDir);

				if (opts.dryRun) {
					output(format, {
						json: {
							dryRun: true,
							input: parsedInput.value,
							inputType: parsedInput.type,
							language: language || config.language,
							model: modelOverride || config.modelSize,
							outputDir,
							steps: [
								...(parsedInput.type === "url" && !opts.noDownload ? ["download via yt-dlp"] : []),
								...(!opts.noClean ? ["clean audio via ffmpeg"] : []),
								"transcribe via whisper-cli",
								"generate .srt and .txt",
							],
						},
					});
					return;
				}

				let spinner: ReturnType<typeof p.spinner> | null = null;
				if (isTTY) {
					spinner = p.spinner();
				}

				const result = await runPipeline({
					input: parsedInput.value,
					inputType: parsedInput.type,
					config: modelOverride
						? {
								...config,
								modelSize: modelOverride,
								modelPath: config.modelPath.replace(/ggml-\w+\.bin/, `ggml-${modelOverride}.bin`),
							}
						: config,
					outputDir,
					language,
					noDownload: opts.noDownload,
					noClean: opts.noClean,
					onStep: (step) => {
						if (spinner) spinner.start(step);
					},
				});

				if (spinner) spinner.stop("Done");

				const filtered = opts.fields ? filterFields(result, opts.fields) : result;
				output(format, {
					json: filtered,
					table: {
						headers: ["Property", "Value"],
						rows: [
							["Input", result.input],
							["Language", result.metadata.language],
							["Model", result.metadata.model],
							["SRT", result.files.srt],
							["TXT", result.files.txt],
							["WAV", result.files.wav],
						],
					},
				});
			} catch (e) {
				outputError((e as Error).message, format);
			}
		});
}
