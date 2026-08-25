import { existsSync } from "node:fs";
import { join } from "node:path";
import { getBinDir } from "./config.ts";

export interface SpawnResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export function resolveExecutable(name: string): string | null {
	if (process.platform === "win32") {
		const managed = join(getBinDir(), name.toLowerCase().endsWith(".exe") ? name : `${name}.exe`);
		if (existsSync(managed)) return managed;
	}
	return Bun.which(name);
}

function resolveCommand(cmd: string[]): string[] {
	const executable = resolveExecutable(cmd[0]);
	return executable ? [executable, ...cmd.slice(1)] : cmd;
}

export async function spawn(cmd: string[], opts?: { cwd?: string; timeout?: number }): Promise<SpawnResult> {
	const proc = Bun.spawn(resolveCommand(cmd), {
		cwd: opts?.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	let stdout = "";
	let stderr = "";
	let exitCode: number;
	let killedByTimeout = false;

	try {
		const pending = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

		if (opts?.timeout) {
			const timeoutPromise = new Promise<never>((_, reject) => {
				setTimeout(() => {
					killedByTimeout = true;
					try {
						proc.kill();
					} catch {}
					reject(new Error(`command timed out after ${opts.timeout}ms: ${cmd.join(" ")}`));
				}, opts.timeout);
			});
			[stdout, stderr] = (await Promise.race([pending, timeoutPromise])) as [string, string];
		} else {
			[stdout, stderr] = await pending;
		}

		exitCode = await proc.exited;
	} catch (e) {
		if (killedByTimeout) throw e as Error;
		throw e;
	}

	return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function spawnOrThrow(cmd: string[], context: string): Promise<string> {
	const result = await spawn(cmd);
	if (result.exitCode !== 0) {
		throw new Error(`${context} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
	}
	return result.stdout;
}

export async function spawnStreaming(
	cmd: string[],
	context: string,
	onStderr?: (line: string) => void,
): Promise<string> {
	const proc = Bun.spawn(resolveCommand(cmd), {
		stdout: "pipe",
		stderr: "pipe",
	});

	const stderrReader = (async () => {
		const reader = proc.stderr.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (line.trim()) onStderr?.(line.trim());
			}
		}
		if (buffer.trim()) onStderr?.(buffer.trim());
	})();

	const stdout = await new Response(proc.stdout).text();
	await stderrReader;
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error(`${context} failed (exit ${exitCode})`);
	}
	return stdout.trim();
}
