# Common Whisper Transcription Mistakes

Reference for post-processing agent corrections. Grouped by language and category.

## Spanish

### Accent marks (most common)
Whisper frequently drops diacritics. Restore based on grammatical context:
- "como" -> "cmo" (when meaning "how/what")
- "esta" -> "est" (when it's a verb, not demonstrative)
- "mas" -> "ms" (when meaning "more", not "but")
- "si" -> "s" (when meaning "yes", not "if")
- "el" -> "l" (when it's a pronoun, not article)
- "que" -> "qu" (in questions: "Qu haces?")
- "cuando" -> "cundo" (in questions)
- "numero" -> "nmero"
- "tambien" -> "tambin"
- "informacion" -> "informacin"

### Question/exclamation marks
Whisper almost never generates opening marks:
- Add "" at the start of questions
- Add "" at the start of exclamations

### Run-on sentences
Whisper often produces long sentences without periods. Split when:
- Topic changes
- Speaker changes
- Natural pause in the audio (check SRT timestamps for gaps > 1.5s)

### Common confusions
- "coma" vs "como" (comma vs how)
- "haber" vs "a ver" (to have vs let's see)
- "echo" vs "hecho" (thrown vs done/fact)
- "hay" vs "ah" vs "ay" (there is vs interjection)

## English

### Homophones
- "their" / "there" / "they're"
- "your" / "you're"
- "its" / "it's"
- "to" / "too" / "two"
- "then" / "than"

### Capitalization
Whisper inconsistently capitalizes:
- Proper nouns (names, companies, places)
- Sentence beginnings after periods
- Acronyms (API, CLI, AI, ML)

### Technical terms (common misspellings)
- "typescript" -> "TypeScript"
- "javascript" -> "JavaScript"
- "react" -> "React" (when referring to the framework)
- "next js" / "nextjs" -> "Next.js"
- "node js" -> "Node.js"
- "github" -> "GitHub"
- "vercel" -> "Vercel"
- "anthropic" -> "Anthropic"
- "openai" -> "OpenAI"
- "kubernetes" -> "Kubernetes"
- "docker" -> "Docker"

### Filler words (remove if user wants clean output)
- "um", "uh", "like", "you know", "I mean", "basically", "actually", "right"

## Both Languages

### Repeated words
Whisper sometimes outputs the same word/phrase twice at segment boundaries:
```
the the quick brown fox
```
Remove exact consecutive duplicates.

### Numbers
Whisper alternates between spelled-out and numeric forms inconsistently:
- Prefer numeric for: dates, times, measurements, code references
- Prefer spelled-out for: small numbers in natural speech (one, two, three)

### Timestamps (SRT editing rules)
When editing .srt files:
1. Never modify timestamp lines (lines with `-->`)
2. Never modify sequence numbers
3. Only edit the text content between timestamps
4. Keep the same number of subtitle blocks
5. Preserve blank lines between blocks
