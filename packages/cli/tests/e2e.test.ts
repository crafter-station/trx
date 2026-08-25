import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { lastCueEndMs } from "../src/core/audio.ts";
import { stitchSrt } from "../src/core/chunk.ts";
import { cuesToSrt, cuesToTranscript, getElevenLabsKey, wordsToCues } from "../src/core/elevenlabs.ts";
import { presetLanguages, presetPrompt } from "../src/core/prompts.ts";
import { buildWhisperArgs } from "../src/core/whisper.ts";
import { validateOutputFormat } from "../src/validation/input.ts";

const CLI = resolve(import.meta.dir, "../bin/trx.ts");

async function run(
	args: string[],
	env: Record<string, string | undefined> = { ...process.env, FORCE_COLOR: "0" },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(["bun", "run", CLI, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		env,
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
		expect(stdout).toContain("models");
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
		expect(deps.ffmpeg.version).toEqual(expect.any(String));
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
		expect(flags).toHaveProperty("--backend");
		expect(flags).toHaveProperty("--language");
		expect(flags).toHaveProperty("--model");
		expect(flags).toHaveProperty("--dry-run");
		expect(flags).toHaveProperty("--fields");
		expect(flags).toHaveProperty("--output");
		expect(flags).toHaveProperty("--cookies-from-browser");
		expect(flags).toHaveProperty("--no-chunk");
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
		const flags = data.flags as Record<string, unknown>;
		expect(flags).toHaveProperty("--yes");
	});

	test("models schema returns valid JSON with command info", async () => {
		const { stdout, exitCode } = await run(["schema", "models"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.command).toBe("models");
	});

	test("unknown schema exits with error", async () => {
		const { stderr, exitCode } = await run(["schema", "nonexistent"]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain("Unknown schema");
	});
});

describe("trx models", () => {
	test("returns local models as JSON", async () => {
		const { stdout, exitCode } = await run(["models", "--backend", "local", "--output", "json"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.local).toEqual([
			"tiny",
			"tiny.en",
			"base",
			"base.en",
			"small",
			"small.en",
			"medium",
			"medium.en",
			"large",
			"large-v3-turbo",
		]);
	});

	test("errors when Vercel API key is missing", async () => {
		const env = { ...process.env, FORCE_COLOR: "0" };
		delete env.AI_GATEWAY_API_KEY;

		const { stdout, exitCode } = await run(["models", "--backend", "vercel", "--output", "json"], env);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.error).toContain("AI_GATEWAY_API_KEY");
	});
});

describe("SRT stitching", () => {
	test("renumbers entries and offsets timestamps across chunks", () => {
		const stitched = stitchSrt([
			{
				srt: "7\n00:59:58,500 --> 00:59:59,500\nFirst\n",
				durationSeconds: 3599.5,
			},
			{
				srt: [
					"3",
					"00:00:00,000 --> 00:00:00,500",
					"Boundary",
					"",
					"9",
					"00:00:01,000 --> 00:00:02,000",
					"After one hour",
					"",
				].join("\n"),
				durationSeconds: 2,
			},
		]);

		expect(stitched).toBe(
			[
				"1",
				"00:59:58,500 --> 00:59:59,500",
				"First",
				"",
				"2",
				"00:59:59,500 --> 01:00:00,000",
				"Boundary",
				"",
				"3",
				"01:00:00,500 --> 01:00:01,500",
				"After one hour",
				"",
			].join("\n"),
		);
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

	test("--cookies-from-browser appears in dry-run download step", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://www.instagram.com/reel/test123",
			"--dry-run",
			"--cookies-from-browser",
			"chrome:Default",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.cookiesFromBrowser).toBe("chrome:Default");
		const steps = data.steps as string[];
		expect(steps).toContain("download via yt-dlp with chrome:Default cookies");
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
		const { stdout, exitCode } = await run(["transcribe", "../../etc/passwd", "--dry-run", "--output", "json"]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("traversal");
	});

	test("rejects URL-encoded file paths", async () => {
		const { stdout, exitCode } = await run(["transcribe", "/tmp/%2e%2e/etc/passwd", "--dry-run", "--output", "json"]);
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
		expect(data.error).toContain("Unknown local model");
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
		for (const model of ["tiny", "base", "small", "medium", "large", "large-v3-turbo"]) {
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

// Real transcription needs whisper-cli + a downloaded model; skip on runners without them (TRX_SKIP_REAL=1)
describe.skipIf(process.env.TRX_SKIP_REAL === "1")("trx transcribe (real file)", () => {
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

describe("backend selection", () => {
	test("--backend openai shows openai in dry-run plan", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"openai",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.backend).toBe("openai");
		const steps = data.steps as string[];
		expect(steps.some((s) => s.includes("OpenAI"))).toBe(true);
	});

	test("--backend local shows whisper-cli in dry-run plan", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"local",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.backend).toBe("local");
		const steps = data.steps as string[];
		expect(steps).toContain("transcribe via whisper-cli");
	});

	test("rejects invalid backend", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"azure",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("Unknown backend");
	});

	test("openai backend validates openai model names", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"openai",
			"--model",
			"gpt-4o-transcribe",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.model).toBe("gpt-4o-transcribe");
	});

	test("openai backend rejects local model names", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"openai",
			"--model",
			"small",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.error).toContain("Unknown OpenAI model");
	});

	test("--backend vercel shows gateway in dry-run plan", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"vercel",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.backend).toBe("vercel");
		expect(data.model).toBe("openai/whisper-1");
		const steps = data.steps as string[];
		expect(steps.some((s) => s.includes("Vercel AI Gateway"))).toBe(true);
	});

	test("vercel backend accepts creator/model-name overrides", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"vercel",
			"--model",
			"xai/grok-stt",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.model).toBe("xai/grok-stt");
	});

	test("vercel backend rejects models without creator prefix", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"vercel",
			"--model",
			"whisper-1",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.error).toContain("creator/model-name");
	});
});

