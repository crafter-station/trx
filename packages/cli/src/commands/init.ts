import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import { getElevenLabsKey } from "../core/elevenlabs.ts";
import {
	activateManagedBin,
	type Backend,
	defaultConfig,
	ensureTrxDir,
	getBinDir,
	getModelsDir,
	writeConfig,
} from "../utils/config.ts";
import { type OutputFormat, output, outputError } from "../utils/output.ts";
import { spawn, spawnOrThrow } from "../utils/spawn.ts";
import {
	validateBackend,
	validateElevenLabsModel,
	validateLanguage,
	validateModel,
	validateOpenAIModel,
	validateVercelModel,
} from "../validation/input.ts";

const MODELS = [
	{ value: "tiny", label: "tiny (~75 MB)", hint: "fastest, lowest accuracy" },
	{ value: "base", label: "base (~142 MB)", hint: "fast, decent accuracy" },
	{ value: "small", label: "small (~466 MB)", hint: "balanced speed/accuracy (recommended)" },
	{ value: "medium", label: "medium (~1.5 GB)", hint: "slow, high accuracy" },
	{ value: "large", label: "large (~3 GB)", hint: "slowest, best accuracy" },
	{ value: "large-v3-turbo", label: "large-v3-turbo (~1.6 GB)", hint: "near-large accuracy, ~3x faster" },
];

