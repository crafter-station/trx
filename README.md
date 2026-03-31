# @crafter/trx

Agent-first CLI for audio/video transcription via [Whisper](https://github.com/ggml-org/whisper.cpp).

Downloads, cleans, and transcribes media from URLs or local files with machine-readable output designed for AI agents.

## Install

```bash
bun add -g @crafter/trx
trx init
```

`trx init` installs dependencies (`whisper-cli`, `yt-dlp`, `ffmpeg` via Homebrew), downloads a Whisper model, and optionally installs the agent skill for your AI coding tool.

### Skill Only

If you already have trx set up and just want the agent skill:

```bash
npx skills add crafter-station/trx -g
```

## Usage

```bash
# Transcribe a local file
trx recording.mp4

# Transcribe from URL (YouTube, Twitter, Instagram, etc.)
trx "https://youtube.com/watch?v=..."

# Agent-friendly JSON output
trx transcribe video.mp4 --output json

# Only get the text (saves tokens)
trx transcribe video.mp4 --fields text --output json

# Dry-run (validate without executing)
trx transcribe video.mp4 --dry-run --output json

# Specify language
trx transcribe video.mp4 --language es

# Schema introspection for agents
trx schema transcribe
```

## Commands

| Command | Description |
|---------|-------------|
| `trx <input>` | Shorthand for `trx transcribe` |
| `trx init` | Install deps + download Whisper model |
| `trx transcribe <input>` | Full transcription pipeline |
| `trx doctor` | Check dependency status |
| `trx schema <resource>` | JSON schema introspection |

## Agent-First Design

Built following [agent-first CLI principles](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/):

- **`--output json`** auto-detects: table for TTY, JSON when piped
- **`--dry-run`** validates before executing
- **`--fields`** limits response size to protect agent context windows
- **`trx schema`** runtime introspection (no docs needed)
- **Input validation** rejects control characters, path traversals, URL-encoded strings
- **Ships with SKILL.md** for Claude Code agent post-processing

## Agent Skill

The bundled skill (`skills/trx/SKILL.md`) enables AI agents to:

1. Transcribe media via CLI
2. Post-process output (fix punctuation, accents, technical terms, repeated phrases)
3. Reference `whisper-fixes.md` for common Whisper mistake patterns

## Pipeline

```
Input (URL or file)
  |
  v
[yt-dlp] Download media (if URL)
  |
  v
[ffmpeg] Clean audio (silence removal, noise reduction, normalization)
  |
  v
[whisper-cli] Transcribe (local Whisper model)
  |
  v
Output: .wav + .srt + .txt + JSON
```

## Configuration

Stored at `~/.trx/config.json` after `trx init`:

```json
{
  "modelPath": "~/.trx/models/ggml-small.bin",
  "modelSize": "small",
  "language": "auto",
  "threads": 8
}
```

Models: `tiny` (75MB) | `base` (142MB) | `small` (466MB) | `medium` (1.5GB) | `large` (3GB)

## License

MIT
