import { createWorldSession } from "../src/world/generation/createWorld";
import { assaultLocalActor, performPlayerLoopAction, progressLife, purchaseVenueOffer } from "../src/gameplay/life/lifeSimulation";
import { getPlayerJob, jobsForVenueCategory } from "../src/gameplay/playerLoop/playerLoopSystem";
import type { GameSession } from "../src/world/state/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function enterVenue(session: GameSession, venue: GameSession["urban"]["venues"][number]): GameSession {
  return {
    ...session,
    urban: {
      ...session.urban,
      venues: session.urban.venues.map((item) => item.id === venue.id ? { ...item, active: true, operatingStatus: "operating", openHour: 0, closeHour: 24 } : item),
      venueOperations: {
        ...session.urban.venueOperations,
        operations: session.urban.venueOperations.operations.map((operation) => operation.venueId === venue.id ? {
          ...operation,
          status: "operating",
          queue: { ...operation.queue, playerState: "ready", estimatedWaitMinutes: 0 }
        } : operation)
      }
    },
    localScene: {
      ...session.localScene,
      playerPosition: {
        ...session.localScene.playerPosition,
        state: "inside",
        sectorId: venue.sectorId,
        buildingId: venue.buildingId,
        unitId: venue.unitId,
        floor: venue.floor,
        roomId: undefined,
        interiorZone: "unit"
      }
    }
  };
}

function leaveVenue(session: GameSession): GameSession {
  return {
    ...session,
    localScene: {
      ...session.localScene,
      playerPosition: {
        ...session.localScene.playerPosition,
        state: "outside",
        buildingId: undefined,
        unitId: undefined,
        roomId: undefined,
        interiorZone: undefined
      }
    }
  };
}

let session = createWorldSession("world-bound-player-systems");
assert(!("jobs" in session), "legacy jobs state still exists in fresh session");
assert(session.playerLoop.employment === null, "fresh player has an automatic employer");

const categories = new Set(session.urban.venueOperations.registry.map((entry) => entry.venue.category));
for (const category of ["gym", "boxing-gym", "shooting-range", "weapon-shop"] as const) {
  assert(categories.has(category), `world generation did not create ${category}`);
}

session = {
  ...session,
  player: {
    ...session.player,
    balance: 10_000,
    condition: { ...session.player.condition, health: 100, fatigue: 0, stress: 0 }
  },
  playerLoop: {
    ...session.playerLoop,
    skills: { ...session.playerLoop.skills, service: 40, strength: 45, streetwise: 45, boxing: 50, endurance: 50, shooting: 45, technical: 30 }
  }
};

const employerVenue = session.urban.venues.find((venue) => venue.anchorLocationId && jobsForVenueCategory(venue.category).some((job) => job.id === "store-clerk"))
  ?? session.urban.venues.find((venue) => jobsForVenueCategory(venue.category).some((job) => job.id === "store-clerk"));
assert(employerVenue, "no physical employer offers store-clerk work");
const manager = employerVenue.anchorLocationId
  ? session.people.people.find((person) => person.workLocationId === employerVenue.anchorLocationId)
  : undefined;

const remoteHire = performPlayerLoopAction(session, { kind: "select-job", jobId: "store-clerk", venueId: employerVenue.id, employerName: employerVenue.name, managerPersonId: manager?.id });
assert(remoteHire === session, "player was hired without entering the employer venue");

session = enterVenue(session, employerVenue);
const managerTrustBefore = manager?.trustToPlayer;
session = performPlayerLoopAction(session, { kind: "select-job", jobId: "store-clerk", venueId: employerVenue.id, employerName: employerVenue.name, managerPersonId: manager?.id });
assert(getPlayerJob(session.playerLoop)?.id === "store-clerk", "physical job selection failed");
assert(session.playerLoop.employment?.venueId === employerVenue.id, "employment did not retain its physical employer");
assert(session.playerLoop.biography.some((entry) => entry.category === "employment" && entry.locationName === employerVenue.name), "hiring did not enter the biography with a place");
if (manager && managerTrustBefore !== undefined) {
  const updatedManager = session.people.people.find((person) => person.id === manager.id);
  assert(updatedManager && updatedManager.trustToPlayer > managerTrustBefore, "manager did not remember the hiring");
}

const outsideWork = leaveVenue(session);
const rejectedShift = performPlayerLoopAction(outsideWork, { kind: "work-shift", venueId: employerVenue.id });
assert(rejectedShift === outsideWork, "work shift was possible away from the workplace");

session = enterVenue(session, employerVenue);
const balanceBeforeShift = session.player.balance;
const serviceBefore = session.playerLoop.skills.service;
const timestampBeforeShift = session.timestamp;
session = performPlayerLoopAction(session, { kind: "work-shift", venueId: employerVenue.id });
assert(session.timestamp - timestampBeforeShift === 480 * 60_000, "one-click shift did not consume exactly eight hours");
assert(session.player.balance > balanceBeforeShift, "one-click shift did not pay the player");
assert(session.playerLoop.skills.service > serviceBefore, "shift did not improve its single skill");
assert(session.playerLoop.employment?.shiftsWorked === 1, "employer-specific shift count was not updated");

