import { existsSync, readFileSync } from "node:fs";
import type { TrxConfig } from "../utils/config.ts";
import { spawnOrThrow, spawnStreaming } from "../utils/spawn.ts";

export interface WhisperProgress {
	percent: number;
}

export interface WhisperResult {
	srtPath: string;
	txtPath: string;
	text: string;
}

export async function transcribe(
	wavPath: string,
	config: TrxConfig,
	languageOverride?: string,
	onProgress?: (progress: WhisperProgress) => void,
): Promise<WhisperResult> {
	if (!existsSync(config.modelPath)) {
		throw new Error(`Whisper model not found: ${config.modelPath}\nRun "trx init" to download a model.`);
	}

	const language = languageOverride || config.language;
	const args = [
		"whisper-cli",
		"-m",
		config.modelPath,
		"-f",
		wavPath,
		"-t",
		String(config.threads),
		"--max-len",
		config.wordTimestamps ? "1" : "0",
		"--output-srt",
	];

	if (language !== "auto") {
		args.push("--language", language);
	}

	const flags = config.whisperFlags;
	if (flags.suppressNst) args.push("--suppress-nst");
	if (flags.noFallback) args.push("--no-fallback");
	args.push("--max-context", String(flags.maxContext));
	args.push("--entropy-thold", String(flags.entropyThold));
	args.push("--logprob-thold", String(flags.logprobThold));

	if (onProgress) {
		args.push("--print-progress");
		await spawnStreaming(args, "whisper-cli transcription", (line) => {
			const match = line.match(/progress\s*=\s*(\d+)%/i);
			if (match) {
				onProgress({ percent: Number.parseInt(match[1], 10) });
			}
		});
	} else {
		await spawnOrThrow(args, "whisper-cli transcription");
	}

	const srtPath = `${wavPath}.srt`;
	if (!existsSync(srtPath)) {
		throw new Error(`Whisper completed but SRT file not found: ${srtPath}`);
	}

	const srtContent = readFileSync(srtPath, "utf-8");
	const text = srtToPlainText(srtContent);

	const txtPath = wavPath.replace(/\.wav$/, ".txt");
	await Bun.write(txtPath, text);

	return { srtPath, txtPath, text };
}

function srtToPlainText(srt: string): string {
	return srt
		.split("\n")
		.filter((line) => !/^\[|-->/.test(line))
		.filter((line) => !/^\d+\s*$/.test(line))
		.filter((line) => line.trim().length > 0)
		.join("\n");
}
