import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const output = path.join(root, ".worldintegritytest-dist");
fs.rmSync(output, { recursive: true, force: true });
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const compile = spawnSync(command, ["tsc", "-p", "tsconfig.worldintegritytest.json", "--pretty", "false"], { cwd: root, stdio: "inherit" });
if (compile.status !== 0) process.exit(compile.status ?? 1);
fs.writeFileSync(path.join(output, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2));
const run = spawnSync(process.execPath, [path.join(output, "tests", "worldIntegrityTest.js")], { cwd: root, stdio: "inherit" });
process.exit(run.status ?? 1);
