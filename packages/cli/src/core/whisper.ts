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

export function buildWhisperArgs(config: WhisperConfig, wavPath: string, language: string): string[] {
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

	// --max-len 1 caps a cue at one token, not one word, so without this a multi-token word
	// arrives split: "Crafter" as "Cra" + "fter". The result still looks word-level, since
	// every cue holds one token and no spaces, which is what makes the omission expensive:
	// anything matching on word text silently misses the fragments and nothing reports it.
	// Measured on 91s of Spanish with large-v3-turbo: 26% of cues were fragments without this
	// flag, 0% with it.
	if (config.wordTimestamps) {
		args.push("--split-on-word");
	}

	if (language !== "auto") {
		args.push("--language", language);
	}

	const flags = config.whisperFlags;
	if (flags.suppressNst) args.push("--suppress-nst");
	if (flags.noFallback) args.push("--no-fallback");
	args.push("--max-context", String(flags.maxContext));
	args.push("--entropy-thold", String(flags.entropyThold));
	args.push("--logprob-thold", String(flags.logprobThold));

	return args;
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
	const args = buildWhisperArgs(config, wavPath, language);

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
