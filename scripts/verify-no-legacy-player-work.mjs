import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const forbiddenFiles = [
  "src/app/map/VenueWorkPanel.tsx",
  "src/gameplay/jobs/courier/courierSystem.ts",
  "src/gameplay/jobs/work/types.ts",
  "src/gameplay/jobs/work/workSystem.ts",
  "scripts/run-player-work-domain-test.mjs",
  "tests/playerWorkTest.ts",
  "tsconfig.playerworktest.json",
];

const forbiddenPatterns = [
  { pattern: /session\.jobs\b/g, label: "session.jobs" },
  { pattern: /gameplay\/jobs\/work/g, label: "legacy work import" },
  { pattern: /gameplay\/jobs\/courier/g, label: "legacy courier import" },
  { pattern: /VenueWorkPanel/g, label: "VenueWorkPanel reference" },
];

const failures = [];
for (const file of forbiddenFiles) {
  if (existsSync(join(root, file))) failures.push(`forbidden legacy file exists: ${file}`);
}

function walk(directory) {
  for (const name of readdirSync(directory)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const full = join(directory, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(?:ts|tsx|js|mjs|json)$/.test(name)) continue;
    const path = relative(root, full).replaceAll("\\", "/");
    if (path === "scripts/verify-no-legacy-player-work.mjs") continue;
    const source = readFileSync(full, "utf8");
    for (const { pattern, label } of forbiddenPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(source)) failures.push(`${label}: ${path}`);
    }
  }
}

walk(join(root, "src"));

if (failures.length) {
  console.error("Legacy player-work regression detected:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log("Legacy work cleanup verified: playerLoop is the only player-facing work system.");
