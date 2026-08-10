# @crafter/trx - Agent Guide

`@crafter/trx` is an agent-first CLI that transcribes audio/video from URLs (YouTube, Twitter, Instagram, any yt-dlp source) or local files using Whisper, locally via whisper-cli or remotely via the OpenAI API. Reach for it when a task needs speech-to-text: extracting the transcript of a video/podcast, generating subtitles (.srt), or turning a recording into text for summarization. Output auto-switches to JSON when piped, supports `--fields` to limit payload size, `--dry-run` validation, and `trx schema` introspection.

## Install

```bash
# Run without installing (requires Bun on PATH; the binary is a Bun script)
bunx @crafter/trx init
npx @crafter/trx@latest init

# Or install globally
bun add -g @crafter/trx
trx init
```

The published name is `@crafter/trx` (scoped). `trx init` is a required one-time setup: it installs `whisper-cli`, `yt-dlp`, and `ffmpeg` (via Homebrew on macOS), downloads a Whisper model to `~/.trx/models/`, and writes `~/.trx/config.json`.

## Commands

| Command | Description |
|---------|-------------|
| `trx <input>` | Shorthand for `trx transcribe <input>` |
| `trx init` | Install deps + download Whisper model (run once, first) |
| `trx transcribe <input>` | Full pipeline: download -> clean audio -> transcribe |
| `trx doctor` | Check dependency/config status (whisper-cli, yt-dlp, ffmpeg) |
| `trx schema <resource>` | Print JSON schema for `init` or `transcribe` |

Global option (all commands): `-o, --output <format>` with `json`, `table`, or `auto` (default). `auto` renders a table on a TTY and emits JSON when piped, so agents get JSON without passing anything.

`trx init` flags:

| Flag | Description |
|------|-------------|
| `-b, --backend <backend>` | `local` (whisper-cli) or `openai` (needs `OPENAI_API_KEY`) |
| `-m, --model <size>` | Whisper model size, default `small` (`tiny`/`base`/`small`/`medium`/`large`) |
| `-l, --language <code>` | Default language, `auto` = detect |

`trx transcribe <input>` flags:

| Flag | Description |
|------|-------------|
| `-l, --language <lang>` | Force language (ISO 639-1), default auto-detect |
| `-m, --model <size>` | Override model. Local: `tiny`/`base`/`small`/`medium`/`large`/`large-v3-turbo`. OpenAI: `gpt-4o-transcribe`/`gpt-4o-mini-transcribe`/`whisper-1` |
| `-b, --backend <backend>` | `local`, `openai`, or `vercel` |
| `--fields <fields>` | Limit output fields: `text`, `srt`, `metadata`, `files` |
| `--dry-run` | Validate input and show plan without transcribing |
| `--json <payload>` | Raw JSON input for agents |
| `--output-dir <dir>` | Where to write `.wav`/`.srt`/`.txt` (default `.`) |
| `-w, --words` | Word-level timestamps in the SRT |
| `--preset <name>` | `verbatim` keeps fillers and false starts; needs `--language` |
| `--prompt <text>` | Initial prompt in the spoken language; takes precedence over `--preset` |
| `--no-download` | Skip yt-dlp, input must be a local file |
| `--no-clean` | Skip ffmpeg audio cleaning |

## Usage patterns

1. First-time setup, then transcribe a local file:
   ```bash
   trx init
   trx recording.mp4
   ```
2. Transcribe a URL and get only the text as JSON (token-efficient for agents):
   ```bash
   trx transcribe "https://youtube.com/watch?v=..." --fields text --output json
   ```
3. Validate before running an expensive job:
   ```bash
   trx transcribe video.mp4 --dry-run --output json
   ```
4. Use the OpenAI backend (no local model needed):
   ```bash
   OPENAI_API_KEY=sk-... trx transcribe interview.m4a --backend openai --model gpt-4o-mini-transcribe
   ```

## Decision guide

| Task | Use |
|------|-----|
| Transcript text of a video/audio file or URL | `trx transcribe <input> --fields text --output json` |
| Subtitles (.srt) for a video | `trx transcribe <input>` (writes `.srt`; add `-w` for word-level) |
| Check whether deps/model are ready | `trx doctor --output json` |
| Discover flags at runtime without docs | `trx schema transcribe` |
| Fast cloud transcription, no local model download | `--backend openai` with `OPENAI_API_KEY` set |
| Force Spanish (or any language) | `trx transcribe <input> --language es` |

## Common mistakes

- Wrong: `npm install trx` (different, unrelated package). Correct: `npm install -g @crafter/trx` or `bunx @crafter/trx`.
- Wrong: running `trx transcribe` on a fresh machine. Correct: run `trx init` first; it installs whisper-cli/yt-dlp/ffmpeg and downloads the model. `trx doctor` tells you what is missing.
- Wrong: assuming Node is enough. The `trx` binary has a `#!/usr/bin/env bun` shebang and requires Bun (`engines.bun >= 1.0.0`) even when installed through npm/npx.
- Wrong: `--backend openai` without credentials. Correct: export `OPENAI_API_KEY` first.
- Wrong: adding `--output json` manually in scripts. Not harmful, but unnecessary: output is already JSON whenever stdout is not a TTY.
- Wrong: expecting `trx init` to work non-interactively on Linux via Homebrew. Dependency install uses `brew`; without it, install `whisper-cli`, `yt-dlp`, and `ffmpeg` manually, then re-run `trx init` for the model download.
