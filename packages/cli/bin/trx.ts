#!/usr/bin/env bun
import { Command } from "commander";
import { createDoctorCommand } from "../src/commands/doctor.ts";
import { createInitCommand } from "../src/commands/init.ts";
import { createModelsCommand } from "../src/commands/models.ts";
import { createSchemaCommand } from "../src/commands/schema.ts";
import { createTranscribeCommand } from "../src/commands/transcribe.ts";

const program = new Command();

import pkg from "../package.json" with { type: "json" };

program
	.name("trx")
	.description("Agent-first CLI for audio/video transcription via Whisper")
	.version(pkg.version)
	.option("-o, --output <format>", "output format (json, table, auto)", "auto")
	.hook("preAction", (thisCommand) => {
		const opts = thisCommand.opts();
		if (opts.output === "auto") {
			opts.output = process.stdout.isTTY ? "table" : "json";
		}
	});

program.addCommand(createInitCommand());
program.addCommand(createTranscribeCommand());
program.addCommand(createDoctorCommand());
program.addCommand(createModelsCommand());
program.addCommand(createSchemaCommand());

const args = process.argv.slice(2);
const subcommands = ["init", "transcribe", "doctor", "models", "schema", "help", "--help", "-h", "--version", "-V"];
const firstArg = args[0];

if (firstArg && !firstArg.startsWith("-") && !subcommands.includes(firstArg)) {
	process.argv.splice(2, 0, "transcribe");
}

program.parse();
