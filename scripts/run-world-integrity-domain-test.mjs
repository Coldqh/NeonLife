import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const output = path.join(root, ".worldintegritytest-dist");
fs.rmSync(output, { recursive: true, force: true });
const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
const compile = spawnSync(process.execPath, [compiler, "-p", "tsconfig.worldintegritytest.json", "--pretty", "false"], { cwd: root, stdio: "inherit" });
if (compile.status !== 0) process.exit(compile.status ?? 1);
fs.writeFileSync(path.join(output, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2));
const run = spawnSync(process.execPath, [path.join(output, "tests", "worldIntegrityTest.js")], {
  cwd: root,
  stdio: "inherit",
  timeout: 60_000
});
if (run.error) {
  console.error(`World integrity regression failed to start or exceeded 60 seconds: ${run.error.message}`);
  process.exit(1);
}
if (run.signal) {
  console.error(`World integrity regression terminated by ${run.signal}.`);
  process.exit(1);
}
process.exit(run.status ?? 1);
