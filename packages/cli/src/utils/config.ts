import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TrxConfig {
	modelPath: string;
	modelSize: string;
	language: string;
	threads: number;
	wordTimestamps: boolean;
	whisperFlags: {
		suppressNst: boolean;
		noFallback: boolean;
		entropyThold: number;
		logprobThold: number;
		maxContext: number;
	};
}

const TRX_DIR = join(homedir(), ".trx");
const CONFIG_PATH = join(TRX_DIR, "config.json");
const MODELS_DIR = join(TRX_DIR, "models");

export function getTrxDir(): string {
	return TRX_DIR;
}

export function getModelsDir(): string {
	return MODELS_DIR;
}

export function getConfigPath(): string {
	return CONFIG_PATH;
}

export function ensureTrxDir(): void {
	if (!existsSync(TRX_DIR)) {
		mkdirSync(TRX_DIR, { recursive: true });
	}
	if (!existsSync(MODELS_DIR)) {
		mkdirSync(MODELS_DIR, { recursive: true });
	}
}

export function readConfig(): TrxConfig | null {
	if (!existsSync(CONFIG_PATH)) return null;
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as TrxConfig;
	} catch {
		return null;
	}
}

export function writeConfig(config: TrxConfig): void {
	ensureTrxDir();
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function defaultConfig(modelSize: string, language: string): TrxConfig {
	return {
		modelPath: join(MODELS_DIR, `ggml-${modelSize}.bin`),
		modelSize,
		language,
		threads: 8,
		wordTimestamps: false,
		whisperFlags: {
			suppressNst: true,
			noFallback: true,
			entropyThold: 2.8,
			logprobThold: -1.0,
			maxContext: 0,
		},
	};
}
