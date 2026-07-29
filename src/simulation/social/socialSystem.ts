import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import type { HumanNetworkState, PersonMemory, PersonState } from "../../people/network/types";
import type { LocalSceneState } from "../localScene/types";
import type { StreetSceneState } from "../streetScene/types";
import type { LocationState } from "../../world/state/types";
import type {
  ConversationAction,
  ConversationLineState,
  ConversationState,
  KnowledgeEntryState,
  RelationshipEventState,
  RumorState,
  SocialIdentityState,
  SocialNotice,
  SocialState,
  SocialTemperament,
  SocialVoice
} from "./types";

const CYCLE_MS = 6 * 60 * 60_000;
const TEMPERAMENTS: SocialTemperament[] = ["reserved", "direct", "warm", "cynical", "nervous", "aggressive"];
const VOICES: SocialVoice[] = ["plain", "blunt", "formal", "guarded", "street", "tired"];
const VALUES = ["семья", "деньги", "порядок", "свобода", "работа", "репутация", "выживание", "лояльность"];
const FEARS = ["потерять жильё", "остаться без работы", "полиция", "банды", "болезнь", "долги", "огласка", "одиночество"];
const GOALS = ["закрыть долги", "сменить район", "сохранить работу", "помочь семье", "накопить на лечение", "уйти из города", "получить повышение", "открыть своё дело"];

function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }

function identityFor(seed: string, person: PersonState): SocialIdentityState {
  const rng = new SeededRandom(`${seed}:social-identity:${person.id}`);
  return {
    personId: person.id,
    temperament: rng.pick(TEMPERAMENTS),
    voice: rng.pick(VOICES),
    ambition: rng.integer(15, 90), courage: rng.integer(10, 88), greed: rng.integer(5, 92), loyalty: rng.integer(10, 95), openness: rng.integer(8, 86),
    values: [rng.pick(VALUES), rng.pick(VALUES)].filter((value, index, all) => all.indexOf(value) === index),
    fears: [rng.pick(FEARS), rng.pick(FEARS)].filter((value, index, all) => all.indexOf(value) === index),
    goals: [rng.pick(GOALS)]
  };
}

function personalKnowledge(seed: string, person: PersonState, locations: LocationState[], timestamp: number): KnowledgeEntryState[] {
  const home = locations.find((item) => item.id === person.homeLocationId)?.name;
  const work = locations.find((item) => item.id === person.workLocationId)?.name;
  const entries = [
    ...person.knownFacts.map((summary, index) => ({ subject: "person" as const, subjectId: person.id, summary, source: "personal" as const, secrecy: index === 0 ? 10 : 25 })),
    ...(home ? [{ subject: "place" as const, subjectId: person.homeLocationId, summary: `Живёт: ${home}.`, source: "personal" as const, secrecy: 60 }] : []),
    ...(work ? [{ subject: "place" as const, subjectId: person.workLocationId, summary: `Работает: ${work}.`, source: "personal" as const, secrecy: 18 }] : [])
  ];
  return entries.map((entry, index) => ({
    id: createStableEntityId("knowledge", `${seed}:${person.id}:initial:${index}:${entry.summary}`), holderPersonId: person.id,
    subject: entry.subject, subjectId: entry.subjectId, summary: entry.summary, source: entry.source,
    confidence: 100, secrecy: entry.secrecy, learnedAt: timestamp
  }));
}

export function createSocialState(seed: string, timestamp: number, people: HumanNetworkState, locations: LocationState[]): SocialState {
  const relationKnowledge = people.people.flatMap((person) => person.relations.flatMap((link, index) => {
    const related = people.people.find((item) => item.id === link.personId);
    if (!related) return [];
    return [{
      id: createStableEntityId("knowledge", `${seed}:${person.id}:relation:${related.id}:${index}`),
      holderPersonId: person.id,
      subject: "person" as const,
      subjectId: related.id,
      summary: `${related.name} — ${link.kind}; связь ${link.strength}%.`,
      source: "personal" as const,
      confidence: 100,
      secrecy: link.kind === "family" ? 48 : link.kind === "rival" ? 22 : 30,
      learnedAt: timestamp
    }];
  }));
  return {
    version: 1,
    identities: people.people.map((person) => identityFor(seed, person)),
    knowledge: [...people.people.flatMap((person) => personalKnowledge(seed, person, locations, timestamp)), ...relationKnowledge],
    rumors: [], relationshipEvents: [], lastCycle: Math.floor(timestamp / CYCLE_MS), lastUpdatedAt: timestamp
  };
}

