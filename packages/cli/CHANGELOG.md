# Changelog

Notable changes to `@crafter/trx`. Entries say what changed and, where it is not obvious, what measurement led to it.

## 0.8.0

### Added

- **`--preset verbatim` and `--prompt`.** A transcriber cleans by default: it writes what it believes was meant, so hesitations, stretched vowels and false starts are dropped as noise. That is right for captions and wrong when the transcript drives an edit, because those spans are exactly the ones worth cutting and one that never reaches the transcript cannot be acted on. Measured with `whisper-cli` on a 90.5s recording: 441 cues without a prompt, 450 with one.

  The prompt is a table rather than a translated string, because it has to be written in the language being spoken and name the fillers that language actually uses. Covers `de`, `en`, `es`, `fr`, `it`, `pt`. Any other language is an error naming the available ones rather than a fallback, since a prompt in the wrong language steers the model worse than no prompt at all. `--prompt` remains as the escape hatch.

  Note that the cleaning stage currently removes silence before transcribing, which deletes the pauses these hesitations live around, so the preset has less to work with than it should. Tracked in #35.

### Fixed

- **An unknown `--output` value is rejected instead of quietly becoming JSON.** It used to be accepted with exit 0 and discarded, so a caller that asked for something unavailable got output anyway with nothing saying the request was dropped.

  That silence was reachable by accident and produced a wrong bug report against this project: `--output` selects a format and `--output-dir` names a directory, one hyphen apart, so a path handed to the format flag looked from outside like the directory flag being ignored. The error now names the valid formats, and points at `--output-dir` only when the value looks like a path — `--output` appears about three times as often as `--output-dir` across this repo's own docs, so most bad values are a mistyped format and naming a different flag at all of them would add noise to the common case.

### Documentation

- The `transcribe` schema declares `--words`, `--preset` and `--prompt`, none of which it listed before, and its `--output` and `--output-dir` entries now each say what the other one does.
- The skill's correction checklist no longer recommends stripping fillers unconditionally. When the transcript feeds a tool that cuts a recording, those words are the evidence that tool reads.
