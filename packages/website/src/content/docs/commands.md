---
title: Commands
description: Complete reference for all trx CLI commands and flags.
order: 2
---

## trx transcribe

Transcribe audio/video from a URL or local file.

```bash
trx transcribe <input> [flags]
```

The `transcribe` subcommand is optional — `trx <input>` works the same way.

### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `-b, --backend` | Transcription backend (`local`, `openai`, or `vercel`) | from config |
| `-l, --language` | ISO 639-1 language code | `auto` |
| `-m, --model` | Override model size | from config |
| `-w, --words` | Word-level timestamps in SRT | `false` |
| `--output-dir` | Directory for output files | `.` |
| `--fields` | Limit output: `text,srt,metadata,files` | all |
| `--dry-run` | Show execution plan without running | `false` |
| `--no-download` | Skip yt-dlp (input must be local) | `false` |
| `--no-clean` | Skip ffmpeg audio cleaning | `false` |
| `--json` | Raw JSON payload for agents | — |
| `-o, --output` | Output format: `json`, `table`, `auto` | `auto` |

### Models

**Local (whisper-cli):**

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| `tiny` | ~75 MB | Fastest | Lowest |
| `base` | ~142 MB | Fast | Decent |
| `small` | ~466 MB | Balanced | Good (recommended) |
| `medium` | ~1.5 GB | Slow | High |
| `large` | ~3 GB | Slowest | Best |
| `large-v3-turbo` | ~1.6 GB | Fast | Near-large |

**OpenAI API:**

| Model | Cost | Notes |
|-------|------|-------|
| `gpt-4o-transcribe` | $2.50/hr | Best accuracy |
| `gpt-4o-mini-transcribe` | $0.60/hr | Fastest, cheapest |
| `whisper-1` | $0.36/hr | Legacy, segment timestamps |

**Vercel AI Gateway:**

Any transcription model on the [gateway](https://vercel.com/docs/ai-gateway/modalities/speech-to-text), addressed as `creator/model-name` (default `openai/whisper-1`). One `AI_GATEWAY_API_KEY` covers all providers. This is Vercel's AI Gateway, not Cloudflare's product of the same name.

### Examples

```bash
# Transcribe YouTube video
trx "https://youtube.com/watch?v=abc"

# Spanish podcast with word timestamps
trx podcast.mp3 -l es -w

# OpenAI API with specific model
trx meeting.m4a -b openai -m gpt-4o-mini-transcribe

# Vercel AI Gateway with any provider's model
trx meeting.m4a -b vercel -m openai/whisper-1

# JSON output for piping
trx video.mp4 --output json --fields text

# Dry run to preview
trx video.mp4 --dry-run --output json
```

---

## trx init

Install dependencies and configure the transcription backend.

```bash
trx init [flags]
```

### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `-b, --backend` | Backend: `local`, `openai`, or `vercel` | `local` |
| `-m, --model` | Model to download/configure | `small` |
| `-l, --language` | Default language | `auto` |

### What it does

**Local backend:**
1. Installs `whisper-cli`, `yt-dlp`, `ffmpeg` via your OS package manager
2. Downloads the selected Whisper model from Hugging Face
3. Saves config to `~/.trx/config.json`

**OpenAI backend:**
1. Validates `OPENAI_API_KEY` is set
2. Installs `yt-dlp` and `ffmpeg` (still needed for download/clean)
3. Saves config with selected OpenAI model

**Vercel backend:**
1. Validates `AI_GATEWAY_API_KEY` is set
2. Installs `yt-dlp` and `ffmpeg` (still needed for download/clean)
3. Saves config with the selected gateway model (`creator/model-name`)

---

## trx doctor

Health check for all dependencies and configuration.

```bash
trx doctor [--output json]
```

Shows: installed dependencies, versions, config path, model status, backend, API key.

---

## trx schema

Runtime introspection for agents. Returns the JSON schema of any command.

```bash
trx schema transcribe
trx schema init
```

Agents use this to discover available flags and their types without reading docs.
