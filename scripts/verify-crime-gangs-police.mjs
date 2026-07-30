import fs from "node:fs";

const checks = [
  ["src/simulation/crime/playerCrimeTypes.ts", "PlayerCrimeState"],
  ["src/simulation/crime/playerCrimeTypes.ts", "GangFactionState"],
  ["src/simulation/crime/playerCrimeSystem.ts", "recordPlayerCrimeAction"],
  ["src/simulation/crime/playerCrimeSystem.ts", "advancePlayerCrimeState"],
  ["src/simulation/crime/playerCrimeSystem.ts", "createResponse"],
  ["src/gameplay/life/lifeSimulation.ts", "shopliftVenueOffer"],
  ["src/gameplay/life/lifeSimulation.ts", "robVenueRegister"],
  ["src/gameplay/life/lifeSimulation.ts", "assaultLocalActor"],
  ["src/gameplay/life/lifeSimulation.ts", "kind: \"vehicle-theft\""],
  ["src/app/screens/CrimeScreen.tsx", "Городской розыск"],
  ["src/app/map/BuildingServicePanel.tsx", "Ограбить кассу"],
  ["src/app/map/MapSelectionSheet.tsx", "Вскрыть машину"],
  ["src/app/map/MapSelectionSheet.tsx", "Напасть"],
  ["src/app/map/LocalSectorMap.tsx", "local-map__police-response"],
  ["src/ui/theme/crime.css", ".crime-screen"],
  ["src/world/state/types.ts", "playerCrime: PlayerCrimeState"],
  ["src/core/saves/types.ts", "SAVE_SCHEMA_VERSION = 39"]
];

let passed = 0;
for (const [file, token] of checks) {
  const content = fs.readFileSync(file, "utf8");
  if (!content.toLocaleLowerCase("ru-RU").includes(token.toLocaleLowerCase("ru-RU"))) throw new Error(`${file} does not contain ${token}`);
  passed += 1;
}
console.log(`Crime, Gangs & Police UI checks: ${passed}/${checks.length}`);
