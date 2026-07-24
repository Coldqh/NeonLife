import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const checks = [];
const check = (name, value) => checks.push({ name, ok: Boolean(value) });
const lineCount = (path) => read(path).split(/\r?\n/).length;

const deletedPaths = [
  "src/app/mobile/MobileExperience.tsx",
  "src/app/layout/NeonShell.tsx",
  "src/app/workspaces/PopulationWorkspace.tsx",
  "src/app/workspaces/PressureWorkspace.tsx",
  "src/ui/components/Meter.tsx",
  "src/ui/components/Portrait.tsx",
  "src/ui/components/SystemPanel.tsx",
  "src/ui/components/WindowFrame.tsx",
  "src/ui/theme/components.css",
  "src/ui/theme/mobile-experience.css",
  "src/ui/theme/responsive.css"
];
for (const path of deletedPaths) check(`Deleted legacy file: ${path}`, !existsSync(new URL(path, root)));

const app = read("src/app/App.tsx");
const header = read("src/app/shell/GameHeader.tsx");
const nav = read("src/app/shell/PrimaryNavigation.tsx");
const map = read("src/app/screens/MapScreen.tsx");
const localMap = read("src/app/map/LocalSectorMap.tsx");
const globalMap = read("src/app/map/GlobalCityMap.tsx");
const transit = read("src/app/screens/TransitJourneyScreen.tsx");
const main = read("src/main.tsx");
check("App is below 220 lines", lineCount("src/app/App.tsx") <= 220);
check("No Home screen remains", !/HomeView|"home"\s*\|\s*"profile"|label:\s*"Главная"/.test(app + nav));
check("No Move screen remains", !/MoveView|label:\s*"Путь"|"move"/.test(app + nav));
check("Exactly three primary screens", ["profile", "map", "nearby"].every((id) => nav.includes(`id: "${id}"`)) && (nav.match(/id:\s*"/g) ?? []).length === 3);
check("Map is the initial screen", app.includes('useState<GameScreen>("map")'));
check("Balance is in unified header", header.includes("session.player.balance") && header.includes("temperatureC") && header.includes("formatGameDate"));
check("Single shell is mounted", app.includes("<GameShell") && !app.includes("NeonShell") && !app.includes("MobileExperience"));
check("Transit scene blocks the shell", app.includes("session.transit.player.journey") && app.includes("<TransitJourneyScreen"));
check("Transit supports stops and cabin actions", transit.includes("currentStopId") && transit.includes("onAdvance") && transit.includes("onTakeSeat") && transit.includes("onInteract") && transit.includes("onPhone"));
check("Global map supports drag", globalMap.includes("onPointerDown") && globalMap.includes("panX") && globalMap.includes("onWheel"));
check("Local map uses real road graph", localMap.includes("metropolitan.roadLinks") && localMap.includes("urban.buildings"));
check("Local map has no decorative fallback blocks", !localMap.includes("fallback") && !localMap.includes("STREET_NAMES"));
check("Route planning lives on map", map.includes("route-panel") && map.includes("getTravelOptions") && map.includes("Начать маршрут"));
check("Legacy styles are not imported", !/components\.css|responsive\.css|mobile-experience\.css/.test(main));
check("Split styles are imported", ["app-shell.css", "screens.css", "map.css", "nearby.css", "transit.css", "overlays.css"].every((file) => main.includes(file)));

const sourceFiles = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (/\.(tsx|ts|css)$/.test(entry.name)) sourceFiles.push(path);
  }
}
collect(new URL("src/app/", root).pathname);
collect(new URL("src/ui/theme/", root).pathname);
const oversized = sourceFiles.filter((path) => readFileSync(path, "utf8").split(/\r?\n/).length > 600);
check("No UI source file exceeds 600 lines", oversized.length === 0);

function openingTags(source, tagName) {
  const result = [];
  const needle = `<${tagName}`;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) !== -1) {
    let index = cursor + needle.length;
    let braces = 0;
    let quote = "";
    let escaped = false;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) { escaped = false; continue; }
      if (quote) {
        if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'" || char === "`") { quote = char; continue; }
      if (char === "{") braces += 1;
      else if (char === "}") braces = Math.max(0, braces - 1);
      else if (char === ">" && braces === 0) {
        result.push(source.slice(cursor, index + 1));
        cursor = index + 1;
        break;
      }
    }
    if (index >= source.length) break;
  }
  return result;
}

const buttonTags = sourceFiles
  .filter((path) => path.endsWith(".tsx"))
  .flatMap((path) => openingTags(readFileSync(path, "utf8"), "button"));
const deadButtons = buttonTags.filter((tag) => !tag.includes("onClick=") && !tag.includes('type="submit"'));
check("Every rendered button has an action", deadButtons.length === 0);

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (oversized.length) console.log("Oversized:", oversized);
if (deadButtons.length) console.log("Dead buttons:", deadButtons);
if (failed.length) process.exit(1);
