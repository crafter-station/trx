import { spawnOrThrow } from "../utils/spawn.ts";

export interface AudioResult {
	wavPath: string;
}

export async function cleanAudio(inputPath: string, outputPath: string): Promise<AudioResult> {
	await spawnOrThrow(
		[
			"ffmpeg",
			"-i",
			inputPath,
			"-af",
			"silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-40dB,dynaudnorm,afftdn=nf=-25",
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
