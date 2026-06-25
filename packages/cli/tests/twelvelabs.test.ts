import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { getTwelveLabsKey, transcribePegasus } from "../src/core/twelvelabs.ts";

describe("twelvelabs pegasus backend", () => {
	test("getTwelveLabsKey throws a helpful error when unset", () => {
		const saved = process.env.TWELVELABS_API_KEY;
		delete process.env.TWELVELABS_API_KEY;
		try {
			expect(() => getTwelveLabsKey()).toThrow("TWELVELABS_API_KEY not set");
		} finally {
			if (saved !== undefined) process.env.TWELVELABS_API_KEY = saved;
		}
	});

	// Live smoke test — only runs when a key is present. Pegasus analyses video
	// server-side, so this needs a reachable public media URL and may be slow.
	const VIDEO_URL = process.env.TRX_TEST_VIDEO_URL;
	const liveTest = process.env.TWELVELABS_API_KEY && VIDEO_URL ? test : test.skip;

	liveTest(
		"transcribePegasus returns text and writes .srt/.txt",
		async () => {
			const outBase = resolve("/tmp", `trx-pegasus-test-${Date.now()}`);
			const result = await transcribePegasus(VIDEO_URL as string, "pegasus1.5", outBase);
			expect(typeof result.text).toBe("string");
			expect(result.text.length).toBeGreaterThan(0);
			expect(result.srtPath).toBe(`${outBase}.srt`);
			expect(result.txtPath).toBe(`${outBase}.txt`);
			const { existsSync } = await import("node:fs");
			expect(existsSync(result.txtPath)).toBe(true);
		},
		300000,
	);
});
