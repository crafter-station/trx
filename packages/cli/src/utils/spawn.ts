export interface SpawnResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export async function spawn(cmd: string[], opts?: { cwd?: string; timeout?: number }): Promise<SpawnResult> {
	const proc = Bun.spawn(cmd, {
		cwd: opts?.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

	const exitCode = await proc.exited;

	return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function spawnOrThrow(cmd: string[], context: string): Promise<string> {
	const result = await spawn(cmd);
	if (result.exitCode !== 0) {
		throw new Error(`${context} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
	}
	return result.stdout;
}
