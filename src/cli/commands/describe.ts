import { describeEndpoint, describeCompact, describeAllParams } from "../../core/generator/describe.ts";
import { printError } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface DescribeOptions {
  specPath: string;
  method?: string;
  path?: string;
  compact?: boolean;
  listParams?: boolean;
  json?: boolean;
}

export async function describeCommand(options: DescribeOptions): Promise<number> {
  try {
    if (options.listParams) {
      const params = await describeAllParams(options.specPath);
      if (options.json) {
        printJson(jsonOk("describe", { params }));
      } else {
        const grouped = new Map<string, typeof params>();
        for (const p of params) {
          const arr = grouped.get(p.in) ?? [];
          arr.push(p);
          grouped.set(p.in, arr);
        }
        for (const [location, locationParams] of grouped) {
          console.log(`\n${location.toUpperCase()} parameters:`);
          for (const p of locationParams) {
            const req = p.required ? " (required)" : "";
            const type = p.type ? ` [${p.type}]` : "";
            console.log(`  ${p.name}${type}${req} — used in ${p.usedBy.length} endpoint(s)`);
          }
        }
        console.log(`\n${params.length} unique parameter(s)`);
      }
      return 0;
    }

    if (options.compact) {
      const endpoints = await describeCompact(options.specPath);

      if (options.json) {
        printJson(jsonOk("describe", { endpoints }));
      } else {
        for (const ep of endpoints) {
          const parts = [ep.method.padEnd(7), ep.path];
          if (ep.operationId) parts.push(`(${ep.operationId})`);
          if (ep.summary) parts.push(`— ${ep.summary}`);
          if (ep.deprecated) parts.push("[deprecated]");
          console.log(parts.join(" "));
        }
        console.log(`\n${endpoints.length} endpoint(s)`);
      }
      return 0;
    }

    if (!options.method || !options.path) {
      const msg = "Missing --method and --path. Use --compact for all endpoints, or specify --method and --path for one.";
      if (options.json) {
        printJson(jsonError("describe", [msg]));
      } else {
        printError(msg);
      }
      return 2;
    }

    const result = await describeEndpoint(options.specPath, options.method, options.path);

    if (options.json) {
      printJson(jsonOk("describe", result));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("describe", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}
