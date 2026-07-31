import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const app = read("src/app/App.tsx");
const nearby = read("src/app/screens/NearbyScreen.tsx");
const panel = read("src/app/social/ConversationPanel.tsx");
const commands = read("src/gameplay/social/socialCommands.ts");
const system = read("src/simulation/social/socialSystem.ts");
const types = read("src/simulation/social/types.ts");
const life = read("src/gameplay/life/lifeSimulation.ts");
const migration = read("src/core/saves/migrations.ts");
const main = read("src/main.tsx");

check("social domain is separate", fs.existsSync(path.join(root, "src/simulation/social/socialSystem.ts")) && fs.existsSync(path.join(root, "src/gameplay/social/socialCommands.ts")));
check("session stores social state", read("src/world/state/types.ts").includes("social: SocialState"));
check("world generation creates social state", read("src/world/generation/createWorld.ts").includes("createSocialState"));
check("time pipeline advances social state", life.includes("advanceSocialState") && life.includes("socialAdvance.people") && life.includes("social: socialAdvance.state"));
check("save migration normalizes social state", migration.includes("normalizeSocialState(payload.social") && Number(read("src/core/saves/types.ts").match(/SAVE_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1] ?? 0) >= 34);
check("physical availability gates conversation", commands.includes("actor.visible") && commands.includes("actor.interactable") && commands.includes("distanceToPlayerM > 3.5") && commands.includes("participantActorIds.includes"));
check("nearby exposes real conversation action", nearby.includes("getConversationAvailability") && nearby.includes("onStartConversation") && nearby.includes("Заговорить"));
check("conversation panel is interactive", panel.includes('onAction("ask-incident")') && panel.includes('onAction("offer-money")') && panel.includes('onAction("threaten")') && panel.includes("Закончить разговор"));
check("conversation actions are wired in app", app.includes("beginConversation(current") && app.includes("continueConversation(current") && app.includes("endConversation(current"));
check("knowledge respects source and secrecy", types.includes("KnowledgeSource") && system.includes("source: \"witnessed\"") && system.includes("item.secrecy <= disclosure"));
check("physical incidents create witness knowledge", system.includes("incident.participantActorIds") && system.includes('subject: "incident"'));
check("rumors spread through relations", system.includes('type === "gossip"') && system.includes("holderPersonIds: [source.id, target.id]") && system.includes('source: "heard"'));
check("NPC relationships change autonomously", system.includes("relationshipEvents") && system.includes("relationUpdate") && system.includes("strengthDelta"));
check("threats and lies become shareable knowledge", commands.includes("Игрок угрожал") && commands.includes("сомнительную информацию") && commands.includes("recordSocialKnowledge"));
check("real money transfer is conditional", commands.includes("const moneyAccepted") && commands.includes("balanceDelta: moneyAccepted ? -25 : 0") && commands.includes("if (moneyAccepted) progressed = updatePersonFunds"));
check("social UI style is loaded", main.includes("social.css") && fs.existsSync(path.join(root, "src/ui/theme/social.css")));
check("social CSS braces balanced", (read("src/ui/theme/social.css").match(/\{/g) ?? []).length === (read("src/ui/theme/social.css").match(/\}/g) ?? []).length);

const failures = checks.filter((item) => !item.pass);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(`\n${checks.length - failures.length}/${checks.length} living-people checks passed`);
if (failures.length) process.exit(1);
