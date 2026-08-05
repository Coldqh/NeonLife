import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const system = read("src/gameplay/playerLoop/playerLoopSystem.ts");
const types = read("src/gameplay/playerLoop/types.ts");
const life = read("src/gameplay/life/lifeSimulation.ts");
const screen = read("src/app/screens/WorkScreen.tsx");
const actions = read("src/app/actions/localLifeActions.ts");
const state = read("src/world/state/types.ts");
const css = read("src/ui/theme/work.css");

check("one canonical player loop exists", types.includes("PlayerLoopState") && state.includes("playerLoop: PlayerLoopState"));
check("work is one-click", system.includes('action.kind === "work-shift"') && system.includes("durationMinutes") && screen.includes("Отработать смену"));
check("training improves one explicit skill", system.includes('action.kind === "train"') && system.includes("addSkill(state, training.skill"));
check("equipment has four simple slots", types.includes('"outfit" | "armor" | "weapon" | "implant"') && screen.includes("СНАРЯЖЕНИЕ"));
check("street fights auto-resolve", system.includes('action.kind === "street-fight"') && screen.includes("УЛИЧНЫЕ ДРАКИ"));
check("boxing career auto-resolves", system.includes('action.kind === "boxing-fight"') && screen.includes("Провести следующий бой"));
check("all player-loop actions use one command", life.includes("performPlayerLoopAction") && actions.includes("isPlayerLoopAction"));
check("old work engine is physically deleted", !exists("src/gameplay/jobs/work/workSystem.ts") && !exists("src/gameplay/jobs/work/types.ts"));
check("old courier engine is physically deleted", !exists("src/gameplay/jobs/courier/courierSystem.ts"));
check("old venue work panel is physically deleted", !exists("src/app/map/VenueWorkPanel.tsx"));
check("runtime contains no legacy jobs state", !state.includes("jobs:") && !life.includes("session.jobs"));
check("screen styles are balanced", css.includes(".work-screen") && (css.match(/\{/g) ?? []).length === (css.match(/\}/g) ?? []).length);

const failed = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} simple player-loop checks passed.`);
if (failed.length) process.exit(1);
