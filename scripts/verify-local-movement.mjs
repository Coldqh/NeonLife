import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

const root = process.cwd();
let checks = 0;
function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }
function assert(condition, message) { checks += 1; if (!condition) throw new Error(message); }

const required = [
  "src/simulation/localMovement/types.ts",
  "src/simulation/localMovement/localMovementSystem.ts",
  "src/app/screens/LocalMovementScreen.tsx",
  "tests/localMovementTest.ts"
];
for (const file of required) assert(fs.existsSync(path.join(root, file)), `missing ${file}`);

const stateTypes = read("src/world/state/types.ts");
const system = read("src/simulation/localMovement/localMovementSystem.ts");
const life = read("src/gameplay/life/lifeSimulation.ts");
const app = read("src/app/App.tsx");
const map = read("src/app/screens/MapScreen.tsx");
const localMap = read("src/app/map/LocalSectorMap.tsx");
const routeCard = read("src/app/map/RouteCard.tsx");
const nearby = read("src/app/screens/NearbyScreen.tsx");
const css = ["src/ui/theme/map.css", "src/ui/theme/city-map.css", "src/ui/theme/city-map-render.css", "src/ui/theme/city-profiles.css"].map(read).join("\n");
const movementCss = read("src/ui/theme/local-movement.css");
const pkg = JSON.parse(read("package.json"));

assert(pkg.version === "0.39.3", "package version is not 0.39.3");
assert(pkg.scripts["test:movement"], "movement verification script is not registered");
assert(stateTypes.includes("localMovement?: LocalMovementState"), "saved session has no optional local movement state");
assert(system.includes("function findPath"), "street graph pathfinder is missing");
assert(system.includes("MAX_LOCAL_SECTOR_SPAN"), "local route span guard is missing");
assert(system.includes("refreshLocalMovementRoute"), "route replan support is missing");
assert(system.includes("localMovementTargetForActor"), "person targets are not supported");
assert(system.includes("localMovementTargetForVehicle"), "vehicle targets are not supported");
assert(life.includes("export function startLocalMovement"), "movement start command is missing");
assert(life.includes("export function advanceLocalMovement"), "movement advance command is missing");
assert(life.includes("export function skipLocalMovement"), "movement skip command is missing");
assert(life.includes("export function cancelLocalMovement"), "movement cancel command is missing");
assert(life.includes("const streetRoute = stopTarget ? planLocalMovement"), "transit walking does not use the street planner");
assert(life.includes("transitCommand: transitWalkMinutes > 0"), "street walking does not advance the linked transit phase");
assert(app.includes("<LocalMovementScreen"), "movement overlay is not connected");
assert(app.includes("onWalk={walkTo}"), "map is not connected to movement start");
assert(app.includes("session.transit.player.journey && !localMovementOverlay"), "transit overlay still hides the street walk to the stop");
assert(map.includes("planLocalMovement"), "map route preview is missing");
assert(map.includes("buildRoute") && map.includes("startRoute") && map.includes("routeReady") && map.includes("onWalk(target)"), "map has no start route action");
assert(localMap.includes("local-map__route"), "local map does not render route geometry");
assert(!read("src/app/screens/LocalMovementScreen.tsx").includes("onSelect={() => undefined}"), "walking scene contains inert map controls");
assert(nearby.includes("onWalkTo"), "Nearby is not connected to unified route actions");
assert(!nearby.includes("onApproachBuilding"), "old instant building approach remains");
assert(!nearby.includes("onApproachVehicle"), "old instant vehicle approach remains");
assert(movementCss.includes(".local-movement-overlay"), "movement scene styles are missing");
assert((css.match(/{/g) ?? []).length === (css.match(/}/g) ?? []).length, "map CSS braces are unbalanced");
assert((movementCss.match(/{/g) ?? []).length === (movementCss.match(/}/g) ?? []).length, "movement CSS braces are unbalanced");

