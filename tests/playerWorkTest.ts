import { createWorldSession } from "../src/world/generation/createWorld";
import {
  approachLocalBuilding,
  enterBuildingUnit,
  enterLocalBuilding,
  finishPlayerEmploymentShift,
  interviewForPlayerWork,
  leaveLocalBuilding,
  moveInsideBuilding,
  performPlayerWorkTask,
  progressLife,
  signPlayerEmploymentContract,
  startPlayerEmploymentShift
} from "../src/gameplay/life/lifeSimulation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let session = createWorldSession("living-work-regression");
if (session.localScene.playerPosition.state === "inside") session = leaveLocalBuilding(session);
assert(session.localScene.playerPosition.state === "outside", "player could not reach street");

session = {
  ...session,
  jobs: {
    ...session.jobs,
    work: {
      ...session.jobs.work,
      skills: { service: 85, cooking: 85, medical: 85, technical: 85 }
    }
  }
};

const buildingById = new Map(session.urban.buildings.map((building) => [building.id, building]));
const unitById = new Map(session.urban.units.map((unit) => [unit.id, unit]));
const venueById = new Map(session.urban.venues.map((venue) => [venue.id, venue]));
const candidates = session.jobs.work.vacancies
  .filter((vacancy) => vacancy.status === "open" && buildingById.has(vacancy.buildingId) && unitById.has(vacancy.unitId) && venueById.has(vacancy.venueId))
  .sort((left, right) => left.minimumSkill - right.minimumSkill || right.wagePerHour - left.wagePerHour);
assert(candidates.length > 0, "no materialized player vacancies exist");

const vacancy = candidates[0];
const venue = venueById.get(vacancy.venueId)!;
const building = buildingById.get(vacancy.buildingId)!;

session = approachLocalBuilding(session, building.id);
session = enterLocalBuilding(session, building.id);
assert(session.localScene.playerPosition.buildingId === building.id, "could not enter employer building");
if ((session.localScene.playerPosition.floor ?? 1) !== venue.floor) {
  session = moveInsideBuilding(session, venue.floor, building.elevatorCount > 0 ? "elevator" : "stairs");
}
session = enterBuildingUnit(session, venue.unitId);
assert(session.localScene.playerPosition.unitId === venue.unitId, "could not enter employer unit");

session = interviewForPlayerWork(session, vacancy.id);
const application = session.jobs.work.applications.find((item) => item.vacancyId === vacancy.id);
assert(application?.status === "accepted", `interview was not accepted: ${application?.decisionText ?? "missing"}`);

session = signPlayerEmploymentContract(session, vacancy.id);
const contract = session.jobs.work.contracts.find((item) => item.id === session.jobs.work.activeContractId);
assert(contract, "contract was not created");
assert(session.player.occupation !== "UNEMPLOYED", "player occupation did not update");

if (session.timestamp < contract.nextShiftAt) {
  session = progressLife(session, Math.ceil((contract.nextShiftAt - session.timestamp) / 60_000), { activity: "Wait for work regression" });
}
session = startPlayerEmploymentShift(session, contract.id);
assert(session.jobs.work.activeShiftId, "shift did not start");

let guard = 0;
while (session.jobs.work.activeShiftId && guard < 10) {
  const shift = session.jobs.work.shifts.find((item) => item.id === session.jobs.work.activeShiftId)!;
  const nextTask = session.jobs.work.tasks.find((task) => task.shiftId === shift.id && task.status === "pending");
  if (!nextTask) break;
  const before = session.timestamp;
  session = performPlayerWorkTask(session, nextTask.id);
  assert(session.timestamp > before, `task ${nextTask.label} did not advance time`);
  guard += 1;
}
const activeShift = session.jobs.work.shifts.find((item) => item.id === session.jobs.work.activeShiftId);
assert(activeShift && activeShift.completedTaskCount === activeShift.taskIds.length, "not all shift tasks completed");

const balanceBefore = session.player.balance;
const cashBefore = session.urban.venueOperations.operations.find((item) => item.venueId === venue.id)?.cash ?? 0;
session = finishPlayerEmploymentShift(session);
const completedContract = session.jobs.work.contracts.find((item) => item.id === contract.id);
const completedShift = session.jobs.work.shifts.find((item) => item.id === activeShift.id);
const cashAfter = session.urban.venueOperations.operations.find((item) => item.venueId === venue.id)?.cash ?? 0;
assert(!session.jobs.work.activeShiftId, "shift remained active after completion");
assert(completedShift?.status === "completed", "shift status is not completed");
assert((completedContract?.completedShifts ?? 0) === 1, "contract did not count completed shift");
assert(session.player.balance > balanceBefore, "player was not paid");
assert(cashAfter < cashBefore, "employer cash did not fund wage");
assert(session.jobs.work.skills[vacancy.requiredSkill] > 85, "work skill did not grow");

const warningBefore = completedContract?.warningCount ?? 0;
const missTarget = (completedContract?.nextShiftAt ?? session.timestamp) + 4 * 60 * 60_000;
session = progressLife(session, Math.ceil((missTarget - session.timestamp) / 60_000), { activity: "Miss work shift regression" });
const warnedContract = session.jobs.work.contracts.find((item) => item.id === contract.id);
assert((warnedContract?.warningCount ?? 0) === warningBefore + 1, "missed shift did not create warning");
assert(warnedContract?.status === "warning", "contract was not marked warning after missed shift");

console.log(JSON.stringify({
  venue: venue.name,
  role: vacancy.role,
  wagePerHour: vacancy.wagePerHour,
  paid: session.player.balance - balanceBefore,
  employerCashBefore: Math.round(cashBefore),
  employerCashAfter: Math.round(cashAfter),
  completedTasks: completedShift.completedTaskCount,
  quality: completedShift.quality,
  nextShiftAt: warnedContract?.nextShiftAt,
  warningCount: warnedContract?.warningCount,
  skillAfter: session.jobs.work.skills[vacancy.requiredSkill]
}, null, 2));
