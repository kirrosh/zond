import { mock } from "bun:test";

export interface CapturedOutput {
  restore: () => void;
  outChunks: string[];
  errChunks: string[];
  readonly out: string;
  readonly err: string;
}

export function captureOutput(opts: { console?: boolean } = {}): CapturedOutput {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const origLog = console.log;
  const origConsoleErr = console.error;

  const outChunks: string[] = [];
  const errChunks: string[] = [];

  process.stdout.write = mock((chunk: unknown) => {
    outChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = mock((chunk: unknown) => {
    errChunks.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stderr.write;

  if (opts.console) {
    console.log = mock((...args: unknown[]) => {
      outChunks.push(args.map(String).join(" ") + "\n");
    }) as typeof console.log;
    console.error = mock((...args: unknown[]) => {
      errChunks.push(args.map(String).join(" ") + "\n");
    }) as typeof console.error;
  }

  return {
    restore: () => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      if (opts.console) {
        console.log = origLog;
        console.error = origConsoleErr;
      }
    },
    outChunks,
    errChunks,
    get out() { return outChunks.join(""); },
    get err() { return errChunks.join(""); },
  };
}
