import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { type OutputFormat, output, outputError } from "../utils/output.ts";

const SKILLS_DIR_ENV = "TRX_SKILLS_DIR";

export interface Skill {
	name: string;
	description: string;
	path: string;
	content: string;
}

function parseFrontmatter(content: string): Record<string, string> {
	if (!content.startsWith("---\n")) return {};
	const end = content.indexOf("\n---", 4);
	if (end === -1) return {};

	const fields: Record<string, string> = {};
	const lines = content.slice(4, end).split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s/.test(line)) continue;
		const sep = line.indexOf(":");
		if (sep === -1) continue;
		const key = line.slice(0, sep).trim();
		if (!key) continue;

		const raw = line.slice(sep + 1).trim();

		// Block scalars (`key: |` or `key: >`) carry their value in the indented
		// lines below, which the flat scan above skips.
		if (raw === "|" || raw === ">" || raw === "|-" || raw === ">-") {
			const block: string[] = [];
			while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
				block.push(lines[++i].trim());
			}
			fields[key] = block.join(raw.startsWith(">") ? " " : "\n").trim();
			continue;
		}

		fields[key] = raw.replace(/^["'](.*)["']$/, "$1");
	}
	return fields;
}

/**
 * Resolution order, widest override first:
 *   1. TRX_SKILLS_DIR, a direct path to the skills directory
 *   2. `../skills` relative to this file, the layout npm and bun install
 *   3. walking up from this file, for repo checkouts and monorepo runs
 *
 * A global install that separates the entry point from its assets defeats 2
 * and 3, which is why 1 exists and why the error names it.
 */
export function findSkillsDir(): string | null {
	const override = process.env[SKILLS_DIR_ENV];
	if (override) {
		const path = resolve(override);
		return existsSync(path) ? path : null;
	}

	const here = dirname(fileURLToPath(import.meta.url));

	const packaged = resolve(here, "..", "..", "skills");
	if (existsSync(packaged)) return packaged;

	let dir = here;
	for (let depth = 0; depth < 8; depth++) {
		const candidate = join(dir, "skills");
		if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return null;
}

export function discoverSkills(skillsDir: string): Skill[] {
	const skills: Skill[] = [];

	for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const skillPath = join(skillsDir, entry.name);
		const manifest = join(skillPath, "SKILL.md");
		if (!existsSync(manifest)) continue;

		const content = readFileSync(manifest, "utf-8");
		const meta = parseFrontmatter(content);
		if (meta.hidden === "true") continue;

		skills.push({
			name: meta.name || entry.name,
			description: meta.description || "",
			path: skillPath,
			content,
		});
	}

	return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Descriptions are multi-line by design; a table cell is one line. */
function summarize(description: string): string {
	const firstSentence = description.replace(/\s+/g, " ").trim().split(". ")[0];
	return firstSentence.length > 96 ? `${firstSentence.slice(0, 93)}...` : firstSentence;
}

function collectExtraFiles(skillPath: string): string[] {
	const files: string[] = [];
	for (const sub of ["references", "templates"]) {
		const dir = join(skillPath, sub);
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isFile()) files.push(join(dir, entry.name));
		}
	}
	return files.sort();
}

function missingDirError(format: OutputFormat): never {
	outputError(`Skills directory not found. Set ${SKILLS_DIR_ENV} to its path, or reinstall trx.`, format);
	throw new Error("unreachable");
}

export function createSkillsCommand(): Command {
	const skills = new Command("skills").description("Serve the bundled agent skill (list, get, path)");

	skills
		.command("list", { isDefault: true })
		.description("List available skills")
		.action((_opts, cmd) => {
			const format: OutputFormat = cmd.optsWithGlobals().output;
			const dir = findSkillsDir();
			if (!dir) missingDirError(format);

			const found = discoverSkills(dir);
			output(format, {
				json: { success: true, data: found.map(({ name, description, path }) => ({ name, description, path })) },
				table: {
					headers: ["name", "description", "get it with"],
					rows: found.map((s) => [s.name, summarize(s.description), `trx skills get ${s.name}`]),
				},
			});
		});

	skills
		.command("get")
		.argument("[names...]", "skill names to output")
		.option("--all", "output every skill")
		.option("--full", "include references and templates")
		.description("Output a skill's full content for pasting into agent context")
		.action((names: string[], opts, cmd) => {
			const format: OutputFormat = cmd.optsWithGlobals().output;
			const dir = findSkillsDir();
			if (!dir) missingDirError(format);

			const available = discoverSkills(dir);
			const wanted = opts.all ? available : available.filter((s) => names.includes(s.name));

			if (!opts.all && names.length === 0) {
				outputError(`Name a skill or pass --all. Available: ${available.map((s) => s.name).join(", ")}`, format);
			}

			const unknown = opts.all ? [] : names.filter((n) => !available.some((s) => s.name === n));
			if (unknown.length > 0) {
				outputError(
					`Unknown skill: ${unknown.join(", ")}. Available: ${available.map((s) => s.name).join(", ")}`,
					format,
				);
			}

			const rendered = wanted.map((skill) => {
				if (!opts.full) return { name: skill.name, content: skill.content };
				const extras = collectExtraFiles(skill.path).map((file) => {
					const rel = file.slice(skill.path.length + 1);
					return `\n\n--- ${rel} ---\n\n${readFileSync(file, "utf-8")}`;
				});
				return { name: skill.name, content: skill.content + extras.join("") };
			});

			if (format === "json") {
				output(format, { json: { success: true, data: rendered } });
				return;
			}

			process.stdout.write(rendered.map((s) => s.content).join("\n\n"));
		});

	skills
		.command("path")
		.argument("[name]", "skill name")
		.description("Print the filesystem path to a skill directory")
		.action((name: string | undefined, _opts, cmd) => {
			const format: OutputFormat = cmd.optsWithGlobals().output;
			const dir = findSkillsDir();
			if (!dir) missingDirError(format);

			if (!name) {
				if (format === "json") {
					output(format, { json: { success: true, data: { path: dir } } });
				} else {
					console.log(dir);
				}
				return;
			}

			const skill = discoverSkills(dir).find((s) => s.name === name);
			if (!skill) {
				outputError(`Unknown skill: ${name}`, format);
				return;
			}

			if (format === "json") {
				output(format, { json: { success: true, data: { path: skill.path } } });
			} else {
				console.log(skill.path);
			}
		});

	return skills;
}
