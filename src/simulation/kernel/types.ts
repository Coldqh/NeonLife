import type { EntityId } from "../../core/ids/entityId";

export type KernelEntityKind =
  | "player"
  | "resident"
  | "household"
  | "business"
  | "organization"
  | "location"
  | "district"
  | "city"
  | "system";

export type KernelResource =
  | "credits"
  | "food-units"
  | "medical-units"
  | "parts-units"
  | "document-units"
  | "mixed-units"
  | "labor-hours"
  | "housing-beds"
  | "transport-capacity"
  | "energy-units"
  | "water-units"
  | "waste-capacity"
  | "data-capacity";

export type KernelAssetKind = "business-operation" | "housing-block" | "facility" | "district-land" | "infrastructure-node" | "infrastructure-link";
export type KernelAssetStatus = "active" | "strained" | "restricted" | "offline";
export type KernelContractKind = "employment" | "lease" | "supply" | "service" | "loan" | "utility";
export type KernelContractStatus = "active" | "suspended" | "breached" | "ended";
export type KernelTransactionReason =
  | "wage"
  | "rent"
  | "food-sale"
  | "medical-service"
  | "transport-service"
  | "discretionary-service"
  | "debt-repayment"
  | "maintenance"
  | "inventory-transfer"
  | "operating-settlement"
  | "player-action"
  | "utility-service"
  | "infrastructure-maintenance"
  | "domain-reconciliation";

export interface KernelResourceBalance {
  resource: KernelResource;
  amount: number;
}

export interface KernelAccountState {
  id: EntityId;
  entityId: EntityId;
  entityKind: KernelEntityKind;
  balances: KernelResourceBalance[];
  updatedAt: number;
}

export interface KernelAssetState {
  id: EntityId;
  kind: KernelAssetKind;
  name: string;
  ownerEntityId: EntityId;
  controllerEntityId: EntityId;
  locationId?: EntityId;
  districtId?: EntityId;
  status: KernelAssetStatus;
  condition: number;
  capacity: number;
  valuation: number;
  resources: KernelResourceBalance[];
  updatedAt: number;
}

export interface KernelOwnershipState {
  id: EntityId;
  assetId: EntityId;
  ownerEntityId: EntityId;
  shareBasisPoints: number;
  acquiredAt: number;
}

export interface KernelContractTerm {
  resource: KernelResource;
  amount: number;
  unitValue: number;
  intervalMinutes: number;
}

export interface KernelContractState {
  id: EntityId;
  kind: KernelContractKind;
  sourceEntityId: EntityId;
  targetEntityId: EntityId;
  beneficiaryEntityId?: EntityId;
  assetId?: EntityId;
  locationId?: EntityId;
  status: KernelContractStatus;
  startedAt: number;
  endedAt?: number;
  nextSettlementAt: number;
  breachCount: number;
  terms: KernelContractTerm[];
  metadata: Record<string, string | number | boolean>;
}

export interface KernelTransactionDraft {
  idempotencyKey: string;
  timestamp: number;
  debitEntityId: EntityId;
  creditEntityId: EntityId;
  resource: KernelResource;
  amount: number;
  unitValue?: number;
  reason: KernelTransactionReason;
  contractId?: EntityId;
  assetId?: EntityId;
  description?: string;
}

export interface KernelTransactionState extends KernelTransactionDraft {
  id: EntityId;
  balanceValue: number;
}

export interface KernelClockState {
  lastAdvancedAt: number;
  minuteIndex: number;
  hourIndex: number;
  dayIndex: number;
  weekIndex: number;
  minutesAdvanced: number;
  hoursAdvanced: number;
  daysAdvanced: number;
  weeksAdvanced: number;
}

export interface KernelIntegrityState {
  healthy: boolean;
  checkedAt: number;
  duplicateIds: number;
  ownershipErrors: number;
  orphanReferences: number;
  negativePhysicalBalances: number;
  reconciliationTransactions: number;
  reconciliationCreditVolume: number;
  warnings: string[];
}

export interface KernelTotalsState {
  transactions: number;
  creditsTransferred: number;
  physicalUnitsTransferred: number;
  reconciliationTransactions: number;
  reconciliationCreditVolume: number;
  contractsCreated: number;
  assetsTracked: number;
}

export interface SimulationKernelState {
  version: 1;
  clock: KernelClockState;
  accounts: KernelAccountState[];
  assets: KernelAssetState[];
  ownership: KernelOwnershipState[];
  contracts: KernelContractState[];
  transactions: KernelTransactionState[];
  totals: KernelTotalsState;
  integrity: KernelIntegrityState;
  lastUpdatedAt: number;
}
