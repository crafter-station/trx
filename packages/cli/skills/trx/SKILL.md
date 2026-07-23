---
name: trx
description: |
  Transcribe audio/video using trx CLI and post-process results with agent corrections.
  Use when: (1) user wants to transcribe a video or audio file, (2) user shares a
  YouTube/Twitter/Instagram URL for transcription, (3) user says "transcribe",
  "subtitles", "srt", "transcript", (4) user wants to fix/clean up a whisper
  transcription, (5) user asks to extract text from a video.
metadata:
  author: Railly Hugo
  version: "0.5.0"
---

# trx -- Agent-First Transcription CLI

Install: `npx skills add crafter-station/trx -g`

## Prerequisites

Check setup: `trx doctor --output json`. If dependencies missing, run `trx init`.

Install (Bun recommended, works with npm):

```bash
bun add -g @crafter/trx
# or
npm i -g @crafter/trx

trx init
trx doctor --output json
```

`trx init` installs deps (`whisper-cli`, `yt-dlp`, `ffmpeg`), downloads a Whisper model, and installs the agent skill.

## Workflow

### 1. Dry-run first (always)

```bash
trx transcribe <input> --dry-run --output json
```

Validates input, checks dependencies, shows execution plan without running.

### 2. Transcribe

For URLs (YouTube, Twitter, Instagram, etc.):

```bash
trx transcribe "https://youtube.com/watch?v=..." --output json
```

For Instagram or private URLs that need login:

```bash
trx transcribe "https://www.instagram.com/reel/..." --cookies-from-browser chrome --output json
```

For local files:

```bash
trx transcribe ./recording.mp4 --output json
```

Agent-optimized (text only, saves tokens):

```bash
trx transcribe <input> --fields text --output json
```

Raw JSON payload (preferred for agents, avoids shell quoting issues):

```bash
trx transcribe video.mp4 --json '{"input":"video.mp4","language":"es","backend":"local"}' --output json
```

### Backends (v0.4.0+)

trx supports three backends: local Whisper (default), OpenAI API, and Vercel AI Gateway.

Discover available transcription models with `trx models` or filter with `trx models --backend <name>`.

```bash
# Local Whisper (default, offline, free)
trx transcribe <input> --backend local

# OpenAI API (faster, SOTA accuracy, requires OPENAI_API_KEY)
export OPENAI_API_KEY=sk-...
trx transcribe <input> --backend openai

# Vercel AI Gateway (any provider's transcription model, requires AI_GATEWAY_API_KEY)
trx transcribe <input> --backend vercel -m openai/whisper-1
```

OpenAI models:
- `gpt-4o-transcribe` — SOTA accuracy (default for openai backend)
- `gpt-4o-mini-transcribe` — cheapest
- `whisper-1` — legacy, supports per-segment SRT timestamps

Vercel gateway models: any transcription model on the gateway, addressed as `creator/model-name` (default `openai/whisper-1`). One `AI_GATEWAY_API_KEY` covers all providers. This is Vercel's AI Gateway, not Cloudflare's product of the same name.

Local models: `tiny`, `base`, `small`, `medium`, `large-v3-turbo`, `large`.

Set backend persistently via `trx init --backend openai`, `trx init --backend vercel`, or in config.

### 3. Post-process (fix whisper mistakes)

After transcription, read the `.txt` output and apply corrections. Read [whisper-fixes.md](references/whisper-fixes.md) for common patterns.

**Correction checklist:**
1. **Punctuation**: Whisper drops periods at paragraph boundaries and misplaces commas. Fix sentence boundaries.
2. **Accents** (Spanish): Whisper often drops diacritics. Restore: `como` -> `cómo` (how), `esta` -> `está` (is), `mas` -> `más` (more), `si` -> `sí` (yes), `el` -> `él` (he/him), `que` -> `qué` (what), `cuando` -> `cuándo` (when), `numero` -> `número`, `tambien` -> `también`, `informacion` -> `información`.
3. **Technical terms**: Whisper misspells domain-specific words. Ask user for a glossary or infer from context.
4. **Repeated phrases**: Whisper sometimes stutters on word boundaries. Remove exact consecutive duplicates.
5. **Speaker attribution**: If user provides speaker names, insert `[Speaker Name]:` markers.
6. **Filler words**: Remove "um", "uh", "este", "o sea" if user wants clean output.
7. **Timestamp alignment**: If editing `.srt`, preserve the timestamp structure. Only modify text between timestamps.

