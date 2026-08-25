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
  version: "0.7.0"
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

On Windows, IT or CI can run a non-interactive local setup in PowerShell:

```powershell
trx init --yes --backend local --model small --language es
trx doctor --output json
```

The local backend does not upload the source. Whisper, `ffmpeg`, `ffprobe`, and `yt-dlp` are stored in `%USERPROFILE%\.trx\bin`. Setup prefers `winget` and falls back to checksum-verified portable downloads. Corporate software policies can still block the install.

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

### Backends

trx v0.7.0 supports three backends: local Whisper (default), OpenAI API, and Vercel AI Gateway.

Discover available transcription models with `trx models`, or filter with `trx models --backend <name>`.

```bash
# Local Whisper (default, offline, free)
trx transcribe <input> --backend local

# OpenAI API (faster, SOTA accuracy, requires OPENAI_API_KEY)
export OPENAI_API_KEY=sk-...
trx transcribe <input> --backend openai

# Vercel AI Gateway (requires AI_GATEWAY_API_KEY)
export AI_GATEWAY_API_KEY=...
trx transcribe <input> --backend vercel --model openai/whisper-1

# ElevenLabs Scribe (requires ELEVENLABS_API_KEY, separates speakers)
export ELEVENLABS_API_KEY=...
trx transcribe <input> --backend elevenlabs --diarize
```

OpenAI models:
- `gpt-4o-transcribe` — SOTA accuracy (default for openai backend)
- `gpt-4o-mini-transcribe` — cheapest
- `whisper-1` — legacy, supports per-segment SRT timestamps

Vercel model IDs use `creator/model-name` format. The default is `openai/whisper-1`. One `AI_GATEWAY_API_KEY` covers every provider on the gateway. Use a transcription model returned by `trx models --backend vercel`; this is Vercel AI Gateway, not Cloudflare AI Gateway.

ElevenLabs models: `scribe_v2` (default) and `scribe_v1`. This is the only backend that reports who is speaking. On macOS the key may live in the login Keychain under `elevenlabs` instead of the environment; `trx doctor` resolves it the same way a run does, so trust its verdict over `echo $ELEVENLABS_API_KEY`.

#### Speaker diarization

```bash
trx transcribe interview.m4a --backend elevenlabs --diarize --output json
trx transcribe interview.m4a --backend elevenlabs --speakers 2 --language spa --output json
```

`--diarize` prefixes every SRT cue with its speaker (`[speaker_0]`) and turns the `.txt` into a conversation, one paragraph per turn. `--speakers <n>` (1-32) passes the count when it is known and implies `--diarize`. A change of speaker always starts a new cue, so no cue attributes two people to one line.

Both flags are an error on `local`, `openai` and `vercel` rather than being ignored: no other backend returns speaker labels, and silently dropping them would hand back an undiarized transcript that looks like the request succeeded. `--language` accepts ISO 639-1 or ISO 639-3 here (`es` and `spa` both work); every other backend takes 639-1 only.

Local models: `tiny`, `tiny.en`, `base`, `base.en`, `small`, `small.en`, `medium`, `medium.en`, `large`, `large-v3-turbo`.

Set the backend persistently with `trx init --backend vercel` (or `local`/`openai`/`elevenlabs`) or in config.

#### Model discovery

```bash
trx models
trx models --backend local --output json
trx models --backend openai --output json
trx models --backend vercel --output json
trx models --backend elevenlabs --output json
```

Local, OpenAI and ElevenLabs model lists are static. Vercel models are fetched live from the gateway and filtered to transcription models, so do not hard-code that list. `AI_GATEWAY_API_KEY` is required when requesting only the Vercel backend. Without it, the all-backends view still returns local and OpenAI models plus a Vercel error.

#### Automatic cloud-file chunking

OpenAI uploads over 25 MB and Vercel uploads over 100 MB are chunked automatically with ffmpeg. The ElevenLabs limit is 5 GB, so that backend never chunks. trx transcribes chunks sequentially, joins their text in order, offsets and renumbers SRT timestamps, and removes intermediate chunk files. Use `--no-chunk` to disable this behavior and fail on an oversized cloud upload.

### 3. Post-process (fix whisper mistakes)

After transcription, read the `.txt` output and apply corrections. Read [whisper-fixes.md](references/whisper-fixes.md) for common patterns.

