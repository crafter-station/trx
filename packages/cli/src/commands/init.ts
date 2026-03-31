import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import { Command } from "commander";
import { defaultConfig, ensureTrxDir, getModelsDir, writeConfig } from "../utils/config.ts";
import { type OutputFormat, output, outputError } from "../utils/output.ts";
import { spawn, spawnOrThrow } from "../utils/spawn.ts";
import { validateLanguage, validateModel } from "../validation/input.ts";

const MODELS = [
	{ value: "tiny", label: "tiny (~75 MB)", hint: "fastest, lowest accuracy" },
	{ value: "base", label: "base (~142 MB)", hint: "fast, decent accuracy" },
	{ value: "small", label: "small (~466 MB)", hint: "balanced speed/accuracy (recommended)" },
	{ value: "medium", label: "medium (~1.5 GB)", hint: "slow, high accuracy" },
	{ value: "large", label: "large (~3 GB)", hint: "slowest, best accuracy" },
];

const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

async function checkAndInstallDep(name: string, brewPackage: string, isTTY: boolean): Promise<boolean> {
	const which = await spawn(["which", name]);
	if (which.exitCode === 0) return true;

	if (!isTTY) {
		return false;
	}

	const install = await p.confirm({
		message: `${name} is not installed. Install via Homebrew (brew install ${brewPackage})?`,
	});

	if (p.isCancel(install) || !install) {
		p.log.warn(`Skipped ${name}. Install manually: brew install ${brewPackage}`);
		return false;
	}

	try {
		p.log.step(`Installing ${brewPackage}...`);
		await spawnOrThrow(["brew", "install", brewPackage], `brew install ${brewPackage}`);
		p.log.success(`${name} installed`);
		return true;
	} catch (e) {
		p.log.error(`Failed to install ${brewPackage}: ${(e as Error).message}`);
		return false;
	}
}

async function downloadModel(modelSize: string, modelsDir: string, isTTY: boolean): Promise<string> {
	const modelFile = `ggml-${modelSize}.bin`;
	const modelPath = `${modelsDir}/${modelFile}`;

	if (existsSync(modelPath)) {
		if (isTTY) p.log.success(`Model ${modelSize} already downloaded`);
		return modelPath;
	}

	const url = `${HF_BASE}/${modelFile}`;
	if (isTTY) p.log.step(`Downloading ${modelFile} from Hugging Face...`);

	await spawnOrThrow(["curl", "-L", "--progress-bar", "-o", modelPath, url], `Download model ${modelSize}`);

	if (!existsSync(modelPath)) {
		throw new Error(`Model download completed but file not found: ${modelPath}`);
	}

	return modelPath;
}

async function installSkill(isTTY: boolean): Promise<boolean> {
	if (!isTTY) return false;

	const install = await p.confirm({
		message: "Install agent skill? (lets AI agents use trx with post-processing)",
	});

	if (p.isCancel(install) || !install) {
		p.log.info("Skipped. Install later: npx skills add crafter-station/trx -g");
		return false;
	}

	try {
		const proc = Bun.spawn(["npx", "skills", "add", "crafter-station/trx", "-g"], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		const exitCode = await proc.exited;
		return exitCode === 0;
	} catch {
		p.log.warn("npx skills not available. Install manually: npx skills add crafter-station/trx -g");
		return false;
	}
}

export function createInitCommand(): Command {
	return new Command("init")
		.description("Install dependencies and download Whisper model")
		.option("-m, --model <size>", "whisper model size", "small")
		.option("-l, --language <code>", "default language", "auto")
		.action(async (opts, cmd) => {
			const format: OutputFormat = cmd.optsWithGlobals().output;
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const modelSize = validateModel(opts.model);
				const language = validateLanguage(opts.language);

				if (isTTY) {
					p.intro("trx init");
				}

				ensureTrxDir();

				if (isTTY) p.log.step("Checking dependencies...");

				const [hasWhisper, hasYtdlp, hasFfmpeg] = await Promise.all([
					checkAndInstallDep("whisper-cli", "whisper-cpp", isTTY),
					checkAndInstallDep("yt-dlp", "yt-dlp", isTTY),
					checkAndInstallDep("ffmpeg", "ffmpeg", isTTY),
				]);

				if (!hasWhisper || !hasYtdlp || !hasFfmpeg) {
					const missing = [!hasWhisper && "whisper-cli", !hasYtdlp && "yt-dlp", !hasFfmpeg && "ffmpeg"]
						.filter(Boolean)
						.join(", ");
					outputError(`Missing dependencies: ${missing}`, format);
					return;
				}

				let selectedModel = modelSize;
				if (isTTY && !cmd.getOptionValueSource("model")) {
					const choice = await p.select({
						message: "Select Whisper model:",
						options: MODELS,
						initialValue: "small",
					});
					if (p.isCancel(choice)) {
						p.cancel("Init cancelled");
						process.exit(0);
					}
					selectedModel = validateModel(choice as string);
				}

				const modelsDir = getModelsDir();
				const modelPath = await downloadModel(selectedModel, modelsDir, isTTY);

				const config = defaultConfig(selectedModel, language);
				config.modelPath = modelPath;
				writeConfig(config);

				if (isTTY) p.log.step("Agent skill setup...");
				const skillInstalled = await installSkill(isTTY);

				if (isTTY) {
					p.outro("trx is ready. Run: trx <url-or-file>");
				}

				output(format, {
					json: {
						success: true,
						model: selectedModel,
						language,
						modelPath,
						skillInstalled,
						config,
					},
				});
			} catch (e) {
				outputError((e as Error).message, format);
			}
		});
}
