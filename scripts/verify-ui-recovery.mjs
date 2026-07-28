import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const app = read("src/app/App.tsx");
const shell = read("src/app/shell/GameShell.tsx");
const nav = read("src/app/shell/PrimaryNavigation.tsx");
const shellCss = read("src/ui/theme/app-shell.css");
const profile = read("src/app/screens/ProfileScreen.tsx");
const nearby = read("src/app/screens/NearbyScreen.tsx");
const nearbyCss = read("src/ui/theme/nearby.css");
const map = read("src/app/screens/MapScreen.tsx");
const globalMap = read("src/app/map/GlobalCityMap.tsx");
const localMap = read("src/app/map/LocalSectorMap.tsx");
const transit = read("src/app/screens/TransitJourneyScreen.tsx");
const transitSystem = read("src/simulation/transit/transitOperationsSystem.ts");
const life = read("src/gameplay/life/lifeSimulation.ts");
const save = read("src/app/providers/useWorldSave.ts");
const reconcile = read("src/gameplay/transit/reconcileTransitJourney.ts");

check("old desktop shell removed", !exists("src/app/layout/NeonShell.tsx"));
check("old mobile shell removed", !exists("src/app/mobile/MobileExperience.tsx"));
check("app starts on map", app.includes('useState<GameScreen>("map")'));
check("only three primary screens", ["profile", "map", "nearby"].every((name) => nav.includes(`id: "${name}"`)) && !nav.includes('id: "home"'));
check("map nav is not a special raised button", !shellCss.includes("primary-nav__map"));
check("navigation uses equal columns", shellCss.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"));
check("screen scroll resets", shell.includes("scrollTo({ top: 0"));
check("screen swipe exists", shell.includes("SCREEN_ORDER") && shell.includes("pointerUp"));
check("safe area is respected", shellCss.includes("env(safe-area-inset-top)") && shellCss.includes("env(safe-area-inset-bottom)"));
check("profile uses real identity screen", profile.includes("profile-hero") && profile.includes("currentActivity(session)"));
check("profile does not print raw coordinates", !profile.includes("xM") && !profile.includes("yM"));
check("nearby category swipe exists", nearby.includes("TAB_ORDER") && nearby.includes("pointerUp"));
check("nearby inspector is not a fixed overlay", !nearbyCss.includes("position: fixed"));
check("map has city district sector navigation", map.includes("map-breadcrumb") && map.includes("openDistrict") && map.includes("openSector"));
check("global map supports pinch", globalMap.includes("pointers.current.size >= 2") && globalMap.includes("PinchState"));
check("local map supports pinch", localMap.includes("pointers.current.size >= 2") && localMap.includes("PinchState"));
check("global transit layer uses real routes", globalMap.includes("session.transit.routes") && globalMap.includes("route.stopIds"));
check("local map shows real stops", localMap.includes("session.transit.stops") && localMap.includes("local-map__stop"));
check("transit has walking scene", transit.includes('journey.phase === "walking"') && transit.includes("Дойти до остановки"));
check("transit has explicit waiting scene", transit.includes("waitingMinutesRemaining") && transit.includes("Дождаться рейса"));
check("transit lists every stop", transit.includes("segment.stopIds.map"));
check("transit can cancel before boarding", transit.includes("onCancel") && transitSystem.includes('command.kind === "cancel"'));
check("boot reconciles stale transit", save.includes("reconcileLoadedTransitJourney") && reconcile.includes('journey.phase === "walking" || journey.phase === "waiting"'));
check("journey start does not auto-skip access time", life.includes("progressLife(session, 0") && life.includes('kind: "begin"'));
check("transit domain has walk and wait commands", transitSystem.includes('command.kind === "walk"') && transitSystem.includes('command.kind === "wait"'));
check("false approach success notices removed", !nearby.includes("Ты подошёл к") && !nearby.includes("Посадка:"));

for (const file of ["src/ui/theme/app-shell.css", "src/ui/theme/screens.css", "src/ui/theme/map.css", "src/ui/theme/nearby.css", "src/ui/theme/transit.css"]) {
  const text = read(file);
  check(`${file} braces balanced`, (text.match(/\{/g) ?? []).length === (text.match(/\}/g) ?? []).length);
}

for (const file of ["src/app/App.tsx", "src/app/screens/ProfileScreen.tsx", "src/app/screens/NearbyScreen.tsx", "src/app/screens/TransitJourneyScreen.tsx", "src/app/map/LocalSectorMap.tsx"]) {
  const lines = read(file).split(/\r?\n/).length;
  check(`${file} remains bounded`, lines <= 420);
}
check("src/app/map/GlobalCityMap.tsx remains bounded", globalMap.split(/\r?\n/).length <= 540);

const failures = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failures.length}/${checks.length} recovery invariants passed`);
if (failures.length) process.exit(1);
