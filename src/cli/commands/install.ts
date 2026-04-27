import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { CLIENTS, findClient, installToClient, type InstallResult } from "../../core/install/index.ts";
import { buildMcpServer } from "../../mcp/server.ts";
import { jsonError, jsonOk, printJson } from "../json-envelope.ts";
import { printError, printSuccess, printWarning } from "../output.ts";

export interface InstallOptions {
  claude?: boolean;
  cursor?: boolean;
  all?: boolean;
  dryRun?: boolean;
  sanity?: boolean;
  json?: boolean;
}

export interface SanityResult {
  ok: boolean;
  toolCount: number;
  resourceCount: number;
  templateCount: number;
  error?: string;
}

export async function installCommand(opts: InstallOptions): Promise<number> {
  const targets = pickTargets(opts);
  if (targets.length === 0) {
    const hint =
      "Specify which client(s) to configure: --claude, --cursor, or --all.\n" +
      "Detected MCP-capable clients are listed below; an interactive picker will land in TASK-11.";
    if (opts.json) {
      printJson(jsonError("install", [hint]));
    } else {
      printError(hint);
      for (const c of CLIENTS) {
        process.stdout.write(`  - ${c.id} (${c.displayName}) → ${c.configPath(homeOrEmpty())}\n`);
      }
    }
    return 1;
  }

  const installResults: InstallResult[] = [];
  const warnings: string[] = [];
  for (const target of targets) {
    try {
      const result = installToClient(target, { dryRun: opts.dryRun });
      installResults.push(result);
      if (!opts.json) {
        const verb =
          result.action === "created" ? "Created" :
          result.action === "updated" ? "Updated" :
          "Already up-to-date";
        const dryNote = opts.dryRun ? " (dry-run)" : "";
        process.stdout.write(`  ${verb}${dryNote}: ${result.configPath}\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.json) {
        printJson(jsonError("install", [`${target.id}: ${message}`]));
      } else {
        printError(`${target.displayName}: ${message}`);
      }
      return 1;
    }
  }

  const sanityEnabled = opts.sanity !== false;
  let sanity: SanityResult | undefined;
  if (sanityEnabled) {
    sanity = await runSanityCheck();
    if (!opts.json) {
      if (sanity.ok) {
        process.stdout.write(
          `  Sanity: tools/list=${sanity.toolCount}, resources/list=${sanity.resourceCount}, templates=${sanity.templateCount}\n`,
        );
      } else {
        printWarning(`Sanity check failed: ${sanity.error ?? "unknown error"}`);
      }
    }
  }

  if (typeof Bun !== "undefined" && !Bun.which("zond")) {
    warnings.push(
      "`zond` not found in PATH. Configs reference `command: \"zond\"` — run `zond://workflow/setup` or install the binary so MCP clients can launch it.",
    );
    if (!opts.json) printWarning(warnings[warnings.length - 1]!);
  }

  if (opts.json) {
    printJson(
      jsonOk(
        "install",
        {
          installed: installResults,
          sanity: sanity ?? null,
          dryRun: !!opts.dryRun,
        },
        warnings,
      ),
    );
  } else if (!opts.dryRun) {
    printSuccess(`Installed zond MCP server for ${installResults.length} client(s).`);
  }

  return 0;
}

function pickTargets(opts: InstallOptions) {
  if (opts.all) return [...CLIENTS];
  const out: ReturnType<typeof findClient>[] = [];
  if (opts.claude) out.push(findClient("claude"));
  if (opts.cursor) out.push(findClient("cursor"));
  return out.filter((c): c is NonNullable<typeof c> => Boolean(c));
}

async function runSanityCheck(): Promise<SanityResult> {
  const server = buildMcpServer({});
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "zond-install-sanity", version: "0" }, { capabilities: {} });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const [tools, resources, templates] = await Promise.all([
      client.listTools(),
      client.listResources(),
      client.listResourceTemplates(),
    ]);
    return {
      ok: tools.tools.length > 0,
      toolCount: tools.tools.length,
      resourceCount: resources.resources.length,
      templateCount: templates.resourceTemplates.length,
    };
  } catch (err) {
    return {
      ok: false,
      toolCount: 0,
      resourceCount: 0,
      templateCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

function homeOrEmpty(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "~";
}
