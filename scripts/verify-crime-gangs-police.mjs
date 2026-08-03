import fs from "node:fs";

const checks = [
  ["src/simulation/crime/playerCrimeTypes.ts", "PlayerCrimeState"],
  ["src/simulation/crime/playerCrimeTypes.ts", "PlayerCustodyPhase"],
  ["src/simulation/crime/playerCrimeTypes.ts", "knownIntel"],
  ["src/simulation/crime/playerCrimeSystem.ts", "recordPlayerCrimeAction"],
  ["src/simulation/crime/playerCrimeSystem.ts", "advancePlayerCrimeState"],
  ["src/simulation/crime/playerCrimeSystem.ts", "actOnPlayerCustodyState"],
  ["src/simulation/crime/playerCrimeSystem.ts", "projectGangs"],
  ["src/simulation/crime/playerCrimeSystem.ts", "shouldDispatchResponse"],
  ["src/simulation/government/types.ts", "GangConflictState"],
  ["src/simulation/government/governmentSystem.ts", "advanceGangConflicts"],
  ["src/world/generation/createWorld.ts", "RED STATIC"],
  ["src/world/generation/createWorld.ts", "MOURNING SONS"],
  ["src/gameplay/life/lifeSimulation.ts", "shopliftVenueOffer"],
  ["src/gameplay/life/lifeSimulation.ts", "robVenueRegister"],
  ["src/gameplay/life/lifeSimulation.ts", "assaultLocalActor"],
  ["src/gameplay/life/lifeSimulation.ts", "submit-search"],
  ["src/app/screens/CrimeScreen.tsx", "Только то, что персонаж видел"],
  ["src/app/screens/CrimeScreen.tsx", "Подчиниться обыску"],
  ["src/app/screens/CrimeScreen.tsx", "Полиция рядом"],
  ["src/app/map/BuildingServicePanel.tsx", "Ограбить кассу"],
  ["src/app/map/MapSelectionSheet.tsx", "Вскрыть машину"],
  ["src/app/map/MapSelectionSheet.tsx", "Напасть"],
  ["src/app/map/LocalSectorMap.tsx", "local-map__police-response"],
  ["src/ui/theme/crime.css", ".crime-custody--hearing"],
  ["src/world/state/types.ts", "playerCrime: PlayerCrimeState"]
];

let passed = 0;
for (const [file, token] of checks) {
  const content = fs.readFileSync(file, "utf8");
  if (!content.toLocaleLowerCase("ru-RU").includes(token.toLocaleLowerCase("ru-RU"))) {
    throw new Error(`${file} does not contain ${token}`);
  }
  passed += 1;
}

const saveTypesPath = "src/core/saves/types.ts";
const saveTypes = fs.readFileSync(saveTypesPath, "utf8");
const schemaMatch = saveTypes.match(/SAVE_SCHEMA_VERSION\s*=\s*(\d+)/);
const schemaVersion = schemaMatch ? Number(schemaMatch[1]) : Number.NaN;
const minimumCrimeSchemaVersion = 39;

if (!Number.isInteger(schemaVersion) || schemaVersion < minimumCrimeSchemaVersion) {
  throw new Error(
    `${saveTypesPath} must declare SAVE_SCHEMA_VERSION >= ${minimumCrimeSchemaVersion}; found ${schemaMatch?.[1] ?? "nothing"}`
  );
}

passed += 1;
console.log(`Crime, Gangs & Police UI checks: ${passed}/${checks.length + 1}`);
