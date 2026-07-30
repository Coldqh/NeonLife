import type { EntityId } from "../../core/ids/entityId";
import type { LocalEconomyState, SupplyClass } from "../../gameplay/economy/types";
import type { PlayerWorkState } from "../../gameplay/jobs/work/types";
import type { KernelTransactionDraft, SimulationKernelState } from "../kernel/types";
import type { PopulationState, ShiftType } from "../population/types";
import type { UrbanFabricState, VenueCategory, VenueOperatingStatus } from "../urban/types";
import type { LocationState, OrganizationState } from "../../world/state/types";

export type WorldCoreBusinessSource = "legacy" | "venue" | "merged" | "institution";
export type WorldCoreBusinessStatus = VenueOperatingStatus | "restricted" | "strained";
export type WorldCoreEmploymentStatus = "active" | "suspended" | "breached" | "ended";

export interface WorldCoreBusinessState {
  id: EntityId;
  source: WorldCoreBusinessSource;
  aliases: EntityId[];
  legacyBusinessId?: EntityId;
  venueId?: EntityId;
  locationId?: EntityId;
  districtId: EntityId;
  buildingId?: EntityId;
  unitId?: EntityId;
  ownerEntityId: EntityId;
  operatorEntityId: EntityId;
  name: string;
  category: VenueCategory | "logistics" | "corporate" | "education" | "government" | "transport";
  supplyClass: SupplyClass;
  status: WorldCoreBusinessStatus;
  cash: number;
  legacyCashObserved?: number;
  venueCashObserved?: number;
  stockPercent: number;
  stockUnits: number;
  targetStaff: number;
  activeWorkers: number;
  lastUpdatedAt: number;
}

export interface WorldCoreEmploymentState {
  id: EntityId;
  residentId: EntityId;
  businessId: EntityId;
  sourceEmploymentId?: EntityId;
  sourcePlayerContractId?: EntityId;
  role: string;
  status: WorldCoreEmploymentStatus;
  wagePerDay: number;
  shift: ShiftType;
  startedAt: number;
  playerControlled: boolean;
  lastUpdatedAt: number;
}

export interface WorldCoreClockState {
  timestamp: number;
  minuteIndex: number;
  hourIndex: number;
  dayIndex: number;
  weekIndex: number;
  revision: number;
}

export interface WorldCoreIntegrityState {
  healthy: boolean;
  checkedAt: number;
  duplicateAliases: number;
  orphanBusinesses: number;
  orphanEmployments: number;
  accountDrift: number;
  clockDrift: number;
  legacyVenueCashDrift: number;
  warnings: string[];
}

export interface WorldCoreState {
  version: 1;
  businesses: WorldCoreBusinessState[];
  employments: WorldCoreEmploymentState[];
  aliasToBusinessId: Record<EntityId, EntityId>;
  clock: WorldCoreClockState;
  integrity: WorldCoreIntegrityState;
  lastUpdatedAt: number;
}

export interface WorldCoreInput {
  seed: string;
  timestamp: number;
  playerId: EntityId;
  locations: LocationState[];
  organizations: OrganizationState[];
  economy: LocalEconomyState;
  population: PopulationState;
  urban: UrbanFabricState;
  work: PlayerWorkState;
  kernel?: SimulationKernelState;
  previous?: WorldCoreState;
}

export interface WorldCoreProjectionResult {
  state: WorldCoreState;
  economy: LocalEconomyState;
  population: PopulationState;
  urban: UrbanFabricState;
  work: PlayerWorkState;
}

export interface WorldCoreKernelBridgeResult {
  state: WorldCoreState;
  drafts: KernelTransactionDraft[];
}
