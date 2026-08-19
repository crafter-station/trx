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
| `-b, --backend` | Transcription backend (`local`, `openai`, `vercel`, or `elevenlabs`) | from config |
| `-l, --language` | ISO 639-1 language code (`elevenlabs` also accepts ISO 639-3) | `auto` |
| `-m, --model` | Override model size | from config |
| `-w, --words` | Word-level timestamps in SRT | `false` |
| `--preset` | `verbatim` keeps fillers and false starts; needs `--language` | none |
| `--prompt` | Initial prompt in the spoken language; beats `--preset` | none |
| `--output-dir` | Directory for output files, created if missing | `.` |
| `--fields` | Limit output: `text,srt,metadata,files` | all |
| `--dry-run` | Show execution plan without running | `false` |
| `--no-download` | Skip yt-dlp (input must be local) | `false` |
| `--no-clean` | Skip ffmpeg audio cleaning | `false` |
| `--diarize` | Label each cue with its speaker (`elevenlabs` only) | `false` |
| `--speakers` | Expected speaker count, 1-32; implies `--diarize` (`elevenlabs` only) | none |
| `--no-chunk` | Disable automatic chunking for oversized cloud uploads | `false` |
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

Any transcription model on the [gateway](https://vercel.com/docs/ai-gateway/modalities/speech-to-text), addressed as `creator/model-name` (default `openai/whisper-1`). One `AI_GATEWAY_API_KEY` covers all providers. This is Vercel's AI Gateway, not Cloudflare's product of the same name. Run `trx models` to see what is available.

**ElevenLabs Scribe:**

| Model | Notes |
|-------|-------|
| `scribe_v2` | Latest, speaker diarization and word timestamps (default) |
| `scribe_v1` | Previous generation |

The only backend that separates speakers. Requires `ELEVENLABS_API_KEY`; on macOS trx also reads the `elevenlabs` entry from your login Keychain, so a key stored there needs no export.

### Speaker diarization

`--diarize` asks Scribe who is speaking and labels every cue with the result:

```srt
1
00:00:01,900 --> 00:00:03,400
[speaker_0] Hola, que tal? Escuchas?

2
00:00:04,520 --> 00:00:05,900
[speaker_1] Si, te escucho bien.
```

Scribe timestamps every word, so cues are grouped for reading: a pause of 0.6s or more starts a new cue, a cue is capped at 84 characters, and a change of speaker always starts a new one so no cue attributes two people to one line. The `.txt` becomes a conversation, one paragraph per turn.

Pass `--speakers <n>` when you know how many people are in the room (1-32); it implies `--diarize`. Both flags are rejected on any other backend rather than being silently ignored, because an undiarized transcript would otherwise look like the request succeeded.

### Big files

Cloud backends have upload limits (OpenAI 25 MB, gateway 100 MB). The ElevenLabs limit is 5 GB, so that backend never chunks. Files over the limit split automatically with ffmpeg, transcribe chunk by chunk, and stitch back into one continuous transcript and SRT with correct timestamps. Use `--no-chunk` to disable and fail fast instead.

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

# ElevenLabs Scribe, two speakers separated
trx interview.m4a -b elevenlabs --speakers 2 -l spa

# JSON output for piping
trx video.mp4 --output json --fields text

# Dry run to preview
trx video.mp4 --dry-run --output json
```

### Reading the result

```json
"metadata": {
  "language": "es",
  "model": "large-v3-turbo",
  "inputDurationMs": 90538,
  "transcribedDurationMs": 90539,
  "lastCueEndMs": 89120
}
```

Three durations, no verdict. The gaps say different things:

- **`inputDurationMs` against `transcribedDurationMs`** is what the cleaning stage changed. They should be within a millisecond of each other. A large gap means the timeline was rewritten and the timestamps do not describe the file you passed in.
- **`transcribedDurationMs` against `lastCueEndMs`** is audio that produced no words: trailing silence, or a transcription that stopped early.

A short transcript reads the same whether the recording is mostly silence, the model stopped early, or the file handed in was not the one intended. These separate those cases.

### Verbatim transcripts

A transcriber cleans by default, dropping hesitations and false starts as noise. That is right for captions and wrong when the transcript drives an edit, because those spans are exactly the ones worth cutting.

```bash
trx transcribe video.mp4 --words --language es --preset verbatim
```

Measured on one recording: the preset recovers `Ok.` and `Eh,` where the unprompted run drops both. The prompt has to be written in the language being spoken, so the preset needs `--language` and covers `de`, `en`, `es`, `fr`, `it`, `pt`. Any other language is an error naming what is available, because a prompt in the wrong language steers the model worse than none. `--prompt "<text>"` writes your own.

---

## trx models

List available transcription models per backend.

```bash
trx models [--backend local|openai|vercel|elevenlabs] [--output json]
```

Local, OpenAI and ElevenLabs lists are static. The `vercel` backend queries the gateway live (requires `AI_GATEWAY_API_KEY`), so you always see what is actually available instead of guessing model slugs.

```bash
# All backends grouped
trx models

# Only gateway models, as JSON for agents
trx models --backend vercel --output json
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
| `-b, --backend` | Backend: `local`, `openai`, `vercel`, or `elevenlabs` | `local` |
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
