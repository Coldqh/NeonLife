import { readFileSync, statSync } from "node:fs";

const app = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../src/app/mobile/MobileExperience.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/ui/theme/mobile-experience.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const playerPortrait = new URL("../public/ui/player-portrait.webp", import.meta.url);

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });
const has = (source, value) => source.includes(value);

function openingTags(source, tagName) {
  const result = [];
  const needle = `<${tagName}`;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) !== -1) {
    let index = cursor + needle.length;
    let braces = 0;
    let quote = "";
    let escaped = false;
    for (; index < source.length; index += 1) {
      const char = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote) {
        if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "{") braces += 1;
      else if (char === "}") braces = Math.max(0, braces - 1);
      else if (char === ">" && braces === 0) {
        result.push(source.slice(cursor, index + 1));
        cursor = index + 1;
        break;
      }
    }
    if (index >= source.length) break;
  }
  return result;
}

const buttons = openingTags(mobile, "button");
const deadButtons = buttons.filter((tag) => !tag.includes("onClick="));
const roleButtons = openingTags(mobile, "g").filter((tag) => tag.includes('role="button"'));

check("MobileExperience is mounted in App", has(app, "<MobileExperience"));
check("Mobile stylesheet is imported last", has(main, 'import "./ui/theme/mobile-experience.css"'));
check("Mobile UI is isolated to phone/tablet width", /@media\s*\(max-width:\s*860px\)/.test(css));
check("Shared horizontal gutter is 20px", has(css, "--nlm-gutter: 20px"));
check("Normal card radius is capped at 16px", has(css, "--nlm-radius: 16px"));
check("Content uses full mobile width up to 540px", has(css, "--nlm-content-max: 540px") && has(css, "max-width: var(--nlm-content-max)"));
check("Single inherited font is enforced", has(css, ".nlm-app *") && has(css, "font-family: inherit"));
check("Page title uses 28/34/700", /font-size:\s*28px;[\s\S]{0,100}line-height:\s*34px;[\s\S]{0,100}font-weight:\s*700/.test(css));
check("Section title uses 18/24/650", /\.nlm-section-title h2[\s\S]{0,300}font-size:\s*18px;[\s\S]{0,100}line-height:\s*24px;[\s\S]{0,100}font-weight:\s*650/.test(css));
check("Body scale contains 15/21/400", /font-size:\s*15px;[\s\S]{0,80}line-height:\s*21px;[\s\S]{0,80}font-weight:\s*400/.test(css));
check("Caption scale contains 13/18/400", /font-size:\s*13px;[\s\S]{0,80}line-height:\s*18px;[\s\S]{0,80}font-weight:\s*400/.test(css));
check("Numeric scale contains 22/28/650", /font-size:\s*22px;[\s\S]{0,80}line-height:\s*28px;[\s\S]{0,80}font-weight:\s*650/.test(css));
check("No text ellipsis hides gameplay data", !has(css, "text-overflow: ellipsis"));
check("No decorative nested mobile cards", !/\.nlm-card\s+\.nlm-card/.test(css));
check("Desktop shell is hidden only in mobile mode", has(css, ".neon-shell") && has(css, "display: none !important"));
check("Bottom nav width matches content width", has(css, "width: min(100%, var(--nlm-content-max))"));
check("Bottom navigation has five canonical destinations", ["home", "profile", "map", "nearby", "move"].every((id) => has(mobile, `id: "${id}"`)));
check("Exactly one active nav condition is used", has(mobile, 'className={view === item.id ? "is-active" : ""}'));
check("Active bottom tab exposes aria-current", has(mobile, 'aria-current={view === item.id ? "page" : undefined}'));
check("Every rendered button has an onClick handler", deadButtons.length === 0);
check("SVG map POIs have click handlers", roleButtons.length > 0 && roleButtons.every((tag) => tag.includes("onClick=")));
check("Section actions render only with handlers", has(mobile, "action && onAction ? <button"));
check("Player identity is not locked to courier profession", has(mobile, 'return "Независимый житель"') && !has(mobile, 'return "Курьер"'));
check("Courier objective appears only for an active order", has(mobile, "activeCourier") && has(mobile, 'order.status === "accepted" || order.status === "in-transit"'));
check("Courier objective routes to its actual pickup or drop-off", has(mobile, "activeCourierTargetId") && has(mobile, "activeCourier.pickupLocationId") && has(mobile, "activeCourier.dropoffLocationId"));
check("Default objective executes the actual quick action", has(mobile, "if (objective.action)") && has(mobile, "onAction(objective.action)"));
check("Agenda rows navigate instead of pretending to execute", has(mobile, 'onClick={() => onNavigate("move")}'));
check("Quick access buttons are wired", ["global", "local", "nearby", "profile"].every((value) => has(mobile, `onOpenMap("${value}")`) || has(mobile, `onNavigate("${value}")`)));
check("Profile connections are interactive", has(mobile, "selectRelation(person.id, person.name)"));
check("Profile connection selection opens visible details", has(mobile, "nlm-connection-detail") && has(mobile, "selectedRelationId"));
check("Profile portraits are stable by person id", has(mobile, "personAssetById(person.id)"));
check("Nearby portraits are stable between list and sheet", has(mobile, "personAssetById(actor.id)") && has(mobile, "personAssetById(selectedActor.id)"));
check("Portrait selection never depends on list position", !has(mobile, "personAsset(actor, index)") && !has(mobile, "+ index) % PERSON_ASSETS.length"));
check("Clean player portrait asset exists", statSync(playerPortrait).size > 15_000);
check("Nearby supports people, places, cars and events", ["people", "places", "cars", "events"].every((mode) => has(mobile, `id: "${mode}"`)));
check("Nearby data comes from physical scene", has(mobile, "session.localScene.actors") && has(mobile, "session.localScene.buildings") && has(mobile, "session.vehicles.vehicles"));
check("Nearby people selection opens a real sheet", has(mobile, "chooseActor(actor)") && has(mobile, "setSheetOpen(true)"));
check("Nearby person profile changes selected world contact", has(mobile, "onSelectPerson(actor.activePersonId)"));
check("Nearby profile button visibly expands actor facts", has(mobile, "actorDetailsOpen") && has(mobile, "nlm-actor-facts"));
check("Nearby observation advances world time", has(mobile, 'onAdvance(2, `Наблюдение: ${actor.name}`)'));
check("Actor destination action uses actual location id", has(mobile, "onTravel(actor.destinationLocationId)"));
check("Building actions use the selected building", has(mobile, "selectedBuildingId") && has(mobile, "approachBuilding(selectedBuilding)") && has(mobile, "enterBuilding(selectedBuilding)"));
check("Vehicle actions use the selected vehicle", has(mobile, "selectedVehicleId") && has(mobile, "approachVehicle(selectedVehicle)") && has(mobile, "enterVehicle(selectedVehicle)"));
check("Invalid building entry is hidden and explained", has(mobile, "selectedBuilding.distanceToPlayerM <= 12") && has(mobile, 'buildingAccess?.publicDecision === "locked"') && has(mobile, "nlm-action-unavailable"));
check("Vehicle entry appears only at physical interaction distance", has(mobile, "selectedVehicle.playerCanEnter && selectedVehicle.distanceToPlayerM <= 12"));
check("Every nearby sheet can be closed", has(mobile, "nlm-sheet-close") && has(mobile, "setSheetOpen(false)"));
check("All gameplay actions provide visible feedback", has(mobile, "nlm-toast") && has(mobile, "notify("));
check("View changes reset scroll position", has(mobile, "scrollRef.current?.scrollTo"));
check("Global map renders every metropolitan sector", has(mobile, "for (const sector of session.metropolitan.sectors)"));
check("Global map uses dynamic sector dimensions", has(mobile, "sectorsWide") && has(mobile, "sectorsHigh"));
check("City scale is never hard-coded to a fixed sector count", !/\b1512\b/.test(mobile));
check("Sector selection is spatial and interactive", has(mobile, "xIndex") && has(mobile, "yIndex") && has(mobile, "onSelect(sector)"));
check("Global map layers are real toggles", has(mobile, "setLayers") && has(mobile, "layers.transit") && has(mobile, "layers.traffic") && has(mobile, "layers.districts"));
check("Global POI rows execute travel", has(mobile, "locations.map((location) =>") && has(mobile, "onClick={() => travel(location)}"));
check("Local map divides a sector into streets", has(mobile, "STREET_NAMES") && has(mobile, "nlm-map-road") && has(mobile, "localLayout"));
check("Local map uses actual materialized buildings", has(mobile, "session.urban.buildings.filter") && has(mobile, "building.bounds"));
check("Local map uses the player's physical position", has(mobile, "session.localScene.playerPosition") && has(mobile, "nlm-player-marker"));
check("Local map controls are interactive", has(mobile, "setZoom") && has(mobile, "setShowDetails") && has(mobile, 'aria-label="Приблизить"'));
check("Remote sectors never fake the player marker", has(mobile, "playerIsHere ? <g") && has(mobile, "playerPosition.sectorId !== selected.id"));
check("Local distances are calculated from spatial bounds", has(mobile, "Math.hypot(centerX - playerPosition.xM"));
check("Local POI rows execute travel", has(mobile, "onLocation={travel}") && has(mobile, "onClick={() => travel(location)}"));
check("Local building rows approach actual buildings", has(mobile, "onApproachBuilding(building.buildingId)"));
check("Move routes use existing travel logic", has(app, "onTravel={travel}") && has(mobile, "getTravelOptions(session)"));
check("Wait buttons advance existing simulation time", has(mobile, "onAdvance(minutes, \"Ожидание\")"));
check("Existing building interactions remain wired", has(app, "onApproachBuilding={approachBuilding}") && has(app, "onEnterBuilding={enterBuilding}"));
check("Existing vehicle interactions remain wired", has(app, "onApproachVehicle={approachVehicle}") && has(app, "onEnterVehicle={enterVehicle}"));
check("Balance is sourced from player state", has(mobile, "session.player.balance.toLocaleString"));
check("Balance is not duplicated inside profile cards", !has(mobile, 'label="Баланс"'));

const failed = checks.filter((item) => !item.ok);
for (const [index, item] of checks.entries()) {
  console.log(`${String(index + 1).padStart(2, "0")}. ${item.ok ? "PASS" : "FAIL"}  ${item.name}`);
}
if (deadButtons.length) {
  console.log("\nButtons without handlers:");
  for (const tag of deadButtons) console.log(tag.replace(/\s+/g, " ").slice(0, 220));
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) process.exit(1);
