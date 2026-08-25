import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Backend = "local" | "openai" | "vercel" | "elevenlabs";

export type OpenAIModel = "gpt-4o-transcribe" | "gpt-4o-mini-transcribe" | "whisper-1";

export type ElevenLabsModel = "scribe_v2" | "scribe_v1";

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
	vercel: {
		model: string;
	};
	elevenlabs: {
		model: ElevenLabsModel;
		diarize: boolean;
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
const BIN_DIR = join(TRX_DIR, "bin");

export function getTrxDir(): string {
	return TRX_DIR;
}

export function getModelsDir(): string {
	return MODELS_DIR;
}

export function getBinDir(): string {
	return BIN_DIR;
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
	if (!existsSync(BIN_DIR)) {
		mkdirSync(BIN_DIR, { recursive: true });
	}
}

export function activateManagedBin(): void {
	const separator = process.platform === "win32" ? ";" : ":";
	const current = process.env.PATH || "";
	const managedEntries = [BIN_DIR];
	if (process.platform === "win32") {
		managedEntries.push(
			join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Microsoft", "WinGet", "Links"),
		);
	}
	const entries = current.split(separator);
	const normalize = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
	const missing = managedEntries.filter(
		(candidate) => !entries.some((entry) => normalize(entry) === normalize(candidate)),
	);
	process.env.PATH = [...missing, current].filter(Boolean).join(separator);
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
			vercel: { ...defaults.vercel, ...(saved.vercel || {}) },
			elevenlabs: { ...defaults.elevenlabs, ...(saved.elevenlabs || {}) },
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
		vercel: {
			model: "openai/whisper-1",
		},
		elevenlabs: {
			model: "scribe_v2",
			diarize: false,
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
