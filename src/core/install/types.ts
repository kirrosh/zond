/**
 * Description of an MCP-capable client that `zond install` can target.
 *
 * Each spec resolves a concrete absolute config-file path (relative to the
 * user's home directory) and provides the JSON shape that should be merged
 * into that file under `mcpServers.zond`.
 */
export interface McpClientSpec {
  /** Stable identifier used in CLI flags (`--claude`, `--cursor`, ...). */
  id: string;
  /** Human-readable name shown in CLI output. */
  displayName: string;
  /** Returns the absolute path to this client's MCP config, given the user's home dir. */
  configPath(home: string): string;
  /** The JSON value written under `mcpServers[<key>]`. */
  serverEntry: Record<string, unknown>;
  /** Key under `mcpServers` (almost always "zond"). */
  serverKey: string;
}

export interface InstallOptions {
  /** Override $HOME (used by tests). Defaults to `os.homedir()`. */
  home?: string;
  /** If true — render the would-be diff but do not write to disk. */
  dryRun?: boolean;
}

export interface InstallResult {
  client: string;
  configPath: string;
  /** "created" — file did not exist; "updated" — file existed and was changed; "noop" — already up-to-date. */
  action: "created" | "updated" | "noop";
}