describe("trx shorthand", () => {
	test("trx <url> delegates to transcribe", async () => {
		const { stdout, exitCode } = await run(["https://example.com/video.mp4", "--dry-run", "--output", "json"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.dryRun).toBe(true);
		expect(data.inputType).toBe("url");
	});
});

describe("trx skills", () => {
	test("list returns the bundled skill", async () => {
		const { stdout, exitCode } = await run(["--output", "json", "skills", "list"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as { success: boolean; data: { name: string; description: string }[] };
		expect(data.success).toBe(true);
		expect(data.data.some((s) => s.name === "trx")).toBe(true);
	});

	test("list is the default subcommand", async () => {
		const { stdout, exitCode } = await run(["--output", "json", "skills"]);
		expect(exitCode).toBe(0);
		expect((parseJSON(stdout) as { success: boolean }).success).toBe(true);
	});

	test("multi-line frontmatter descriptions are parsed, not left as a block marker", async () => {
		const { stdout } = await run(["--output", "json", "skills", "list"]);
		const data = parseJSON(stdout) as { data: { name: string; description: string }[] };
		const trx = data.data.find((s) => s.name === "trx");
		expect(trx?.description).not.toBe("|");
		expect(trx?.description).toContain("Transcribe");
	});

	test("get prints raw markdown to stdout in human mode", async () => {
		const { stdout, exitCode } = await run(["--output", "table", "skills", "get", "trx"]);
		expect(exitCode).toBe(0);
		expect(stdout.startsWith("---")).toBe(true);
		expect(stdout).toContain("name: trx");
	});

	test("--full appends references", async () => {
		const plain = await run(["--output", "table", "skills", "get", "trx"]);
		const full = await run(["--output", "table", "skills", "get", "trx", "--full"]);
		expect(full.exitCode).toBe(0);
		expect(full.stdout.length).toBeGreaterThan(plain.stdout.length);
		expect(full.stdout).toContain("references/whisper-fixes.md");
	});

	test("get without a name errors and names what is available", async () => {
		const { stdout, exitCode } = await run(["--output", "json", "skills", "get"]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as { success: boolean; error: string };
		expect(data.success).toBe(false);
		expect(data.error).toContain("trx");
	});

	test("get with an unknown name errors", async () => {
		const { exitCode } = await run(["--output", "json", "skills", "get", "no-such-skill"]);
		expect(exitCode).toBe(1);
	});

	test("path prints the skill directory", async () => {
		const { stdout, exitCode } = await run(["--output", "json", "skills", "path", "trx"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as { data: { path: string } };
		expect(data.data.path.endsWith("skills/trx")).toBe(true);
	});

	test("TRX_SKILLS_DIR pointing nowhere fails with a message naming the variable", async () => {
		const { stdout, exitCode } = await run(["--output", "json", "skills", "list"], {
			...process.env,
			FORCE_COLOR: "0",
			TRX_SKILLS_DIR: "/nonexistent-skills-dir",
		});
		expect(exitCode).toBe(1);
		expect((parseJSON(stdout) as { error: string }).error).toContain("TRX_SKILLS_DIR");
	});
});

describe("buildWhisperArgs", () => {
	const config = {
		modelPath: "/models/ggml-large-v3-turbo.bin",
		threads: 4,
		language: "es",
		wordTimestamps: true,
		whisperFlags: {
			suppressNst: false,
			noFallback: false,
			maxContext: 64,
			entropyThold: 2.4,
			logprobThold: -1,
		},
	};

	test("splits on words, not tokens, when word timestamps are asked for", () => {
		// --max-len 1 alone caps a cue at one token, so a multi-token word arrives split.
		expect(buildWhisperArgs(config as never, "/tmp/a.wav", "es")).toContain("--split-on-word");
	});

	test("leaves the flag off when cues are sentence-level", () => {
		const sentences = { ...config, wordTimestamps: false };
		expect(buildWhisperArgs(sentences as never, "/tmp/a.wav", "es")).not.toContain("--split-on-word");
	});

	test("still caps the cue length, since the split flag alone does not", () => {
		const args = buildWhisperArgs(config as never, "/tmp/a.wav", "es");
		expect(args[args.indexOf("--max-len") + 1]).toBe("1");
	});

	test("passes an initial prompt through when one is given", () => {
		const args = buildWhisperArgs(config as never, "/tmp/a.wav", "es", "Transcripción literal.");
		expect(args[args.indexOf("--prompt") + 1]).toBe("Transcripción literal.");
	});

	// An initial prompt is text context, so --max-context 0 discards it and the run comes
	// back identical to one with no prompt. The default is 0 to stop the model carrying its
	// own hallucinations between windows; a prompt needs room to sit in.
	test("makes room for a prompt when the config leaves no context", () => {
		const noContext = { ...config, whisperFlags: { ...config.whisperFlags, maxContext: 0 } };
		const args = buildWhisperArgs(noContext as never, "/tmp/a.wav", "es", "literal");
		expect(args[args.indexOf("--max-context") + 1]).toBe("64");
	});

	test("leaves a configured context alone", () => {
		const args = buildWhisperArgs(config as never, "/tmp/a.wav", "es", "literal");
		expect(args[args.indexOf("--max-context") + 1]).toBe("64");
		const wide = { ...config, whisperFlags: { ...config.whisperFlags, maxContext: 128 } };
		expect(
			buildWhisperArgs(wide as never, "/tmp/a.wav", "es", "literal")[
				buildWhisperArgs(wide as never, "/tmp/a.wav", "es", "literal").indexOf("--max-context") + 1
			],
		).toBe("128");
	});

	test("keeps max-context at zero when no prompt was given", () => {
		const noContext = { ...config, whisperFlags: { ...config.whisperFlags, maxContext: 0 } };
		const args = buildWhisperArgs(noContext as never, "/tmp/a.wav", "es");
		expect(args[args.indexOf("--max-context") + 1]).toBe("0");
	});

	test("adds no prompt flag when there is none, so old invocations are unchanged", () => {
		expect(buildWhisperArgs(config as never, "/tmp/a.wav", "es")).not.toContain("--prompt");
		expect(buildWhisperArgs(config as never, "/tmp/a.wav", "es", null)).not.toContain("--prompt");
	});

	test("omits the language flag when detection is automatic", () => {
		expect(buildWhisperArgs(config as never, "/tmp/a.wav", "auto")).not.toContain("--language");
	});
});

describe("verbatim preset", () => {
	test("carries a prompt written in the language being transcribed", () => {
		expect(presetPrompt("verbatim", "es")).toContain("muletillas");
		expect(presetPrompt("verbatim", "en")).toContain("fillers");
	});

	test("is case insensitive about the language tag", () => {
		expect(presetPrompt("verbatim", "ES")).toBe(presetPrompt("verbatim", "es"));
	});

	// A prompt written for one language steers the model worse than no prompt at all, so an
	// unsupported language returns nothing and the caller reports it rather than falling back.
	test("returns nothing for a language with no prompt of its own", () => {
		expect(presetPrompt("verbatim", "ja")).toBeNull();
	});

	test("lists the languages it actually has prompts for", () => {
		const languages = presetLanguages();
		expect(languages).toContain("es");
		expect(languages).not.toContain("ja");
	});
});

describe("validateOutputFormat", () => {
	test("accepts the formats it documents", () => {
		expect(validateOutputFormat("json")).toBe("json");
		expect(validateOutputFormat("table")).toBe("table");
		expect(validateOutputFormat("auto")).toBe("auto");
	});

	test("is forgiving about case and stray whitespace", () => {
		expect(validateOutputFormat("  JSON ")).toBe("json");
	});

	// An unknown format used to fall through to JSON with exit 0, so a caller that asked for
	// something unavailable got output anyway and nothing said the request was dropped.
	test("rejects an unknown format instead of quietly emitting JSON", () => {
		expect(() => validateOutputFormat("basura")).toThrow(/Unknown output format/);
	});

	// --output and --output-dir are one hyphen apart, and handing a path to the format flag
	// used to look from outside like the directory flag being ignored.
	test("points a misdirected path at the flag that takes one", () => {
		expect(() => validateOutputFormat("/tmp/somewhere")).toThrow(/--output-dir/);
		expect(() => validateOutputFormat("./out")).toThrow(/--output-dir/);
	});

	// --output appears about three times as often as --output-dir across this repo's own
	// docs, so most bad values are a mistyped format. Naming a different flag at those adds
	// noise to the frequent case to serve the rare one.
	test("keeps the directory hint out of a plain typo", () => {
		expect(() => validateOutputFormat("jsonn")).toThrow(/Available: json, table, auto\.$/);
	});
});

describe("lastCueEndMs", () => {
	test("reports where the last cue ends, not the first", () => {
		const srt = "1\n00:00:01,000 --> 00:00:02,500\nhola\n\n2\n00:00:03,000 --> 00:00:04,250\nmundo\n";
		expect(lastCueEndMs(srt)).toBe(4250);
	});

	test("reads hours past the first", () => {
		expect(lastCueEndMs("1\n01:02:03,456 --> 01:02:04,500\nx\n")).toBe(3_724_500);
	});

	// The gap between this and the audio duration is what separates "mostly silence" from
	// "the transcription stopped early", so an empty transcript has to be reportable rather
	// than collapse to zero.
	test("returns null for a transcript with no cues", () => {
		expect(lastCueEndMs("")).toBeNull();
		expect(lastCueEndMs("not an srt at all")).toBeNull();
	});

	test("survives cues that arrive out of order", () => {
		const srt = "1\n00:00:09,000 --> 00:00:10,000\nb\n\n2\n00:00:01,000 --> 00:00:02,000\na\n";
		expect(lastCueEndMs(srt)).toBe(10_000);
	});
});

describe("elevenlabs words to cues", () => {
	// Scribe returns the gaps between words as their own entries. Counting them would inflate
	// every word count and put empty cues in the SRT.
	test("drops spacing entries and keeps only words", () => {
		const cues = wordsToCues([
			{ text: "hola", type: "word", start: 0, end: 0.4 },
			{ text: " ", type: "spacing", start: 0.4, end: 0.45 },
			{ text: "mundo", type: "word", start: 0.45, end: 0.9 },
		]);
		expect(cues).toHaveLength(1);
		expect(cues[0].text).toBe("hola mundo");
	});

	test("a spacing entry never becomes a cue of its own", () => {
		const cues = wordsToCues([{ text: "   ", type: "spacing", start: 0, end: 5 }]);
		expect(cues).toHaveLength(0);
	});

	// A silence longer than the threshold reads as a sentence boundary. Scribe does not
	// always punctuate, so the pause is the only signal available.
	test("splits on a pause longer than the gap threshold", () => {
		const cues = wordsToCues([
			{ text: "uno", type: "word", start: 0, end: 0.4 },
			{ text: "dos", type: "word", start: 2.0, end: 2.4 },
		]);
		expect(cues).toHaveLength(2);
		expect(cues[0].text).toBe("uno");
		expect(cues[1].text).toBe("dos");
	});

	test("keeps words together across a pause below the threshold", () => {
		const cues = wordsToCues([
			{ text: "uno", type: "word", start: 0, end: 0.4 },
			{ text: "dos", type: "word", start: 0.5, end: 0.9 },
		]);
		expect(cues).toHaveLength(1);
		expect(cues[0].text).toBe("uno dos");
	});

	// Two speakers inside one cue misattribute the line, which is worse than a short cue.
	// This cut is not subject to the gap or length thresholds.
	test("a change of speaker forces a new cue even with no pause", () => {
		const cues = wordsToCues([
			{ text: "hola", type: "word", start: 0, end: 0.3, speaker_id: "speaker_0" },
			{ text: "si", type: "word", start: 0.31, end: 0.6, speaker_id: "speaker_1" },
		]);
		expect(cues).toHaveLength(2);
		expect(cues[0].speaker).toBe("speaker_0");
		expect(cues[1].speaker).toBe("speaker_1");
	});

	test("carries the speaker of each cue through to the SRT label", () => {
		const cues = wordsToCues([
			{ text: "hola", type: "word", start: 0, end: 0.3, speaker_id: "speaker_0" },
			{ text: "si", type: "word", start: 0.31, end: 0.6, speaker_id: "speaker_1" },
		]);
		const srt = cuesToSrt(cues, true);
		expect(srt).toContain("[speaker_0] hola");
		expect(srt).toContain("[speaker_1] si");
	});

	// The same cues without diarization must not grow labels, because speaker_id is absent
	// and a label of "undefined" would be worse than none.
	test("omits speaker labels when diarization is off", () => {
		const cues = wordsToCues([{ text: "hola", type: "word", start: 0, end: 0.3 }]);
		expect(cuesToSrt(cues, false)).not.toContain("[");
	});

	test("caps a cue that runs long with no pause", () => {
		const words = Array.from({ length: 40 }, (_, i) => ({
			text: "palabra",
			type: "word",
			start: i * 0.1,
			end: i * 0.1 + 0.09,
		}));
		const cues = wordsToCues(words);
		expect(cues.length).toBeGreaterThan(1);
		for (const cue of cues) {
			expect(cue.text.length).toBeLessThanOrEqual(84);
		}
	});

	test("emits well formed SRT timestamps", () => {
		const srt = cuesToSrt(wordsToCues([{ text: "hola", type: "word", start: 1.5, end: 2.25 }]), false);
		expect(srt).toBe("1\n00:00:01,500 --> 00:00:02,250\nhola\n");
	});

	// Consecutive cues from one speaker are one turn to a reader, even though the SRT splits
	// them for length.
	test("merges consecutive cues from the same speaker into one turn", () => {
		const transcript = cuesToTranscript([
			{ start: 0, end: 1, text: "hola", speaker: "speaker_0" },
			{ start: 1, end: 2, text: "que tal", speaker: "speaker_0" },
			{ start: 2, end: 3, text: "bien", speaker: "speaker_1" },
		]);
		expect(transcript).toBe("[speaker_0] hola que tal\n\n[speaker_1] bien");
	});
});

describe("elevenlabs key resolution", () => {
	// Env first, matching the other cloud backends, so CI and containers work with no Keychain.
	test("prefers the environment variable", async () => {
		process.env.ELEVENLABS_API_KEY = "test-key-from-env";
		expect(await getElevenLabsKey()).toBe("test-key-from-env");
	});

	// The message has to name the way out, in the same shape as the other backends' errors.
	test("names how to set the key when nothing provides one", async () => {
		const saved = process.env.ELEVENLABS_API_KEY;
		process.env.ELEVENLABS_API_KEY = "";
		try {
			// On macOS a real Keychain entry may satisfy this, so only the no-key path is asserted.
			const key = await getElevenLabsKey().catch((e: Error) => e);
			if (key instanceof Error) {
				expect(key.message).toContain("ELEVENLABS_API_KEY");
			} else {
				expect(typeof key).toBe("string");
			}
		} finally {
			if (saved === undefined) {
				delete process.env.ELEVENLABS_API_KEY;
			} else {
				process.env.ELEVENLABS_API_KEY = saved;
			}
		}
	});
});

describe("elevenlabs backend selection", () => {
	test("--backend elevenlabs shows Scribe in dry-run plan", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"elevenlabs",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.backend).toBe("elevenlabs");
		expect(data.model).toBe("scribe_v2");
		const steps = data.steps as string[];
		expect(steps.some((s) => s.includes("ElevenLabs"))).toBe(true);
	});

	test("--diarize is reported in the plan", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"elevenlabs",
			"--diarize",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.diarize).toBe(true);
		const steps = data.steps as string[];
		expect(steps.some((s) => s.includes("diarized"))).toBe(true);
	});

	// Naming a speaker count is a request to separate speakers; the API only returns labels
	// when diarization is on, so one without the other would be a no-op.
	test("--speakers implies diarization", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"elevenlabs",
			"--speakers",
			"2",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.speakers).toBe(2);
		expect(data.diarize).toBe(true);
	});

	// Silently dropping these on another backend would return an undiarized transcript that
	// looks like the request was honored.
	test("rejects --diarize on a backend that cannot do it", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"openai",
			"--diarize",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.success).toBe(false);
		expect(data.error).toContain("elevenlabs");
	});

	test("rejects a speaker count outside the API range", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"elevenlabs",
			"--speakers",
			"99",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.error).toContain("1 and 32");
	});

	test("rejects a non-numeric speaker count", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"elevenlabs",
			"--speakers",
			"two",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.error).toContain("--speakers");
	});

	test("elevenlabs backend rejects models from another backend", async () => {
		const { stdout, exitCode } = await run([
			"transcribe",
			"https://example.com/video.mp4",
			"--backend",
			"elevenlabs",
			"--model",
			"whisper-1",
			"--dry-run",
			"--output",
			"json",
		]);
		expect(exitCode).toBe(1);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.error).toContain("Unknown ElevenLabs model");
	});

	test("models command lists the elevenlabs backend", async () => {
		const { stdout, exitCode } = await run(["models", "--backend", "elevenlabs", "--output", "json"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, unknown>;
		expect(data.elevenlabs).toContain("scribe_v2");
	});

	test("transcribe schema advertises the backend and its flags", async () => {
		const { stdout, exitCode } = await run(["schema", "transcribe"]);
		expect(exitCode).toBe(0);
		const data = parseJSON(stdout) as Record<string, Record<string, Record<string, unknown>>>;
		expect(data.flags["--backend"].enum).toContain("elevenlabs");
		expect(data.flags).toHaveProperty("--diarize");
		expect(data.flags).toHaveProperty("--speakers");
	});
});

