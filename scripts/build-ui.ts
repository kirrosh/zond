// Single-shot build for src/ui/ via Bun.build() JS API.
// We use the JS API (not `bun build` CLI) so bun-plugin-tailwind — which is
// only loaded for Bun.serve via bunfig and for Bun.build() programmatically —
// can process `<link rel="stylesheet" href="tailwindcss" />` in index.html.
import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";

const OUT_DIR = "dist/ui";

await rm(OUT_DIR, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ["src/ui/client/index.html"],
  outdir: OUT_DIR,
  minify: true,
  naming: {
    entry: "[name].[ext]",
    asset: "[name].[ext]",
    chunk: "[name].[ext]",
  },
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

let totalRaw = 0;
for (const out of result.outputs) {
  const size = out.size ?? 0;
  totalRaw += size;
  console.log(`  ${out.path.replace(`${process.cwd()}/`, "")}  ${(size / 1024).toFixed(1)} KB`);
}
console.log(`  total                       ${(totalRaw / 1024).toFixed(1)} KB`);
