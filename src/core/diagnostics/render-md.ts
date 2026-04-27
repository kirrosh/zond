import type { DiagnoseResult } from "./db-analysis.ts";

/**
 * Render a DiagnoseResult into a human-readable markdown digest.
 * Output is the canonical body of the `zond://run/{id}/diagnosis` MCP resource.
 */
export function renderDiagnosisMarkdown(result: DiagnoseResult): string {
  const { run, summary, agent_directive, env_issue, auth_hint, cascade_skips, failures, grouped_failures } = result;
  const out: string[] = [];

  const passed = summary.passed;
  const total = summary.total;
  const env = run.environment ?? "no env";
  const duration = run.duration_ms !== null ? `${run.duration_ms}ms` : "unknown duration";

  out.push(`# Run ${run.id} — ${passed}/${total} passed`);
  out.push(`${run.started_at} · ${env} · ${duration}`);
  out.push("");
  out.push("## Summary");
  out.push(`- total: ${summary.total}`);
  out.push(`- passed: ${summary.passed}`);
  out.push(`- failed: ${summary.failed} (api_errors: ${summary.api_errors}, assertion_failures: ${summary.assertion_failures}, network_errors: ${summary.network_errors})`);

  if (agent_directive) {
    out.push("");
    out.push("## Agent directive");
    out.push(agent_directive);
  }

  if (env_issue) {
    out.push("");
    out.push("## Env issue");
    out.push(env_issue);
  }

  if (auth_hint) {
    out.push("");
    out.push("## Auth hint");
    out.push(auth_hint);
  }

  if (cascade_skips && cascade_skips.length > 0) {
    out.push("");
    out.push("## Cascade skips");
    for (const group of cascade_skips) {
      out.push(`- **${group.capture_var}** — ${group.count} test${group.count === 1 ? "" : "s"} skipped`);
      for (const example of group.examples) {
        out.push(`  - ${example}`);
      }
    }
  }

  if (grouped_failures && grouped_failures.length > 0) {
    out.push("");
    out.push("## Failure groups");
    for (const group of grouped_failures) {
      out.push("");
      out.push(`### ${group.pattern} — ${group.count} occurrence${group.count === 1 ? "" : "s"}`);
      out.push(`recommended_action: \`${group.recommended_action}\``);
      if (group.hint) out.push(`hint: ${group.hint}`);
      if (group.examples.length > 0) {
        out.push("examples:");
        for (const example of group.examples) {
          out.push(`- ${example}`);
        }
      }
    }
  }

  if (failures.length > 0) {
    out.push("");
    out.push(grouped_failures && grouped_failures.length > 0 ? "## Representative failures" : "## Failures");
    for (const f of failures) {
      out.push("");
      out.push(`### ${f.suite_name} > ${f.test_name}`);
      const meta: string[] = [`failure_type: \`${f.failure_type}\``, `recommended_action: \`${f.recommended_action}\``];
      if (f.suite_file) meta.push(`file: \`${f.suite_file}\``);
      out.push(meta.join(" · "));
      const requestLine = `${f.request_method ?? "?"} ${f.request_url ?? "?"}`;
      const statusLine = f.response_status !== null ? ` → ${f.response_status}` : "";
      out.push(`- request: ${requestLine}${statusLine}`);
      if (f.error_message) out.push(`- error: ${f.error_message}`);
      if (f.hint) out.push(`- hint: ${f.hint}`);
      if (f.schema_hint) out.push(`- schema: ${f.schema_hint}`);
      if (f.response_headers) {
        const headerStr = Object.entries(f.response_headers).map(([k, v]) => `${k}: ${v}`).join(", ");
        out.push(`- headers: ${headerStr}`);
      }
      if (f.response_body !== undefined) {
        const bodyStr = typeof f.response_body === "string"
          ? f.response_body
          : JSON.stringify(f.response_body, null, 2);
        const fenced = bodyStr.includes("\n") || bodyStr.length > 80;
        if (fenced) {
          out.push("- response_body:");
          out.push("  ```");
          for (const line of bodyStr.split("\n")) out.push(`  ${line}`);
          out.push("  ```");
        } else {
          out.push(`- response_body: \`${bodyStr}\``);
        }
      }
    }
  }

  if (failures.length === 0 && (!grouped_failures || grouped_failures.length === 0)) {
    out.push("");
    out.push("_No failures._");
  }

  return out.join("\n");
}
