import fs from "node:fs";

const checks = [
  ["src/gameplay/jobs/work/types.ts", "PlayerWorkContractState"],
  ["src/gameplay/jobs/work/types.ts", "PlayerWorkShiftState"],
  ["src/gameplay/jobs/work/workSystem.ts", "createPlayerWorkState"],
  ["src/gameplay/jobs/work/workSystem.ts", "interviewPlayerForVacancy"],
  ["src/gameplay/jobs/work/workSystem.ts", "completePlayerWorkTask"],
  ["src/gameplay/jobs/work/workSystem.ts", "finishPlayerWorkShift"],
  ["src/gameplay/life/lifeSimulation.ts", "interviewForPlayerWork"],
  ["src/gameplay/life/lifeSimulation.ts", "startPlayerEmploymentShift"],
  ["src/gameplay/life/lifeSimulation.ts", "balanceReason: \"wage\""],
  ["src/app/screens/WorkScreen.tsx", "Доступные смены"],
  ["src/app/map/VenueWorkPanel.tsx", "Поговорить с управляющим"],
  ["src/app/map/VenueWorkPanel.tsx", "Закрыть смену и получить зарплату"],
  ["src/app/actions/localLifeActions.ts", "perform-work-task"],
  ["src/world/state/types.ts", "work: PlayerWorkState"],
  ["src/ui/theme/work.css", ".venue-work-panel"]
];

let passed = 0;
for (const [file, token] of checks) {
  const content = fs.readFileSync(file, "utf8");
  if (!content.includes(token)) throw new Error(`${file} does not contain ${token}`);
  passed += 1;
}
console.log(`Living Work UI checks: ${passed}/${checks.length}`);
