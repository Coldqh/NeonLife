import { createWorldSession } from "../src/world/generation/createWorld";
import { beginConversation, continueConversation, endConversation, getConversationAvailability } from "../src/gameplay/social/socialCommands";
import { progressLife } from "../src/gameplay/life/lifeSimulation";
import { advanceSocialState } from "../src/simulation/social/socialSystem";
import type { StreetIncidentState } from "../src/simulation/streetScene/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const seed = "living-people-regression";
const created = createWorldSession(seed);
const sourceActor = created.localScene.actors.find((item) => item.activePersonId);
assert(sourceActor?.activePersonId, "social test needs an active materialized person");
const person = created.people.people.find((item) => item.id === sourceActor.activePersonId);
assert(person, "active person is missing from human network");
const playerPosition = { ...sourceActor.position, updatedAt: created.timestamp };
const colocated = progressLife({
  ...created,
  localScene: { ...created.localScene, playerPosition },
  people: {
    ...created.people,
    people: created.people.people.map((item) => item.id === person.id ? { ...item, trustToPlayer: 60, irritationToPlayer: 0 } : item)
  }
}, 0, { playerPosition, suppressTimeEvent: true });
const readyActor = colocated.localScene.actors.find((item) => item.activePersonId === person.id);
assert(readyActor?.visible && readyActor.interactable, "person did not become physically reachable after colocation");
const ready = colocated;

const availability = getConversationAvailability(ready, person.id);
assert(availability.allowed, `conversation should be physically available: ${availability.reason}`);
const started = beginConversation(ready, person.id);
assert(started.social.activeConversation?.personId === person.id, "conversation did not start");
assert(started.social.activeConversation.transcript.length === 1, "greeting was not written to transcript");

const asked = continueConversation(started, "ask-place");
assert((asked.social.activeConversation?.transcript.length ?? 0) >= 3, "conversation turn was not recorded");
const balanceBeforeGift = asked.player.balance;
const residentBeforeGift = asked.population.residents.find((item) => item.activePersonId === person.id);
const gifted = continueConversation(asked, "offer-money");
const residentAfterGift = gifted.population.residents.find((item) => item.activePersonId === person.id);
assert(gifted.player.balance === balanceBeforeGift - 25, "conversation gift did not debit player");
assert(residentBeforeGift && residentAfterGift && residentAfterGift.savings === residentBeforeGift.savings + 25, "conversation gift did not credit canonical resident money");

const threatened = continueConversation(gifted, "threaten");
const threatenedPerson = threatened.people.people.find((item) => item.id === person.id);
assert(threatenedPerson && threatenedPerson.irritationToPlayer >= 16, "threat did not change relationship");
assert(threatenedPerson.memories.some((memory) => memory.summary.includes("угрожал")), "threat was not remembered");
assert(threatened.social.knowledge.some((entry) => entry.holderPersonId === person.id && entry.subject === "player" && entry.summary.includes("угрожал")), "threat was not added to social knowledge");
const ended = endConversation(threatened);
assert(!ended.social.activeConversation, "conversation did not end");

const incident: StreetIncidentState = {
  id: "incident-social-test",
  type: "fight",
  status: "active",
  sectorId: ready.localScene.focusSectorId,
  segmentId: ready.streets.materializedSectors[0]?.segments[0]?.id ?? "segment-test",
  xM: readyActor.position.xM,
  yM: readyActor.position.yM,
  title: "Драка у входа",
  detail: "Двое спорили и один ударил другого.",
  severity: 2,
  participantActorIds: [readyActor.id],
  involvedVehicleIds: [],
  responder: "police",
  startedAt: ready.timestamp,
  expiresAt: ready.timestamp + 60 * 60_000,
  playerObserved: false,
  playerIntervened: false
};
let socialResult = advanceSocialState(ready.social, {
  seed,
  timestamp: ready.timestamp + 1,
  people: ready.people,
  locations: ready.world.locations,
  localScene: ready.localScene,
  streetScene: { ...ready.streetScene, incidents: [incident] }
});
assert(socialResult.state.knowledge.some((entry) => entry.holderPersonId === person.id && entry.subjectId === incident.id && entry.source === "witnessed"), "witness did not learn about physical incident");

let timestamp = ready.timestamp + 1;
for (let step = 0; step < 8 && socialResult.state.rumors.length === 0; step += 1) {
  timestamp += 12 * 6 * 60 * 60_000;
  socialResult = advanceSocialState(socialResult.state, {
    seed,
    timestamp,
    people: socialResult.people,
    locations: ready.world.locations,
    localScene: ready.localScene,
    streetScene: { ...ready.streetScene, incidents: [incident] }
  });
}
assert(socialResult.state.relationshipEvents.length > 0, "autonomous social events were not generated");
assert(socialResult.state.rumors.length > 0, "knowledge never spread as a rumor");
const rumor = socialResult.state.rumors[0];
assert(rumor.holderPersonIds.length >= 2, "rumor did not reach another person");

console.log(JSON.stringify({
  person: person.name,
  transcriptLines: threatened.social.activeConversation?.transcript.length ?? 0,
  irritation: threatenedPerson.irritationToPlayer,
  witnessedIncident: incident.title,
  relationshipEvents: socialResult.state.relationshipEvents.length,
  rumor: rumor.currentSummary,
  rumorHolders: rumor.holderPersonIds.length
}, null, 2));
