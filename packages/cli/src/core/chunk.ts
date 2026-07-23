import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { spawn } from "../utils/spawn.ts";

const SAFETY_MARGIN = 0.9;
const PCM_BYTES_PER_SECOND = 16000 * 1 * 2;

export interface AudioChunk {
	path: string;
	durationSeconds: number;
}

export interface SrtChunk {
	srt: string;
	durationSeconds: number;
}

export async function probeDuration(audioPath: string): Promise<number> {
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
		const duration = Number.parseFloat(result.stdout.trim());
		if (!Number.isNaN(duration) && duration > 0) return duration;
	}
	return 0;
}

export async function chunkAudio(
	audioPath: string,
	maxBytes: number,
	outputDir = dirname(audioPath),
): Promise<AudioChunk[]> {
	const duration = await probeDuration(audioPath);
	if (duration <= 0) {
		throw new Error(`Could not determine audio duration for chunking: ${audioPath}`);
	}

	await mkdir(outputDir, { recursive: true });

	const extension = extname(audioPath) || ".wav";
	const stem = basename(audioPath, extension);
	const prefix = `${stem}.chunk-`;
	const outputPattern = join(outputDir, `${prefix}%03d${extension}`);
	const bytesPerSecond = statSync(audioPath).size / duration;
	const segmentDuration = (maxBytes * SAFETY_MARGIN) / bytesPerSecond;

	await removeMatchingFiles(outputDir, prefix);

	try {
		const splitResult = await spawn([
			"ffmpeg",
			"-y",
			"-i",
			audioPath,
			"-map",
			"0:a:0",
			"-f",
			"segment",
			"-segment_time",
			formatSegmentDuration(segmentDuration),
			"-reset_timestamps",
			"1",
			"-c",
			"copy",
			outputPattern,
		]);
		if (splitResult.exitCode !== 0) {
			throw new Error(`ffmpeg chunking failed: ${splitResult.stderr || splitResult.stdout}`);
		}

		const splitPaths = listMatchingFiles(outputDir, prefix, extension);
		if (splitPaths.length === 0) {
			throw new Error("ffmpeg chunking produced no output files");
		}

		const finalPaths: string[] = [];
		for (const splitPath of splitPaths) {
			if (statSync(splitPath).size <= maxBytes) {
				finalPaths.push(splitPath);
				continue;
			}

			const reencodedPaths = await reencodeOversizedChunk(splitPath, maxBytes);
			finalPaths.push(...reencodedPaths);
			await unlink(splitPath);
		}

		return await Promise.all(
			finalPaths.map(async (path) => {
				const chunkDuration = await probeDuration(path);
				if (chunkDuration <= 0) {
					throw new Error(`Could not determine chunk duration: ${path}`);
				}
				return { path, durationSeconds: chunkDuration };
			}),
		);
	} catch (error) {
		await removeMatchingFiles(outputDir, prefix);
		throw error;
	}
}

export function stitchSrt(chunks: SrtChunk[]): string {
	const entries: string[] = [];
	let offsetSeconds = 0;
	let sequence = 1;

	for (const chunk of chunks) {
		const blocks = chunk.srt
			.trim()
			.split(/\r?\n\r?\n/)
			.filter(Boolean);
		for (const block of blocks) {
			const lines = block.split(/\r?\n/);
			const timestampIndex = lines.findIndex((line) => parseTimestampLine(line) !== null);
			if (timestampIndex === -1) continue;

			const timestamps = parseTimestampLine(lines[timestampIndex]);
			if (!timestamps) continue;

			const text = lines.slice(timestampIndex + 1).join("\n");
			const offsetMilliseconds = Math.round(offsetSeconds * 1000);
			entries.push(
				`${sequence}\n${formatTimestamp(timestamps.start + offsetMilliseconds)} --> ${formatTimestamp(timestamps.end + offsetMilliseconds)}\n${text}`,
			);
			sequence += 1;
		}
		offsetSeconds += chunk.durationSeconds;
	}

	return entries.length > 0 ? `${entries.join("\n\n")}\n` : "";
}

async function reencodeOversizedChunk(splitPath: string, maxBytes: number): Promise<string[]> {
	const extension = extname(splitPath);
	const outputDir = dirname(splitPath);
	const stem = basename(splitPath, extension);
	const prefix = `${stem}.pcm-`;
	const outputPattern = join(outputDir, `${prefix}%03d.wav`);
	const segmentDuration = (maxBytes * SAFETY_MARGIN) / PCM_BYTES_PER_SECOND;

	const result = await spawn([
		"ffmpeg",
		"-y",
		"-i",
		splitPath,
		"-map",
		"0:a:0",
		"-f",
		"segment",
		"-segment_time",
		formatSegmentDuration(segmentDuration),
		"-reset_timestamps",
		"1",
		"-c:a",
		"pcm_s16le",
		"-ar",
		"16000",
		"-ac",
		"1",
		outputPattern,
	]);
	if (result.exitCode !== 0) {
		throw new Error(`ffmpeg chunk re-encoding failed: ${result.stderr || result.stdout}`);
	}

	const paths = listMatchingFiles(outputDir, prefix, ".wav");
	if (paths.length === 0) {
		throw new Error(`ffmpeg chunk re-encoding produced no output for ${splitPath}`);
	}
	for (const path of paths) {
		if (statSync(path).size > maxBytes) {
			throw new Error(`Re-encoded chunk still exceeds the byte limit: ${path}`);
		}
	}
	return paths;
}

function formatSegmentDuration(seconds: number): string {
	return Math.max(seconds, 0.001).toFixed(3);
}

function listMatchingFiles(outputDir: string, prefix: string, extension?: string): string[] {
	if (!existsSync(outputDir)) return [];
	return readdirSync(outputDir)
		.filter((name) => name.startsWith(prefix) && (!extension || name.endsWith(extension)))
		.sort()
		.map((name) => join(outputDir, name));
}

async function removeMatchingFiles(outputDir: string, prefix: string): Promise<void> {
	await Promise.all(listMatchingFiles(outputDir, prefix).map((path) => unlink(path)));
}

function parseTimestampLine(line: string): { start: number; end: number } | null {
	const match = line.match(/^(\d+):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d+):(\d{2}):(\d{2}),(\d{3})$/);
	if (!match) return null;

	return {
		start: timestampToMilliseconds(match[1], match[2], match[3], match[4]),
		end: timestampToMilliseconds(match[5], match[6], match[7], match[8]),
	};
}

function timestampToMilliseconds(hours: string, minutes: string, seconds: string, milliseconds: string): number {
	return (
		(Number.parseInt(hours, 10) * 3600 + Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10)) * 1000 +
		Number.parseInt(milliseconds, 10)
	);
}

function formatTimestamp(milliseconds: number): string {
	const totalSeconds = Math.floor(milliseconds / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const remainingMilliseconds = milliseconds % 1000;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(remainingMilliseconds).padStart(3, "0")}`;
}
