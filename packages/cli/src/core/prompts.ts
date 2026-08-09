/**
 * Prompts that ask the model for a literal transcript.
 *
 * A transcriber cleans by default: it writes what it believes was meant, so a stretched
 * vowel, a false start or a filler is dropped as noise. For captions that is what you want.
 * For anything that edits the recording it is the opposite, because those spans are exactly
 * the ones worth cutting and one that never reaches the transcript cannot be acted on.
 * Measured on one recording: a prompted run recovered a three-attempt retake that the
 * unprompted run collapsed into a single phrase.
 *
 * The prompt has to be written in the language being transcribed and name the sounds that
 * language actually uses, so this is a table rather than one translated string: a filler list
 * written for Spanish is noise in Japanese. Only languages with a prompt someone wrote on
 * purpose are here. Asking for a preset in any other language says so instead of guessing,
 * because a prompt in the wrong language is worse than none at all.
 */

export type PresetName = "verbatim";

const VERBATIM: Record<string, string> = {
	en: "Verbatim transcription. Include fillers, hesitations and false starts: uh, um, you know, like, I mean.",
	es: "Transcripción literal. Incluí muletillas, dudas y sonidos: eh, mmm, este, o sea, digamos.",
	pt: "Transcrição literal. Inclua hesitações, muletas e sons: né, tipo, ahn, hum, quer dizer.",
	fr: "Transcription littérale. Incluez les hésitations et les tics de langage : euh, ben, du coup, enfin, voilà.",
	it: "Trascrizione letterale. Includi esitazioni e intercalari: ehm, cioè, insomma, tipo, allora.",
	de: "Wörtliche Transkription. Füllwörter und Zögern mitschreiben: äh, ähm, also, halt, ja.",
};

export const presetLanguages = (): string[] => Object.keys(VERBATIM).sort();

/**
 * The prompt for a preset, or null when the language has none. A caller that gets null
 * should say the preset did not apply rather than fall back to another language's prompt.
 */
export function presetPrompt(preset: PresetName, language: string): string | null {
	if (preset !== "verbatim") {
		return null;
	}
	return VERBATIM[language.toLowerCase()] ?? null;
}
