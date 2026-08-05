import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const checks = [];
const check = (label, condition) => checks.push({ label, condition: Boolean(condition) });

const work = read("src/app/screens/WorkScreen.tsx");
const profile = read("src/app/screens/ProfileScreen.tsx");
const building = read("src/app/map/BuildingServicePanel.tsx");
const nearby = read("src/app/screens/NearbyScreen.tsx");
const types = read("src/gameplay/playerLoop/types.ts");
const system = read("src/gameplay/playerLoop/playerLoopSystem.ts");
const urbanTypes = read("src/simulation/urban/types.ts");
const urbanSystem = read("src/simulation/urban/urbanSystem.ts");
const life = read("src/gameplay/life/lifeSimulation.ts");
const css = read("src/ui/theme/work.css") + read("src/ui/theme/player-identity.css") + read("src/ui/theme/venue-operations.css");

check("work screen is contract-only", work.includes("Физическая работа") && work.includes("Показать работу на карте") && !work.includes("PLAYER_JOBS") && !work.includes('kind: "work-shift"') && !work.includes('kind: "select-job"') && !work.includes("TRAINING_ACTIONS") && !work.includes("EQUIPMENT_CATALOG"));
check("physical venues own vacancies", building.includes("jobsForVenueCategory") && building.includes('kind: "select-job"') && building.includes("employerName: venue.name"));
check("shift exists only at employer venue", building.includes('kind: "work-shift"') && building.includes("isWorkplace") && life.includes("employment.venueId !== action.venueId"));
check("employment has one compound source of truth", types.includes("interface PlayerEmploymentState") && types.includes("employment: PlayerEmploymentState | null") && !types.includes("activeJobId:"));
check("manager is a persistent npc", building.includes("managerPersonId: manager?.id") && life.includes("recordPlayerAction") && system.includes("managerPersonId"));
check("characteristics live in profile", profile.includes("ХАРАКТЕРИСТИКИ") && profile.includes("profile-skill-grid") && profile.includes("skillLabel(skill)"));
check("equipment lives in profile", profile.includes("СНАРЯЖЕНИЕ") && profile.includes("profile-owned-equipment") && profile.includes('kind: "equip-item"'));
check("biography lives in profile", profile.includes("БИОГРАФИЯ") && profile.includes("playerLoop.biography") && system.includes("PlayerBiographyEntry"));
check("equipment purchases use physical venue offers", building.includes('kind: "buy-venue-offer"') && life.includes("registerEquipmentPurchase") && !types.includes('kind: "buy-equipment"'));
check("training requires a physical venue", building.includes('kind: "train"') && building.includes("venueId: venue.id") && life.includes("training.venueCategories.includes"));
check("boxing requires a boxing gym", building.includes('venue?.category === "boxing-gym"') && life.includes('venue?.category !== "boxing-gym"'));
check("street fights originate from nearby actors", nearby.includes('kind: "assault-actor"') && nearby.includes("Подраться") && life.includes("resolveStreetFightAgainstActor"));
check("world generates sport and weapons venues", ["gym", "boxing-gym", "shooting-range", "weapon-shop"].every((value) => urbanTypes.includes(`"${value}"`) && urbanSystem.includes(`"${value}"`)));
check("old work engine is physically deleted", !fs.existsSync("src/gameplay/jobs/work/workSystem.ts"));
check("old courier engine is physically deleted", !fs.existsSync("src/gameplay/jobs/courier/courierSystem.ts"));
check("old venue work panel is physically deleted", !fs.existsSync("src/app/map/VenueWorkPanel.tsx"));
check("player-system styles are balanced", (css.match(/{/g) ?? []).length === (css.match(/}/g) ?? []).length);

for (const item of checks) console.log(`${item.condition ? "PASS" : "FAIL"} ${item.label}`);
const passed = checks.filter((item) => item.condition).length;
console.log(`\n${passed}/${checks.length} one-city daily-life checks passed.`);
if (passed !== checks.length) process.exit(1);
