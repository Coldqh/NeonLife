import type { EntityId } from "../../core/ids/entityId";
import type { KernelTransactionDraft } from "../kernel/types";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { PopulationState } from "../population/types";

export type InfrastructureKind = "power" | "water" | "data" | "transport" | "waste";
export type InfrastructureStatus = "stable" | "strained" | "restricted" | "offline";
export type InfrastructureNodeRole = "source" | "district-hub";
export type InfrastructureTargetKind = "node" | "link";
export type MaintenanceStatus = "open" | "in-progress" | "completed" | "deferred";
export type IncidentStatus = "active" | "resolved";

export interface InfrastructureNetworkState {
  id: EntityId;
  kind: InfrastructureKind;
  providerEntityId: EntityId;
  reserveFund: number;
  tariffPerUnit: number;
  status: InfrastructureStatus;
  totalCapacity: number;
  totalDemand: number;
  totalDelivered: number;
  unmetDemand: number;
  averageServiceLevel: number;
  outageHours: number;
  lastUpdatedAt: number;
}

export interface InfrastructureNodeState {
  id: EntityId;
  networkId: EntityId;
  kind: InfrastructureKind;
  role: InfrastructureNodeRole;
  name: string;
  providerEntityId: EntityId;
  districtId?: EntityId;
  capacity: number;
  throughput: number;
  condition: number;
  load: number;
  staffing: number;
  maintenanceBacklog: number;
  status: InfrastructureStatus;
  lastMaintainedAt: number;
  lastUpdatedAt: number;
}

export interface InfrastructureLinkState {
  id: EntityId;
  networkId: EntityId;
  kind: InfrastructureKind;
  sourceNodeId: EntityId;
  targetNodeId: EntityId;
  districtId: EntityId;
  capacity: number;
  throughput: number;
  condition: number;
  lossRate: number;
  status: InfrastructureStatus;
  lastUpdatedAt: number;
}

export interface InfrastructureServiceState {
  id: EntityId;
  networkId: EntityId;
  kind: InfrastructureKind;
  districtId: EntityId;
  locationId: EntityId;
  baseDemand: number;
  currentDemand: number;
  supplied: number;
  serviceLevel: number;
  priority: number;
  status: InfrastructureStatus;
  consecutiveDeficitHours: number;
  lastUpdatedAt: number;
}

export interface InfrastructureMaintenanceOrder {
  id: EntityId;
  networkId: EntityId;
  kind: InfrastructureKind;
  targetKind: InfrastructureTargetKind;
  targetId: EntityId;
  providerEntityId: EntityId;
  status: MaintenanceStatus;
  createdAt: number;
  dueAt: number;
  startedAt?: number;
  completedAt?: number;
  creditsCost: number;
  partsCost: number;
  laborHours: number;
  completedLaborHours: number;
  conditionRestored: number;
}

export interface InfrastructureIncident {
  id: EntityId;
  networkId: EntityId;
  kind: InfrastructureKind;
  districtId?: EntityId;
  targetId: EntityId;
  status: IncidentStatus;
  startedAt: number;
  resolvedAt?: number;
  severity: 1 | 2 | 3;
  cause: "overload" | "wear" | "staffing" | "maintenance-delay";
  serviceLoss: number;
}

export interface InfrastructureTotals {
  generatedUnits: number;
  deliveredUnits: number;
  unmetUnits: number;
  serviceRevenue: number;
  maintenanceSpent: number;
  maintenanceCompleted: number;
  incidents: number;
  outageHours: number;
}

export interface InfrastructureState {
  version: 1;
  networks: InfrastructureNetworkState[];
  nodes: InfrastructureNodeState[];
  links: InfrastructureLinkState[];
  services: InfrastructureServiceState[];
  maintenance: InfrastructureMaintenanceOrder[];
  incidents: InfrastructureIncident[];
  totals: InfrastructureTotals;
  hourIndex: number;
  dayIndex: number;
  simulatedHours: number;
  lastUpdatedAt: number;
}

export interface InfrastructureNotice {
  districtId?: EntityId;
  locationId?: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface InfrastructureBudgetDelta {
  organizationId: EntityId;
  delta: number;
}

export interface InfrastructureAdvanceResult {
  state: InfrastructureState;
  economy: LocalEconomyState;
  population: PopulationState;
  notices: InfrastructureNotice[];
  organizationBudgetDeltas: InfrastructureBudgetDelta[];
  transactions: KernelTransactionDraft[];
}
