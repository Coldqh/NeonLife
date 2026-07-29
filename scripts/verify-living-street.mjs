import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const types = read("src/simulation/streetScene/types.ts");
const system = read("src/simulation/streetScene/streetSceneSystem.ts");
const state = read("src/world/state/types.ts");
const world = read("src/world/generation/createWorld.ts");
const life = read("src/gameplay/life/lifeSimulation.ts");
const migrations = read("src/core/saves/migrations.ts");
const map = read("src/app/screens/MapScreen.tsx");
const localMap = read("src/app/map/LocalSectorMap.tsx");
const sheet = read("src/app/map/MapSelectionSheet.tsx");
const app = read("src/app/App.tsx");
const ui = read("src/app/map/mapUi.ts");
const css = [read("src/ui/theme/city-map-render.css"), read("src/ui/theme/city-map.css")].join("\n");
const pkg = JSON.parse(read("package.json"));

check("street scene domain files exist", exists("src/simulation/streetScene/types.ts") && exists("src/simulation/streetScene/streetSceneSystem.ts"));
check("session persists street scene", state.includes("streetScene: StreetSceneState"));
check("world creates street scene", world.includes("createStreetSceneState") && world.includes("streetScene,"));
check("time pipeline advances street scene", life.includes("advanceStreetSceneState") && life.includes("streetAdvance.state"));
check("save migration normalizes street scene", migrations.includes("normalizeStreetSceneState") && migrations.includes("streetScene,"));
check("pedestrians use real street segments", system.includes("nearestSegment") && system.includes("sidewalkLeftM") && system.includes("StreetPedestrianState"));
check("traffic uses lanes congestion and signals", system.includes("laneIndex") && system.includes("trafficLoad") && system.includes("signalStop"));
check("crossings change with game time", system.includes("buildCrossings") && system.includes('signal: intersection.kind !== "crossing"'));
check("physical incident catalog exists", ["fight", "robbery", "overdose", "arrest", "crash", "checkpoint", "vendor", "breakdown"].every((token) => system.includes(`${token}:`)));
check("incidents persist and resolve over time", system.includes("updateIncidents") && system.includes('status = "responding"') && system.includes('status = "resolved"'));
check("player incident actions are domain commands", life.includes("actOnStreetIncident") && system.includes("applyStreetIncidentAction"));
check("app wires incident actions", app.includes("onStreetIncidentAction") && app.includes("actOnStreetIncident"));
check("map renders pedestrians traffic crossings and incidents", ["pedestrians=", "traffic=", "incidents=", "crossings="].every((token) => map.includes(token)) && ["local-map__crossing", "local-map__incident", "local-map__brake-lights"].every((token) => localMap.includes(token)));
check("incident layer is selectable", ui.includes('id: "incidents"') && ui.includes('kind: "incident"'));
check("incident sheet has working actions", ["observe", "call-help", "intervene", "move-on"].every((token) => sheet.includes(`"${token}"`)) && sheet.includes("Маршрут к месту"));
check("living street CSS is present", css.includes("living street layer") && css.includes("physical incident inspector") && css.includes("street-incident-pulse"));
check("street scene tests are registered", pkg.scripts["test:street-ui"] && pkg.scripts["test:street"]);
check("version is 0.38.0", pkg.version === "0.38.0");
check("map components remain bounded", [map, localMap, sheet, ui].every((source) => source.split(/\r?\n/).length <= 600));
check("street CSS braces are balanced", (css.match(/\{/g) ?? []).length === (css.match(/\}/g) ?? []).length);

const failed = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} living-street checks passed.`);
if (failed.length) process.exit(1);
