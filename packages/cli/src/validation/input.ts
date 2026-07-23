import { existsSync } from "node:fs";

export function rejectControlChars(input: string): string {
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		if (code < 0x20 && code !== 0x0a && code !== 0x0d && code !== 0x09) {
			throw new Error(`Input contains control character at position ${i} (0x${code.toString(16)})`);
		}
	}
	return input;
}

export function validateUrl(url: string): string {
	const cleaned = rejectControlChars(url.trim());
	if (!/^https?:\/\//i.test(cleaned)) {
		throw new Error(`Invalid URL: must start with http:// or https://, got "${cleaned}"`);
	}
	if (cleaned.includes("..")) {
		throw new Error("URL contains path traversal (..), rejected");
	}
	return cleaned;
}

export function validateFilePath(path: string): string {
	const cleaned = rejectControlChars(path.trim());
	if (cleaned.includes("..")) {
		throw new Error("Path contains traversal (..), rejected");
	}
	if (/%[0-9a-f]{2}/i.test(cleaned)) {
		throw new Error("Path contains URL-encoded characters, pass raw path");
	}
	if (!existsSync(cleaned)) {
		throw new Error(`File not found: "${cleaned}"`);
	}
	return cleaned;
}

const SUPPORTED_EXTENSIONS = [".mp4", ".m4a", ".ogg", ".wav", ".webm", ".mkv", ".avi", ".mov", ".flac", ".mp3"];

export function validateFileExtension(path: string): string {
	const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
	if (!SUPPORTED_EXTENSIONS.includes(ext)) {
		throw new Error(`Unsupported file type: "${ext}". Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`);
	}
	return ext;
}

const WHISPER_LANGUAGES = [
	"auto",
	"af",
	"am",
	"ar",
	"as",
	"az",
	"ba",
	"be",
	"bg",
	"bn",
	"bo",
	"br",
	"bs",
	"ca",
	"cs",
	"cy",
	"da",
	"de",
	"el",
	"en",
	"es",
	"et",
	"eu",
	"fa",
	"fi",
	"fo",
	"fr",
	"gl",
	"gu",
	"ha",
	"haw",
	"he",
	"hi",
	"hr",
	"ht",
	"hu",
	"hy",
	"id",
	"is",
	"it",
	"ja",
	"jw",
	"ka",
	"kk",
	"km",
	"kn",
	"ko",
	"la",
	"lb",
	"ln",
	"lo",
	"lt",
	"lv",
	"mg",
	"mi",
	"mk",
	"ml",
	"mn",
	"mr",
	"ms",
	"mt",
	"my",
	"ne",
	"nl",
	"nn",
	"no",
	"oc",
	"pa",
	"pl",
	"ps",
	"pt",
	"ro",
	"ru",
	"sa",
	"sd",
	"si",
	"sk",
	"sl",
	"sn",
	"so",
	"sq",
	"sr",
	"su",
	"sv",
	"sw",
	"ta",
	"te",
	"tg",
	"th",
	"tk",
	"tl",
	"tr",
	"tt",
	"uk",
	"ur",
	"uz",
	"vi",
	"yi",
	"yo",
	"zh",
] as const;

export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number];

export function validateLanguage(lang: string): WhisperLanguage {
	const cleaned = lang.trim().toLowerCase();
	if (!WHISPER_LANGUAGES.includes(cleaned as WhisperLanguage)) {
		throw new Error(`Unsupported language: "${lang}". Use ISO 639-1 code or "auto".`);
	}
	return cleaned as WhisperLanguage;
}

export const VALID_LOCAL_MODELS = [
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
] as const;
export type WhisperModel = (typeof VALID_LOCAL_MODELS)[number];

export const VALID_OPENAI_MODELS = ["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"] as const;
export type OpenAITranscribeModel = (typeof VALID_OPENAI_MODELS)[number];

export function validateModel(model: string): WhisperModel {
	const cleaned = model.trim().toLowerCase();
	if (!VALID_LOCAL_MODELS.includes(cleaned as WhisperModel)) {
		throw new Error(`Unknown local model: "${model}". Available: ${VALID_LOCAL_MODELS.join(", ")}`);
	}
	return cleaned as WhisperModel;
}

export function validateOpenAIModel(model: string): OpenAITranscribeModel {
	const cleaned = model.trim().toLowerCase();
	if (!VALID_OPENAI_MODELS.includes(cleaned as OpenAITranscribeModel)) {
		throw new Error(`Unknown OpenAI model: "${model}". Available: ${VALID_OPENAI_MODELS.join(", ")}`);
	}
	return cleaned as OpenAITranscribeModel;
}

export function validateBackend(backend: string): "local" | "openai" | "vercel" {
	const cleaned = backend.trim().toLowerCase();
	if (cleaned !== "local" && cleaned !== "openai" && cleaned !== "vercel") {
		throw new Error(`Unknown backend: "${backend}". Available: local, openai, vercel`);
	}
	return cleaned;
}

export function validateVercelModel(model: string): string {
	const cleaned = rejectControlChars(model.trim());
	if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) {
		throw new Error(`Invalid gateway model: "${model}". Use creator/model-name format, for example openai/whisper-1.`);
	}
	return cleaned;
}

export function validateInput(input: string): { type: "url" | "file"; value: string } {
	const cleaned = rejectControlChars(input.trim());
	if (/^https?:\/\//i.test(cleaned)) {
		return { type: "url", value: validateUrl(cleaned) };
	}
	validateFilePath(cleaned);
	return { type: "file", value: cleaned };
}