const OPENAI_MODELS = [
	{ value: "gpt-4o-transcribe", label: "gpt-4o-transcribe", hint: "best accuracy ($2.50/hr)" },
	{ value: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe", hint: "fastest, cheapest ($0.60/hr)" },
	{ value: "whisper-1", label: "whisper-1", hint: "legacy ($0.36/hr)" },
];

const ELEVENLABS_MODELS = [
	{ value: "scribe_v2", label: "scribe_v2", hint: "latest, diarization + word timestamps" },
	{ value: "scribe_v1", label: "scribe_v1", hint: "previous generation" },
];

const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const WHISPER_CPP_RELEASE = "https://github.com/ggml-org/whisper.cpp/releases/download/b4938";
const WHISPER_WINDOWS_X64_SHA256 = "c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d";

type Platform = "macos" | "linux" | "windows";

function getPlatform(): Platform {
	switch (process.platform) {
		case "darwin":
			return "macos";
		case "win32":
			return "windows";
		default:
			return "linux";
	}
}

async function isInstalled(name: string): Promise<boolean> {
	const cmd = getPlatform() === "windows" ? ["where", name] : ["which", name];
	const result = await spawn(cmd);
	return result.exitCode === 0;
}

// --- macOS: Homebrew ---

async function installViaBrew(name: string, brewPkg: string, isTTY: boolean, yes: boolean): Promise<boolean> {
	if (!(await isInstalled("brew"))) {
		if (isTTY) p.log.error("Homebrew not found. Install from https://brew.sh");
		return false;
	}

	const confirm = yes
		? true
		: isTTY
			? await p.confirm({ message: `${name} not found. Install via brew install ${brewPkg}?` })
			: false;
	if (p.isCancel(confirm) || !confirm) {
		if (isTTY) p.log.warn(`Skipped ${name}. Install manually: brew install ${brewPkg}`);
		return false;
	}

	try {
		if (isTTY) p.log.step(`Installing ${brewPkg}...`);
		await spawnOrThrow(["brew", "install", brewPkg], `brew install ${brewPkg}`);
		if (isTTY) p.log.success(`${name} installed`);
		return true;
	} catch (e) {
		const raw = (e as Error).message;
		if (await isInstalled(name)) {
			if (isTTY) p.log.success(`${name} installed (verified despite brew lock)`);
			return true;
		}

		const isLockError = raw.includes("already locked") || raw.includes("Another `brew");
		if (isLockError) {
			if (isTTY) p.log.warn(`brew lock detected for ${name}, bottle was likely installed, verifying...`);

			try {
				await spawn(["sh", "-c", "rm -f ~/Library/Caches/Homebrew/downloads/*.incomplete 2>/dev/null; echo ok"]);
			} catch {}

			if (await isInstalled(name)) {
				if (isTTY) p.log.success(`${name} installed`);
				return true;
			}

			if (isTTY) p.log.step(`Retrying brew install ${brewPkg} after lock cleanup...`);
			try {
				await spawnOrThrow(["brew", "install", brewPkg], `brew install ${brewPkg} (retry)`);
				if (isTTY) p.log.success(`${name} installed`);
				return true;
			} catch (retryErr) {
				if (await isInstalled(name)) {
					if (isTTY) p.log.success(`${name} installed (verified on retry)`);
					return true;
				}
				if (isTTY) p.log.error(`Retry failed: ${(retryErr as Error).message}`);
			}
		}

		if (isTTY) p.log.error(`Failed: ${raw}`);
		return false;
	}
}

// --- Linux: apt-get ---

async function installViaApt(name: string, aptPkg: string, isTTY: boolean, yes: boolean): Promise<boolean> {
	if (!(await isInstalled("apt-get"))) {
		if (isTTY) p.log.error("apt-get not found. This installer supports Debian/Ubuntu. Install manually.");
		return false;
	}

	const confirm = yes
		? true
		: isTTY
			? await p.confirm({ message: `${name} not found. Install via sudo apt-get install ${aptPkg}?` })
			: false;
	if (p.isCancel(confirm) || !confirm) {
		if (isTTY) p.log.warn(`Skipped ${name}. Install manually: sudo apt-get install ${aptPkg}`);
		return false;
	}

	try {
		if (isTTY) p.log.step(`Installing ${aptPkg}...`);
		await spawnOrThrow(["sudo", "apt-get", "install", "-y", aptPkg], `apt-get install ${aptPkg}`);
		if (isTTY) p.log.success(`${name} installed`);
		return true;
	} catch (e) {
		if (isTTY) p.log.error(`Failed: ${(e as Error).message}`);
		return false;
	}
}

// --- Linux: compile whisper.cpp from source ---

async function installWhisperLinux(isTTY: boolean, yes: boolean): Promise<boolean> {
	for (const dep of ["git", "cmake", "make"]) {
		if (!(await isInstalled(dep))) {
			if (isTTY) p.log.error(`${dep} is required to build whisper.cpp. Install it first.`);
			return false;
		}
	}

	const confirm = yes
		? true
		: isTTY
			? await p.confirm({ message: "whisper-cli not found. Build from source (whisper.cpp)?" })
			: false;
	if (p.isCancel(confirm) || !confirm) {
		if (isTTY) p.log.warn("Skipped whisper-cli. See: https://github.com/ggerganov/whisper.cpp");
		return false;
	}

	const buildDir = join(tmpdir(), "whisper-cpp-build");
	try {
		if (isTTY) p.log.step("Cloning whisper.cpp...");
		if (existsSync(buildDir)) {
			await spawnOrThrow(["rm", "-rf", buildDir], "clean old build dir");
		}
		await spawnOrThrow(
			["git", "clone", "--depth", "1", "https://github.com/ggerganov/whisper.cpp.git", buildDir],
			"git clone whisper.cpp",
		);

		if (isTTY) p.log.step("Building whisper.cpp (this may take a few minutes)...");
		await spawnOrThrow(["cmake", "-B", `${buildDir}/build`, "-S", buildDir], "cmake configure");
		await spawnOrThrow(["cmake", "--build", `${buildDir}/build`, "--config", "Release", "-j"], "cmake build");

		if (isTTY) p.log.step("Installing whisper-cli to /usr/local/bin...");
		const binaryPath = `${buildDir}/build/bin/whisper-cli`;
		if (!existsSync(binaryPath)) {
			throw new Error(`Build succeeded but binary not found at ${binaryPath}`);
		}
		await spawnOrThrow(["sudo", "cp", binaryPath, "/usr/local/bin/whisper-cli"], "install whisper-cli");

		if (isTTY) p.log.success("whisper-cli installed");

		// cleanup
		await spawn(["rm", "-rf", buildDir]);
		return true;
	} catch (e) {
		if (isTTY) p.log.error(`Failed to build whisper.cpp: ${(e as Error).message}`);
		await spawn(["rm", "-rf", buildDir]);
		return false;
	}
}

// --- Windows: winget ---

async function refreshWindowsPath(): Promise<void> {
	const result = await spawn([
		"powershell",
		"-NoProfile",
		"-Command",
		"[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
	]);
	if (result.exitCode === 0 && result.stdout) {
		process.env.PATH = `${process.env.PATH || ""};${result.stdout}`;
		activateManagedBin();
	}
}

async function copyWindowsBinaries(name: string): Promise<boolean> {
	const binaries = name === "ffmpeg" ? ["ffmpeg", "ffprobe"] : [name];
	for (const binary of binaries) {
		const result = await spawn(["where", binary]);
		const source = result.stdout.split(/\r?\n/).find(Boolean);
		if (result.exitCode !== 0 || !source || !existsSync(source)) return false;
		copyFileSync(source, join(getBinDir(), `${binary}.exe`));
	}
	activateManagedBin();
	return true;
}

async function installViaWinget(name: string, wingetPkg: string, isTTY: boolean, yes: boolean): Promise<boolean> {
	if (!(await isInstalled("winget"))) {
		if (isTTY) p.log.error("winget not found. Install App Installer from the Microsoft Store.");
		return false;
	}

	const confirm = yes
		? true
		: isTTY
			? await p.confirm({ message: `${name} not found. Install via winget install ${wingetPkg}?` })
			: false;
	if (p.isCancel(confirm) || !confirm) {
		if (isTTY) p.log.warn(`Skipped ${name}. Install manually: winget install ${wingetPkg}`);
		return false;
	}

	try {
		if (isTTY) p.log.step(`Installing ${wingetPkg}...`);
		await spawnOrThrow(
			[
				"winget",
				"install",
				"--id",
				wingetPkg,
				"--exact",
				"--disable-interactivity",
				"--accept-source-agreements",
				"--accept-package-agreements",
			],
			`winget install ${wingetPkg}`,
		);
		await refreshWindowsPath();
		if (!(await isInstalled(name)) || !(await copyWindowsBinaries(name))) {
			if (isTTY) p.log.error(`${name} was installed but is not available on PATH`);
			return false;
		}
		if (isTTY) p.log.success(`${name} installed`);
		return true;
	} catch (e) {
		if (isTTY) p.log.error(`Failed: ${(e as Error).message}`);
		return false;
	}
}

// --- Windows: download whisper-cli binary from GitHub releases ---

async function installWhisperWindows(isTTY: boolean, yes: boolean): Promise<boolean> {
	const confirm = yes
		? true
		: isTTY
			? await p.confirm({ message: "whisper-cli not found. Download pre-built binary from GitHub?" })
			: false;
	if (p.isCancel(confirm) || !confirm) {
		if (isTTY) p.log.warn("Skipped whisper-cli. See: https://github.com/ggerganov/whisper.cpp/releases");
		return false;
	}

	const zipName = "whisper-bin-x64.zip";
	const downloadUrl = `${WHISPER_CPP_RELEASE}/${zipName}`;
	const downloadDir = join(tmpdir(), "whisper-download");
	const zipPath = join(downloadDir, zipName);
	const extractDir = join(downloadDir, "extracted");
	const installDir = getBinDir();

	try {
		if (isTTY) p.log.step("Downloading whisper-cli...");

		rmSync(downloadDir, { recursive: true, force: true });
		mkdirSync(extractDir, { recursive: true });
		await spawnOrThrow(["curl", "-L", "--progress-bar", "-o", zipPath, downloadUrl], "download whisper-cli");
		const digest = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
		if (digest !== WHISPER_WINDOWS_X64_SHA256) {
			throw new Error(`whisper-cli checksum mismatch: expected ${WHISPER_WINDOWS_X64_SHA256}, got ${digest}`);
		}

		if (isTTY) p.log.step("Extracting...");
		const escapedZipPath = zipPath.replaceAll("'", "''");
		const escapedExtractDir = extractDir.replaceAll("'", "''");
		await spawnOrThrow(
			[
				"powershell",
				"-NoProfile",
				"-Command",
				`Expand-Archive -Force -LiteralPath '${escapedZipPath}' -DestinationPath '${escapedExtractDir}'`,
			],
			"extract whisper-cli",
		);
		const releaseDir = join(extractDir, "Release");
		if (!existsSync(join(releaseDir, "whisper-cli.exe"))) {
			throw new Error(`whisper-cli.exe not found in ${zipName}`);
		}
		for (const entry of readdirSync(releaseDir)) {
			copyFileSync(join(releaseDir, entry), join(installDir, entry));
		}
		activateManagedBin();
		if (!(await isInstalled("whisper-cli"))) {
			throw new Error(`whisper-cli was extracted but is not available from ${installDir}`);
		}

		if (isTTY) {
			p.log.success(`whisper-cli installed in ${installDir}`);
		}

		rmSync(downloadDir, { recursive: true, force: true });
		return true;
	} catch (e) {
		if (isTTY) p.log.error(`Failed: ${(e as Error).message}`);
		rmSync(downloadDir, { recursive: true, force: true });
		return false;
	}
}

// --- Unified dependency installer ---

async function installDep(name: string, isTTY: boolean, yes: boolean): Promise<boolean> {
	if (await isInstalled(name)) return true;
	if (!isTTY && !yes) return false;

	const platform = getPlatform();

	if (name === "whisper-cli") {
		switch (platform) {
			case "macos":
				return installViaBrew(name, "whisper-cpp", isTTY, yes);
			case "linux":
				return installWhisperLinux(isTTY, yes);
			case "windows":
				return installWhisperWindows(isTTY, yes);
		}
	}

	const packages: Record<string, Record<Platform, string>> = {
		"yt-dlp": { macos: "yt-dlp", linux: "yt-dlp", windows: "yt-dlp.yt-dlp" },
		ffmpeg: { macos: "ffmpeg", linux: "ffmpeg", windows: "Gyan.FFmpeg" },
	};

	const pkg = packages[name]?.[platform];
	if (!pkg) {
		if (isTTY) p.log.error(`No installer configured for ${name} on ${platform}`);
		return false;
	}

	switch (platform) {
		case "macos":
			return installViaBrew(name, pkg, isTTY, yes);
		case "linux":
			return installViaApt(name, pkg, isTTY, yes);
		case "windows":
			return installViaWinget(name, pkg, isTTY, yes);
	}
}

// --- Model download ---

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

// --- Agent skill ---

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

// --- Init command ---

export function createInitCommand(): Command {
	return new Command("init")
		.description("Install dependencies and download Whisper model")
		.option("-b, --backend <backend>", "transcription backend (local, openai, vercel)")
		.option("-m, --model <size>", "whisper model size", "small")
		.option("-l, --language <code>", "default language (auto = detect from audio)", "auto")
		.option("-y, --yes", "install missing dependencies without prompting")
		.action(async (opts, cmd) => {
			const format: OutputFormat = cmd.optsWithGlobals().output;
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const language = validateLanguage(opts.language);

				if (isTTY) {
					const platform = getPlatform();
					p.intro(`trx init (${platform})`);
				}

				ensureTrxDir();

				let selectedBackend: Backend = opts.backend ? validateBackend(opts.backend) : "local";
				if (isTTY && !cmd.getOptionValueSource("backend")) {
					const choice = await p.select({
						message: "Transcription backend:",
						options: [
							{ value: "local", label: "Local (whisper.cpp)", hint: "free, private, offline" },
							{ value: "openai", label: "OpenAI API", hint: "fast, requires API key" },
							{ value: "vercel", label: "Vercel AI Gateway", hint: "any provider, requires AI_GATEWAY_API_KEY" },
							{
								value: "elevenlabs",
								label: "ElevenLabs Scribe",
								hint: "speaker diarization, requires ELEVENLABS_API_KEY",
							},
						],
						initialValue: "local",
					});
					if (p.isCancel(choice)) {
						p.cancel("Init cancelled");
						process.exit(0);
					}
					selectedBackend = choice as Backend;
				}

				if (selectedBackend === "elevenlabs") {
					// Resolved through the same path the transcribe run uses, so init cannot pass on a
					// key that later turns out to be unreachable.
					const hasKey = await getElevenLabsKey().then(
						() => true,
						() => false,
					);
					if (!hasKey) {
						outputError(
							"ELEVENLABS_API_KEY not set. Get one at https://elevenlabs.io/app/settings/api-keys and export it: export ELEVENLABS_API_KEY=...",
							format,
						);
						return;
					}
					if (isTTY) p.log.success("ELEVENLABS_API_KEY detected");

					let selectedModel = "scribe_v2";
					if (isTTY && !cmd.getOptionValueSource("model")) {
						const choice = await p.select({
							message: "Select Scribe model:",
							options: ELEVENLABS_MODELS,
							initialValue: "scribe_v2",
						});
						if (p.isCancel(choice)) {
							p.cancel("Init cancelled");
							process.exit(0);
						}
						selectedModel = choice as string;
					} else if (cmd.getOptionValueSource("model")) {
						selectedModel = validateElevenLabsModel(opts.model);
					}

					let diarize = false;
					if (isTTY) {
						const answer = await p.confirm({
							message: "Separate speakers by default? (diarization)",
							initialValue: false,
						});
						if (p.isCancel(answer)) {
							p.cancel("Init cancelled");
							process.exit(0);
						}
						diarize = answer === true;
					}

					if (isTTY) p.log.step("Checking ffmpeg + yt-dlp (still needed for download/clean)...");
					const hasFfmpeg = await installDep("ffmpeg", isTTY, opts.yes === true);
					const hasYtdlp = await installDep("yt-dlp", isTTY, opts.yes === true);
					if (!hasYtdlp || !hasFfmpeg) {
						const missing = [!hasYtdlp && "yt-dlp", !hasFfmpeg && "ffmpeg"].filter(Boolean).join(", ");
						outputError(`Missing dependencies: ${missing}`, format);
						return;
					}

					const config = defaultConfig("small", language, "elevenlabs");
					config.elevenlabs.model = selectedModel as typeof config.elevenlabs.model;
					config.elevenlabs.diarize = diarize;
					writeConfig(config);

					if (isTTY) p.log.step("Agent skill setup...");
					const skillInstalled = await installSkill(isTTY && opts.yes !== true);

					if (isTTY) {
						p.outro(`trx is ready (elevenlabs, ${selectedModel}). Run: trx <url-or-file>`);
					}

					output(format, {
						json: {
							success: true,
							backend: "elevenlabs",
							model: selectedModel,
							diarize,
							language,
							skillInstalled,
							config,
						},
					});
					return;
				}

				if (selectedBackend === "vercel") {
					const apiKey = process.env.AI_GATEWAY_API_KEY;
					if (!apiKey) {
						outputError(
							"AI_GATEWAY_API_KEY not set. Get one at https://vercel.com/docs/ai-gateway and export it: export AI_GATEWAY_API_KEY=...",
							format,
						);
						return;
					}
					if (isTTY) p.log.success("AI_GATEWAY_API_KEY detected");

					let selectedModel = "openai/whisper-1";
					if (isTTY && !cmd.getOptionValueSource("model")) {
						const answer = await p.text({
							message: "Gateway model (creator/model-name):",
							initialValue: "openai/whisper-1",
							validate: (value) => {
								try {
									validateVercelModel(value);
									return undefined;
								} catch (e) {
									return (e as Error).message;
								}
							},
						});
						if (p.isCancel(answer)) {
							p.cancel("Init cancelled");
							process.exit(0);
						}
						selectedModel = answer as string;
					} else if (cmd.getOptionValueSource("model")) {
						selectedModel = validateVercelModel(opts.model);
					}

					if (isTTY) p.log.step("Checking ffmpeg + yt-dlp (still needed for download/clean)...");
					const hasFfmpeg = await installDep("ffmpeg", isTTY, opts.yes === true);
					const hasYtdlp = await installDep("yt-dlp", isTTY, opts.yes === true);
					if (!hasYtdlp || !hasFfmpeg) {
						const missing = [!hasYtdlp && "yt-dlp", !hasFfmpeg && "ffmpeg"].filter(Boolean).join(", ");
						outputError(`Missing dependencies: ${missing}`, format);
						return;
					}

					const config = defaultConfig("small", language, "vercel");
					config.vercel.model = selectedModel;
					writeConfig(config);

					if (isTTY) p.log.step("Agent skill setup...");
					const skillInstalled = await installSkill(isTTY && opts.yes !== true);

					if (isTTY) {
						p.outro(`trx is ready (vercel gateway, ${selectedModel}). Run: trx <url-or-file>`);
					}

					output(format, {
						json: {
							success: true,
							backend: "vercel",
							model: selectedModel,
							language,
							skillInstalled,
							config,
						},
					});
					return;
				}

				if (selectedBackend === "openai") {
					const apiKey = process.env.OPENAI_API_KEY;
					if (!apiKey) {
						outputError("OPENAI_API_KEY not set. Export it: export OPENAI_API_KEY=sk-...", format);
						return;
					}
					if (isTTY) p.log.success("OPENAI_API_KEY detected");

					let selectedModel = "gpt-4o-transcribe";
					if (isTTY && !cmd.getOptionValueSource("model")) {
						const choice = await p.select({
							message: "Select OpenAI model:",
							options: OPENAI_MODELS,
							initialValue: "gpt-4o-transcribe",
						});
						if (p.isCancel(choice)) {
							p.cancel("Init cancelled");
							process.exit(0);
						}
						selectedModel = choice as string;
					} else if (opts.model) {
						selectedModel = validateOpenAIModel(opts.model);
					}

					if (isTTY) p.log.step("Checking ffmpeg + yt-dlp (still needed for download/clean)...");
					const hasFfmpeg = await installDep("ffmpeg", isTTY, opts.yes === true);
					const hasYtdlp = await installDep("yt-dlp", isTTY, opts.yes === true);
					if (!hasYtdlp || !hasFfmpeg) {
						const missing = [!hasYtdlp && "yt-dlp", !hasFfmpeg && "ffmpeg"].filter(Boolean).join(", ");
						outputError(`Missing dependencies: ${missing}`, format);
						return;
					}

					const config = defaultConfig("small", language, "openai");
					config.openai.model = selectedModel as typeof config.openai.model;
					writeConfig(config);

					if (isTTY) p.log.step("Agent skill setup...");
					const skillInstalled = await installSkill(isTTY && opts.yes !== true);

					if (isTTY) {
						p.outro(`trx is ready (openai/${selectedModel}). Run: trx <url-or-file>`);
					}

					output(format, {
						json: {
							success: true,
							backend: "openai",
							model: selectedModel,
							language,
							skillInstalled,
							config,
						},
					});
					return;
				}

				const modelSize = validateModel(opts.model);

				if (isTTY) p.log.step("Checking dependencies...");

				// install sequentially on macOS to avoid brew lock contention
				const hasWhisper = await installDep("whisper-cli", isTTY, opts.yes === true);
				const hasFfmpeg = await installDep("ffmpeg", isTTY, opts.yes === true);
				const hasYtdlp = await installDep("yt-dlp", isTTY, opts.yes === true);

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

				const config = defaultConfig(selectedModel, language, "local");
				config.modelPath = modelPath;
				writeConfig(config);

				if (isTTY) p.log.step("Agent skill setup...");
				const skillInstalled = await installSkill(isTTY && opts.yes !== true);

				if (isTTY) {
					p.outro("trx is ready. Run: trx <url-or-file>");
				}

				output(format, {
					json: {
						success: true,
						backend: "local",
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
