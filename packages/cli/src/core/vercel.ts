import { readFileSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { chunkAudio, stitchSrt } from "./chunk.ts";

export interface VercelTranscribeResult {
	srtPath: string;
	txtPath: string;
	text: string;
}

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v4/ai/transcription-model";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB (base64 payload limit guard)

export interface VercelTranscribeOptions {
	onStep?: (step: string) => void;
	noChunk?: boolean;
}

interface GatewaySegment {
	startSecond?: number;
	endSecond?: number;
	start?: number;
	end?: number;
	text: string;
}

interface GatewayResponse {
	text: string;
	segments?: GatewaySegment[];
	language?: string;
	durationInSeconds?: number;
	warnings?: unknown[];
}

const MEDIA_TYPES: Record<string, string> = {
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".m4a": "audio/mp4",
	".ogg": "audio/ogg",
	".flac": "audio/flac",
	".webm": "audio/webm",
	".mp4": "video/mp4",
	".mkv": "video/x-matroska",
	".avi": "video/x-msvideo",
	".mov": "video/quicktime",
};

export function getGatewayKey(): string {
	const key = process.env.AI_GATEWAY_API_KEY;
	if (!key) {
		throw new Error(
			"AI_GATEWAY_API_KEY not set. Get one at https://vercel.com/docs/ai-gateway and export it: export AI_GATEWAY_API_KEY=...",
		);
	}
	return key;
}

function mediaTypeFor(path: string): string {
	const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
	return MEDIA_TYPES[ext] || "audio/wav";
}

export async function transcribeVercel(
	audioPath: string,
	model: string,
	language?: string,
	options: VercelTranscribeOptions = {},
): Promise<VercelTranscribeResult> {
	const apiKey = getGatewayKey();

	const stat = statSync(audioPath);
	if (stat.size > MAX_FILE_SIZE) {
		if (!options.noChunk) {
			return transcribeVercelChunks(audioPath, model, language, apiKey, options.onStep);
		}
		const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
		throw new Error(
			`File is ${sizeMB} MB, over the ${MAX_FILE_SIZE / 1024 / 1024} MB limit for the gateway backend. Use --backend local for large files, or pre-split with ffmpeg.`,
		);
	}

	return transcribeVercelSingle(audioPath, model, language, apiKey);
}

async function transcribeVercelSingle(
	audioPath: string,
	model: string,
	language: string | undefined,
	apiKey: string,
): Promise<VercelTranscribeResult> {
	const fileBuffer = readFileSync(audioPath);

	const response = await fetch(GATEWAY_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"ai-model-id": model,
			// protocol headers required by the gateway, matching @ai-sdk/gateway
			"ai-gateway-protocol-version": "0.0.1",
			"ai-transcription-model-specification-version": "4",
			"ai-gateway-auth-method": "api-key",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			audio: fileBuffer.toString("base64"),
			mediaType: mediaTypeFor(audioPath),
			...(language && language !== "auto" ? { language } : {}),
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Vercel AI Gateway error (${response.status}): ${body}`);
	}

	const json = (await response.json()) as GatewayResponse;
	const text = json.text || "";

	let srtContent: string;
	if (json.segments && json.segments.length > 0) {
		srtContent = segmentsToSrt(json.segments);
	} else {
		srtContent = textToSrt(text, json.durationInSeconds || 0);
	}

	const srtPath = `${audioPath}.srt`;
	const txtPath = audioPath.replace(/\.[^.]+$/, ".txt");

	await Bun.write(srtPath, srtContent);
	await Bun.write(txtPath, text);

	return { srtPath, txtPath, text };
}

async function transcribeVercelChunks(
	audioPath: string,
	model: string,
	language: string | undefined,
	apiKey: string,
	onStep?: (step: string) => void,
): Promise<VercelTranscribeResult> {
	const chunks = await chunkAudio(audioPath, MAX_FILE_SIZE);
	const results: Array<{ text: string; srt: string; durationSeconds: number }> = [];

	try {
		for (const [index, chunk] of chunks.entries()) {
			onStep?.(`Transcribing chunk ${index + 1}/${chunks.length}...`);
			const result = await transcribeVercelSingle(chunk.path, model, language, apiKey);
			results.push({
				text: result.text,
				srt: await Bun.file(result.srtPath).text(),
				durationSeconds: chunk.durationSeconds,
			});
		}

		const text = results
			.map((result) => result.text.trim())
			.filter(Boolean)
			.join(" ");
		const srtContent = stitchSrt(results);
		const srtPath = `${audioPath}.srt`;
		const txtPath = audioPath.replace(/\.[^.]+$/, ".txt");

		await Bun.write(srtPath, srtContent);
		await Bun.write(txtPath, text);

		return { srtPath, txtPath, text };
	} finally {
		await removeChunkArtifacts(chunks.map((chunk) => chunk.path));
	}
}

async function removeChunkArtifacts(chunkPaths: string[]): Promise<void> {
	const paths = chunkPaths.flatMap((path) => [path, `${path}.srt`, path.replace(/\.[^.]+$/, ".txt")]);
	await Promise.allSettled(paths.map((path) => unlink(path)));
}

function formatTimestamp(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	const ms = Math.round((seconds % 1) * 1000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function segmentsToSrt(segments: GatewaySegment[]): string {
	return segments
		.map((seg, i) => {
			const start = seg.startSecond ?? seg.start ?? 0;
			const end = seg.endSecond ?? seg.end ?? start;
			return `${i + 1}\n${formatTimestamp(start)} --> ${formatTimestamp(end)}\n${seg.text.trim()}\n`;
		})
		.join("\n");
}

function textToSrt(text: string, duration: number): string {
	if (!text.trim()) return "";
	const end = formatTimestamp(duration > 0 ? duration : 0);
	return `1\n${formatTimestamp(0)} --> ${end}\n${text.trim()}\n`;
}