**Correction checklist:**
1. **Punctuation**: Whisper drops periods at paragraph boundaries and misplaces commas. Fix sentence boundaries.
2. **Accents** (Spanish): Whisper often drops diacritics. Restore: `como` -> `cómo` (how), `esta` -> `está` (is), `mas` -> `más` (more), `si` -> `sí` (yes), `el` -> `él` (he/him), `que` -> `qué` (what), `cuando` -> `cuándo` (when), `numero` -> `número`, `tambien` -> `también`, `informacion` -> `información`.
3. **Technical terms**: Whisper misspells domain-specific words. Ask user for a glossary or infer from context.
4. **Repeated phrases**: Whisper sometimes stutters on word boundaries. Remove exact consecutive duplicates.
5. **Speaker attribution**: If user provides speaker names, insert `[Speaker Name]:` markers.
6. **Filler words**: Remove "um", "uh", "este", "o sea" if user wants clean output. **Ask first when the transcript feeds an edit** rather than a reader: a tool that cuts a recording finds those spans by reading them, so removing them here deletes the evidence it needs. `--preset verbatim` exists to keep them in the transcript for exactly that case.
7. **Timestamp alignment**: If editing `.srt`, preserve the timestamp structure. Only modify text between timestamps.

### 4. Schema introspection

```bash
trx schema transcribe
trx schema init
trx schema models
```

These are the three schemas available in v0.7.0. Use `trx <command> --help` for the runtime CLI flags.

## Commands

| Command | Example |
|---------|---------|
| `init` | `trx init --model small` |
| `transcribe` | `trx transcribe <url-or-file> --output json` |
| `doctor` | `trx doctor --output json` |
| `models` | `trx models --output json` |
| `schema` | `trx schema transcribe` |
| `skills` | `trx skills get trx --full` |

## Loading this skill

This file ships with the CLI, so it can be read straight from an install instead of being copied around:

```bash
trx skills list              # what is bundled
trx skills get trx           # this file, raw markdown on stdout
trx skills get trx --full    # plus references/
trx skills path trx          # where it lives on disk
```

`--output json` works on each. `TRX_SKILLS_DIR` overrides where trx looks for the directory.

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
    "model": "small",
    "inputDurationMs": 90538,
    "transcribedDurationMs": 90539,
    "lastCueEndMs": 89120
  }
}
```

Full response includes `text`, `files`, `metadata`, `input`, `backend`.

**Read the three durations before trusting a short transcript.** They are numbers, not a
verdict, and the gaps between them say different things:

- `inputDurationMs` against `transcribedDurationMs` is what the cleaning stage changed. They
  should now be within a millisecond of each other; a large gap means the timeline was
  rewritten and the timestamps do not describe the file you passed in.
- `transcribedDurationMs` against `lastCueEndMs` is audio that produced no words. A big gap
  is trailing silence, or a transcription that stopped early.

A five-cue transcript reads identically whether the recording is mostly silence, the model
stopped early, or the file handed in was not the one intended. These separate those cases,
and checking them is faster than filing a bug.

## Flags reference

| Flag | Description | Default |
|------|-------------|---------|
| `-b, --backend <name>` | `local`, `openai`, or `vercel` | from config (`local`) |
| `-l, --language <code>` | ISO 639-1 language code | `auto` (from config) |
| `-m, --model <size>` | Override model: a local model, an OpenAI model, or `creator/model-name` for Vercel | from config |
| `-w, --words` | Word-level timestamps in SRT | false |
| `--preset <name>` | `verbatim` keeps fillers and false starts; needs `--language` | none |
| `--prompt <text>` | Initial prompt in the spoken language; beats `--preset` | none |
| `--output-dir <dir>` | Output directory, created if missing | `.` (cwd) |
| `-o, --output <format>` | `json`, `table`, or `auto`. Global flag, goes before the subcommand | auto (TTY=table, piped=json) |
| `--fields <list>` | Limit output: text,srt,metadata,files (comma-separated) | all |
| `--no-download` | Skip yt-dlp (input must be local) | false |
| `--no-clean` | Skip ffmpeg audio cleaning | false |
| `--no-chunk` | Disable automatic chunking for oversized OpenAI and Vercel uploads | false |
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
- **Oversized cloud uploads**: Chunking is automatic above 25 MB for OpenAI and 100 MB for Vercel. Remove `--no-chunk` if you want trx to split the file. If trx cannot determine the audio duration for chunking, confirm `ffprobe` is available with `command -v ffprobe`; it is installed with ffmpeg.
- **Slow local transcription**: Use a smaller local model such as `tiny` or `base`, or switch to the OpenAI or Vercel backend.
- **Multilingual content**: Specify the primary language with `--language es` instead of relying on `auto`.
- **OpenAI backend fails**: Ensure `OPENAI_API_KEY` is set, then run `trx doctor --output json`. Do not print the key.
- **Vercel backend fails**: Ensure `AI_GATEWAY_API_KEY` is set, run `trx doctor --output json`, and confirm the model with `trx models --backend vercel --output json`. Model IDs must use `creator/model-name` format.
- **`trx models` reports a missing gateway key**: `trx models` without a backend still returns local and OpenAI lists plus a Vercel error. `trx models --backend vercel` requires `AI_GATEWAY_API_KEY` and exits with an error when it is absent.
- **npm vs bun**: Package requires `bun >=1.0.0` runtime (engines field). `npm i -g @crafter/trx` works if `bun` is installed globally (`curl -fsSL https://bun.sh/install | bash`). `bun add -g` is recommended.