### 4. Schema introspection

```bash
trx schema transcribe
trx schema init
```

## Commands

| Command | Example |
|---------|---------|
| `init` | `trx init --model small` |
| `transcribe` | `trx transcribe <url-or-file> --output json` |
| `doctor` | `trx doctor --output json` |
| `models` | `trx models --output json` |
| `schema` | `trx schema transcribe` |

## Shorthand

`trx <input>` is equivalent to `trx transcribe <input>`.

## Output format

- `--output json`: Machine-readable (default when piped)
- `--output table`: Human-readable with progress (default when TTY)
- `--fields text`: Only return transcript text (saves tokens)
- `--fields srt,metadata,files`: Select specific fields
- `--dry-run`: Validate without executing

Example JSON response (filtered with `--fields text`):

```json
{
  "success": true,
  "input": "recording.mp4",
  "backend": "local",
  "text": "Hola, cómo estás. Este es un ejemplo de transcripción...",
  "files": {
    "wav": "./recording.wav",
    "srt": "./recording.srt",
    "txt": "./recording.txt"
  },
  "metadata": {
    "language": "es",
    "model": "small"
  }
}
```

Full response includes `text`, `files`, `metadata`, `input`, `backend`.

## Flags reference

| Flag | Description | Default |
|------|-------------|---------|
| `-b, --backend <name>` | `local`, `openai`, or `vercel` | from config (`local`) |
| `-l, --language <code>` | ISO 639-1 language code | `auto` (from config) |
| `-m, --model <size>` | Override model: tiny, base, small, medium, large-v3-turbo, large, gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1, or creator/model-name for vercel | from config |
| `-w, --words` | Word-level timestamps in SRT | false |
| `--output-dir <dir>` | Output directory | `.` (cwd) |
| `--output <format>` | `json`, `table`, or `auto` | auto (TTY=table, piped=json) |
| `--fields <list>` | Limit output: text,srt,metadata,files (comma-separated) | all |
| `--no-download` | Skip yt-dlp (input must be local) | false |
| `--no-clean` | Skip ffmpeg audio cleaning | false |
| `--cookies-from-browser <browser>` | Load yt-dlp cookies from browser (e.g. chrome, chrome:Default) | - |
| `--json <payload>` | Raw JSON input for agents: {"input","language","model","backend","cookiesFromBrowser"} | - |
| `--dry-run` | Validate input and show plan without executing | false |

Config stored at `~/.trx/config.json` after `trx init`:

```json
{
  "modelPath": "~/.trx/models/ggml-small.bin",
  "modelSize": "small",
  "language": "auto",
  "backend": "local",
  "threads": 8,
  "openai": { "model": "gpt-4o-transcribe" },
  "vercel": { "model": "openai/whisper-1" }
}
```

## Edge cases & troubleshooting

- **yt-dlp extension mismatch**: yt-dlp sometimes outputs `.mp4.webm` instead of `.mp4`. The CLI handles this by scanning for the downloaded file by prefix.
- **Instagram empty media response**: Retry with `--cookies-from-browser chrome` or `--cookies-from-browser chrome:Default`. If it still fails, update yt-dlp (`brew upgrade yt-dlp`) and confirm the reel opens in that browser profile.
- **Large files (>1hr)**: Whisper processes in segments. Works but is slow on CPU. Consider `--model tiny` for speed or switch to `--backend openai`.
- **No GPU**: `whisper-cli` uses CPU by default. Acceptable for tiny/base/small. For medium/large use `large-v3-turbo` or OpenAI backend.
- **Auto-detect language**: When `--language auto`, Whisper detects language from first 30 seconds. For multilingual content, specify primary language via `--language es`.
- **OpenAI backend fails**: Ensure `OPENAI_API_KEY` is set. Run `trx doctor --output json` to verify. For agents: `echo $OPENAI_API_KEY` should be non-empty, else error is expected.
- **npm vs bun**: Package requires `bun >=1.0.0` runtime (engines field). `npm i -g @crafter/trx` works if `bun` is installed globally (`curl -fsSL https://bun.sh/install | bash`). `bun add -g` is recommended.
