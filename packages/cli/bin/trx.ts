#!/usr/bin/env bun
import { Command } from "commander";
import { createDoctorCommand } from "../src/commands/doctor.ts";
import { createInitCommand } from "../src/commands/init.ts";
import { createModelsCommand } from "../src/commands/models.ts";
import { createSchemaCommand } from "../src/commands/schema.ts";
import { createSkillsCommand } from "../src/commands/skills.ts";
import { createTranscribeCommand } from "../src/commands/transcribe.ts";
import { outputError } from "../src/utils/output.ts";
import { validateOutputFormat } from "../src/validation/input.ts";

const program = new Command();

import pkg from "../package.json" with { type: "json" };

program
	.name("trx")
	.description("Agent-first CLI for audio/video transcription via Whisper")
	.version(pkg.version)
	.option("-o, --output <format>", "output format (json, table, auto)", "auto")
	.hook("preAction", (thisCommand) => {
		const opts = thisCommand.opts();
		// Before resolving "auto", so an unknown format is rejected rather than quietly
		// becoming JSON. One entry point for every subcommand, since they all read this
		// same option through optsWithGlobals().
		try {
			opts.output = validateOutputFormat(String(opts.output));
		} catch (error) {
			// The requested format is the invalid one, so the complaint goes out in the
			// shape the caller would have got by default rather than in the one it asked
			// for and cannot have.
			outputError(error instanceof Error ? error.message : String(error), process.stdout.isTTY ? "table" : "json");
		}
		if (opts.output === "auto") {
			opts.output = process.stdout.isTTY ? "table" : "json";
		}
	});

program.addCommand(createInitCommand());
program.addCommand(createTranscribeCommand());
program.addCommand(createDoctorCommand());
program.addCommand(createModelsCommand());
program.addCommand(createSchemaCommand());
program.addCommand(createSkillsCommand());

const args = process.argv.slice(2);
const subcommands = program.commands.map((c) => c.name());
const globalFlags = ["--help", "-h", "--version", "-V"];
const firstArg = args[0];

if (firstArg && !firstArg.startsWith("-") && !subcommands.includes(firstArg) && !globalFlags.includes(firstArg)) {
	process.argv.splice(2, 0, "transcribe");
}

program.parse();