const gym = session.urban.venueOperations.registry.find((entry) => entry.venue.category === "gym")?.venue;
assert(gym, "gym missing from venue registry");
const strengthBeforeOutside = session.playerLoop.skills.strength;
const outsideTraining = performPlayerLoopAction(leaveVenue(session), { kind: "train", trainingId: "gym-strength", venueId: gym.id });
assert(outsideTraining.playerLoop.skills.strength === strengthBeforeOutside, "training was possible outside the gym");
session = enterVenue(session, gym);
const strengthBefore = session.playerLoop.skills.strength;
session = performPlayerLoopAction(session, { kind: "train", trainingId: "gym-strength", venueId: gym.id });
assert(session.playerLoop.skills.strength > strengthBefore, "gym training did not improve strength inside the venue");

const boxingGym = session.urban.venueOperations.registry.find((entry) => entry.venue.category === "boxing-gym")?.venue;
assert(boxingGym, "boxing gym missing from venue registry");
session = { ...progressLife(session, 60, { suppressTimeEvent: true }), player: { ...session.player, condition: { ...session.player.condition, health: 100, fatigue: 0, stress: 0 } } };
const boxingBeforeOutside = session.playerLoop.boxingWins + session.playerLoop.boxingLosses;
const outsideBoxing = performPlayerLoopAction(leaveVenue(session), { kind: "boxing-fight", venueId: boxingGym.id });
assert(outsideBoxing.playerLoop.boxingWins + outsideBoxing.playerLoop.boxingLosses === boxingBeforeOutside, "boxing fight was possible outside the boxing gym");
session = enterVenue(session, boxingGym);
session = performPlayerLoopAction(session, { kind: "boxing-fight", venueId: boxingGym.id });
assert(session.playerLoop.boxingWins + session.playerLoop.boxingLosses === boxingBeforeOutside + 1, "boxing fight did not resolve inside the boxing gym");
assert(session.playerLoop.biography.some((entry) => entry.category === "boxing" && entry.locationName === boxingGym.name), "boxing result did not enter biography with venue");

const weaponShop = session.urban.venueOperations.registry.find((entry) => entry.venue.category === "weapon-shop")?.venue;
assert(weaponShop, "weapon shop missing from venue registry");
session = enterVenue({ ...session, player: { ...session.player, balance: 10_000 } }, weaponShop);
const weaponOperation = session.urban.venueOperations.operations.find((operation) => operation.venueId === weaponShop.id);
const weaponOffer = weaponOperation?.offers.find((offer) => offer.productId === "brass-knuckles");
assert(weaponOffer, "weapon shop has no physical equipment offer");
const purchased = purchaseVenueOffer(session, weaponShop.id, weaponOffer.id);
assert(purchased.playerLoop.ownedEquipmentIds.includes("brass-knuckles"), "physical weapon purchase did not add owned equipment");
session = performPlayerLoopAction(purchased, { kind: "equip-item", itemId: "brass-knuckles" });
assert(session.playerLoop.equipped.weapon === "brass-knuckles", "owned weapon could not be equipped from profile state");

session = progressLife(session, 60, { suppressTimeEvent: true });
const actor = session.localScene.actors[0];
assert(actor, "no local actor available for street fight test");
session = {
  ...session,
  player: { ...session.player, condition: { ...session.player.condition, health: 100, fatigue: 0, stress: 0 } },
  localScene: {
    ...session.localScene,
    playerPosition: { ...session.localScene.playerPosition, state: "outside", buildingId: undefined, unitId: undefined, roomId: undefined, interiorZone: undefined },
    actors: session.localScene.actors.map((item) => item.id === actor.id ? { ...item, visible: true, interactable: true, distanceToPlayerM: 2, position: { ...item.position, state: "outside", buildingId: undefined, unitId: undefined, roomId: undefined } } : item)
  }
};
const streetBefore = session.playerLoop.streetFightWins + session.playerLoop.streetFightLosses;
session = assaultLocalActor(session, actor.id);
assert(session.playerLoop.streetFightWins + session.playerLoop.streetFightLosses === streetBefore + 1, "nearby actor fight did not update combat record");
assert(session.playerLoop.biography.some((entry) => entry.category === "combat"), "street fight did not enter biography");

session = performPlayerLoopAction(session, { kind: "leave-job" });
assert(session.playerLoop.employment === null, "leaving job did not clear physical employment");

console.log(JSON.stringify({
  employer: employerVenue.name,
  shiftsWorked: session.playerLoop.shiftsWorked,
  strength: session.playerLoop.skills.strength,
  streetRecord: `${session.playerLoop.streetFightWins}-${session.playerLoop.streetFightLosses}`,
  boxingRecord: `${session.playerLoop.boxingWins}-${session.playerLoop.boxingLosses}`,
  biographyEntries: session.playerLoop.biography.length,
  ownedEquipment: session.playerLoop.ownedEquipmentIds
}, null, 2));
