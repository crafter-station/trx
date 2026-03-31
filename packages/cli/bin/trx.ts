#!/usr/bin/env bun
import { Command } from "commander";
import { createDoctorCommand } from "../src/commands/doctor.ts";
import { createInitCommand } from "../src/commands/init.ts";
import { createSchemaCommand } from "../src/commands/schema.ts";
import { createTranscribeCommand } from "../src/commands/transcribe.ts";

const program = new Command();

program
	.name("trx")
	.description("Agent-first CLI for audio/video transcription via Whisper")
	.version("0.1.0")
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
program.addCommand(createSchemaCommand());

const args = process.argv.slice(2);
const subcommands = ["init", "transcribe", "doctor", "schema", "help", "--help", "-h", "--version", "-V"];
const firstArg = args[0];

if (firstArg && !firstArg.startsWith("-") && !subcommands.includes(firstArg)) {
	process.argv.splice(2, 0, "transcribe");
}

program.parse();
