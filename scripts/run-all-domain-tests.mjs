import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
const allConfigs = fs.readdirSync(root)
  .filter((name) => /^tsconfig\..*test\.json$/i.test(name))
  .sort();
const startIndex = Math.max(0, Number.parseInt(process.env.DOMAIN_TEST_START ?? "1", 10) - 1);
const endIndex = Math.min(allConfigs.length, Number.parseInt(process.env.DOMAIN_TEST_END ?? String(allConfigs.length), 10));
const configs = allConfigs.slice(startIndex, endIndex);

if (!fs.existsSync(compiler)) {
  console.error("TypeScript compiler is missing. Run npm install first.");
  process.exit(1);
}

let passed = 0;
const startedAt = Date.now();
for (const configName of configs) {
  const configPath = path.join(root, configName);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const output = path.join(root, config.compilerOptions?.outDir ?? `.domain-test-${passed}`);
  const testSource = (config.include ?? []).find((entry) => typeof entry === "string" && /^tests\/.+\.ts$/.test(entry) && !entry.endsWith("globals.d.ts"));
  if (!testSource) {
    console.error(`No test entry found in ${configName}`);
    process.exit(1);
  }
  const testName = path.basename(testSource, ".ts");
  const testOutput = path.join(output, "tests", `${testName}.js`);

  console.log(`\n[domain ${startIndex + passed + 1}/${allConfigs.length}] ${testName}`);
  fs.rmSync(output, { recursive: true, force: true });
  const compile = spawnSync(process.execPath, [compiler, "-p", configName, "--pretty", "false"], {
    cwd: root,
    stdio: "inherit"
  });
  if (compile.status !== 0) process.exit(compile.status ?? 1);

  fs.writeFileSync(path.join(output, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2));
  const run = spawnSync(process.execPath, [testOutput], {
    cwd: root,
    stdio: "inherit",
    timeout: 120_000
  });
  if (run.error) {
    console.error(`${testName} failed to start or exceeded 120 seconds: ${run.error.message}`);
    process.exit(1);
  }
  if (run.signal || run.status !== 0) {
    console.error(`${testName} failed${run.signal ? ` with ${run.signal}` : ` with exit code ${run.status}`}.`);
    process.exit(run.status ?? 1);
  }
  fs.rmSync(output, { recursive: true, force: true });
  passed += 1;
}

console.log(`\nAll ${passed} domain tests passed in ${Math.round((Date.now() - startedAt) / 1000)}s.`);
