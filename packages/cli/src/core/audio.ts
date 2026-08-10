import { spawn, spawnOrThrow } from "../utils/spawn.ts";

export interface AudioResult {
	wavPath: string;
}

/**
 * Level and noise only. Every filter here preserves duration, so a timestamp in the
 * transcript means the same instant in the file the caller handed in.
 *
 * `silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-40dB` used to lead this
 * chain and was removed: deleting pauses rewrites the timeline, so every cue after the first
 * removed pause was early and the error accumulated rather than being a constant offset a
 * consumer could subtract. Measured on one 90.538s recording, the audio that reached the
 * model ran 88.966s, and nothing in the output said the timeline had changed. Anything using
 * those timestamps against the original file was quietly wrong.
 *
 * It also bought nothing. Same recording, with and against without: 436 cues either way, and
 * the run without it was faster (7.6s against 8.7s) because dropping pauses costs more in the
 * filter than the shorter audio saves in the model. The only measurable effects were the
 * broken timeline and the loss of the pauses that hesitations live around, which is where a
 * verbatim prompt does its work.
 */
export async function cleanAudio(inputPath: string, outputPath: string): Promise<AudioResult> {
	await spawnOrThrow(
		[
			"ffmpeg",
			"-i",
			inputPath,
			"-af",
			"dynaudnorm,afftdn=nf=-25",
			"-ar",
			"16000",
			"-ac",
			"1",
			"-c:a",
			"pcm_s16le",
			outputPath,
			"-y",
		],
		"ffmpeg audio cleaning",
	);

	return { wavPath: outputPath };
}

/**
 * Duration in milliseconds, or null when it cannot be read.
 *
 * Null rather than a throw: this exists to describe a result that already succeeded, and a
 * missing number is worth reporting as missing rather than failing a transcription over.
 */
export async function durationMs(path: string): Promise<number | null> {
	const { stdout, exitCode } = await spawn([
		"ffprobe",
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"default=noprint_wrappers=1:nokey=1",
		path,
	]);
	if (exitCode !== 0) {
		return null;
	}
	const seconds = Number(stdout.trim());
	return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

/**
 * Where the last cue ends, which is not the same as how long the audio ran. The gap between
 * the two is how much audio produced no words, and reading it is what separates "this
 * recording is mostly silence" from "the transcription stopped early".
 */
export function lastCueEndMs(srt: string): number | null {
	let latest: number | null = null;
	for (const line of srt.split("\n")) {
		const match = line.match(/-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
		if (match === null) {
			continue;
		}
		const [, hours, minutes, secs, millis] = match;
		const end = (Number(hours) * 3600 + Number(minutes) * 60 + Number(secs)) * 1000 + Number(millis);
		if (latest === null || end > latest) {
			latest = end;
		}
	}
	return latest;
}
