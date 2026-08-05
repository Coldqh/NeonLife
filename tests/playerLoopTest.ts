import { createWorldSession } from "../src/world/generation/createWorld";
import { performPlayerLoopAction, progressLife } from "../src/gameplay/life/lifeSimulation";
import { getEquipment, getPlayerJob } from "../src/gameplay/playerLoop/playerLoopSystem";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let session = createWorldSession("player-loop-regression");
assert(!("jobs" in session), "legacy jobs state still exists in fresh session");
assert(session.playerLoop.activeJobId === null, "fresh player has an automatic job");

session = {
  ...session,
  player: {
    ...session.player,
    balance: 3_000,
    condition: { ...session.player.condition, health: 100, fatigue: 0, stress: 0 }
  },
  playerLoop: {
    ...session.playerLoop,
    skills: { ...session.playerLoop.skills, strength: 40, streetwise: 40, boxing: 45, endurance: 45 }
  }
};

session = performPlayerLoopAction(session, { kind: "select-job", jobId: "store-clerk" });
assert(getPlayerJob(session.playerLoop)?.id === "store-clerk", "one-click job selection failed");
assert(session.player.occupation.includes("ПРОДАВЕЦ"), "occupation was not projected from player loop");

const balanceBeforeShift = session.player.balance;
const serviceBefore = session.playerLoop.skills.service;
const timestampBeforeShift = session.timestamp;
session = performPlayerLoopAction(session, { kind: "work-shift" });
assert(session.timestamp - timestampBeforeShift === 480 * 60_000, "one-click shift did not consume exactly eight hours");
assert(session.player.balance > balanceBeforeShift, "one-click shift did not pay the player");
assert(session.playerLoop.skills.service > serviceBefore, "one-click shift did not improve its single skill");
assert(session.playerLoop.shiftsWorked === 1, "shift counter did not update");

session = {
  ...session,
  player: { ...session.player, condition: { ...session.player.condition, health: 100, fatigue: 0, stress: 0 } }
};
const strengthBefore = session.playerLoop.skills.strength;
session = performPlayerLoopAction(session, { kind: "train", trainingId: "gym-strength" });
assert(session.playerLoop.skills.strength > strengthBefore, "training did not improve one skill");

const balanceBeforeItem = session.player.balance;
session = performPlayerLoopAction(session, { kind: "buy-equipment", itemId: "brass-knuckles" });
assert(session.playerLoop.ownedEquipmentIds.includes("brass-knuckles"), "equipment purchase did not enter owned list");
assert(session.player.balance === balanceBeforeItem - (getEquipment("brass-knuckles")?.price ?? 0), "equipment price was not charged once");
session = performPlayerLoopAction(session, { kind: "equip-item", itemId: "brass-knuckles" });
assert(session.playerLoop.equipped.weapon === "brass-knuckles", "equipment slot did not update");

session = {
  ...progressLife(session, 60, { suppressTimeEvent: true }),
  player: { ...session.player, condition: { ...session.player.condition, health: 100, fatigue: 0, stress: 0 } }
};
const streetFightsBefore = session.playerLoop.streetFightWins + session.playerLoop.streetFightLosses;
session = performPlayerLoopAction(session, { kind: "street-fight", fightId: "alley-extortionist" });
assert(session.playerLoop.streetFightWins + session.playerLoop.streetFightLosses === streetFightsBefore + 1, "street fight was not resolved in one action");

session = {
  ...progressLife(session, 60, { suppressTimeEvent: true }),
  player: { ...session.player, condition: { ...session.player.condition, health: 100, fatigue: 0, stress: 0 } }
};
const boxingFightsBefore = session.playerLoop.boxingWins + session.playerLoop.boxingLosses;
session = performPlayerLoopAction(session, { kind: "boxing-fight" });
assert(session.playerLoop.boxingWins + session.playerLoop.boxingLosses === boxingFightsBefore + 1, "boxing fight was not resolved in one action");
assert(session.playerLoop.history.length >= 7, "player loop history did not record actions");

session = performPlayerLoopAction(session, { kind: "leave-job" });
assert(session.playerLoop.activeJobId === null, "leaving job did not clear active job");
assert(session.player.occupation === "UNEMPLOYED", "occupation did not clear after leaving job");

console.log(JSON.stringify({
  shiftsWorked: session.playerLoop.shiftsWorked,
  totalEarned: session.playerLoop.totalEarned,
  strength: session.playerLoop.skills.strength,
  streetRecord: `${session.playerLoop.streetFightWins}-${session.playerLoop.streetFightLosses}`,
  boxingRecord: `${session.playerLoop.boxingWins}-${session.playerLoop.boxingLosses}`,
  historyEntries: session.playerLoop.history.length
}, null, 2));
