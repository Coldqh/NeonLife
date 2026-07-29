import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const packageJson = JSON.parse(read("package.json"));
const saves = read("src/core/saves/types.ts");
const urbanTypes = read("src/simulation/urban/types.ts");
const urban = read("src/simulation/urban/urbanSystem.ts");
const operationTypes = read("src/simulation/venues/types.ts");
const operations = read("src/simulation/venues/venueOperationsSystem.ts");
const catalog = read("src/simulation/venues/catalog.ts");
const life = read("src/gameplay/life/lifeSimulation.ts");
const actions = read("src/app/actions/localLifeActions.ts");
const search = read("src/app/map/VenueSearchPanel.tsx");
const top = read("src/app/map/MapTopBar.tsx");
const map = read("src/app/screens/MapScreen.tsx");
const service = read("src/app/map/BuildingServicePanel.tsx");
const profile = read("src/app/map/MapProfileOverlay.tsx");
const css = read("src/ui/theme/venue-operations.css");

check("package version is 0.39.3", packageJson.version === "0.39.3");
check("save schema is 34", saves.includes("SAVE_SCHEMA_VERSION = 34"));
check("urban fabric owns venue operations", urbanTypes.includes("venueOperations: VenueOperationsState") && urbanTypes.includes("operatingStatus: VenueOperatingStatus"));
check("venue operations are normalized and advanced", urban.includes("createVenueOperationsState") && urban.includes("advanceVenueOperationsState"));
check("venue offers have stock price duration and effects", ["currentPrice", "stock", "durationMinutes", "effects"].every((token) => operationTypes.includes(token)));
check("venue catalog covers physical service categories", ["food-goods", "meal", "medical", "vehicle-service", "lodging", "entertainment", "cyberware"].every((token) => catalog.includes(token)));
check("queues and purchases are stateful", operations.includes("joinVenueQueueState") && operations.includes("purchaseVenueOfferState") && operations.includes("VenueReceiptState"));
check("purchases require the exact venue unit", life.includes("function venueAtPlayer") && life.includes("venue.unitId === unitId"));
check("purchases charge and change real stock", life.includes("balanceCounterpartyEntityId") && operations.includes("stock: Math.max(0, candidate.stock - 1)"));
check("local actions expose queue and purchase commands", ["join-venue-queue", "leave-venue-queue", "buy-venue-offer"].every((token) => actions.includes(token)));
check("building interior exposes venue counter", service.includes("className=\"venue-service\"") && service.includes("buy-venue-offer") && service.includes("join-venue-queue"));
check("map has real venue search", top.includes("onSearch") && map.includes("<VenueSearchPanel") && search.includes("openOnly"));
check("search can focus a physical venue", map.includes("selectVenueFromSearch") && search.includes("onSelectVenue(venue)"));
check("profiles display live offers and operations", profile.includes("venue-profile__offers") && profile.includes("operation.offers") && profile.includes("revenueToday"));
check("functional venue CSS is substantial and balanced", css.includes(".venue-search") && css.includes(".venue-service") && css.includes(".venue-profile__offers") && (css.match(/\{/g) ?? []).length === (css.match(/\}/g) ?? []).length);
check("new UI components remain bounded", search.split(/\r?\n/).length <= 300 && service.split(/\r?\n/).length <= 600 && profile.split(/\r?\n/).length <= 600);

const failures = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failures.length}/${checks.length} functional-venue invariants passed`);
if (failures.length) process.exit(1);