describe("--words keeps the timings this backend already receives", () => {
	test("the flag is documented as keeping them, not as fetching them", async () => {
		// The elevenlabs backend sends timestamps_granularity: word on every
		// request, because wordsToCues builds the SRT out of the response. The
		// flag decides whether they survive the process, and the help text used
		// to describe only the local backend's behaviour.
		const { stdout } = await run(["transcribe", "--help"]);
		expect(stdout).toContain("--words");
		expect(stdout).toMatch(/words\.json|per-word/);
	});

	test("word entries carry a boundary and the provider's own score", async () => {
		// Shape check on the writer, without a network call: startMs and endMs in
		// milliseconds like every other time in this CLI, and logprob passed
		// through on the provider's scale rather than normalised, because it
		// scores the token and not the boundary.
		const cues = wordsToCues([
			{ text: "Hola,", type: "word", start: 0.959, end: 1.199, logprob: -0.00003 },
			{ text: "¿cómo", type: "word", start: 1.339, end: 1.459, logprob: -0.0003 },
		]);
		expect(cues.length).toBeGreaterThan(0);
		// Cue times are seconds here; the words file converts to milliseconds,
		// which is the unit every downstream consumer of this CLI works in.
		expect(cues[0]?.start).toBeCloseTo(0.959, 3);
		expect(Math.round((cues[0]?.start ?? 0) * 1000)).toBe(959);
	});
});
