import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const packageJson = JSON.parse(read("package.json"));
const saves = read("src/core/saves/types.ts");
const migrations = read("src/core/saves/migrations.ts");
const spatialTypes = read("src/simulation/spatial/types.ts");
const metro = read("src/simulation/spatial/metropolitanSystem.ts");
const urbanTypes = read("src/simulation/urban/types.ts");
const urban = read("src/simulation/urban/urbanSystem.ts");
const localMap = read("src/app/map/LocalSectorMap.tsx");
const mapScreen = read("src/app/screens/MapScreen.tsx");
const mapSheet = read("src/app/map/MapSelectionSheet.tsx");
const mapProfile = read("src/app/map/MapProfileOverlay.tsx");
const mapUi = read("src/app/map/mapUi.ts");
const renderCss = read("src/ui/theme/city-map-render.css");
const profileCss = read("src/ui/theme/city-profiles.css");

check("package version is 0.39.3", packageJson.version === "0.39.3");
check("save schema is 34", saves.includes("SAVE_SCHEMA_VERSION = 34"));
check("old saves rebuild the physical player position", migrations.includes("schemaVersion < 33 ? undefined : payload.localScene"));
check("metropolitan placement version is 3", spatialTypes.includes("version: 3") && metro.includes("version: 3"));
check("urban fabric version is 3", urbanTypes.includes("version: 3") && urban.includes("version: 3"));
check("urban state owns real venues", urbanTypes.includes("export interface VenueState") && urbanTypes.includes("venues: VenueState[]") && urbanTypes.includes("venueId?: EntityId"));
check("buildings use deterministic street lots", urban.includes("function lotsForSector") && urban.includes("fitBuildingToLot") && !urban.includes("blockIndex = index %"));
check("named locations use compact street lots", metro.includes("function placementLots") && metro.includes("fitLocationToLot") && metro.includes("locationDimensions"));
check("generated venues are deterministic and bounded", urban.includes("function materializeVenues") && urban.includes("createStableEntityId(\"venue\"") && urban.includes(".slice(0, 900)"));
check("venues create real building units", urban.includes("function venueUnit") && urban.includes("venueId: venue.id") && urban.includes("mergeVenueUnits"));
check("housing anchors are not fake hotel venues", urban.includes('anchorLocation.type !== "housing"'));
check("local map uses one robust hit test", localMap.includes("function hitTest") && localMap.includes("function hitRadiusM") && localMap.includes("onSelect(hitTest(point))"));
check("venue hit testing only targets rendered markers", localMap.includes("const venueHit = renderedVenues.map"));
check("hit priority prefers venues before buildings and streets", localMap.indexOf("const venueHit") < localMap.indexOf("const buildingHits") && localMap.indexOf("const buildingHits") < localMap.indexOf("const streetHits"));
check("map receives real venue layer", mapScreen.includes("venues={session.urban.venues.filter") && mapScreen.includes("venueMatchesLayer"));
check("selection sheet has a generated venue branch", mapSheet.includes('selection.kind === "venue"') && mapSheet.includes("venueIsOpen") && mapSheet.includes("onEnterBuilding"));
check("full venue profile can enter its building and unit", mapProfile.includes("venue?: VenueState") && mapProfile.includes("onEnterUnit(venue.unitId)") && mapProfile.includes("map-profile--generated-venue"));
check("venue categories participate in map filters", mapUi.includes("venueMatchesLayer") && mapUi.includes("venueCategoryLabel"));
check("venue markers and profiles have dedicated styles", renderCss.includes(".local-map__venue") && profileCss.includes(".map-profile--generated-venue") || profileCss.includes(".generated-venue__address"));
check("map components remain bounded", localMap.split(/\r?\n/).length <= 600 && mapScreen.split(/\r?\n/).length <= 600 && mapProfile.split(/\r?\n/).length <= 600);
check("new styles remain balanced", (renderCss.match(/\{/g) ?? []).length === (renderCss.match(/\}/g) ?? []).length && (profileCss.match(/\{/g) ?? []).length === (profileCss.match(/\}/g) ?? []).length);

const failures = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failures.length}/${checks.length} city-fabric and venue invariants passed`);
if (failures.length) process.exit(1);
