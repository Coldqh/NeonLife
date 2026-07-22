import type { EntityId } from "../../core/ids/entityId";
import type { WorldMeta } from "../../core/simulation/types";
import type { WorldEvent } from "../../core/events/types";
import type { PlayerState } from "../../gameplay/player/demoPlayer";
import type { KnownNpc } from "../../people/demoNpc";
import type { HumanNetworkState } from "../../people/network/types";
import type { DistrictPulseState } from "../city/districtPulse";
import type { FoodState } from "../../gameplay/food/foodSystem";
import type { HousingState } from "../../gameplay/housing/housingSystem";
import type { CourierState } from "../../gameplay/jobs/courier/courierSystem";
import type { PressureState } from "../../gameplay/pressure/types";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { SituationState } from "../../gameplay/situations/types";

export interface CityState {
  id: EntityId;
  name: string;
  code: string;
  population: number;
  weather: string;
  temperatureC: number;
  networkStatus: "stable" | "degraded" | "offline";
}

export interface DistrictState {
  id: EntityId;
  name: string;
  code: string;
  population: number;
  securityLevel: number;
  costOfLiving: number;
  infrastructure: number;
  pollution: number;
  corporateInfluence: number;
  gangInfluence: number;
  governmentInfluence: number;
  employmentRate: number;
  locationIds: EntityId[];
}

export interface LocationState {
  id: EntityId;
  districtId: EntityId;
  organizationId?: EntityId;
  name: string;
  code: string;
  type: "housing" | "food" | "workshop" | "transport" | "clinic" | "office" | "market" | "government";
  open: boolean;
  security: number;
  openHour?: number;
  closeHour?: number;
}

export interface OrganizationState {
  id: EntityId;
  name: string;
  code: string;
  type: "corporation" | "company" | "government" | "police" | "medical" | "transport" | "gang" | "independent";
  budget: number;
  reputation: number;
  employeeCount: number;
  locationIds: EntityId[];
}

export type ScheduledEventStatus = "queued" | "resolved" | "cancelled";

export interface ScheduledWorldEvent {
  id: EntityId;
  dueAt: number;
  type: "grid-restoration" | "rent-warning" | "patrol-shift";
  status: ScheduledEventStatus;
  entityIds: EntityId[];
  payload: Record<string, string | number | boolean>;
}

export interface WorldState {
  meta: WorldMeta;
  city: CityState;
  districts: DistrictState[];
  locations: LocationState[];
  organizations: OrganizationState[];
  activeDistrictId: EntityId;
  playerId: EntityId;
  primaryContactId: EntityId;
}

export interface LifeState {
  currentLocationId: EntityId;
  housing: HousingState;
  food: FoodState;
  lastSleepAt: number | null;
}

export interface GameSession {
  schemaVersion: number;
  timestamp: number;
  world: WorldState;
  player: PlayerState;
  primaryContact: KnownNpc;
  people: HumanNetworkState;
  pressure: PressureState;
  economy: LocalEconomyState;
  situations: SituationState;
  events: WorldEvent[];
  eventQueue: ScheduledWorldEvent[];
  currentActivity: string;
  district: DistrictPulseState;
  life: LifeState;
  jobs: {
    courier: CourierState;
  };
}
