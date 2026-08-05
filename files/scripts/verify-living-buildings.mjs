import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const app = read("src/app/App.tsx");
const map = read("src/app/screens/MapScreen.tsx");
const top = read("src/app/map/MapTopBar.tsx");
const interior = read("src/app/map/BuildingInteriorMap.tsx");
const service = read("src/app/map/BuildingServicePanel.tsx");
const localScene = read("src/simulation/localScene/localSceneSystem.ts");
const localTypes = read("src/simulation/localScene/types.ts");
const urban = read("src/simulation/urban/urbanSystem.ts");
const life = read("src/gameplay/life/lifeSimulation.ts");
const css = read("src/ui/theme/building-interiors.css");

check("map switches to physical building mode", map.includes('setMode("interior")') && map.includes("<BuildingInteriorMap") && top.includes('onMode("interior")'));
check("building mode is unavailable outside", top.includes("disabled={!insideBuilding}"));
check("floor rail and corridor are interactive", interior.includes("FloorRail") && interior.includes("floor-corridor") && interior.includes("onMoveFloor(selectedFloor"));
check("units are selectable and enterable", interior.includes("floor-unit-grid") && interior.includes("onEnterUnit(selectedUnit.unitId)"));
check("rooms are mapped and enterable", interior.includes("unit-plan") && interior.includes("onEnterRoom(selectedRoomId)") && interior.includes("onLeaveRoom"));
check("building exit remains physical", interior.includes("onLeaveBuilding") && app.includes("leaveLocalBuilding"));
check("venue service point is a real panel", interior.includes("BuildingServicePanel") && interior.includes("building-service-node"));
check("venue and home actions are wired without duplicate job controls", ["buy-venue-offer", "join-venue-queue", "sleep-home"].every((token) => service.includes(token)) && !service.includes("accept-courier"));
check("player position records interior hierarchy", localTypes.includes("InteriorPresenceZone") && life.includes('interiorZone: roomId ? "room"'));
check("NPC visibility respects walls and rooms", localScene.includes("sameInteriorView") && localScene.includes("actor.roomId === player.roomId") && localScene.includes("!actor.unitId"));
check("ambient NPCs occupy floors units and rooms", localScene.includes("actorFloor") && localScene.includes("actorUnit") && localScene.includes("actorRoomId"));
check("mixed buildings materialize commercial units", urban.includes("isCommercialUnit") && urban.includes('building.use === "mixed" ? "shop"'));
check("interior styles are substantial and balanced", css.includes(".building-floor-plan") && css.includes(".unit-plan") && css.includes(".building-service-panel") && (css.match(/\{/g) ?? []).length === (css.match(/\}/g) ?? []).length);
check("new UI files remain bounded", interior.split(/\r?\n/).length <= 600 && service.split(/\r?\n/).length <= 600);

const failed = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} living-building checks passed.`);
if (failed.length) process.exit(1);