export function normalizeSocialState(value: unknown, seed: string, timestamp: number, people: HumanNetworkState, locations: LocationState[]): SocialState {
  const fresh = createSocialState(seed, timestamp, people, locations);
  if (!value || typeof value !== "object") return fresh;
  const raw = value as Partial<SocialState>;
  if (raw.version !== 1) return fresh;
  const knownIds = new Set(people.people.map((person) => person.id));
  const identities = Array.isArray(raw.identities) ? raw.identities.filter((item) => item && knownIds.has(item.personId)) : [];
  const identityIds = new Set(identities.map((item) => item.personId));
  return {
    version: 1,
    identities: [...identities, ...fresh.identities.filter((item) => !identityIds.has(item.personId))],
    knowledge: Array.isArray(raw.knowledge) ? raw.knowledge.filter((item) => item && knownIds.has(item.holderPersonId)) : fresh.knowledge,
    rumors: Array.isArray(raw.rumors) ? raw.rumors : [],
    relationshipEvents: Array.isArray(raw.relationshipEvents) ? raw.relationshipEvents : [],
    activeConversation: raw.activeConversation && knownIds.has(raw.activeConversation.personId) ? raw.activeConversation : undefined,
    lastCycle: typeof raw.lastCycle === "number" ? raw.lastCycle : Math.floor(timestamp / CYCLE_MS),
    lastUpdatedAt: timestamp
  };
}

function addKnowledge(state: SocialState, entry: KnowledgeEntryState): SocialState {
  if (state.knowledge.some((item) => item.id === entry.id || (item.holderPersonId === entry.holderPersonId && item.summary === entry.summary))) return state;
  return { ...state, knowledge: [entry, ...state.knowledge].slice(0, 360) };
}

export function recordSocialKnowledge(state: SocialState, seed: string, holderPersonId: string, subject: KnowledgeEntryState["subject"], summary: string, timestamp: number, options: { subjectId?: string; source?: KnowledgeEntryState["source"]; confidence?: number; secrecy?: number } = {}): SocialState {
  return addKnowledge(state, {
    id: createStableEntityId("knowledge", `${seed}:${holderPersonId}:${subject}:${options.subjectId ?? "none"}:${timestamp}:${summary}`),
    holderPersonId,
    subject,
    subjectId: options.subjectId,
    summary,
    source: options.source ?? "witnessed",
    confidence: clamp(options.confidence ?? 90),
    secrecy: clamp(options.secrecy ?? 25),
    learnedAt: timestamp
  });
}

function incidentKnowledge(state: SocialState, seed: string, timestamp: number, localScene: LocalSceneState, streetScene: StreetSceneState): SocialState {
  let next = state;
  for (const incident of streetScene.incidents.filter((item) => item.status !== "resolved")) {
    for (const actorId of incident.participantActorIds) {
      const actor = localScene.actors.find((item) => item.id === actorId);
      if (!actor?.activePersonId) continue;
      next = addKnowledge(next, {
        id: createStableEntityId("knowledge", `${seed}:${actor.activePersonId}:incident:${incident.id}`),
        holderPersonId: actor.activePersonId, subject: "incident", subjectId: incident.id,
        summary: `${incident.title}: ${incident.detail}`, source: "witnessed", confidence: 95, secrecy: 20, learnedAt: timestamp,
        expiresAt: timestamp + 3 * 24 * 60 * 60_000
      });
    }
  }
  return next;
}

function relationUpdate(person: PersonState, otherId: string, delta: number): PersonState {
  return { ...person, relations: person.relations.map((link) => link.personId === otherId ? { ...link, strength: clamp(link.strength + delta) } : link) };
}

function memoryFor(seed: string, person: PersonState, timestamp: number, summary: string, emotionalValue: number): PersonMemory {
  return { id: createStableEntityId("memory", `${seed}:${person.id}:${timestamp}:${summary}`), timestamp, type: "personal", summary, importance: 45, emotionalValue, confidence: 100 };
}

