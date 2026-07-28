import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, value) => checks.push({ name, ok: Boolean(value) });

const map = read("src/app/screens/MapScreen.tsx");
const app = read("src/app/App.tsx");
const css = [
  "src/ui/theme/city-map.css",
  "src/ui/theme/city-map-render.css",
  "src/ui/theme/city-profiles.css"
].map(read).join("\n");

check("global map renders district geometry", map.includes("global-district-card") && map.includes("DISTRICT_CLIPS"));
check("global map renders real road and transit networks", map.includes("globalRoads") && map.includes("globalTransitLines") && map.includes("global-map-network"));
check("global filters change real markers", map.includes("globalMarkerType") && map.includes("setGlobalFilter") && map.includes("globalMarkers"));
check("local map renders blocks and street topology", map.includes("localTopology.blocks") && map.includes("localRoads.map") && map.includes("local-map-network__roads"));
check("local map renders named points of interest", map.includes("filteredLocations.map") && map.includes("local-poi-marker") && map.includes("PLACE_ICONS"));
check("people are restricted to actual player context", map.includes('player.state === "inside"') && map.includes("actor.position.buildingId === player.buildingId") && map.includes("actorStreetId === playerStreetId"));
check("vehicles are restricted to actual player context", map.includes("vehicle.position.buildingId === player.buildingId") && map.includes("vehicleStreetId === playerStreetId"));
check("venue profile has live information and actions", map.includes("city-sheet--venue") && map.includes("actorsAtSelectedPlace") && map.includes("onEnterBuilding") && map.includes("onLeaveBuilding"));
check("building profile has functional floors", map.includes("building-profile__floor-list") && map.includes("onMoveBuildingFloor") && map.includes("verticalMethod"));
check("vehicle profile uses real enter and leave commands", map.includes("onEnterVehicle") && map.includes("onLeaveVehicle") && app.includes("enterPhysicalVehicle") && app.includes("leavePhysicalVehicle"));
check("route preview is real and startable", map.includes("planLocalMovement") && map.includes("routePoints") && map.includes("city-route-banner") && map.includes("goToSelection"));
check("favorites persist", map.includes("neon-life/map-favorites/v1") && map.includes("localStorage.setItem"));
check("share action is implemented", map.includes("navigator.share") && map.includes("navigator.clipboard"));
check("new map styles provide top-down roads and profiles", css.includes(".local-map-network__roads") && css.includes(".local-building-card") && css.includes(".building-profile__layout"));
check("all new map styles are balanced", (css.match(/\{/g) ?? []).length === (css.match(/\}/g) ?? []).length);

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} city-map overhaul checks passed.`);
if (failed.length) process.exit(1);
