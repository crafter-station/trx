import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../bin/trx.ts");

async function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, FORCE_COLOR: "0" },
	});
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const exitCode = await proc.exited;
	return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function parseJSON(output: string): unknown {
	return JSON.parse(output);
}

describe("trx --help", () => {
	test("prints usage and exits 0", async () => {
		const { stdout, exitCode } = await run(["--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("Agent-first CLI");
		expect(stdout).toContain("transcribe");
		expect(stdout).toContain("doctor");
		expect(stdout).toContain("schema");
		expect(stdout).toContain("init");
	});

	test("prints version", async () => {
		const { stdout, exitCode } = await run(["--version"]);
		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/^\d+\.\d+\.\d+$/);
	});
});

describe("trx doctor", () => {
	test("returns healthy JSON with all deps", async () => {
		const { stdout, exitCode } = await run(["doctor", "--output", "json"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data).toHaveProperty("healthy");
		expect(data).toHaveProperty("dependencies");
		expect(data).toHaveProperty("config");

		const deps = data.dependencies as Record<string, Record<string, unknown>>;
		expect(deps).toHaveProperty("whisper-cli");
		expect(deps).toHaveProperty("yt-dlp");
		expect(deps).toHaveProperty("ffmpeg");

		for (const dep of Object.values(deps)) {
			expect(dep).toHaveProperty("installed");
			expect(dep).toHaveProperty("path");
		}
	});

	test("config section reports model info", async () => {
		const { stdout } = await run(["doctor", "--output", "json"]);
		const data = parseJSON(stdout) as Record<string, unknown>;
		const config = data.config as Record<string, unknown>;
		expect(config).toHaveProperty("exists");
		expect(config).toHaveProperty("path");
		expect(config).toHaveProperty("modelsDir");
	});
});

describe("trx schema", () => {
	test("transcribe schema returns valid JSON with command info", async () => {
		const { stdout, exitCode } = await run(["schema", "transcribe"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.command).toBe("transcribe");
		expect(data).toHaveProperty("arguments");
		expect(data).toHaveProperty("flags");
		expect(data).toHaveProperty("output");
		expect(data).toHaveProperty("examples");

		const flags = data.flags as Record<string, unknown>;
		expect(flags).toHaveProperty("--language");
		expect(flags).toHaveProperty("--model");
		expect(flags).toHaveProperty("--dry-run");
		expect(flags).toHaveProperty("--fields");
		expect(flags).toHaveProperty("--output");
	});

	test("init schema returns valid JSON with deps info", async () => {
		const { stdout, exitCode } = await run(["schema", "init"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.command).toBe("init");
		expect(data).toHaveProperty("dependencies");
		expect(data).toHaveProperty("flags");

		const deps = data.dependencies as Record<string, unknown>;
		expect(deps).toHaveProperty("whisper-cli");
		expect(deps).toHaveProperty("yt-dlp");
		expect(deps).toHaveProperty("ffmpeg");
	});

	test("unknown schema exits with error", async () => {
		const { stderr, exitCode } = await run(["schema", "nonexistent"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Unknown schema");
	});
});

describe("trx transcribe --dry-run", () => {
	test("validates URL input and shows execution plan", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://youtube.com/watch?v=test123",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.dryRun).toBe(true);
		expect(data.inputType).toBe("url");
		expect(data.input).toBe("https://youtube.com/watch?v=test123");
		expect(data).toHaveProperty("language");
		expect(data).toHaveProperty("model");
		expect(data).toHaveProperty("steps");

		const steps = data.steps as string[];
		expect(steps).toContain("download via yt-dlp");
		expect(steps).toContain("clean audio via ffmpeg");
		expect(steps).toContain("transcribe via whisper-cli");
	});

	test("validates local file input (nonexistent file fails)", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"/tmp/nonexistent-file.mp4",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("File not found");
	});

	test("--no-download removes download step", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--dry-run",
			"--no-download",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		const steps = data.steps as string[];
		expect(steps).not.toContain("download via yt-dlp");
		expect(steps).toContain("clean audio via ffmpeg");
	});

	test("--no-clean removes ffmpeg step", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--dry-run",
			"--no-clean",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		const steps = data.steps as string[];
		expect(steps).toContain("download via yt-dlp");
		expect(steps).not.toContain("clean audio via ffmpeg");
	});
});

describe("input validation", () => {
	test("rejects path traversal in URL", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://evil.com/../../etc/passwd",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("path traversal");
	});

	test("rejects path traversal in file path", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"../../etc/passwd",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("traversal");
	});

	test("rejects URL-encoded file paths", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"/tmp/%2e%2e/etc/passwd",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("URL-encoded");
	});

	test("rejects invalid language code", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--language",
			"klingon",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("Unsupported language");
	});

	test("rejects invalid model name", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--model",
			"gigantic",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("Unknown model");
	});

	test("accepts valid language codes", async () => {
		for (const lang of ["es", "en", "pt", "fr", "auto"]) {
			const { exitCode } = await run([
				"transcribe",
				"https://example.com/video.mp4",
				"--language",
				lang,
				"--dry-run",
				"--output",
				"json",
			]);
			expect(exitCode).toBe(0);
		}
	});

	test("accepts valid model names", async () => {
		for (const model of ["tiny", "base", "small", "medium", "large"]) {
			const { exitCode } = await run([
				"transcribe",
				"https://example.com/video.mp4",
				"--model",
				model,
				"--dry-run",
				"--output",
				"json",
			]);
			expect(exitCode).toBe(0);
		}
	});
});

describe("trx transcribe (real file)", () => {
	const testWav = resolve(import.meta.dir, "fixtures/silence.wav");

	test("transcribes a real WAV file", async () => {
		const { existsSync } = await import("node:fs");
		if (!existsSync(testWav)) {
			console.log("Generating test fixture: 2s silence WAV");
			const fixturesDir = resolve(import.meta.dir, "fixtures");
			await Bun.spawn(["mkdir", "-p", fixturesDir]).exited;
			const proc = Bun.spawn([
				"ffmpeg",
				"-f",
				"lavfi",
				"-i",
				"anullsrc=r=16000:cl=mono",
				"-t",
				"2",
				"-c:a",
				"pcm_s16le",
				testWav,
				"-y",
			]);
			await proc.exited;
		}

		const { stdout, exitCode } = await run([
			"transcribe",
			testWav,
			"--no-clean",
			"--output",
			"json",
			"--output-dir",
			"/tmp",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(true);
		expect(data).toHaveProperty("files");
		expect(data).toHaveProperty("metadata");
		expect(data).toHaveProperty("text");

		const files = data.files as Record<string, string>;
		expect(files).toHaveProperty("srt");
		expect(files).toHaveProperty("txt");

		const metadata = data.metadata as Record<string, string>;
		expect(metadata).toHaveProperty("model");
		expect(metadata).toHaveProperty("language");
	}, 30000);

	test("--fields text returns only text", async () => {
		const { existsSync } = await import("node:fs");
		if (!existsSync(testWav)) return;

		const { stdout, exitCode } = await run([
			"transcribe",
			testWav,
			"--no-clean",
			"--fields",
			"text",
			"--output",
			"json",
			"--output-dir",
			"/tmp",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(true);
		expect(data).toHaveProperty("text");
		expect(data).not.toHaveProperty("files");
		expect(data).not.toHaveProperty("metadata");
	}, 30000);
});

describe("trx shorthand", () => {
	test("trx <url> delegates to transcribe", async () => {
		const { stdout, exitCode } = await run([
			"https://example.com/video.mp4",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.dryRun).toBe(true);
		expect(data.inputType).toBe("url");
	});
});
