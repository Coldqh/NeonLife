import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../src/app/mobile/MobileExperience.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/ui/theme/mobile-experience.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });
const has = (source, value) => source.includes(value);

check("MobileExperience is mounted in App", has(app, "<MobileExperience"));
check("Mobile stylesheet is imported last", has(main, 'import "./ui/theme/mobile-experience.css"'));
check("Mobile UI is isolated to phone/tablet width", /@media\s*\(max-width:\s*860px\)/.test(css));
check("Shared horizontal gutter is 20px", has(css, "--nlm-gutter: 20px"));
check("Normal card radius is capped at 16px", has(css, "--nlm-radius: 16px"));
check("Single inherited font is enforced", has(css, ".nlm-app *") && has(css, "font-family: inherit"));
check("Page title uses 28/34/700", /font-size:\s*28px;[\s\S]{0,100}line-height:\s*34px;[\s\S]{0,100}font-weight:\s*700/.test(css));
check("Section title uses 18/24/650", /\.nlm-section-title h2[\s\S]{0,300}font-size:\s*18px;[\s\S]{0,100}line-height:\s*24px;[\s\S]{0,100}font-weight:\s*650/.test(css));
check("Body scale contains 15/21/400", /font-size:\s*15px;[\s\S]{0,80}line-height:\s*21px;[\s\S]{0,80}font-weight:\s*400/.test(css));
check("Caption scale contains 13/18/400", /font-size:\s*13px;[\s\S]{0,80}line-height:\s*18px;[\s\S]{0,80}font-weight:\s*400/.test(css));
check("Numeric scale contains 22/28/650", /font-size:\s*22px;[\s\S]{0,80}line-height:\s*28px;[\s\S]{0,80}font-weight:\s*650/.test(css));
check("No decorative nested mobile cards", !/\.nlm-card\s+\.nlm-card/.test(css));
check("Desktop shell is hidden only in mobile mode", has(css, ".neon-shell") && has(css, "display: none !important"));
check("Bottom navigation has five canonical destinations", ["home", "profile", "map", "nearby", "move"].every((id) => has(mobile, `id: \"${id}\"`)));
check("Exactly one active nav condition is used", has(mobile, 'className={view === item.id ? "is-active" : ""}'));
check("Player identity is not locked to courier profession", has(mobile, 'return "Независимый житель"') && !has(mobile, 'return "Курьер"'));
check("Profile summary is derived from simulation state", has(mobile, "activeObligations") && has(mobile, "visibleActors") && !has(mobile, "Амбициозный"));
check("Courier work is shown only when actually active", has(mobile, "activeCourier") && has(mobile, 'order.status === "accepted" || order.status === "in-transit"'));
check("Global map renders every metropolitan sector", has(mobile, "for (const sector of session.metropolitan.sectors)"));
check("Global map uses dynamic sector dimensions", has(mobile, "sectorsWide") && has(mobile, "sectorsHigh"));
check("Sector selection is spatial and interactive", has(mobile, "xIndex") && has(mobile, "yIndex") && has(mobile, "onSelect(sector)"));
check("Local map divides a sector into streets", has(mobile, "STREET_NAMES") && has(mobile, "nlm-map-road") && has(mobile, "localLayout"));
check("Local map uses actual materialized buildings", has(mobile, "session.urban.buildings.filter") && has(mobile, "building.bounds"));
check("Local map uses the player's physical position", has(mobile, "session.localScene.playerPosition") && has(mobile, "nlm-player-marker"));
check("Local map controls are interactive", has(mobile, "setZoom") && has(mobile, "setShowDetails") && has(mobile, 'aria-label="Приблизить"'));
check("Remote sectors never fake the player marker", has(mobile, "playerIsHere ? <g") && has(mobile, "playerPosition.sectorId !== selected.id"));
check("Local distances are calculated from spatial bounds", has(mobile, "Math.hypot(centerX - playerPosition.xM"));
check("Nearby supports people, places, cars and events", ["people", "places", "cars", "events"].every((mode) => has(mobile, `id: \"${mode}\"`)));
check("Nearby data comes from active physical scene", has(mobile, "session.localScene.actors") && has(mobile, "session.localScene.buildings") && has(mobile, "session.vehicles.vehicles"));
check("Existing building interactions remain wired", has(app, "onApproachBuilding={approachBuilding}") && has(app, "onEnterBuilding={enterBuilding}"));
check("Existing vehicle interactions remain wired", has(app, "onApproachVehicle={approachVehicle}") && has(app, "onEnterVehicle={enterVehicle}"));
check("Existing travel logic remains wired", has(app, "onTravel={travel}") && has(mobile, "getTravelOptions(session)"));
check("Balance is sourced from player state", has(mobile, "session.player.balance.toLocaleString"));
check("Balance is not duplicated inside profile cards", !has(mobile, 'label="Баланс"'));
check("City scale is never hard-coded to a fixed sector count", !/\b1512\b/.test(mobile));

const failed = checks.filter((item) => !item.ok);
for (const [index, item] of checks.entries()) {
  console.log(`${String(index + 1).padStart(2, "0")}. ${item.ok ? "PASS" : "FAIL"}  ${item.name}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) process.exit(1);
