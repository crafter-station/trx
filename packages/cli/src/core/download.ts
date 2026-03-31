import { existsSync } from "node:fs";
import { spawn } from "../utils/spawn.ts";

export interface DownloadResult {
	filePath: string;
	title: string;
}

export async function downloadMedia(url: string, outputDir: string): Promise<DownloadResult> {
	const basename = `trx-${Date.now()}`;
	const outputTemplate = `${outputDir}/${basename}.%(ext)s`;

	const result = await spawn(["yt-dlp", "--no-playlist", "-o", outputTemplate, "--print", "after_move:filepath", url]);

	if (result.exitCode !== 0) {
		throw new Error(`yt-dlp download failed: ${result.stderr}`);
	}

	const downloadedPath = result.stdout.split("\n").pop()?.trim();
	if (!downloadedPath || !existsSync(downloadedPath)) {
		const possibleFiles = await findDownloadedFile(outputDir, basename);
		if (!possibleFiles) {
			throw new Error(`Download completed but file not found. yt-dlp output: ${result.stdout}`);
		}
		return { filePath: possibleFiles, title: basename };
	}

	return { filePath: downloadedPath, title: basename };
}

async function findDownloadedFile(dir: string, basename: string): Promise<string | null> {
	const glob = new Bun.Glob(`${basename}.*`);
	for await (const file of glob.scan({ cwd: dir })) {
		return `${dir}/${file}`;
	}
	return null;
}
