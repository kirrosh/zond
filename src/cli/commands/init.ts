import { resolve, dirname } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { printSuccess } from "../output.ts";

export interface InitCommandOptions {
  force: boolean;
}

const EXAMPLE_TEST = `name: Example Smoke Test
base_url: "{{base_url}}"

tests:
  - name: "List posts"
    GET: /posts
    expect:
      status: 200
      body:
        id: { type: integer }

  - name: "Get single post"
    GET: /posts/1
    expect:
      status: 200
      body:
        id: { equals: 1 }
        title: { type: string }
`;

const ENV_DEV = `base_url: https://jsonplaceholder.typicode.com
`;

const MCP_CONFIG = `{
  "mcpServers": {
    "zond": {
      "command": "zond",
      "args": ["mcp"]
    }
  }
}
`;

function writeIfMissing(filePath: string, content: string, force: boolean): boolean {
  if (!force && existsSync(filePath)) {
    console.log(`  Skipped ${filePath} (already exists)`);
    return false;
  }
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, "utf-8");
  console.log(`  Created ${filePath}`);
  return true;
}

function isClaudeCodeAvailable(): boolean {
  try {
    const result = Bun.spawnSync(["claude", "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function initCommand(options: InitCommandOptions): Promise<number> {
  const cwd = process.cwd();

  console.log("Initializing zond project...\n");

  writeIfMissing(resolve(cwd, "tests/example.yaml"), EXAMPLE_TEST, options.force);
  writeIfMissing(resolve(cwd, ".env.dev.yaml"), ENV_DEV, options.force);

  // Create .mcp.json if Claude Code is detected
  if (isClaudeCodeAvailable()) {
    writeIfMissing(resolve(cwd, ".mcp.json"), MCP_CONFIG, options.force);
    printSuccess("Claude Code detected — .mcp.json created");
  }

  console.log("\nReady! Run: zond run tests/");
  return 0;
}
