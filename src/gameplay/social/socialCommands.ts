import type { GameSession } from "../../world/state/types";
import { getPerson, recordPlayerAction, toKnownNpc } from "../../people/network/humanNetwork";
import { beginConversationState, continueConversationState, endConversationState, recordSocialKnowledge } from "../../simulation/social/socialSystem";
import type { ConversationAction } from "../../simulation/social/types";
import { progressLife } from "../life/lifeSimulation";

export interface ConversationAvailability {
  allowed: boolean;
  reason: string;
  distanceM?: number;
}

export function getConversationAvailability(session: GameSession, personId: string): ConversationAvailability {
  const person = getPerson(session.people, personId);
  if (!person) return { allowed: false, reason: "Человек недоступен" };
  const actor = session.localScene.actors.find((item) => item.activePersonId === personId);
  if (!actor) return { allowed: false, reason: "Человека нет рядом" };
  if (!actor.visible) return { allowed: false, reason: "Человека не видно" };
  if (!actor.interactable || actor.distanceToPlayerM > 3.5) return { allowed: false, reason: `Подойди ближе · ${Math.round(actor.distanceToPlayerM)} м`, distanceM: actor.distanceToPlayerM };
  const incident = session.streetScene.incidents.find((item) => item.status !== "resolved" && item.participantActorIds.includes(actor.id));
  if (incident) return { allowed: false, reason: `Сейчас занят: ${incident.title}` };
  if (actor.activity === "medical") return { allowed: false, reason: "Сейчас проходит лечение" };
  if (person.stress >= 92 || person.irritationToPlayer >= 88) return { allowed: false, reason: "Не хочет разговаривать" };
  return { allowed: true, reason: "Можно поговорить", distanceM: actor.distanceToPlayerM };
}

export function beginConversation(session: GameSession, personId: string): GameSession {
  const availability = getConversationAvailability(session, personId);
  const person = getPerson(session.people, personId);
  if (!availability.allowed || !person) return session;
  const progressed = progressLife(session, 1, { activity: `Разговор: ${person.name}`, suppressTimeEvent: true, playerPosition: session.localScene.playerPosition });
  const current = getPerson(progressed.people, personId);
  if (!current) return progressed;
  return {
    ...progressed,
    social: beginConversationState(progressed.social, progressed.world.meta.seed, current, progressed.timestamp),
    people: { ...progressed.people, selectedPersonId: personId },
    world: { ...progressed.world, primaryContactId: personId },
    primaryContact: toKnownNpc(current, progressed.world.locations, progressed.timestamp)
  };
}

function updatePersonFunds(session: GameSession, personId: string, amount: number): GameSession {
  const resident = session.population.residents.find((item) => item.activePersonId === personId);
  return {
    ...session,
    people: { ...session.people, people: session.people.people.map((person) => person.id === personId ? { ...person, money: Math.max(0, person.money + amount) } : person) },
    population: resident ? { ...session.population, residents: session.population.residents.map((item) => item.id === resident.id ? { ...item, savings: Math.max(0, item.savings + amount) } : item) } : session.population
  };
}

