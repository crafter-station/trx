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

/**
 * Scribe accepts ISO 639-1 and ISO 639-3, and normalizes either to 639-3 in its response
 * (verified: `es` and `spa` both return `language_code: "spa"`). The 639-1 table above is the
 * set whisper.cpp accepts, so it cannot be widened for every backend; this only relaxes the
 * check where the wider set is actually valid. The shape is checked rather than the membership,
 * because the full 639-3 register is thousands of codes and the API is the authority on which
 * ones it serves.
 */
export function validateElevenLabsLanguage(lang: string): string {
	const cleaned = rejectControlChars(lang.trim().toLowerCase());
	if (cleaned === "auto") return cleaned;
	if (!/^[a-z]{2,3}$/.test(cleaned)) {
		throw new Error(`Unsupported language: "${lang}". Use an ISO 639-1 or ISO 639-3 code, or "auto".`);
	}
	return cleaned;
}

export const VALID_ELEVENLABS_MODELS = ["scribe_v2", "scribe_v1"] as const;
export type ElevenLabsTranscribeModel = (typeof VALID_ELEVENLABS_MODELS)[number];

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

export function validateElevenLabsModel(model: string): ElevenLabsTranscribeModel {
	const cleaned = model.trim().toLowerCase();
	if (!VALID_ELEVENLABS_MODELS.includes(cleaned as ElevenLabsTranscribeModel)) {
		throw new Error(`Unknown ElevenLabs model: "${model}". Available: ${VALID_ELEVENLABS_MODELS.join(", ")}`);
	}
	return cleaned as ElevenLabsTranscribeModel;
}

const BACKENDS = ["local", "openai", "vercel", "elevenlabs"] as const;

export function validateBackend(backend: string): (typeof BACKENDS)[number] {
	const cleaned = backend.trim().toLowerCase();
	if (!BACKENDS.includes(cleaned as (typeof BACKENDS)[number])) {
		throw new Error(`Unknown backend: "${backend}". Available: ${BACKENDS.join(", ")}`);
	}
	return cleaned as (typeof BACKENDS)[number];
}

/**
 * Speaker count is an upstream constraint (the API caps it at 32), not a number picked here.
 * Rejecting a bad value locally beats spending an upload to learn the same thing.
 */
export function validateSpeakers(value: string): number {
	const cleaned = rejectControlChars(String(value).trim());
	if (!/^\d+$/.test(cleaned)) {
		throw new Error(`Invalid --speakers: "${value}". Pass a whole number between 1 and 32.`);
	}
	const parsed = Number.parseInt(cleaned, 10);
	if (parsed < 1 || parsed > 32) {
		throw new Error(`Invalid --speakers: "${value}". Must be between 1 and 32.`);
	}
	return parsed;
}

/**
 * An unknown format used to fall through to JSON with exit 0, so a caller that asked for
 * something this does not have got output anyway and nothing said the request was dropped.
 * That silence is reachable by accident: `--output` is one hyphen away from `--output-dir`,
 * so a path handed to the wrong flag was accepted as a format and discarded, which reads
 * from outside like the directory flag being ignored.
 */
export function validateOutputFormat(format: string): "json" | "table" | "auto" {
	const cleaned = format.trim().toLowerCase();
	if (cleaned === "json" || cleaned === "table" || cleaned === "auto") {
		return cleaned;
	}
	// The directory hint only when the value looks like one. `--output` appears about three
	// times as often as `--output-dir` across this repo's own docs, so most bad values are a
	// mistyped format rather than a misdirected path, and appending advice about a different
	// flag to every one of those adds noise to the common case to serve the rare one.
	const looksLikePath = cleaned.includes("/") || cleaned.startsWith(".") || cleaned.startsWith("~");
	throw new Error(
		`Unknown output format: "${format}". Available: json, table, auto.${
			looksLikePath ? " To choose where files are written, use --output-dir." : ""
		}`,
	);
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
