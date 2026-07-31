import type { EntityId } from "../../core/ids/entityId";

export type SocialTemperament = "reserved" | "direct" | "warm" | "cynical" | "nervous" | "aggressive";
export type SocialVoice = "plain" | "blunt" | "formal" | "guarded" | "street" | "tired";
export type KnowledgeSource = "personal" | "witnessed" | "heard" | "official";
export type KnowledgeSubject = "person" | "place" | "incident" | "organization" | "player";
export type ConversationAction = "greet" | "ask-incident" | "ask-place" | "ask-person" | "ask-help" | "offer-money" | "threaten" | "lie" | "end";

export interface ConversationOutcome {
  helpAccepted?: boolean;
  moneyAccepted?: boolean;
  lieBelieved?: boolean;
}

export interface SocialIdentityState {
  personId: EntityId;
  temperament: SocialTemperament;
  voice: SocialVoice;
  ambition: number;
  courage: number;
  greed: number;
  loyalty: number;
  openness: number;
  values: string[];
  fears: string[];
  goals: string[];
}

export interface KnowledgeEntryState {
  id: EntityId;
  holderPersonId: EntityId;
  subject: KnowledgeSubject;
  subjectId?: EntityId;
  summary: string;
  source: KnowledgeSource;
  confidence: number;
  secrecy: number;
  learnedAt: number;
  expiresAt?: number;
}

export interface RumorState {
  id: EntityId;
  originPersonId: EntityId;
  subject: KnowledgeSubject;
  subjectId?: EntityId;
  originalSummary: string;
  currentSummary: string;
  holderPersonIds: EntityId[];
  truth: number;
  distortion: number;
  createdAt: number;
  lastSpreadAt: number;
  expiresAt: number;
}

export interface RelationshipEventState {
  id: EntityId;
  timestamp: number;
  personIds: [EntityId, EntityId];
  type: "argument" | "help" | "loan" | "reconciliation" | "gossip";
  summary: string;
  strengthDelta: number;
}

export interface ConversationLineState {
  id: EntityId;
  speaker: "player" | "npc";
  text: string;
  timestamp: number;
  tone: "neutral" | "warm" | "cold" | "angry" | "afraid";
}

export interface ConversationState {
  personId: EntityId;
  startedAt: number;
  lastTurnAt: number;
  turn: number;
  mood: "open" | "guarded" | "irritated" | "afraid";
  topic?: KnowledgeSubject;
  transcript: ConversationLineState[];
}

export interface SocialState {
  version: 1;
  identities: SocialIdentityState[];
  knowledge: KnowledgeEntryState[];
  rumors: RumorState[];
  relationshipEvents: RelationshipEventState[];
  activeConversation?: ConversationState;
  lastCycle: number;
  lastUpdatedAt: number;
}

export interface SocialNotice {
  personId?: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}
