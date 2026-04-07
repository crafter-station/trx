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
  version: "0.4.0"
---

# trx -- Agent-First Transcription CLI

Install: `npx skills add crafter-station/trx -g`

## Prerequisites

Check setup: `trx doctor --output json`. If dependencies missing, run `trx init`.

Install: `bun add -g @crafter/trx`

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

For local files:
```bash
trx transcribe ./recording.mp4 --output json
```

Agent-optimized (text only, saves tokens):
```bash
trx transcribe <input> --fields text --output json
```

### Backends (v0.4.0+)

trx supports two backends: local Whisper (default) and OpenAI API.

```bash
# Local Whisper (default, offline, free)
trx transcribe <input> --backend local

# OpenAI API (faster, SOTA accuracy, requires OPENAI_API_KEY)
trx transcribe <input> --backend openai
```

OpenAI models:
- `gpt-4o-transcribe` — SOTA accuracy (default for openai backend)
- `gpt-4o-mini-transcribe` — cheapest
- `whisper-1` — legacy, supports per-segment SRT timestamps

Local models: `tiny`, `base`, `small`, `medium`, `large-v3-turbo`, `large`.

Set backend persistently via `trx init --backend openai` or in config.

### 3. Post-process (fix whisper mistakes)

After transcription, read the `.txt` output and apply corrections. Read [whisper-fixes.md](references/whisper-fixes.md) for common patterns.

**Correction checklist:**
1. **Punctuation**: Whisper drops periods at paragraph boundaries and misplaces commas. Fix sentence boundaries.
2. **Accents** (Spanish): Whisper often drops diacritics. Restore: como -> como/cmo, esta -> esta/est, mas -> mas/ms.
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
| `schema` | `trx schema transcribe` |

## Shorthand

`trx <input>` is equivalent to `trx transcribe <input>`.

## Output format

- `--output json`: Machine-readable (default when piped)
- `--output table`: Human-readable with progress (default when TTY)
- `--fields text`: Only return transcript text (saves tokens)
- `--fields metadata`: Only return metadata (language, model)
- `--dry-run`: Validate without executing

## Flags reference

| Flag | Description | Default |
|------|-------------|---------|
| `--backend <name>` | `local` or `openai` | from config |
| `--language <code>` | ISO 639-1 language code | `auto` (from config) |
| `--model <size>` | Override model: tiny, base, small, medium, large-v3-turbo, large, gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1 | from config |
| `--output-dir <dir>` | Output directory | `.` (cwd) |
| `--no-download` | Skip yt-dlp (local files only) | false |
| `--no-clean` | Skip ffmpeg audio cleaning | false |
| `--json <payload>` | Raw JSON input | - |

## Edge cases

- **yt-dlp extension mismatch**: yt-dlp sometimes outputs `.mp4.webm` instead of `.mp4`. The CLI handles this by scanning for the downloaded file by prefix.
- **Large files (>1hr)**: Whisper processes in segments. Works but is slow on CPU. Consider `--model tiny` for speed.
- **No GPU**: whisper-cli uses CPU by default. Acceptable for tiny/base/small models.
- **Auto-detect language**: When `--language auto`, Whisper detects the language from the first 30 seconds. For multilingual content, specify the primary language.
