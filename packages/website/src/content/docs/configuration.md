---
title: Configuration
description: Config file format, environment variables, and customization options.
order: 4
---

## Config file

trx stores configuration at `~/.trx/config.json`. Created automatically by `trx init`.

```json
{
  "backend": "local",
  "modelPath": "~/.trx/models/ggml-small.bin",
  "modelSize": "small",
  "language": "auto",
  "threads": 8,
  "wordTimestamps": false,
  "openai": {
    "model": "gpt-4o-transcribe"
  },
  "vercel": {
    "model": "openai/whisper-1"
  },
  "whisperFlags": {
    "suppressNst": true,
    "noFallback": true,
    "entropyThold": 2.8,
    "logprobThold": -1.0,
    "maxContext": 0
  }
}
```

## Fields

| Field | Type | Description |
|-------|------|-------------|
| `backend` | `"local"` \| `"openai"` \| `"vercel"` | Active transcription backend |
| `modelPath` | string | Path to the local Whisper model file |
| `modelSize` | string | Model size identifier |
| `language` | string | Default language (`"auto"` for detection) |
| `threads` | number | CPU threads for local transcription |
| `wordTimestamps` | boolean | Enable word-level SRT by default |
| `openai.model` | string | Default OpenAI model |
| `vercel.model` | string | Default gateway model (`creator/model-name`) |
| `whisperFlags` | object | Advanced whisper-cli flags |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | For OpenAI backend | Your OpenAI API key |
| `AI_GATEWAY_API_KEY` | For Vercel backend | Your [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) API key |

## Models directory

Downloaded models are stored at `~/.trx/models/`. Each model is a `.bin` file downloaded from Hugging Face.

## Override per-command

Any config value can be overridden via CLI flags:

```bash
# Override backend
trx video.mp4 --backend openai

# Override model
trx video.mp4 --model large-v3-turbo

# Override language
trx video.mp4 --language es
```
