---
title: Getting Started
description: Install trx and transcribe your first file in under a minute.
order: 1
---

## Install

```bash
bun add -g @crafter/trx
```

## Setup

Run `trx init` to install dependencies and download a Whisper model:

```bash
trx init
```

This will:
1. Check and install `whisper-cli`, `yt-dlp`, and `ffmpeg`
2. Let you choose a Whisper model size
3. Optionally install the Claude Code agent skill

## Transcribe

Paste a URL or path to a local file:

```bash
# YouTube video
trx "https://youtube.com/watch?v=dQw4w9WgXcQ"

# Local file
trx recording.mp4

# With language override
trx podcast.mp3 --language es
```

Output: `.txt` (plain text) and `.srt` (subtitles with timestamps).

## OpenAI API (optional)

For faster transcription without local models:

```bash
export OPENAI_API_KEY="sk-..."
trx init --backend openai
trx recording.mp4 -b openai
```

## TwelveLabs Pegasus (optional)

Transcribe a video straight from its URL using [TwelveLabs](https://twelvelabs.io)
Pegasus video understanding — no local download, model, or audio cleaning
required. It reads the video server-side and uses the full audiovisual context.

```bash
export TWELVELABS_API_KEY="tlk_..."
trx "https://example.com/talk.mp4" -b pegasus
```

Pegasus needs a direct media URL (not a YouTube/Drive share link). Grab a free
API key at [twelvelabs.io](https://twelvelabs.io) — there's a generous free tier.
