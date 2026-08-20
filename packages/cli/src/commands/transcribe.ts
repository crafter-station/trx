import { resolve } from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import { type PipelineResult, runPipeline } from "../core/pipeline.ts";
import { presetLanguages, presetPrompt } from "../core/prompts.ts";
import { readConfig } from "../utils/config.ts";
import { type OutputFormat, output, outputError } from "../utils/output.ts";
import {
	validateBackend,
	validateElevenLabsLanguage,
	validateElevenLabsModel,
	validateInput,
	validateLanguage,
	validateModel,
	validateOpenAIModel,
	validateSpeakers,
	validateVercelModel,
} from "../validation/input.ts";

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
		.option("--output-dir <dir>", "output directory, created if missing", ".")
		.option("-w, --words", "keep per-word timings: SRT segmentation on the local backend, a .words.json alongside it on elevenlabs")
		.option("--preset <name>", "verbatim: keep fillers, hesitations and false starts")
		.option("--prompt <text>", "initial prompt passed to the model, in the spoken language")
		.option("-b, --backend <backend>", "transcription backend (local, openai, vercel, elevenlabs)")
		.option("--diarize", "label each cue with its speaker (elevenlabs backend)")
		.option("--speakers <n>", "how many speakers to expect, 1-32 (elevenlabs backend, implies --diarize)")
		.option("--no-download", "skip yt-dlp (input must be local)")
		.option("--no-clean", "skip ffmpeg audio cleaning")
		.option("--no-chunk", "disable automatic chunking for oversized cloud uploads")
		.option("--cookies-from-browser <browser>", "load yt-dlp cookies from browser")
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
				let cookiesFromBrowser = opts.cookiesFromBrowser;
				let diarizeOverride: boolean | undefined = opts.diarize ? true : undefined;
				let speakersOverride = opts.speakers;

				if (opts.json) {
					const payload = JSON.parse(opts.json);
					parsedInput = validateInput(payload.input || inputArg);
					language = payload.language || language;
					modelOverride = payload.model || modelOverride;
					backendOverride = payload.backend || backendOverride;
					cookiesFromBrowser = payload.cookiesFromBrowser || payload.cookies_from_browser || cookiesFromBrowser;
					if (payload.diarize !== undefined) diarizeOverride = payload.diarize === true;
					if (payload.speakers !== undefined) speakersOverride = payload.speakers;
					if (payload.numSpeakers !== undefined) speakersOverride = payload.numSpeakers;
				} else {
					parsedInput = validateInput(inputArg);
				}

				const effectiveBackend = backendOverride ? validateBackend(backendOverride) : config.backend;
				// Resolved after the backend, because the set of accepted codes depends on it:
				// whisper takes ISO 639-1, Scribe also takes ISO 639-3.
				if (language) {
					language =
						effectiveBackend === "elevenlabs" ? validateElevenLabsLanguage(language) : validateLanguage(language);
				}
				if (modelOverride) {
					if (effectiveBackend === "openai") {
						validateOpenAIModel(modelOverride);
					} else if (effectiveBackend === "vercel") {
						validateVercelModel(modelOverride);
					} else if (effectiveBackend === "elevenlabs") {
						validateElevenLabsModel(modelOverride);
					} else {
						validateModel(modelOverride);
					}
				}

				// Only one backend separates speakers. Accepting these flags elsewhere would
				// return an undiarized transcript that looks like the request was honored, so
				// they are rejected where they cannot be applied rather than dropped.
				const numSpeakers = speakersOverride !== undefined ? validateSpeakers(String(speakersOverride)) : undefined;
				if ((diarizeOverride || numSpeakers !== undefined) && effectiveBackend !== "elevenlabs") {
					throw new Error(
						`--diarize and --speakers need --backend elevenlabs, got "${effectiveBackend}". No other backend returns speaker labels.`,
					);
				}
				// Naming a speaker count is a request to separate speakers; the API only returns
				// labels when diarization is on, so asking for one without the other is a no-op.
				const diarize = numSpeakers !== undefined ? true : diarizeOverride;

				const outputDir = resolve(opts.outputDir);

				if (opts.dryRun) {
					const effectiveDiarize = diarize ?? config.elevenlabs.diarize;
					const transcribeStep =
						effectiveBackend === "openai"
							? `transcribe via OpenAI ${modelOverride || config.openai.model}`
							: effectiveBackend === "vercel"
								? `transcribe via Vercel AI Gateway ${modelOverride || config.vercel.model}`
								: effectiveBackend === "elevenlabs"
									? `transcribe via ElevenLabs ${modelOverride || config.elevenlabs.model}${
											effectiveDiarize ? " (diarized)" : ""
										}`
									: "transcribe via whisper-cli";
					const downloadStep = cookiesFromBrowser
						? `download via yt-dlp with ${cookiesFromBrowser} cookies`
						: "download via yt-dlp";
					output(format, {
						json: {
							dryRun: true,
							input: parsedInput.value,
							inputType: parsedInput.type,
							backend: effectiveBackend,
							cookiesFromBrowser,
							language: language || "auto",
							...(effectiveBackend === "elevenlabs"
								? { diarize: effectiveDiarize, ...(numSpeakers !== undefined ? { speakers: numSpeakers } : {}) }
								: {}),
							model:
								effectiveBackend === "openai"
									? modelOverride || config.openai.model
									: effectiveBackend === "vercel"
										? modelOverride || config.vercel.model
										: effectiveBackend === "elevenlabs"
											? modelOverride || config.elevenlabs.model
											: modelOverride || config.modelSize,
							outputDir,
							steps: [
								...(parsedInput.type === "url" && opts.download !== false ? [downloadStep] : []),
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
				} else if (effectiveBackend === "vercel" && modelOverride) {
					effectiveConfig.vercel = { ...config.vercel, model: modelOverride };
				} else if (effectiveBackend === "elevenlabs" && modelOverride) {
					effectiveConfig.elevenlabs = {
						...config.elevenlabs,
						model: modelOverride as typeof config.elevenlabs.model,
					};
				} else if (modelOverride) {
					effectiveConfig.modelSize = modelOverride;
					effectiveConfig.modelPath = config.modelPath.replace(/ggml-[\w.-]+\.bin/, `ggml-${modelOverride}.bin`);
				}

				if (opts.words) effectiveConfig.wordTimestamps = true;

				// An explicit --prompt wins: the caller wrote it for this recording. A preset
				// resolves against the language, and when it has no prompt for that language it
				// says so rather than falling back to another one, because a prompt in the wrong
				// language steers the model worse than no prompt at all.
				let prompt: string | null = opts.prompt ?? null;
				if (prompt === null && opts.preset) {
					if (opts.preset !== "verbatim") {
						throw new Error(`unknown preset: ${opts.preset}. Available: verbatim`);
					}
					if (!language) {
						throw new Error(
							"--preset verbatim needs the spoken language: pass --language. A prompt only works in the language being transcribed.",
						);
					}
					prompt = presetPrompt("verbatim", language);
					if (prompt === null) {
						throw new Error(
							`--preset verbatim has no prompt for "${language}". Available: ${presetLanguages().join(", ")}. Write one for this recording with --prompt "<text in ${language}>".`,
						);
					}
				}

				const result = await runPipeline({
					input: parsedInput.value,
					inputType: parsedInput.type,
					config: effectiveConfig,
					outputDir,
					language: language || "auto",
					backend: effectiveBackend,
					noDownload: opts.download === false,
					noClean: opts.clean === false,
					noChunk: opts.chunk === false,
					diarize,
					numSpeakers,
					words: opts.words === true,
					cookiesFromBrowser,
					prompt,
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
