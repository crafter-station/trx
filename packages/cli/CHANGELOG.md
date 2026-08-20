# Changelog

Notable changes to `@crafter/trx`. Entries say what changed and, where it is not obvious, what measurement led to it.

## 0.9.1

### Fixed

- **`--words` now keeps the per-word timings on the elevenlabs backend.** They were never missing: that backend sends `timestamps_granularity: word` on every request, because `wordsToCues` builds the SRT out of the response. It then returned only the SRT path and the words were dropped, so anything needing a word boundary had to make a second identical request to the same endpoint for data the first call had already parsed.

  Measured in a consumer that needed them: **10.1 seconds of API wait per run** to re-fetch what was already in memory, on a 19 minute source whose first transcription took 16.3s. The flag now writes `<audio>.words.json` beside the SRT — `text`, `startMs`, `endMs`, `speaker` when diarizing, and the provider's `logprob` passed through on its own scale rather than normalised, because it scores the token and not the boundary.

  No extra request and no extra latency: the words are parsed either way. What changes is whether they survive the process.

- **The `--words` help text described only the local backend.** There it changes whisper's SRT segmentation; on elevenlabs it decides whether the timings are written. It now names both.

## 0.9.0

### Added

- **ElevenLabs Scribe backend with speaker diarization** (`--backend elevenlabs`, `--diarize`, `--speakers N`). Cues are built from the API's own word timings rather than from a model's segmentation.

  Why it matters for anything that edits on a transcript: whisper repairs speech. Measured on one 19 minute screencast, at the same instant, whisper returned `...sobre Normal fue muy bien recibido y tuvo muy buenos comentarios` where Scribe returned `...sobre Normal... Hola, ¿cómo están? El video an-- hola, ¿cómo están?`. Whisper had welded an aborted take onto a later complete one and dropped the seam between them, and what it produced is grammatical, so nothing downstream can tell. On that source, three blind runs of an editing tool reading a whisper transcript found one repeated take between them; one reading Scribe found five.

## 0.8.1

### Fixed

- **The transcription path no longer removes silence before transcribing.** `silenceremove` led the cleaning chain, and deleting pauses rewrites the timeline: every cue after the first removed pause was early, and the error accumulated rather than being a constant offset a consumer could subtract. Measured on one 90.538s recording, the audio that reached the model ran 88.966s — **1.572s of drift**, with nothing in the output saying the timeline had changed. Anything using those timestamps against the original file was quietly wrong.

  It also bought nothing. Same recording, with it and without: **436 cues either way**, and the run without was faster (7.6s against 8.7s), because dropping pauses costs more in the filter than the shorter audio saves in the model. `dynaudnorm` and `afftdn` stay; both preserve duration. Closes #35.

- **`--preset verbatim` and `--prompt` now reach the model.** They were being built into the whisper invocation correctly and then discarded: an initial prompt *is* text context, and the default `--max-context 0` throws it away, so a prompted run came back byte-identical to an unprompted one. The default exists to stop the model carrying its own hallucinations forward between windows and is worth keeping when nothing was asked for; when a prompt was, the room now exists for it to sit in.

  Verified end to end rather than by flag inspection: on the same recording the preset now recovers `Ok.` and `Eh,` where the unprompted run dropped both, which is the material a cutting tool reads.

  What neither fix changes: a consumer measuring transcript positions against audio energy still finds drift, because the model stretches a cue backwards into the pause before a word. Measured with `vcut detect` on the same recording, the share of cues claiming a word starts inside measured silence went from 28% to 25% while the worst single case rose from 1318ms to 1418ms. That is a different phenomenon from a rewritten timeline and it is unaffected by this release.

### Added

- **`transcribedDurationMs` and `lastCueEndMs` in the transcribe result**, alongside `inputDurationMs`. Three numbers rather than a verdict: the gap between the first two is what the cleaning stage changed, and the gap between the second and third is how much audio produced no words. A short transcript used to be ambiguous — mostly-silent recording, model stopping early, or the wrong file handed in all read the same. Closes #36.

## 0.8.0

### Added

- **`--preset verbatim` and `--prompt`.** A transcriber cleans by default: it writes what it believes was meant, so hesitations, stretched vowels and false starts are dropped as noise. That is right for captions and wrong when the transcript drives an edit, because those spans are exactly the ones worth cutting and one that never reaches the transcript cannot be acted on. Measured with `whisper-cli` on a 90.5s recording: 441 cues without a prompt, 450 with one.

  The prompt is a table rather than a translated string, because it has to be written in the language being spoken and name the fillers that language actually uses. Covers `de`, `en`, `es`, `fr`, `it`, `pt`. Any other language is an error naming the available ones rather than a fallback, since a prompt in the wrong language steers the model worse than no prompt at all. `--prompt` remains as the escape hatch.

  (Shipped inert: the prompt was discarded before reaching the model until 0.8.1.)

### Fixed

- **An unknown `--output` value is rejected instead of quietly becoming JSON.** It used to be accepted with exit 0 and discarded, so a caller that asked for something unavailable got output anyway with nothing saying the request was dropped.

  That silence was reachable by accident and produced a wrong bug report against this project: `--output` selects a format and `--output-dir` names a directory, one hyphen apart, so a path handed to the format flag looked from outside like the directory flag being ignored. The error now names the valid formats, and points at `--output-dir` only when the value looks like a path — `--output` appears about three times as often as `--output-dir` across this repo's own docs, so most bad values are a mistyped format and naming a different flag at all of them would add noise to the common case.

### Documentation

- The `transcribe` schema declares `--words`, `--preset` and `--prompt`, none of which it listed before, and its `--output` and `--output-dir` entries now each say what the other one does.
- The skill's correction checklist no longer recommends stripping fillers unconditionally. When the transcript feeds a tool that cuts a recording, those words are the evidence that tool reads.
