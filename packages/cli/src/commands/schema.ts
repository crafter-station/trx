import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { outputJSON } from "../utils/output.ts";

const SCHEMAS_DIR = join(dirname(dirname(import.meta.dir)), "schemas");

const AVAILABLE_SCHEMAS = ["transcribe", "init"] as const;

export function createSchemaCommand(): Command {
	return new Command("schema")
		.description("Introspect command schemas (agent self-service)")
		.argument("<resource>", `Resource to describe: ${AVAILABLE_SCHEMAS.join(", ")}`)
		.action((resource: string) => {
			const schemaPath = join(SCHEMAS_DIR, `${resource}.json`);
			try {
				const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
				outputJSON(schema);
			} catch {
				console.error(`Unknown schema: "${resource}". Available: ${AVAILABLE_SCHEMAS.join(", ")}`);
				process.exit(1);
			}
		});
}
