import { readFileSync, statSync } from "node:fs";
import type { OpenAIModel } from "../utils/config.ts";
import { spawn } from "../utils/spawn.ts";

export interface OpenAITranscribeResult {
	srtPath: string;
	txtPath: string;
	text: string;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

interface VerboseSegment {
	start: number;
	end: number;
	text: string;
}

interface VerboseResponse {
	text: string;
	segments?: VerboseSegment[];
}

export function getOpenAIKey(): string {
	const key = process.env.OPENAI_API_KEY;
	if (!key) {
		throw new Error("OPENAI_API_KEY not set. Export it in your shell: export OPENAI_API_KEY=sk-...");
	}
	return key;
}

function supportsVerboseJson(model: OpenAIModel): boolean {
	return model === "whisper-1";
}

async function probeDuration(audioPath: string): Promise<number> {
	const result = await spawn([
		"ffprobe",
		"-v",
		"quiet",
		"-show_entries",
		"format=duration",
		"-of",
		"csv=p=0",
		audioPath,
	]);
	if (result.exitCode === 0) {
		const dur = Number.parseFloat(result.stdout.trim());
		if (!Number.isNaN(dur) && dur > 0) return dur;
	}
	return 0;
}

export async function transcribeOpenAI(
	audioPath: string,
	model: OpenAIModel,
	language?: string,
): Promise<OpenAITranscribeResult> {
	const apiKey = getOpenAIKey();

	const stat = statSync(audioPath);
	if (stat.size > MAX_FILE_SIZE) {
		const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
		throw new Error(
			`File is ${sizeMB} MB — OpenAI API limit is 25 MB. Use --backend local for large files, or pre-split with ffmpeg.`,
		);
	}

	const fileBuffer = readFileSync(audioPath);
	const fileName = audioPath.split("/").pop() || "audio.wav";

	const useVerboseJson = supportsVerboseJson(model);

	const form = new FormData();
	form.append("file", new Blob([fileBuffer]), fileName);
	form.append("model", model);
	form.append("response_format", useVerboseJson ? "verbose_json" : "json");
	if (language && language !== "auto") {
		form.append("language", language);
	}
	if (useVerboseJson) {
		form.append("timestamp_granularities[]", "segment");
	}

	const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
		body: form,
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`OpenAI API error (${response.status}): ${body}`);
	}

	const json = (await response.json()) as VerboseResponse;
	const text = json.text || "";

	let srtContent: string;
	if (json.segments) {
		srtContent = segmentsToSrt(json.segments);
	} else {
		const duration = await probeDuration(audioPath);
		srtContent = textToSrt(text, duration);
	}

	const srtPath = `${audioPath}.srt`;
	const txtPath = audioPath.replace(/\.[^.]+$/, ".txt");

	await Bun.write(srtPath, srtContent);
	await Bun.write(txtPath, text);

	return { srtPath, txtPath, text };
}

function formatTimestamp(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.round((seconds % 1) * 1000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function segmentsToSrt(segments: VerboseSegment[]): string {
	return segments
		.map((seg, i) => `${i + 1}\n${formatTimestamp(seg.start)} --> ${formatTimestamp(seg.end)}\n${seg.text.trim()}\n`)
		.join("\n");
}

function textToSrt(text: string, duration: number): string {
	if (!text.trim()) return "";
	const end = duration > 0 ? formatTimestamp(duration) : formatTimestamp(0);
	return `1\n${formatTimestamp(0)} --> ${end}\n${text.trim()}\n`;
}
