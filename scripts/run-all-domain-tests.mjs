import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
const allConfigs = fs.readdirSync(root)
  .filter((name) => /^tsconfig\..*test\.json$/i.test(name))
  .sort();
const startIndex = Math.max(0, Number.parseInt(process.env.DOMAIN_TEST_START ?? "1", 10) - 1);
const endIndex = Math.min(allConfigs.length, Number.parseInt(process.env.DOMAIN_TEST_END ?? String(allConfigs.length), 10));
const configs = allConfigs.slice(startIndex, endIndex);
const perTestTimeoutMs = Math.max(30_000, Number.parseInt(process.env.DOMAIN_TEST_TIMEOUT_MS ?? "300000", 10));

if (!fs.existsSync(compiler)) {
  console.error("TypeScript compiler is missing. Run npm install first.");
  process.exit(1);
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs) : null;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) reject(new Error(`exceeded ${Math.round(timeoutMs / 1000)} seconds`));
      else if (signal) reject(new Error(`terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`exited with code ${code ?? "unknown"}`));
      else resolve();
    });
  });
}

let passed = 0;
const startedAt = Date.now();
for (const configName of configs) {
  const configPath = path.join(root, configName);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const output = path.join(root, config.compilerOptions?.outDir ?? `.domain-test-${passed}`);
  const testSource = (config.include ?? []).find((entry) => typeof entry === "string" && /^tests\/.+\.ts$/.test(entry) && !entry.endsWith("globals.d.ts"));
  if (!testSource) throw new Error(`No test entry found in ${configName}`);
  const testName = path.basename(testSource, ".ts");
  const testOutput = path.join(output, "tests", `${testName}.js`);

  console.log(`\n[domain ${startIndex + passed + 1}/${allConfigs.length}] ${testName}`);
  fs.rmSync(output, { recursive: true, force: true });
  try {
    await runProcess(process.execPath, [compiler, "-p", configName, "--pretty", "false"], 0);
    fs.writeFileSync(path.join(output, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2));
    await runProcess(process.execPath, [testOutput], perTestTimeoutMs);
  } catch (error) {
    console.error(`${testName} failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
  passed += 1;
}

console.log(`\nAll ${passed} domain tests passed in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
