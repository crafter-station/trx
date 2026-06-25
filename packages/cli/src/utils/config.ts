import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Backend = "local" | "openai" | "pegasus";

export type OpenAIModel = "gpt-4o-transcribe" | "gpt-4o-mini-transcribe" | "whisper-1";

export type PegasusModel = "pegasus1.5" | "pegasus1.2";

export interface TrxConfig {
	backend: Backend;
	modelPath: string;
	modelSize: string;
	language: string;
	threads: number;
	wordTimestamps: boolean;
	openai: {
		model: OpenAIModel;
	};
	pegasus: {
		model: PegasusModel;
	};
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
		const saved = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
		const defaults = defaultConfig(saved.modelSize || "small", saved.language || "auto", saved.backend || "local");
		return {
			...defaults,
			...saved,
			openai: { ...defaults.openai, ...(saved.openai || {}) },
			pegasus: { ...defaults.pegasus, ...(saved.pegasus || {}) },
			whisperFlags: { ...defaults.whisperFlags, ...(saved.whisperFlags || {}) },
		};
	} catch {
		return null;
	}
}

export function writeConfig(config: TrxConfig): void {
	ensureTrxDir();
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function defaultConfig(modelSize: string, language: string, backend: Backend = "local"): TrxConfig {
	return {
		backend,
		modelPath: join(MODELS_DIR, `ggml-${modelSize}.bin`),
		modelSize,
		language,
		threads: 8,
		wordTimestamps: false,
		openai: {
			model: "gpt-4o-transcribe",
		},
		pegasus: {
			model: "pegasus1.5",
		},
		whisperFlags: {
			suppressNst: true,
			noFallback: true,
			entropyThold: 2.8,
			logprobThold: -1.0,
			maxContext: 0,
		},
	};
}