const syntaxFiles = [
  "src/simulation/localMovement/types.ts",
  "src/simulation/localMovement/localMovementSystem.ts",
  "src/world/state/types.ts",
  "src/gameplay/life/lifeSimulation.ts",
  "src/app/App.tsx",
  "src/app/screens/MapScreen.tsx",
  "src/app/map/LocalSectorMap.tsx",
  "src/app/map/RouteCard.tsx",
  "src/app/screens/NearbyScreen.tsx",
  "src/app/screens/LocalMovementScreen.tsx",
  "tests/localMovementTest.ts"
];
for (const file of syntaxFiles) {
  const result = ts.transpileModule(read(file), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
  });
  const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert(!errors.length, `${file} has syntax errors: ${errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")).join("; ")}`);
}

// Execute the pathfinder against two connected synthetic sectors. This catches
// regressions in gate merging, route distance and incremental movement without
// requiring a browser or a generated save.
const systemSource = ts.transpileModule(system, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;
const topologies = {
  A: {
    sectorId: "A", intersections: [
      { id: "a1", sectorId: "A", kind: "junction", xM: 100, yM: 500 },
      { id: "ag", sectorId: "A", kind: "sector-gate", xM: 1000, yM: 500 }
    ],
    segments: [{ id: "as", sectorId: "A", name: "Main", fromIntersectionId: "a1", toIntersectionId: "ag" }],
    blocks: [], parcels: [], buildingEntrances: [], parkingZones: []
  },
  B: {
    sectorId: "B", intersections: [
      { id: "bg", sectorId: "B", kind: "sector-gate", xM: 1000, yM: 500 },
      { id: "b1", sectorId: "B", kind: "junction", xM: 1900, yM: 500 }
    ],
    segments: [{ id: "bs", sectorId: "B", name: "Main", fromIntersectionId: "bg", toIntersectionId: "b1" }],
    blocks: [], parcels: [], buildingEntrances: [], parkingZones: []
  }
};
const movementModule = { exports: {} };
function mockRequire(id) {
  if (id.includes("entityId")) return { createStableEntityId: (kind, value) => `${kind}:${value}` };
  if (id.includes("streetTopologySystem")) return { getSectorStreetTopology: (_state, _input, sectorId) => topologies[sectorId] };
  if (id.endsWith("./types")) return {};
  throw new Error(`unexpected movement verifier import: ${id}`);
}
vm.runInNewContext(`(function(require,module,exports){${systemSource}
})(mockRequire,movementModule,movementModule.exports)`, {
  mockRequire, movementModule, console, Math, Number, Map, Set
});
const movement = movementModule.exports;
const mockSession = {
  timestamp: 0,
  world: { meta: { seed: "verify" }, locations: [] },
  localScene: { playerPosition: { state: "outside", sectorId: "A", xM: 100, yM: 500 }, actors: [] },
  transit: { player: { journey: null }, stops: [] },
  metropolitan: {
    config: { sectorsWide: 2, sectorsHigh: 1 },
    sectors: [
      { id: "A", xIndex: 0, yIndex: 0, bounds: { xM: 0, yM: 0, widthM: 1000, heightM: 1000 } },
      { id: "B", xIndex: 1, yIndex: 0, bounds: { xM: 1000, yM: 0, widthM: 1000, heightM: 1000 } }
    ],
    locations: []
  },
  streets: { topologyVersion: 2, deltas: [] },
  urban: { buildings: [] },
  vehicles: { vehicles: [] }
};
const mockTarget = { kind: "point", id: "target", label: "Target", sectorId: "B", xM: 1900, yM: 500 };
const mockRoute = movement.planLocalMovement(mockSession, mockTarget);
assert(mockRoute?.points.length === 3, "two-sector route did not merge matching gates");
assert(Math.round(mockRoute.totalDistanceM) === 1800, "two-sector route distance is incorrect");
const mockStep = movement.advanceLocalMovementRoute(mockSession, mockRoute, 10);
assert(Math.round(mockStep.route.travelledM) === 780, "incremental walking speed is incorrect");
const mockArrival = movement.advanceLocalMovementRoute({
  ...mockSession,
  timestamp: 600000,
  localScene: { playerPosition: { state: "outside", sectorId: mockStep.position.sectorId, xM: mockStep.position.xM, yM: mockStep.position.yM }, actors: [] }
}, mockStep.route, 20);
assert(mockArrival.route.status === "arrived" && Math.abs(mockArrival.position.xM - 1900) < .1, "route did not reach its target");

console.log(`Local movement verification: ${checks}/${checks}`);
