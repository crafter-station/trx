import { Command } from "commander";
import { type OutputFormat, output, outputError } from "../utils/output.ts";
import { VALID_LOCAL_MODELS, VALID_OPENAI_MODELS, validateBackend } from "../validation/input.ts";

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";
const MISSING_GATEWAY_KEY = "AI_GATEWAY_API_KEY not set";

interface GatewayModel {
	id?: unknown;
	type?: unknown;
}

interface GatewayModelsResponse {
	data?: GatewayModel[];
}

async function fetchVercelModels(apiKey: string): Promise<string[]> {
	const response = await fetch(GATEWAY_MODELS_URL, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});

	if (!response.ok) {
		throw new Error(`Vercel AI Gateway error (${response.status}): ${await response.text()}`);
	}

	const payload = (await response.json()) as GatewayModelsResponse;
	if (!Array.isArray(payload.data)) {
		throw new Error("Vercel AI Gateway returned an invalid models response");
	}

	return payload.data
		.filter((model) => model.type === "transcription" && typeof model.id === "string")
		.map((model) => model.id as string);
}

export function createModelsCommand(): Command {
	return new Command("models")
		.description("List available transcription models")
		.option("-b, --backend <name>", "filter by backend (local, openai, vercel)")
		.action(async (opts, cmd) => {
			const format: OutputFormat = cmd.optsWithGlobals().output;

			try {
				const backend = opts.backend ? validateBackend(opts.backend) : undefined;
				const apiKey = process.env.AI_GATEWAY_API_KEY;

				if (backend === "vercel" && !apiKey) {
					outputError(MISSING_GATEWAY_KEY, format);
					return;
				}

				const data: Record<string, readonly string[] | { error: string }> = {};
				const rows: string[][] = [];

				if (!backend || backend === "local") {
					data.local = VALID_LOCAL_MODELS;
					rows.push(...VALID_LOCAL_MODELS.map((model) => ["local", model]));
				}

				if (!backend || backend === "openai") {
					data.openai = VALID_OPENAI_MODELS;
					rows.push(...VALID_OPENAI_MODELS.map((model) => ["openai", model]));
				}

				if (!backend || backend === "vercel") {
					if (apiKey) {
						const vercelModels = await fetchVercelModels(apiKey);
						data.vercel = vercelModels;
						rows.push(...vercelModels.map((model) => ["vercel", model]));
					} else {
						data.vercel = { error: MISSING_GATEWAY_KEY };
					}
				}

				output(format, {
					json: data,
					table: {
						headers: ["Backend", "Model"],
						rows,
					},
				});

				if (format !== "json" && data.vercel && !Array.isArray(data.vercel)) {
					console.log(`\nNote: Vercel models skipped. ${MISSING_GATEWAY_KEY}.`);
				}
			} catch (error) {
				outputError((error as Error).message, format);
			}
		});
}
