export type PlayerSkill = "service" | "technical" | "medical" | "strength" | "endurance" | "boxing" | "shooting" | "streetwise";
export type EquipmentSlot = "outfit" | "armor" | "weapon" | "implant";
export type WeaponClass = "unarmed" | "melee" | "firearm";
export type EmploymentVenueCategory = "convenience" | "food" | "bar" | "pharmacy" | "clinic" | "repair" | "cyberware" | "clothing" | "entertainment" | "hotel" | "office-service" | "market" | "gym" | "boxing-gym" | "shooting-range" | "weapon-shop";

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
  venueCategories: EmploymentVenueCategory[];
}

export interface PlayerEmploymentState {
  jobId: string;
  venueId: string;
  employerName: string;
  managerPersonId?: string;
  hiredAt: number;
  shiftsWorked: number;
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
  venueCategories: Array<"gym" | "boxing-gym" | "shooting-range">;
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

export interface PlayerLoopHistoryEntry {
  id: string;
  timestamp: number;
  category: "work" | "training" | "equipment" | "fight" | "boxing";
  title: string;
  detail: string;
  moneyDelta: number;
  locationId?: string;
  locationName?: string;
  personId?: string;
}

export interface PlayerBiographyEntry {
  id: string;
  timestamp: number;
  category: "employment" | "combat" | "boxing" | "milestone";
  title: string;
  detail: string;
  locationId?: string;
  locationName?: string;
  personId?: string;
}

export interface PlayerLoopState {
  version: 2;
  skills: PlayerSkillsState;
  employment: PlayerEmploymentState | null;
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
  biography: PlayerBiographyEntry[];
}

export type PlayerLoopAction =
  | { kind: "select-job"; jobId: string; venueId: string; employerName: string; managerPersonId?: string }
  | { kind: "leave-job" }
  | { kind: "work-shift"; venueId: string }
  | { kind: "train"; trainingId: string; venueId: string }
  | { kind: "equip-item"; itemId: string }
  | { kind: "unequip-item"; slot: EquipmentSlot }
  | { kind: "boxing-fight"; venueId: string };

export interface PlayerLoopActionInput {
  seed: string;
  timestamp: number;
  balance: number;
  health: number;
  fatigue: number;
  stress: number;
  locationId?: string;
  locationName?: string;
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
