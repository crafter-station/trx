import { defineConfig } from "astro/config";

const trxTheme = {
	name: "trx",
	type: "dark",
	settings: [
		{ scope: ["comment", "comment.line", "punctuation.definition.comment"], settings: { foreground: "#64748B", fontStyle: "italic" } },
		{ scope: ["string", "string.quoted"], settings: { foreground: "#93C5FD" } },
		{ scope: ["constant", "constant.numeric"], settings: { foreground: "#60A5FA" } },
		{ scope: ["keyword", "keyword.operator", "keyword.control"], settings: { foreground: "#BFDBFE" } },
		{ scope: ["entity.name.function", "support.function"], settings: { foreground: "#FFFFFF" } },
		{ scope: ["variable", "variable.other"], settings: { foreground: "#E2E8F0" } },
		{ scope: ["punctuation"], settings: { foreground: "#94A3B8" } },
		{ scope: ["source", "text"], settings: { foreground: "#CBD5E1" } },
	],
	colors: {
		"editor.background": "#0F172A",
		"editor.foreground": "#CBD5E1",
	},
};

export default defineConfig({
	markdown: {
		shikiConfig: {
			theme: trxTheme,
		},
	},
});
