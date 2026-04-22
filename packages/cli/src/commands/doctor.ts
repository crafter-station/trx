import { existsSync } from "node:fs";
import { Command } from "commander";
import { getConfigPath, getModelsDir, readConfig } from "../utils/config.ts";
import { type OutputFormat, output, outputError } from "../utils/output.ts";
import { spawn } from "../utils/spawn.ts";

interface DepStatus {
	installed: boolean;
	version: string | null;
	path: string | null;
}

async function checkBinary(name: string): Promise<DepStatus> {
	const binPath = Bun.which(name);
	if (!binPath) {
		return { installed: false, version: null, path: null };
	}

	const ver = await spawn([name, "--version"]);
	const version = ver.exitCode === 0 ? ver.stdout.split("\n")[0].trim() : null;

	return { installed: true, version, path: binPath };
}

export function createDoctorCommand(): Command {
	return new Command("doctor").description("Check dependencies and configuration status").action(async (_, cmd) => {
		const format: OutputFormat = cmd.optsWithGlobals().output;

		const [whisper, ytdlp, ffmpeg] = await Promise.all([
			checkBinary("whisper-cli"),
			checkBinary("yt-dlp"),
			checkBinary("ffmpeg"),
		]);

		const config = readConfig();
		const configPath = getConfigPath();
		const modelsDir = getModelsDir();
		const modelExists = config ? existsSync(config.modelPath) : false;

		const backend = config?.backend || "local";
		const hasApiKey = !!process.env.OPENAI_API_KEY;
		const isOpenAI = backend === "openai";
		const coreDepsOk = ytdlp.installed && ffmpeg.installed;
		const localDepsOk = coreDepsOk && whisper.installed;
		const healthy = isOpenAI
			? coreDepsOk && !!config && hasApiKey
			: localDepsOk && !!config && modelExists;

		const data = {
			healthy,
			backend,
			dependencies: { "whisper-cli": whisper, "yt-dlp": ytdlp, ffmpeg },
			openai: {
				apiKey: hasApiKey,
				model: config?.openai?.model || "gpt-4o-transcribe",
			},
			config: {
				exists: !!config,
				path: configPath,
				modelsDir,
				...(config
					? {
							modelSize: config.modelSize,
							modelPath: config.modelPath,
							modelExists,
							language: config.language,
						}
					: {}),
			},
		};

		if (format === "json") {
			output(format, { json: data });
		} else {
			console.log("\ntrx doctor\n");
			console.log(`  Backend: ${backend}`);
			if (isOpenAI) {
				console.log(`  API Key: ${hasApiKey ? "\u2713" : "\u2717 (OPENAI_API_KEY not set)"}`);
				console.log(`  API Model: ${config?.openai?.model || "gpt-4o-transcribe"}`);
			}
			console.log();
			const deps = isOpenAI
				? ([
						["yt-dlp", ytdlp],
						["ffmpeg", ffmpeg],
					] as const)
				: ([
						["whisper-cli", whisper],
						["yt-dlp", ytdlp],
						["ffmpeg", ffmpeg],
					] as const);
			for (const [name, dep] of deps) {
				const status = dep.installed ? "\u2713" : "\u2717";
				const ver = dep.version ? ` (${dep.version})` : "";
				console.log(`  ${status} ${name}${ver}`);
			}
			console.log();
			if (config) {
				console.log(`  Config: ${configPath}`);
				if (!isOpenAI) {
					console.log(`  Model: ${config.modelSize} ${modelExists ? "\u2713" : "\u2717 (not downloaded)"}`);
				}
				console.log(`  Language: ${config.language}`);
			} else {
				console.log('  Config: not found. Run "trx init" to set up.');
			}
			console.log();

			if (!healthy) {
				const issues: string[] = [];
				if (isOpenAI && !hasApiKey) issues.push("OPENAI_API_KEY not set");
				if (!coreDepsOk) issues.push('missing dependencies — run "trx init"');
				if (!isOpenAI && !whisper.installed) issues.push('whisper-cli missing — run "trx init"');
				outputError(issues.join("; "), "table");
			}
		}
	});
}