export function advanceSocialState(current: SocialState | undefined, input: {
  seed: string; timestamp: number; people: HumanNetworkState; locations: LocationState[]; localScene: LocalSceneState; streetScene: StreetSceneState;
}): { state: SocialState; people: HumanNetworkState; notices: SocialNotice[] } {
  let state = normalizeSocialState(current, input.seed, input.timestamp, input.people, input.locations);
  state = incidentKnowledge(state, input.seed, input.timestamp, input.localScene, input.streetScene);
  let people = input.people;
  const notices: SocialNotice[] = [];
  const targetCycle = Math.floor(input.timestamp / CYCLE_MS);
  for (let cycle = state.lastCycle + 1; cycle <= Math.min(targetCycle, state.lastCycle + 12); cycle += 1) {
    const rng = new SeededRandom(`${input.seed}:social-cycle:${cycle}`);
    const candidates = people.people.filter((person) => person.relations.length && (person.lifeStatus ?? "alive") === "alive");
    if (!candidates.length) break;
    const source = rng.pick(candidates);
    const relation = rng.pick(source.relations);
    const target = people.people.find((item) => item.id === relation.personId);
    if (!target) continue;
    const types: RelationshipEventState["type"][] = ["argument", "help", "loan", "reconciliation", "gossip"];
    const type = rng.pick(types);
    const delta = type === "argument" ? -rng.integer(4, 11) : type === "gossip" ? -rng.integer(1, 5) : rng.integer(2, 8);
    const summary = type === "argument" ? `${source.name} и ${target.name} поссорились.` : type === "help" ? `${source.name} помог ${target.name}.` : type === "loan" ? `${source.name} одолжил деньги ${target.name}.` : type === "reconciliation" ? `${source.name} и ${target.name} помирились.` : `${source.name} передал слух ${target.name}.`;
    const event: RelationshipEventState = { id: createStableEntityId("relationship-event", `${input.seed}:${cycle}:${source.id}:${target.id}:${type}`), timestamp: cycle * CYCLE_MS, personIds: [source.id, target.id], type, summary, strengthDelta: delta };
    people = { ...people, people: people.people.map((person) => person.id === source.id ? { ...relationUpdate(person, target.id, delta), memories: [memoryFor(input.seed, person, event.timestamp, summary, delta), ...person.memories].slice(0, 24) } : person.id === target.id ? relationUpdate(person, source.id, delta) : person) };
    state = { ...state, relationshipEvents: [event, ...state.relationshipEvents].slice(0, 80) };
    if (type === "gossip") {
      const sourceKnowledge = state.knowledge.filter((item) => item.holderPersonId === source.id && item.secrecy < 70);
      if (sourceKnowledge.length) {
        const knowledge = rng.pick(sourceKnowledge);
        const distorted = rng.chance(.35) ? `${knowledge.summary.replace(/\.$/, "")}, но детали расходятся.` : knowledge.summary;
        const rumorId = createStableEntityId("rumor", `${input.seed}:${cycle}:${knowledge.id}`);
        const rumor: RumorState = { id: rumorId, originPersonId: source.id, subject: knowledge.subject, subjectId: knowledge.subjectId, originalSummary: knowledge.summary, currentSummary: distorted, holderPersonIds: [source.id, target.id], truth: knowledge.confidence, distortion: distorted === knowledge.summary ? 0 : 22, createdAt: event.timestamp, lastSpreadAt: event.timestamp, expiresAt: event.timestamp + 5 * 24 * 60 * 60_000 };
        state = addKnowledge({ ...state, rumors: [rumor, ...state.rumors.filter((item) => item.id !== rumor.id)].slice(0, 60) }, { ...knowledge, id: createStableEntityId("knowledge", `${rumorId}:${target.id}`), holderPersonId: target.id, source: "heard", summary: distorted, confidence: clamp(knowledge.confidence - rumor.distortion), learnedAt: event.timestamp });
      }
    }
    if (Math.abs(delta) >= 7) notices.push({ title: type === "argument" ? "Конфликт между знакомыми" : "Отношения изменились", detail: summary, importance: type === "argument" ? 2 : 1 });
  }
  const conversation = state.activeConversation;
  if (conversation) {
    const actor = input.localScene.actors.find((item) => item.activePersonId === conversation.personId);
    if (!actor?.visible || !actor.interactable) state = { ...state, activeConversation: undefined };
  }
  return { state: { ...state, lastCycle: targetCycle, lastUpdatedAt: input.timestamp }, people, notices };
}

function line(seed: string, conversation: ConversationState, speaker: "player" | "npc", text: string, timestamp: number, tone: ConversationLineState["tone"]): ConversationLineState {
  return { id: createStableEntityId("conversation-line", `${seed}:${conversation.personId}:${conversation.turn}:${speaker}:${text}`), speaker, text, timestamp, tone };
}

