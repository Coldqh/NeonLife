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
const localActions = read("src/app/screens/LocalActionsPanel.tsx");
const lifeActions = read("src/app/actions/localLifeActions.ts");
const nearbyCss = read("src/ui/theme/nearby.css");
const map = read("src/app/screens/MapScreen.tsx");
const mapTopBar = read("src/app/map/MapTopBar.tsx");
const mapSheet = read("src/app/map/MapSelectionSheet.tsx");
const mapProfile = read("src/app/map/MapProfileOverlay.tsx");
const globalMap = read("src/app/map/GlobalCityMap.tsx");
const localMap = read("src/app/map/LocalSectorMap.tsx");
const interiorMap = read("src/app/map/BuildingInteriorMap.tsx");
const servicePanel = read("src/app/map/BuildingServicePanel.tsx");
const transit = read("src/app/screens/TransitJourneyScreen.tsx");
const transitSystem = read("src/simulation/transit/transitOperationsSystem.ts");
const life = read("src/gameplay/life/lifeSimulation.ts");
const save = read("src/app/providers/useWorldSave.ts");
const reconcile = read("src/gameplay/transit/reconcileTransitJourney.ts");

check("old desktop shell removed", !exists("src/app/layout/NeonShell.tsx"));
check("old mobile shell removed", !exists("src/app/mobile/MobileExperience.tsx"));
check("app starts on map", app.includes('useState<GameScreen>("map")'));
check("four primary screens", ["profile", "map", "nearby", "work"].every((name) => nav.includes(`id: "${name}"`)) && !nav.includes('id: "life"'));
check("map hides generic header", shell.includes('screen === "map" ? null : <GameHeader'));
check("map owns its fullscreen HUD", map.includes("<MapTopBar") && mapTopBar.includes("GLOBAL_LAYERS") && mapTopBar.includes("LOCAL_LAYERS"));
check("map nav is not a special raised button", !shellCss.includes("primary-nav__map"));
check("navigation uses equal columns", shellCss.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"));
check("screen scroll resets", shell.includes("scrollTo({ top: 0"));
check("screen swipe exists", shell.includes("SCREEN_ORDER") && shell.includes("pointerUp"));
check("safe area is respected", shellCss.includes("env(safe-area-inset-top)") && shellCss.includes("env(safe-area-inset-bottom)"));
check("profile uses real identity screen", profile.includes("profile-hero") && profile.includes("currentActivity(session)"));
check("profile does not print raw coordinates", !profile.includes("xM") && !profile.includes("yM"));
check("nearby category swipe exists", nearby.includes("TAB_ORDER") && nearby.includes("pointerUp"));
check("physical actions tab exists", nearby.includes('id: "actions"') && nearby.includes("LocalActionsPanel"));
check("physical actions are dispatched outside the view", app.includes("applyLocalLifeAction") && lifeActions.includes("LocalLifeAction"));
check("home actions require physical presence", localActions.includes("isPlayerInsideHome") && localActions.includes("Войти в своё жильё"));
check("food has carried and home storage presentation", localActions.includes("Переносимый груз") && localActions.includes("Пищевой шкаф"));
check("legacy courier controls are absent", !localActions.includes("Забрать груз") && !localActions.includes("Передать груз"));
check("clinic actions are physical", localActions.includes("Стабилизация") && localActions.includes("clinic-care"));
check("nearby inspector is not a fixed overlay", !nearbyCss.includes("position: fixed"));
check("map has city street and building modes", map.includes("insideBuilding ? \"interior\" : \"local\"") && map.includes("<GlobalCityMap") && map.includes("<LocalSectorMap") && map.includes("<BuildingInteriorMap") && mapTopBar.includes("onMode(\"interior\")"));
check("global map supports pan pinch wheel and inertia", globalMap.includes("pointers.current.size >= 2") && globalMap.includes("PinchState") && globalMap.includes("runInertia") && globalMap.includes("onWheel"));
check("local map supports pan pinch wheel and point selection", localMap.includes("pointers.current.size >= 2") && localMap.includes("PinchState") && localMap.includes("onWheel") && localMap.includes('kind: "point"'));
check("global transit layer uses real routes", globalMap.includes("session.transit.routes") && globalMap.includes("route.stopIds"));
check("local map shows real stops", localMap.includes("session.transit.stops") && localMap.includes("local-map__stop"));
check("selection sheet has real route and entry actions", mapSheet.includes("onBuildRoute") && mapSheet.includes("onStartRoute") && mapSheet.includes("onEnterBuilding") && mapSheet.includes("onEnterVehicle"));
check("profiles expose floors and physical actions", mapProfile.includes("FloorGrid") && mapProfile.includes("onMoveFloor") && mapProfile.includes("onEnterBuilding") && mapProfile.includes("onLeaveBuilding"));
check("interior map exposes floors units rooms and exits", interiorMap.includes("FloorRail") && interiorMap.includes("floor-unit-grid") && interiorMap.includes("unit-plan") && interiorMap.includes("onEnterUnit") && interiorMap.includes("onEnterRoom") && interiorMap.includes("onLeaveBuilding"));
check("building services dispatch physical venue actions only", servicePanel.includes("buy-venue-offer") && servicePanel.includes("join-venue-queue") && !servicePanel.includes("accept-courier") && !servicePanel.includes("VenueWorkPanel"));
check("transit has walking scene", transit.includes('journey.phase === "walking"') && transit.includes("Дойти до остановки"));
check("transit has explicit waiting scene", transit.includes("waitingMinutesRemaining") && transit.includes("Дождаться рейса"));
check("transit lists every stop", transit.includes("segment.stopIds.map"));
check("transit can cancel before boarding", transit.includes("onCancel") && transitSystem.includes('command.kind === "cancel"'));
check("boot reconciles stale transit", save.includes("reconcileLoadedTransitJourney") && reconcile.includes('journey.phase === "walking" || journey.phase === "waiting"'));
check("journey start does not auto-skip access time", life.includes("progressLife(session, 0") && life.includes('kind: "begin"'));
check("transit domain has walk and wait commands", transitSystem.includes('command.kind === "walk"') && transitSystem.includes('command.kind === "wait"'));
check("false approach success notices removed", !nearby.includes("Ты подошёл к") && !nearby.includes("Посадка:"));
check("building exit is wired", app.includes("leaveLocalBuilding") && nearby.includes("onLeaveBuilding") && nearby.includes("Выйти на улицу"));
check("vehicle exit is wired", app.includes("leavePhysicalVehicle") && nearby.includes("onLeaveVehicle") && nearby.includes("Выйти из машины"));
check("map uses time-aware opening hours", mapProfile.includes("isLocationOpen(location, session.timestamp)") && mapSheet.includes("isLocationOpen(selection.location, session.timestamp)"));

for (const file of ["src/ui/theme/app-shell.css", "src/ui/theme/screens.css", "src/ui/theme/map.css", "src/ui/theme/city-map.css", "src/ui/theme/city-map-render.css", "src/ui/theme/city-profiles.css", "src/ui/theme/building-interiors.css", "src/ui/theme/work.css", "src/ui/theme/nearby.css", "src/ui/theme/transit.css"]) {
  const text = read(file);
  check(`${file} braces balanced`, (text.match(/\{/g) ?? []).length === (text.match(/\}/g) ?? []).length);
}

for (const file of ["src/app/App.tsx", "src/app/screens/ProfileScreen.tsx", "src/app/screens/NearbyScreen.tsx", "src/app/screens/TransitJourneyScreen.tsx", "src/app/screens/MapScreen.tsx", "src/app/screens/WorkScreen.tsx", "src/app/map/LocalSectorMap.tsx", "src/app/map/GlobalCityMap.tsx", "src/app/map/MapProfileOverlay.tsx", "src/app/map/MapSelectionSheet.tsx", "src/app/map/BuildingInteriorMap.tsx", "src/app/map/BuildingServicePanel.tsx"]) {
  const lines = read(file).split(/\r?\n/).length;
  check(`${file} remains bounded`, lines <= 600);
}

const failures = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failures.length}/${checks.length} recovery invariants passed`);
if (failures.length) process.exit(1);
