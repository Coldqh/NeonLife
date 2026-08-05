export type PlayerSkill = "service" | "technical" | "medical" | "strength" | "endurance" | "boxing" | "shooting" | "streetwise";
export type EquipmentSlot = "outfit" | "armor" | "weapon" | "implant";
export type WeaponClass = "unarmed" | "melee" | "firearm";

export interface PlayerSkillsState {
  service: number;
  technical: number;
  medical: number;
  strength: number;
  endurance: number;
  boxing: number;
  shooting: number;
  streetwise: number;
}

export interface SimpleJobDefinition {
  id: string;
  title: string;
  description: string;
  skill: PlayerSkill;
  minimumSkill: number;
  basePay: number;
  durationMinutes: number;
  fatigue: number;
  stress: number;
  risk: number;
}

export interface TrainingDefinition {
  id: string;
  title: string;
  description: string;
  skill: PlayerSkill;
  cost: number;
  durationMinutes: number;
  fatigue: number;
  injuryRisk: number;
  gainMin: number;
  gainMax: number;
}

export interface EquipmentDefinition {
  id: string;
  name: string;
  description: string;
  slot: EquipmentSlot;
  price: number;
  attack: number;
  defense: number;
  accuracy: number;
  intimidation: number;
  weaponClass?: WeaponClass;
  requiredSkill?: PlayerSkill;
  minimumSkill?: number;
}

export interface StreetFightDefinition {
  id: string;
  title: string;
  description: string;
  opponentPower: number;
  opponentDefense: number;
  opponentHealth: number;
  reward: number;
  durationMinutes: number;
  weaponRule: "unarmed" | "melee" | "any";
  minimumStreetwise: number;
}

export interface PlayerLoopHistoryEntry {
  id: string;
  timestamp: number;
  category: "work" | "training" | "equipment" | "fight" | "boxing";
  title: string;
  detail: string;
  moneyDelta: number;
}

export interface PlayerLoopState {
  version: 1;
  skills: PlayerSkillsState;
  activeJobId: string | null;
  shiftsWorked: number;
  totalEarned: number;
  ownedEquipmentIds: string[];
  equipped: Partial<Record<EquipmentSlot, string>>;
  streetFightWins: number;
  streetFightLosses: number;
  boxingWins: number;
  boxingLosses: number;
  boxingRating: number;
  boxingRank: number;
  lastFightAt: number | null;
  history: PlayerLoopHistoryEntry[];
}

export type PlayerLoopAction =
  | { kind: "select-job"; jobId: string }
  | { kind: "leave-job" }
  | { kind: "work-shift" }
  | { kind: "train"; trainingId: string }
  | { kind: "buy-equipment"; itemId: string }
  | { kind: "equip-item"; itemId: string }
  | { kind: "unequip-item"; slot: EquipmentSlot }
  | { kind: "street-fight"; fightId: string }
  | { kind: "boxing-fight" };

export interface PlayerLoopActionInput {
  seed: string;
  timestamp: number;
  balance: number;
  health: number;
  fatigue: number;
  stress: number;
}

export interface PlayerLoopActionResult {
  state: PlayerLoopState;
  ok: boolean;
  message: string;
  title: string;
  detail: string;
  elapsedMinutes: number;
  balanceDelta: number;
  healthDelta: number;
  fatigueDelta: number;
  stressDelta: number;
  importance: 1 | 2 | 3;
}
