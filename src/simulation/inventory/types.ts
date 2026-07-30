import type { EntityId } from "../../core/ids/entityId";
import type { FoodState } from "../../gameplay/food/foodSystem";
import type { PopulationState } from "../population/types";
import type { ProductionState } from "../production/types";
import type { UrbanFabricState } from "../urban/types";
import type { WorldCoreState } from "../worldCore/types";

export type InventoryOwnerKind = "player" | "household" | "business" | "facility" | "vehicle" | "building-unit" | "shipment";
export type InventoryStackStatus = "available" | "reserved" | "expired" | "recalled" | "destroyed";
export type ProductBatchOrigin = "production" | "import" | "migration" | "purchase" | "transfer" | "reconciliation";
export type ProductTransferReason = "production-output" | "shipment" | "wholesale" | "retail-sale" | "household-purchase" | "player-purchase" | "storage" | "consumption" | "reconciliation";

export interface ProductBatchState {
  id: EntityId;
  productId: string;
  lotCode: string;
  producerEntityId: EntityId;
  origin: ProductBatchOrigin;
  quantityProduced: number;
  quantityRemaining: number;
  quality: number;
  condition: number;
  manufacturedAt: number;
  expiresAt?: number;
  sourceRecipeId?: EntityId;
  legal: boolean;
  recalled: boolean;
  recallReason?: string;
}

export interface InventoryStackState {
  id: EntityId;
  inventoryId: EntityId;
  productId: string;
  batchId: EntityId;
  quantity: number;
  reservedQuantity: number;
  unitCost: number;
  quality: number;
  condition: number;
  acquiredAt: number;
  expiresAt?: number;
  status: InventoryStackStatus;
}

export interface InventoryState {
  id: EntityId;
  ownerEntityId: EntityId;
  ownerKind: InventoryOwnerKind;
  compartment: string;
  locationId?: EntityId;
  capacityMassGrams?: number;
  capacityVolumeMl?: number;
  stacks: InventoryStackState[];
  lastUpdatedAt: number;
}

export interface ProductTransferState {
  id: EntityId;
  productId: string;
  batchId: EntityId;
  sourceInventoryId: EntityId;
  targetInventoryId: EntityId;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  reason: ProductTransferReason;
  createdAt: number;
  completedAt: number;
}

export interface ProductRecallState {
  id: EntityId;
  productId: string;
  batchId?: EntityId;
  issuerEntityId: EntityId;
  reason: string;
  startedAt: number;
  endedAt?: number;
  active: boolean;
}

export interface ProductInventoryTotalsState {
  products: number;
  batches: number;
  inventories: number;
  availableUnits: number;
  expiredUnits: number;
  recalledUnits: number;
  transfers: number;
  transferredUnits: number;
  producedUnits: number;
  destroyedUnits: number;
}

export interface ProductInventoryIntegrityState {
  healthy: boolean;
  checkedAt: number;
  duplicateInventoryIds: number;
  duplicateStackIds: number;
  orphanStacks: number;
  orphanBatches: number;
  negativeQuantities: number;
  quantityDrift: number;
  warnings: string[];
}


export interface ProductAdapterBindingState {
  inventoryId: EntityId;
  ownerEntityId: EntityId;
  ownerKind: InventoryOwnerKind;
  compartment: string;
  locationId?: EntityId;
  productId: string;
}

export interface ProductInventoryState {
  version: 1;
  catalogVersion: number;
  batches: ProductBatchState[];
  inventories: InventoryState[];
  transfers: ProductTransferState[];
  recalls: ProductRecallState[];
  adapterQuantities: Record<string, number>;
  adapterBindings: Record<string, ProductAdapterBindingState>;
  totals: ProductInventoryTotalsState;
  integrity: ProductInventoryIntegrityState;
  sequence: number;
  lastUpdatedAt: number;
}

export interface ProductInventoryInput {
  seed: string;
  timestamp: number;
  playerId: EntityId;
  worldCore: WorldCoreState;
  production: ProductionState;
  urban: UrbanFabricState;
  population: PopulationState;
  food: FoodState;
  previous?: ProductInventoryState;
}

export interface ProductInventoryProjectionResult {
  state: ProductInventoryState;
  production: ProductionState;
  urban: UrbanFabricState;
  population: PopulationState;
  food: FoodState;
  worldCore: WorldCoreState;
}

export interface ProductTransferResult {
  state: ProductInventoryState;
  transferred: number;
  transferIds: EntityId[];
}