export function continueConversation(session: GameSession, action: ConversationAction): GameSession {
  const conversation = session.social.activeConversation;
  if (!conversation) return session;
  if (action === "end") return endConversation(session);
  const availability = getConversationAvailability(session, conversation.personId);
  const person = getPerson(session.people, conversation.personId);
  if (!availability.allowed || !person) return { ...session, social: endConversationState(session.social) };
  if (action === "offer-money" && session.player.balance < 25) return session;

  const minutes = action === "threaten" ? 2 : action === "offer-money" ? 2 : 1;
  let progressed = progressLife(session, minutes, {
    category: "contact" as const,
    title: action === "threaten" ? `Угроза: ${person.name}` : action === "offer-money" ? `Передано ₵ 25: ${person.name}` : undefined,
    detail: action === "threaten" ? "Разговор стал враждебным." : action === "offer-money" ? "Личный перевод во время разговора." : undefined,
    importance: action === "threaten" ? 2 : 1,
    balanceDelta: action === "offer-money" ? -25 : 0,
    balanceCounterpartyEntityId: action === "offer-money" ? person.id : undefined,
    relationChanges: ["ask-help", "offer-money", "threaten", "lie"].includes(action) ? 1 : 0,
    suppressTimeEvent: true,
    playerPosition: session.localScene.playerPosition,
    activity: `Разговор: ${person.name}`
  });

  let effects: Parameters<typeof recordPlayerAction>[5] = {};
  if (action === "ask-help") effects = person.trustToPlayer >= 35 ? { trust: 1, importance: 25, emotionalValue: 3 } : { irritation: 1, importance: 20, emotionalValue: -2 };
  if (action === "offer-money") effects = { trust: 4, respect: 2, importance: 58, emotionalValue: 24 };
  if (action === "threaten") effects = { trust: -8, respect: 2, irritation: 16, importance: 82, emotionalValue: -46 };
  if (action === "lie") {
    const identity = progressed.social.identities.find((item) => item.personId === person.id);
    const believed = (identity?.openness ?? 0) + person.trustToPlayer >= 85;
    effects = believed ? { trust: 1, importance: 30, emotionalValue: 1 } : { trust: -5, irritation: 8, importance: 62, emotionalValue: -18 };
  }
  if (Object.keys(effects).length) {
    progressed = { ...progressed, people: recordPlayerAction(progressed.people, progressed.world.meta.seed, person.id, progressed.timestamp, action === "offer-money" ? "Игрок передал деньги во время разговора." : action === "threaten" ? "Игрок угрожал во время разговора." : action === "lie" ? "Игрок сообщил сомнительную информацию." : "Игрок попросил о помощи.", effects) };
  }
  if (action === "offer-money") progressed = updatePersonFunds(progressed, person.id, 25);
  if (action === "threaten") progressed = { ...progressed, social: recordSocialKnowledge(progressed.social, progressed.world.meta.seed, person.id, "player", "Игрок угрожал во время личного разговора.", progressed.timestamp, { subjectId: progressed.player.id, secrecy: 8, confidence: 100 }) };
  if (action === "lie") progressed = { ...progressed, social: recordSocialKnowledge(progressed.social, progressed.world.meta.seed, person.id, "player", "Игрок сообщил сомнительную информацию; её нужно проверить.", progressed.timestamp, { subjectId: progressed.player.id, secrecy: 28, confidence: 55 }) };
  if (action === "offer-money") progressed = { ...progressed, social: recordSocialKnowledge(progressed.social, progressed.world.meta.seed, person.id, "player", "Игрок передал ₵ 25 во время разговора.", progressed.timestamp, { subjectId: progressed.player.id, secrecy: 62, confidence: 100 }) };
  const currentPerson = getPerson(progressed.people, person.id) ?? person;
  const relationTarget = currentPerson.relations.map((link) => getPerson(progressed.people, link.personId)).find(Boolean);
  const result = continueConversationState(progressed.social, progressed.world.meta.seed, currentPerson, action, progressed.timestamp, relationTarget?.name);
  return {
    ...progressed,
    social: result.state,
    primaryContact: toKnownNpc(currentPerson, progressed.world.locations, progressed.timestamp),
    events: action === "threaten" ? [{
      id: `conversation-${progressed.timestamp}-${person.id}`,
      timestamp: progressed.timestamp,
      category: "contact" as const,
      title: `${person.name} запомнил угрозу.`,
      detail: result.response,
      importance: 2 as const
    }, ...progressed.events].slice(0, 100) : progressed.events
  };
}

export function endConversation(session: GameSession): GameSession {
  const personId = session.social.activeConversation?.personId;
  const person = personId ? getPerson(session.people, personId) : null;
  return {
    ...session,
    social: endConversationState(session.social),
    currentActivity: person ? `Закончен разговор: ${person.name}` : session.currentActivity
  };
}
