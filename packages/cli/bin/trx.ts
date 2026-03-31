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

program
	.argument("[input]", "URL or file path to transcribe (shorthand for trx transcribe)")
	.action(async (input, _opts, cmd) => {
		if (!input) {
			cmd.help();
			return;
		}
		const transcribeCmd = program.commands.find((c) => c.name() === "transcribe");
		if (transcribeCmd) {
			await transcribeCmd.parseAsync(["node", "trx", "transcribe", input, ...process.argv.slice(3)]);
		}
	});

program.parse();
