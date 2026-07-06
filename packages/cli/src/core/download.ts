import { existsSync } from "node:fs";
import { spawn } from "../utils/spawn.ts";

export interface DownloadResult {
	filePath: string;
	title: string;
}

export interface DownloadOptions {
	cookiesFromBrowser?: string;
}

export async function downloadMedia(url: string, outputDir: string, opts: DownloadOptions = {}): Promise<DownloadResult> {
	const basename = `trx-${Date.now()}`;
	const outputTemplate = `${outputDir}/${basename}.%(ext)s`;

	const args = ["yt-dlp", "--no-playlist", "-o", outputTemplate, "--print", "after_move:filepath"];
	if (opts.cookiesFromBrowser) {
		args.push("--cookies-from-browser", opts.cookiesFromBrowser);
	}
	args.push(url);

	const result = await spawn(args);

	if (result.exitCode !== 0) {
		const hint =
			!opts.cookiesFromBrowser && /Instagram|empty media response|login|cookies/i.test(result.stderr)
				? "\nHint: retry with --cookies-from-browser chrome for Instagram or private URLs."
				: "";
		throw new Error(`yt-dlp download failed: ${result.stderr}${hint}`);
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