export function beginConversationState(state: SocialState, seed: string, person: PersonState, timestamp: number): SocialState {
  const identity = state.identities.find((item) => item.personId === person.id);
  const greeting = identity?.voice === "formal" ? "Слушаю." : identity?.voice === "street" ? "Чего надо?" : identity?.voice === "tired" ? "Давай быстро." : identity?.temperament === "warm" ? "Привет. Что случилось?" : "Да?";
  const conversation: ConversationState = { personId: person.id, startedAt: timestamp, lastTurnAt: timestamp, turn: 1, mood: person.irritationToPlayer >= 55 ? "irritated" : person.trustToPlayer >= 45 ? "open" : "guarded", transcript: [] };
  return { ...state, activeConversation: { ...conversation, transcript: [line(seed, conversation, "npc", greeting, timestamp, conversation.mood === "irritated" ? "angry" : "neutral")] } };
}

function npcReply(identity: SocialIdentityState, person: PersonState, action: ConversationAction, knowledge: KnowledgeEntryState | undefined, subjectName?: string): { text: string; tone: ConversationLineState["tone"] } {
  if (action === "ask-incident") return knowledge ? { text: knowledge.summary, tone: identity.temperament === "nervous" ? "afraid" : "neutral" } : { text: identity.voice === "blunt" ? "Не видел." : "Я об этом ничего не знаю.", tone: "neutral" };
  if (action === "ask-place") return knowledge ? { text: knowledge.summary, tone: "neutral" } : { text: "Не знаю, что там сейчас происходит.", tone: "neutral" };
  if (action === "ask-person") return knowledge ? { text: knowledge.summary, tone: "neutral" } : { text: `${subjectName ?? "Этот человек"} мне не знаком.`, tone: "neutral" };
  if (action === "ask-help") return person.trustToPlayer >= 35 ? { text: "Скажи конкретно, что нужно. Если смогу — помогу.", tone: "warm" } : { text: "Мы недостаточно знакомы.", tone: "cold" };
  if (action === "offer-money") return identity.greed >= 45 || person.problem.severity >= 60 ? { text: "Ладно. Это пригодится.", tone: "warm" } : { text: "Оставь себе.", tone: "neutral" };
  if (action === "threaten") return identity.courage >= 55 ? { text: "Ещё раз так скажешь — разговор закончится плохо.", tone: "angry" } : { text: "Понял. Только отойди.", tone: "afraid" };
  if (action === "lie") return identity.openness >= 50 ? { text: "Допустим. Я проверю.", tone: "neutral" } : { text: "Не верю.", tone: "cold" };
  return { text: "Говори.", tone: "neutral" };
}

export function continueConversationState(state: SocialState, seed: string, person: PersonState, action: ConversationAction, timestamp: number, subjectName?: string): { state: SocialState; response: string } {
  const conversation = state.activeConversation;
  if (!conversation || conversation.personId !== person.id || action === "end") return { state: { ...state, activeConversation: undefined }, response: "Разговор закончен." };
  const identity = state.identities.find((item) => item.personId === person.id) ?? identityFor(seed, person);
  const disclosure = clamp(person.trustToPlayer + identity.openness * .45 - person.irritationToPlayer * .55);
  const shareable = state.knowledge.filter((item) => item.holderPersonId === person.id && item.secrecy <= disclosure && (!item.expiresAt || item.expiresAt > timestamp));
  const knowledge = action === "ask-incident" ? shareable.find((item) => item.subject === "incident") : action === "ask-place" ? shareable.find((item) => item.subject === "place") : action === "ask-person" ? shareable.find((item) => item.subject === "person" && item.subjectId !== person.id) : undefined;
  const playerText: Record<ConversationAction, string> = { greet: "Привет.", "ask-incident": "Что ты знаешь о происшествиях рядом?", "ask-place": "Что знаешь об этом месте?", "ask-person": `Что знаешь о ${subjectName ?? "людях здесь"}?`, "ask-help": "Мне нужна помощь.", "offer-money": "Возьми деньги.", threaten: "Лучше отвечай.", lie: "Мне сказали, что всё уже решено.", end: "Пока." };
  const reply = npcReply(identity, person, action, knowledge, subjectName);
  const nextConversation: ConversationState = { ...conversation, turn: conversation.turn + 1, lastTurnAt: timestamp, topic: action === "ask-incident" ? "incident" : action === "ask-place" ? "place" : action === "ask-person" ? "person" : conversation.topic, mood: action === "threaten" ? (identity.courage >= 55 ? "irritated" : "afraid") : conversation.mood };
  nextConversation.transcript = [...conversation.transcript, line(seed, nextConversation, "player", playerText[action], timestamp, "neutral"), line(seed, nextConversation, "npc", reply.text, timestamp, reply.tone)].slice(-18);
  return { state: { ...state, activeConversation: nextConversation }, response: reply.text };
}

export function endConversationState(state: SocialState): SocialState { return { ...state, activeConversation: undefined }; }
