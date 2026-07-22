import type { EntityId } from "../../core/ids/entityId";
import type { FoodState } from "../../gameplay/food/foodSystem";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import type { KernelTransactionDraft } from "../kernel/types";

export type ProductionResource =
  | "biomass-feedstock"
  | "chemical-feedstock"
  | "alloy-feedstock"
  | "electronic-components"
  | "data-substrate"
  | "packaging-units"
  | "food-units"
  | "medical-units"
  | "parts-units"
  | "document-units"
  | "mixed-units";

export type ProductionFacilityKind =
  | "import-terminal"
  | "processor"
  | "factory"
  | "warehouse"
  | "distribution-hub"
  | "black-market";

export type ProductionFacilityStatus = "stable" | "strained" | "restricted" | "offline";
export type ProductionContractStatus = "active" | "strained" | "breached" | "suspended";
export type ShipmentStatus = "queued" | "in-transit" | "delivered" | "lost" | "cancelled";
export type ShipmentLegality = "licensed" | "restricted" | "unregistered";
export type ProductionTargetKind = "facility" | "business";

export interface ProductionInventoryItem {
  resource: ProductionResource;
  amount: number;
}

export interface ProductionRecipeInput {
  resource: ProductionResource;
  amount: number;
}

export interface ProductionRecipeState {
  id: EntityId;
  name: string;
  facilityKind: "processor" | "factory";
  inputs: ProductionRecipeInput[];
  outputs: ProductionRecipeInput[];
  batchHours: number;
  laborHours: number;
  powerUnits: number;
  waterUnits: number;
  dataUnits: number;
  wasteUnits: number;
  operatingCost: number;
  legality: ShipmentLegality;
}

export interface ProductionFacilityState {
  id: EntityId;
  name: string;
  kind: ProductionFacilityKind;
  districtId: EntityId;
  locationId: EntityId;
  ownerEntityId: EntityId;
  status: ProductionFacilityStatus;
  condition: number;
  capacityLevel: number;
  staffing: number;
  infrastructureLevel: number;
  cash: number;
  inventory: ProductionInventoryItem[];
  recipeIds: EntityId[];
  batchProgressHours: number;
  productionBacklog: number;
  shortageHours: number;
  throughputToday: number;
  operatingCostToday: number;
  lossesToday: number;
  lastSettlementDay: number;
  lastUpdatedAt: number;
}

export interface ProductionSupplyContract {
  id: EntityId;
  sourceFacilityId: EntityId;
  targetKind: ProductionTargetKind;
  targetFacilityId?: EntityId;
  targetBusinessId?: EntityId;
  resource: ProductionResource;
  reorderPoint: number;
  targetStock: number;
  batchSize: number;
  unitPrice: number;
  legality: ShipmentLegality;
  status: ProductionContractStatus;
  breachCount: number;
  lastOrderedAt?: number;
  lastDeliveredAt?: number;
  nextReviewAt: number;
}

export interface ProductionShipmentState {
  id: EntityId;
  contractId?: EntityId;
  sourceFacilityId: EntityId;
  targetKind: ProductionTargetKind;
  targetFacilityId?: EntityId;
  targetBusinessId?: EntityId;
  resource: ProductionResource;
  units: number;
  unitPrice: number;
  status: ShipmentStatus;
  legality: ShipmentLegality;
  createdAt: number;
  departedAt?: number;
  estimatedArrivalAt: number;
  deliveredAt?: number;
  condition: number;
  delayHours: number;
  transportCapacityUsed: number;
  routeDistrictIds: EntityId[];
}

export interface ProductionTotals {
  importedUnits: number;
  producedUnits: number;
  deliveredUnits: number;
  lostUnits: number;
  legalWholesaleRevenue: number;
  blackMarketRevenue: number;
  importCosts: number;
  productionCosts: number;
  shipmentsCreated: number;
  shipmentsDelivered: number;
  contractBreaches: number;
}

export interface ProductionState {
  version: 1;
  recipes: ProductionRecipeState[];
  facilities: ProductionFacilityState[];
  contracts: ProductionSupplyContract[];
  shipments: ProductionShipmentState[];
  totals: ProductionTotals;
  cycleIndex: number;
  dayIndex: number;
  simulatedCycles: number;
  lastUpdatedAt: number;
}

export interface ProductionNotice {
  districtId?: EntityId;
  locationId?: EntityId;
  title: string;
  detail: string;
  importance: 1 | 2 | 3;
}

export interface ProductionOrganizationBudgetDelta {
  organizationId: EntityId;
  delta: number;
}

export interface ProductionAdvanceResult {
  state: ProductionState;
  economy: LocalEconomyState;
  food: FoodState;
  notices: ProductionNotice[];
  organizationBudgetDeltas: ProductionOrganizationBudgetDelta[];
  transactions: KernelTransactionDraft[];
}
