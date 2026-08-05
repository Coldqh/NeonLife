import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const output = path.join(root, ".savetest-dist");
fs.rmSync(output, { recursive: true, force: true });
const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
const compile = spawnSync(process.execPath, [compiler, "-p", "tsconfig.savetest.json", "--pretty", "false"], { cwd: root, stdio: "inherit" });
if (compile.status !== 0) process.exit(compile.status ?? 1);
fs.writeFileSync(path.join(output, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2));
const run = spawnSync(process.execPath, [path.join(output, "tests", "saveCodecTest.js")], { cwd: root, stdio: "inherit" });
fs.rmSync(output, { recursive: true, force: true });
process.exit(run.status ?? 1);
