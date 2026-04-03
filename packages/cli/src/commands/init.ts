import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const WHISPER_CPP_RELEASE = "https://github.com/ggerganov/whisper.cpp/releases/latest/download";

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

async function installViaBrew(name: string, brewPkg: string, isTTY: boolean): Promise<boolean> {
	if (!(await isInstalled("brew"))) {
		if (isTTY) p.log.error("Homebrew not found. Install from https://brew.sh");
		return false;
	}

	const confirm = isTTY
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
		if (isTTY) p.log.error(`Failed: ${(e as Error).message}`);
		return false;
	}
}

// --- Linux: apt-get ---

async function installViaApt(name: string, aptPkg: string, isTTY: boolean): Promise<boolean> {
	if (!(await isInstalled("apt-get"))) {
		if (isTTY) p.log.error("apt-get not found. This installer supports Debian/Ubuntu. Install manually.");
		return false;
	}

	const confirm = isTTY
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

async function installWhisperLinux(isTTY: boolean): Promise<boolean> {
	for (const dep of ["git", "cmake", "make"]) {
		if (!(await isInstalled(dep))) {
			if (isTTY) p.log.error(`${dep} is required to build whisper.cpp. Install it first.`);
			return false;
		}
	}

	const confirm = isTTY
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
		await spawnOrThrow(
			["cmake", "--build", `${buildDir}/build`, "--config", "Release", "-j"],
			"cmake build",
		);

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

async function installViaWinget(name: string, wingetPkg: string, isTTY: boolean): Promise<boolean> {
	if (!(await isInstalled("winget"))) {
		if (isTTY) p.log.error("winget not found. Install App Installer from the Microsoft Store.");
		return false;
	}

	const confirm = isTTY
		? await p.confirm({ message: `${name} not found. Install via winget install ${wingetPkg}?` })
		: false;
	if (p.isCancel(confirm) || !confirm) {
		if (isTTY) p.log.warn(`Skipped ${name}. Install manually: winget install ${wingetPkg}`);
		return false;
	}

	try {
		if (isTTY) p.log.step(`Installing ${wingetPkg}...`);
		await spawnOrThrow(
			["winget", "install", "--id", wingetPkg, "--accept-source-agreements", "--accept-package-agreements"],
			`winget install ${wingetPkg}`,
		);
		if (isTTY) p.log.success(`${name} installed`);
		return true;
	} catch (e) {
		if (isTTY) p.log.error(`Failed: ${(e as Error).message}`);
		return false;
	}
}

// --- Windows: download whisper-cli binary from GitHub releases ---

async function installWhisperWindows(isTTY: boolean): Promise<boolean> {
	const confirm = isTTY
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
	const installDir = join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local"), "whisper-cpp");

	try {
		if (isTTY) p.log.step("Downloading whisper-cli...");

		await spawnOrThrow(["cmd", "/c", "mkdir", downloadDir], "create temp dir").catch(() => {});
		await spawnOrThrow(
			["curl", "-L", "--progress-bar", "-o", zipPath, downloadUrl],
			"download whisper-cli",
		);

		if (isTTY) p.log.step("Extracting...");
		await spawnOrThrow(["cmd", "/c", "mkdir", installDir], "create install dir").catch(() => {});
		await spawnOrThrow(
			["powershell", "-Command", `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${installDir}'`],
			"extract whisper-cli",
		);

		if (isTTY) {
			p.log.success("whisper-cli extracted");
			p.log.info(`Add to PATH: ${installDir}`);
			p.log.info('Run: [System.Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";' + installDir + '", "User")');
		}

		await spawn(["cmd", "/c", "rmdir", "/s", "/q", downloadDir]);
		return true;
	} catch (e) {
		if (isTTY) p.log.error(`Failed: ${(e as Error).message}`);
		await spawn(["cmd", "/c", "rmdir", "/s", "/q", downloadDir]);
		return false;
	}
}

// --- Unified dependency installer ---

async function installDep(name: string, isTTY: boolean): Promise<boolean> {
	if (await isInstalled(name)) return true;
	if (!isTTY) return false;

	const platform = getPlatform();

	if (name === "whisper-cli") {
		switch (platform) {
			case "macos":
				return installViaBrew(name, "whisper-cpp", isTTY);
			case "linux":
				return installWhisperLinux(isTTY);
			case "windows":
				return installWhisperWindows(isTTY);
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
			return installViaBrew(name, pkg, isTTY);
		case "linux":
			return installViaApt(name, pkg, isTTY);
		case "windows":
			return installViaWinget(name, pkg, isTTY);
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
		.option("-m, --model <size>", "whisper model size", "small")
		.option("-l, --language <code>", "default language (auto = detect from audio)", "auto")
		.action(async (opts, cmd) => {
			const format: OutputFormat = cmd.optsWithGlobals().output;
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const modelSize = validateModel(opts.model);
				const language = validateLanguage(opts.language);

				if (isTTY) {
					const platform = getPlatform();
					p.intro(`trx init (${platform})`);
				}

				ensureTrxDir();

				if (isTTY) p.log.step("Checking dependencies...");

				const [hasWhisper, hasYtdlp, hasFfmpeg] = await Promise.all([
					installDep("whisper-cli", isTTY),
					installDep("yt-dlp", isTTY),
					installDep("ffmpeg", isTTY),
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
