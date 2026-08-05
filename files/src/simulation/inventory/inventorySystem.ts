import { createStableEntityId } from "../../core/ids/entityId";
import { FOOD_CATALOG } from "../../data/products/foodCatalog";
import { PRODUCT_CATALOG, PRODUCT_CATALOG_VERSION, getProduct, productForLegacyResource } from "../../data/products/productCatalog";
import type { ProductDefinition } from "../../data/products/types";
import type { FoodStack, FoodState } from "../../gameplay/food/foodSystem";
import type { HouseholdState, PopulationInventoryCommand, PopulationState } from "../population/types";
import type { ProductionFacilityState, ProductionResource, ProductionState } from "../production/types";
import type { UrbanFabricState } from "../urban/types";
import type { VenueOperationState } from "../venues/types";
import type { WorldCoreBusinessState, WorldCoreState } from "../worldCore/types";
import type {
  InventoryOwnerKind,
  InventoryStackState,
  InventoryState,
  ProductBatchOrigin,
  ProductBatchState,
  ProductConsumptionResult,
  ProductInventoryInput,
  ProductInventoryIntegrityState,
  ProductInventoryProjectionResult,
  ProductInventoryState,
  ProductInventoryTotalsState,
  ProductTransferReason,
  ProductTransferResult,
  ProductTransferState
} from "./types";

const MAX_TRANSFERS = 2_000;
const FOOD_PRODUCT_IDS = new Set(FOOD_CATALOG.map((item) => item.id));
const PRODUCT_IDS = new Set(PRODUCT_CATALOG.map((item) => item.id));

type AdapterTarget = { key: string; inventoryId: string; ownerEntityId: string; ownerKind: InventoryOwnerKind; compartment: string; locationId?: string; productId: string; quantity: number; manufacturedAt?: number; expiresAt?: number; unitCost?: number; origin?: ProductBatchOrigin };

function round(value: number): number { return Math.round(value * 100) / 100; }
function clamp(value: number, min = 0, max = 100): number { return Math.max(min, Math.min(max, value)); }

export function inventoryId(ownerEntityId: string, compartment = "main"): string {
  return createStableEntityId("inventory", `${ownerEntityId}:${compartment}`);
}

export function playerCarriedInventoryId(playerId: string): string { return inventoryId(playerId, "carried"); }
export function playerStorageInventoryId(playerId: string): string { return inventoryId(playerId, "home-storage"); }
export function businessInventoryId(businessId: string): string { return inventoryId(businessId, "stockroom"); }
export function facilityInventoryId(facilityId: string): string { return inventoryId(facilityId, "warehouse"); }
export function householdInventoryId(householdId: string): string { return inventoryId(householdId, "pantry"); }

export function ensureCanonicalInventory(
  state: ProductInventoryState,
  ownerEntityId: string,
  ownerKind: InventoryOwnerKind,
  compartment: string,
  timestamp: number,
  locationId?: string,
  capacityMassGrams?: number,
  capacityVolumeMl?: number
): ProductInventoryState {
  const id = inventoryId(ownerEntityId, compartment);
  const current = state.inventories.find((item) => item.id === id);
  if (current) {
    return {
      ...state,
      inventories: state.inventories.map((item) => item.id === id ? {
        ...item,
        ownerEntityId,
        ownerKind,
        compartment,
        locationId: locationId ?? item.locationId,
        capacityMassGrams: capacityMassGrams ?? item.capacityMassGrams,
        capacityVolumeMl: capacityVolumeMl ?? item.capacityVolumeMl,
        lastUpdatedAt: timestamp
      } : item)
    };
  }
  return {
    ...state,
    inventories: [...state.inventories, {
      id,
      ownerEntityId,
      ownerKind,
      compartment,
      locationId,
      capacityMassGrams,
      capacityVolumeMl,
      stacks: [],
      lastUpdatedAt: timestamp
    }],
    lastUpdatedAt: timestamp
  };
}

function inventoryShell(target: AdapterTarget, timestamp: number): InventoryState {
  const product = getProduct(target.productId);
  const playerCapacity = target.compartment === "carried" ? 6_500 : undefined;
  return {
    id: target.inventoryId,
    ownerEntityId: target.ownerEntityId,
    ownerKind: target.ownerKind,
    compartment: target.compartment,
    locationId: target.locationId,
    capacityMassGrams: playerCapacity,
    capacityVolumeMl: playerCapacity ? 8_000 : undefined,
    stacks: [],
    lastUpdatedAt: timestamp
  };
}

function batchId(seed: string, productId: string, producerId: string, timestamp: number, sequence: number): string {
  return createStableEntityId("product-batch", `${seed}:${productId}:${producerId}:${timestamp}:${sequence}`);
}

function stackId(inventoryIdValue: string, batchIdValue: string, sequence: number): string {
  return createStableEntityId("inventory-stack", `${inventoryIdValue}:${batchIdValue}:${sequence}`);
}

function lotCode(product: ProductDefinition, timestamp: number, sequence: number): string {
  return `${product.sku.replace(/[^A-Z0-9]/gi, "").slice(0, 8).toUpperCase()}-${Math.floor(timestamp / 86_400_000).toString(36).toUpperCase()}-${sequence.toString(36).toUpperCase()}`;
}

function createBatchAndStack(
  state: ProductInventoryState,
  inventory: InventoryState,
  seed: string,
  productId: string,
  quantity: number,
  timestamp: number,
  producerEntityId: string,
  origin: ProductBatchOrigin,
  unitCost?: number,
  manufacturedAt = timestamp,
  expiresAt?: number,
  quality = 75,
  sourceRecipeId?: string
): { state: ProductInventoryState; inventory: InventoryState } {
  if (quantity <= 0) return { state, inventory };
  const product = getProduct(productId);
  const sequence = state.sequence + 1;
  const id = batchId(seed, productId, producerEntityId, manufacturedAt, sequence);
  const expiry = expiresAt ?? (product.shelfLifeHours === null ? undefined : manufacturedAt + product.shelfLifeHours * 3_600_000);
  const batch: ProductBatchState = {
    id,
    productId,
    lotCode: lotCode(product, manufacturedAt, sequence),
    producerEntityId,
    origin,
    quantityProduced: quantity,
    quantityRemaining: quantity,
    quality: clamp(quality),
    condition: 100,
    manufacturedAt,
    expiresAt: expiry,
    sourceRecipeId,
    legal: product.legality !== "illegal",
    recalled: false
  };
  const stack: InventoryStackState = {
    id: stackId(inventory.id, id, sequence),
    inventoryId: inventory.id,
    productId,
    batchId: id,
    quantity,
    reservedQuantity: 0,
    unitCost: unitCost ?? product.basePrice,
    quality: batch.quality,
    condition: 100,
    acquiredAt: timestamp,
    expiresAt: expiry,
    status: expiry !== undefined && expiry <= timestamp ? "expired" : "available"
  };
  return {
    state: { ...state, sequence, batches: [...state.batches, batch] },
    inventory: { ...inventory, stacks: [...inventory.stacks, stack], lastUpdatedAt: timestamp }
  };
}

function quantityInInventory(inventory: InventoryState | undefined, productId: string, timestamp = Number.NEGATIVE_INFINITY): number {
  if (!inventory) return 0;
  return inventory.stacks.reduce((sum, stack) => sum + (stack.productId === productId && stack.status === "available" && (stack.expiresAt === undefined || stack.expiresAt > timestamp) ? Math.max(0, stack.quantity - stack.reservedQuantity) : 0), 0);
}

export function getInventoryQuantity(state: ProductInventoryState, inventoryIdValue: string, productId: string, timestamp = state.lastUpdatedAt): number {
  return quantityInInventory(state.inventories.find((item) => item.id === inventoryIdValue), productId, timestamp);
}

function removeQuantity(inventory: InventoryState, batches: ProductBatchState[], productId: string, quantity: number, timestamp: number, decrementBatch = true): { inventory: InventoryState; batches: ProductBatchState[]; removed: Array<{ batchId: string; quantity: number; unitCost: number; quality: number; condition: number; expiresAt?: number }> } {
  let remaining = Math.max(0, quantity);
  const removed: Array<{ batchId: string; quantity: number; unitCost: number; quality: number; condition: number; expiresAt?: number }> = [];
  const stacks = inventory.stacks.map((stack) => ({ ...stack })).sort((a, b) => (a.expiresAt ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt ?? Number.MAX_SAFE_INTEGER) || a.acquiredAt - b.acquiredAt);
  for (const stack of stacks) {
    if (remaining <= 0 || stack.productId !== productId || stack.status !== "available" || (stack.expiresAt !== undefined && stack.expiresAt <= timestamp)) continue;
    const available = Math.max(0, stack.quantity - stack.reservedQuantity);
    const take = Math.min(available, remaining);
    if (take <= 0) continue;
    stack.quantity -= take;
    remaining -= take;
    removed.push({ batchId: stack.batchId, quantity: take, unitCost: stack.unitCost, quality: stack.quality, condition: stack.condition, expiresAt: stack.expiresAt });
  }
  const removedByBatch = new Map<string, number>();
  for (const item of removed) removedByBatch.set(item.batchId, (removedByBatch.get(item.batchId) ?? 0) + item.quantity);
  const nextBatches = decrementBatch ? batches.map((batch) => removedByBatch.has(batch.id) ? { ...batch, quantityRemaining: Math.max(0, batch.quantityRemaining - (removedByBatch.get(batch.id) ?? 0)) } : batch) : batches;
  return { inventory: { ...inventory, stacks: stacks.filter((stack) => stack.quantity > 0), lastUpdatedAt: timestamp }, batches: nextBatches, removed };
}

function addExistingBatchStack(inventory: InventoryState, item: { batchId: string; quantity: number; unitCost: number; quality: number; condition: number; expiresAt?: number }, productId: string, timestamp: number, sequence: number): InventoryState {
  const existing = inventory.stacks.find((stack) => stack.batchId === item.batchId && stack.productId === productId && stack.status === "available");
  if (existing) return { ...inventory, stacks: inventory.stacks.map((stack) => stack.id === existing.id ? { ...stack, quantity: stack.quantity + item.quantity, acquiredAt: timestamp } : stack), lastUpdatedAt: timestamp };
  return {
    ...inventory,
    stacks: [...inventory.stacks, {
      id: stackId(inventory.id, item.batchId, sequence), inventoryId: inventory.id, productId, batchId: item.batchId, quantity: item.quantity, reservedQuantity: 0,
      unitCost: item.unitCost, quality: item.quality, condition: item.condition, acquiredAt: timestamp, expiresAt: item.expiresAt,
      status: item.expiresAt !== undefined && item.expiresAt <= timestamp ? "expired" : "available"
    }],
    lastUpdatedAt: timestamp
  };
}


function inventoryLoad(inventory: InventoryState): { massGrams: number; volumeMl: number } {
  return inventory.stacks.reduce((total, stack) => {
    if (stack.status === "destroyed") return total;
    const product = getProduct(stack.productId);
    total.massGrams += product.massGrams * stack.quantity;
    total.volumeMl += product.volumeMl * stack.quantity;
    return total;
  }, { massGrams: 0, volumeMl: 0 });
}

function targetCapacityQuantity(inventory: InventoryState, productId: string): number {
  const product = getProduct(productId);
  const load = inventoryLoad(inventory);
  const massCapacity = inventory.capacityMassGrams === undefined || product.massGrams <= 0
    ? Number.MAX_SAFE_INTEGER
    : Math.floor(Math.max(0, inventory.capacityMassGrams - load.massGrams) / product.massGrams);
  const volumeCapacity = inventory.capacityVolumeMl === undefined || product.volumeMl <= 0
    ? Number.MAX_SAFE_INTEGER
    : Math.floor(Math.max(0, inventory.capacityVolumeMl - load.volumeMl) / product.volumeMl);
  return Math.max(0, Math.min(massCapacity, volumeCapacity));
}

export function transferProduct(state: ProductInventoryState, sourceInventoryId: string, targetInventoryId: string, productId: string, quantity: number, timestamp: number, reason: ProductTransferReason, unitPrice = 0): ProductTransferResult {
  if (quantity <= 0 || sourceInventoryId === targetInventoryId) return { state, transferred: 0, transferIds: [] };
  const source = state.inventories.find((item) => item.id === sourceInventoryId);
  const target = state.inventories.find((item) => item.id === targetInventoryId);
  if (!source || !target) return { state, transferred: 0, transferIds: [] };
  const acceptedQuantity = Math.min(quantity, targetCapacityQuantity(target, productId));
  if (acceptedQuantity <= 0) return { state, transferred: 0, transferIds: [] };
  const removal = removeQuantity(source, state.batches, productId, acceptedQuantity, timestamp, false);
  const transferred = removal.removed.reduce((sum, item) => sum + item.quantity, 0);
  if (!transferred) return { state, transferred: 0, transferIds: [] };
  let sequence = state.sequence;
  let nextTarget = target;
  const transfers: ProductTransferState[] = [];
  for (const item of removal.removed) {
    sequence += 1;
    nextTarget = addExistingBatchStack(nextTarget, item, productId, timestamp, sequence);
    transfers.push({
      id: createStableEntityId("product-transfer", `${sourceInventoryId}:${targetInventoryId}:${item.batchId}:${timestamp}:${sequence}`),
      productId, batchId: item.batchId, sourceInventoryId, targetInventoryId, quantity: item.quantity, unitPrice,
      totalValue: round(item.quantity * unitPrice), reason, createdAt: timestamp, completedAt: timestamp
    });
  }
  return {
    transferred,
    transferIds: transfers.map((item) => item.id),
    state: {
      ...state,
      sequence,
      batches: removal.batches,
      inventories: state.inventories.map((item) => item.id === source.id ? removal.inventory : item.id === target.id ? nextTarget : item),
      transfers: [...state.transfers, ...transfers].slice(-MAX_TRANSFERS),
      lastUpdatedAt: timestamp
    }
  };
}

export function produceProductBatch(state: ProductInventoryState, seed: string, facilityId: string, productId: string, quantity: number, timestamp: number, quality = 78, sourceRecipeId?: string): ProductInventoryState {
  const id = facilityInventoryId(facilityId);
  const inventory = state.inventories.find((item) => item.id === id) ?? { id, ownerEntityId: facilityId, ownerKind: "facility" as const, compartment: "warehouse", stacks: [], lastUpdatedAt: timestamp };
  const result = createBatchAndStack(state, inventory, seed, productId, quantity, timestamp, facilityId, "production", Math.round(getProduct(productId).basePrice * .42), timestamp, undefined, quality, sourceRecipeId);
  const inventories = state.inventories.some((item) => item.id === id)
    ? state.inventories.map((item) => item.id === id ? result.inventory : item)
    : [...state.inventories, result.inventory];
  return { ...result.state, inventories, lastUpdatedAt: timestamp };
}

export function stockCanonicalInventory(
  state: ProductInventoryState,
  seed: string,
  ownerEntityId: string,
  ownerKind: InventoryOwnerKind,
  compartment: string,
  productId: string,
  quantity: number,
  timestamp: number,
  options: { locationId?: string; unitCost?: number; quality?: number; origin?: ProductBatchOrigin; producerEntityId?: string; capacityMassGrams?: number; capacityVolumeMl?: number } = {}
): ProductInventoryState {
  let next = ensureCanonicalInventory(state, ownerEntityId, ownerKind, compartment, timestamp, options.locationId, options.capacityMassGrams, options.capacityVolumeMl);
  if (quantity <= 0) return next;
  const id = inventoryId(ownerEntityId, compartment);
  const inventory = next.inventories.find((item) => item.id === id);
  if (!inventory) return next;
  const result = createBatchAndStack(
    next,
    inventory,
    seed,
    productId,
    quantity,
    timestamp,
    options.producerEntityId ?? ownerEntityId,
    options.origin ?? "reconciliation",
    options.unitCost,
    timestamp,
    undefined,
    options.quality ?? 72
  );
  return {
    ...result.state,
    inventories: next.inventories.map((item) => item.id === id ? result.inventory : item),
    lastUpdatedAt: timestamp
  };
}


export interface CanonicalInventorySeedSpec {
  ownerEntityId: string;
  ownerKind: InventoryOwnerKind;
  compartment: string;
  locationId?: string;
  capacityMassGrams?: number;
  capacityVolumeMl?: number;
  products: Array<{ productId: string; quantity: number; unitCost?: number; quality?: number; producerEntityId?: string; origin?: ProductBatchOrigin }>;
}

export function seedCanonicalInventories(
  state: ProductInventoryState,
  seed: string,
  specs: CanonicalInventorySeedSpec[],
  timestamp: number
): ProductInventoryState {
  const batches = state.batches.map((item) => ({ ...item }));
  const inventories = state.inventories.map((item) => ({ ...item, stacks: item.stacks.map((stack) => ({ ...stack })) }));
  const inventoryById = new Map(inventories.map((item) => [item.id, item]));
  let sequence = state.sequence;
  for (const spec of specs) {
    const id = inventoryId(spec.ownerEntityId, spec.compartment);
    let inventory = inventoryById.get(id);
    if (!inventory) {
      inventory = {
        id,
        ownerEntityId: spec.ownerEntityId,
        ownerKind: spec.ownerKind,
        compartment: spec.compartment,
        locationId: spec.locationId,
        capacityMassGrams: spec.capacityMassGrams,
        capacityVolumeMl: spec.capacityVolumeMl,
        stacks: [],
        lastUpdatedAt: timestamp
      };
      inventories.push(inventory);
      inventoryById.set(id, inventory);
    } else {
      inventory.ownerEntityId = spec.ownerEntityId;
      inventory.ownerKind = spec.ownerKind;
      inventory.compartment = spec.compartment;
      inventory.locationId = spec.locationId ?? inventory.locationId;
      inventory.capacityMassGrams = spec.capacityMassGrams ?? inventory.capacityMassGrams;
      inventory.capacityVolumeMl = spec.capacityVolumeMl ?? inventory.capacityVolumeMl;
      inventory.lastUpdatedAt = timestamp;
    }
    if (inventory.stacks.length) continue;
    for (const item of spec.products) {
      const quantity = Math.max(0, Math.round(item.quantity));
      if (!quantity) continue;
      const product = getProduct(item.productId);
      sequence += 1;
      const idValue = batchId(seed, item.productId, item.producerEntityId ?? spec.ownerEntityId, timestamp, sequence);
      const expiry = product.shelfLifeHours === null ? undefined : timestamp + product.shelfLifeHours * 3_600_000;
      const quality = clamp(item.quality ?? 72);
      const batch: ProductBatchState = {
        id: idValue,
        productId: item.productId,
        lotCode: lotCode(product, timestamp, sequence),
        producerEntityId: item.producerEntityId ?? spec.ownerEntityId,
        origin: item.origin ?? "migration",
        quantityProduced: quantity,
        quantityRemaining: quantity,
        quality,
        condition: 100,
        manufacturedAt: timestamp,
        expiresAt: expiry,
        legal: product.legality !== "illegal",
        recalled: false
      };
      const stack: InventoryStackState = {
        id: stackId(inventory.id, batch.id, sequence),
        inventoryId: inventory.id,
        productId: item.productId,
        batchId: batch.id,
        quantity,
        reservedQuantity: 0,
        unitCost: item.unitCost ?? product.basePrice,
        quality,
        condition: 100,
        acquiredAt: timestamp,
        expiresAt: expiry,
        status: expiry !== undefined && expiry <= timestamp ? "expired" : "available"
      };
      batches.push(batch);
      inventory.stacks.push(stack);
    }
  }
  return { ...state, batches, inventories, sequence, lastUpdatedAt: timestamp };
}

export function consumeInventoryProduct(
  state: ProductInventoryState,
  sourceInventoryId: string,
  productId: string,
  quantity: number,
  timestamp: number,
  reason: ProductTransferReason = "consumption",
  unitPrice = 0,
  consumerEntityId = "market-consumption"
): ProductConsumptionResult {
  const source = state.inventories.find((item) => item.id === sourceInventoryId);
  if (!source || quantity <= 0) return { state, consumed: 0, inventoryCost: 0, batchIds: [], transferIds: [] };
  const removal = removeQuantity(source, state.batches, productId, quantity, timestamp, true);
  const consumed = removal.removed.reduce((sum, item) => sum + item.quantity, 0);
  if (!consumed) return { state, consumed: 0, inventoryCost: 0, batchIds: [], transferIds: [] };
  let sequence = state.sequence;
  const targetInventoryId = inventoryId(consumerEntityId, "consumed");
  const transfers: ProductTransferState[] = removal.removed.map((item) => {
    sequence += 1;
    return {
      id: createStableEntityId("product-transfer", `${sourceInventoryId}:${targetInventoryId}:${item.batchId}:${timestamp}:${sequence}`),
      productId,
      batchId: item.batchId,
      sourceInventoryId,
      targetInventoryId,
      quantity: item.quantity,
      unitPrice,
      totalValue: round(item.quantity * unitPrice),
      reason,
      createdAt: timestamp,
      completedAt: timestamp
    };
  });
  const inventoryCost = round(removal.removed.reduce((sum, item) => sum + item.quantity * item.unitCost, 0));
  const nextState: ProductInventoryState = {
    ...state,
    sequence,
    batches: removal.batches,
    inventories: state.inventories.map((item) => item.id === source.id ? removal.inventory : item),
    transfers: [...state.transfers, ...transfers].slice(-MAX_TRANSFERS),
    lastUpdatedAt: timestamp
  };
  return { state: nextState, consumed, inventoryCost, batchIds: [...new Set(removal.removed.map((item) => item.batchId))], transferIds: transfers.map((item) => item.id) };
}

export function finalizeProductInventoryState(state: ProductInventoryState, timestamp: number): ProductInventoryState {
  const next = {
    ...state,
    transfers: state.transfers.slice(-MAX_TRANSFERS),
    lastUpdatedAt: timestamp
  };
  return { ...next, totals: totals(next), integrity: integrity(next, timestamp) };
}

interface WorldCoreBusinessLookup {
  byId: Map<string, WorldCoreBusinessState>;
  byLocationId: Map<string, WorldCoreBusinessState>;
}

function buildWorldCoreBusinessLookup(worldCore: WorldCoreState): WorldCoreBusinessLookup {
  const byId = new Map<string, WorldCoreBusinessState>();
  const byLocationId = new Map<string, WorldCoreBusinessState>();
  for (const business of worldCore.businesses) {
    byId.set(business.id, business);
    if (business.locationId) byLocationId.set(business.locationId, business);
  }
  return { byId, byLocationId };
}

function canonicalBusinessForLocation(worldCore: WorldCoreState, locationId: string, lookup?: WorldCoreBusinessLookup): WorldCoreBusinessState | undefined {
  return lookup?.byLocationId.get(locationId) ?? worldCore.businesses.find((business) => business.locationId === locationId);
}

function canonicalBusinessForVenue(worldCore: WorldCoreState, venueId: string, lookup?: WorldCoreBusinessLookup): WorldCoreBusinessState | undefined {
  const canonicalId = worldCore.aliasToBusinessId[venueId] ?? worldCore.aliasToBusinessId[`venue-account:${venueId}`];
  return canonicalId ? lookup?.byId.get(canonicalId) ?? worldCore.businesses.find((business) => business.id === canonicalId) : undefined;
}

function adapterTargets(input: ProductInventoryInput, includeBusinessCompatibility = true): AdapterTarget[] {
  const targets: AdapterTarget[] = [];
  const businessLookup = buildWorldCoreBusinessLookup(input.worldCore);
  const pushFoodStacks = (stacks: FoodStack[], compartment: "carried" | "home-storage") => {
    const grouped = new Map<string, FoodStack[]>();
    for (const stack of stacks) grouped.set(stack.productId, [...(grouped.get(stack.productId) ?? []), stack]);
    for (const [productId, group] of grouped) {
      const quantity = group.reduce((sum, stack) => sum + stack.quantity, 0);
      const earliest = group.reduce((min, stack) => Math.min(min, stack.purchasedAt), input.timestamp);
      const expiry = group.reduce((min, stack) => Math.min(min, stack.expiresAt), Number.MAX_SAFE_INTEGER);
      targets.push({ key: `player:${compartment}:${productId}`, inventoryId: inventoryId(input.playerId, compartment), ownerEntityId: input.playerId, ownerKind: "player", compartment, productId, quantity, manufacturedAt: earliest, expiresAt: expiry === Number.MAX_SAFE_INTEGER ? undefined : expiry, origin: "migration" });
    }
  };
  pushFoodStacks(input.food.carried, "carried");
  pushFoodStacks(input.food.storage, "home-storage");

  if (includeBusinessCompatibility) {
    const venueProductKeys = new Set<string>();
    for (const operation of input.urban.venueOperations.operations) {
      const business = canonicalBusinessForVenue(input.worldCore, operation.venueId, businessLookup);
      if (!business) continue;
      for (const offer of operation.offers) {
        if (!offer.productId || !PRODUCT_IDS.has(offer.productId)) continue;
        venueProductKeys.add(`${business.id}|${offer.productId}`);
        targets.push({ key: `venue:${offer.id}`, inventoryId: businessInventoryId(business.id), ownerEntityId: business.id, ownerKind: "business", compartment: "stockroom", locationId: business.locationId, productId: offer.productId, quantity: Math.max(0, offer.stock), unitCost: Math.max(1, Math.round(offer.currentPrice * .42)), origin: "migration" });
      }
    }

    for (const [locationId, stock] of Object.entries(input.food.shopStocks)) {
      const business = canonicalBusinessForLocation(input.worldCore, locationId, businessLookup);
      if (!business) continue;
      for (const [productId, quantity] of Object.entries(stock)) {
        if (!PRODUCT_IDS.has(productId) || venueProductKeys.has(`${business.id}|${productId}`)) continue;
        targets.push({ key: `shop:${locationId}:${productId}`, inventoryId: businessInventoryId(business.id), ownerEntityId: business.id, ownerKind: "business", compartment: "stockroom", locationId, productId, quantity, origin: "migration" });
      }
    }
  }

  for (const household of input.population.households) {
    for (const pantry of household.pantry) {
      if (!PRODUCT_IDS.has(pantry.productId)) continue;
      targets.push({ key: `household:${household.id}:${pantry.productId}`, inventoryId: householdInventoryId(household.id), ownerEntityId: household.id, ownerKind: "household", compartment: "pantry", locationId: household.homeLocationId ?? undefined, productId: pantry.productId, quantity: pantry.units, origin: "migration" });
    }
  }

  for (const facility of input.production.facilities) {
    for (const entry of facility.inventory) {
      const product = productForLegacyResource(entry.resource, `${facility.name}:${facility.kind}`);
      targets.push({ key: `facility:${facility.id}:${entry.resource}`, inventoryId: facilityInventoryId(facility.id), ownerEntityId: facility.id, ownerKind: "facility", compartment: "warehouse", locationId: facility.locationId, productId: product.id, quantity: Math.max(0, Math.round(entry.amount)), unitCost: Math.max(1, Math.round(product.basePrice * .42)), origin: facility.kind === "import-terminal" ? "import" : facility.recipeIds.length ? "production" : "reconciliation" });
    }
  }
  return targets;
}

function emptyState(timestamp: number): ProductInventoryState {
  return {
    version: 1, catalogVersion: PRODUCT_CATALOG_VERSION, batches: [], inventories: [], transfers: [], recalls: [], adapterQuantities: {}, adapterBindings: {},
    totals: { products: PRODUCT_CATALOG.length, batches: 0, inventories: 0, availableUnits: 0, expiredUnits: 0, recalledUnits: 0, transfers: 0, transferredUnits: 0, producedUnits: 0, destroyedUnits: 0 },
    integrity: { healthy: true, checkedAt: timestamp, duplicateInventoryIds: 0, duplicateStackIds: 0, orphanStacks: 0, orphanBatches: 0, negativeQuantities: 0, quantityDrift: 0, warnings: [] },
    sequence: 0, lastUpdatedAt: timestamp
  };
}

function ensureInventory(state: ProductInventoryState, target: AdapterTarget, timestamp: number): ProductInventoryState {
  if (state.inventories.some((item) => item.id === target.inventoryId)) return state;
  return { ...state, inventories: [...state.inventories, inventoryShell(target, timestamp)] };
}

function applyAdapterDelta(state: ProductInventoryState, input: ProductInventoryInput, target: AdapterTarget, previousQuantity: number): ProductInventoryState {
  let next = ensureInventory(state, target, input.timestamp);
  const delta = Math.round(target.quantity - previousQuantity);
  if (!delta) return next;
  const inventory = next.inventories.find((item) => item.id === target.inventoryId);
  if (!inventory) return next;
  if (delta > 0) {
    const created = createBatchAndStack(next, inventory, input.seed, target.productId, delta, input.timestamp, target.ownerEntityId, target.origin ?? "reconciliation", target.unitCost, target.manufacturedAt ?? input.timestamp, target.expiresAt);
    return { ...created.state, inventories: next.inventories.map((item) => item.id === inventory.id ? created.inventory : item) };
  }
  const removal = removeQuantity(inventory, next.batches, target.productId, Math.abs(delta), input.timestamp);
  return { ...next, batches: removal.batches, inventories: next.inventories.map((item) => item.id === inventory.id ? removal.inventory : item) };
}

function expireStacks(state: ProductInventoryState, timestamp: number): ProductInventoryState {
  const recalledBatches = new Set(state.batches.filter((batch) => batch.recalled).map((batch) => batch.id));
  const inventories = state.inventories.map((inventory) => ({
    ...inventory,
    stacks: inventory.stacks.map((stack) => {
      if (stack.status === "destroyed") return stack;
      if (recalledBatches.has(stack.batchId)) return { ...stack, status: "recalled" as const };
      if (stack.expiresAt !== undefined && stack.expiresAt <= timestamp) return { ...stack, status: "expired" as const, condition: 0 };
      const product = getProduct(stack.productId);
      if (product.shelfLifeHours === null || stack.expiresAt === undefined) return stack;
      const lifetime = Math.max(1, stack.expiresAt - stack.acquiredAt);
      const remaining = stack.expiresAt - timestamp;
      return { ...stack, condition: clamp(Math.round(remaining / lifetime * 100)) };
    }),
    lastUpdatedAt: timestamp
  }));
  return { ...state, inventories, lastUpdatedAt: timestamp };
}

function totals(state: ProductInventoryState): ProductInventoryTotalsState {
  let availableUnits = 0, expiredUnits = 0, recalledUnits = 0, destroyedUnits = 0;
  for (const inventory of state.inventories) for (const stack of inventory.stacks) {
    if (stack.status === "available") availableUnits += stack.quantity;
    else if (stack.status === "expired") expiredUnits += stack.quantity;
    else if (stack.status === "recalled") recalledUnits += stack.quantity;
    else if (stack.status === "destroyed") destroyedUnits += stack.quantity;
  }
  return {
    products: PRODUCT_CATALOG.length,
    batches: state.batches.length,
    inventories: state.inventories.length,
    availableUnits,
    expiredUnits,
    recalledUnits,
    transfers: state.transfers.length,
    transferredUnits: state.transfers.reduce((sum, item) => sum + item.quantity, 0),
    producedUnits: state.batches.filter((batch) => batch.origin === "production").reduce((sum, item) => sum + item.quantityProduced, 0),
    destroyedUnits
  };
}

function integrity(state: ProductInventoryState, timestamp: number): ProductInventoryIntegrityState {
  const inventoryIds = state.inventories.map((item) => item.id);
  const stackIds = state.inventories.flatMap((item) => item.stacks.map((stack) => stack.id));
  const batchIds = new Set(state.batches.map((item) => item.id));
  const knownInventories = new Set(inventoryIds);
  const duplicateInventoryIds = inventoryIds.length - new Set(inventoryIds).size;
  const duplicateStackIds = stackIds.length - new Set(stackIds).size;
  let orphanStacks = 0, orphanBatches = 0, negativeQuantities = 0;
  const quantityByBatch = new Map<string, number>();
  for (const inventory of state.inventories) for (const stack of inventory.stacks) {
    if (!knownInventories.has(stack.inventoryId)) orphanStacks += 1;
    if (!batchIds.has(stack.batchId)) orphanBatches += 1;
    if (stack.quantity < 0 || stack.reservedQuantity < 0 || stack.reservedQuantity > stack.quantity) negativeQuantities += 1;
    quantityByBatch.set(stack.batchId, (quantityByBatch.get(stack.batchId) ?? 0) + Math.max(0, stack.quantity));
  }
  let quantityDrift = 0;
  for (const batch of state.batches) quantityDrift += Math.abs(round(batch.quantityRemaining - (quantityByBatch.get(batch.id) ?? 0)));
  const warnings: string[] = [];
  if (duplicateInventoryIds) warnings.push(`${duplicateInventoryIds} duplicate inventory ids`);
  if (duplicateStackIds) warnings.push(`${duplicateStackIds} duplicate stack ids`);
  if (orphanStacks) warnings.push(`${orphanStacks} stacks point to missing inventories`);
  if (orphanBatches) warnings.push(`${orphanBatches} stacks point to missing batches`);
  if (negativeQuantities) warnings.push(`${negativeQuantities} invalid stack quantities`);
  if (quantityDrift > .01) warnings.push(`${quantityDrift} batch quantity drift`);
  return { healthy: warnings.length === 0, checkedAt: timestamp, duplicateInventoryIds, duplicateStackIds, orphanStacks, orphanBatches, negativeQuantities, quantityDrift, warnings };
}

export function createProductInventoryState(input: ProductInventoryInput): ProductInventoryState {
  const targets = adapterTargets(input);
  const inventories: InventoryState[] = [];
  const inventoryById = new Map<string, InventoryState>();
  const batches: ProductBatchState[] = [];
  const adapterQuantities: ProductInventoryState["adapterQuantities"] = {};
  const adapterBindings: ProductInventoryState["adapterBindings"] = {};
  let sequence = 0;

  for (const target of targets) {
    let inventory = inventoryById.get(target.inventoryId);
    if (!inventory) {
      inventory = inventoryShell(target, input.timestamp);
      inventories.push(inventory);
      inventoryById.set(target.inventoryId, inventory);
    }

    const quantity = Math.round(target.quantity);
    if (quantity > 0) {
      const product = getProduct(target.productId);
      sequence += 1;
      const manufacturedAt = target.manufacturedAt ?? input.timestamp;
      const id = batchId(input.seed, target.productId, target.ownerEntityId, manufacturedAt, sequence);
      const expiresAt = target.expiresAt ?? (product.shelfLifeHours === null ? undefined : manufacturedAt + product.shelfLifeHours * 3_600_000);
      const quality = 75;
      batches.push({
        id,
        productId: target.productId,
        lotCode: lotCode(product, manufacturedAt, sequence),
        producerEntityId: target.ownerEntityId,
        origin: target.origin ?? "reconciliation",
        quantityProduced: quantity,
        quantityRemaining: quantity,
        quality,
        condition: 100,
        manufacturedAt,
        expiresAt,
        legal: product.legality !== "illegal",
        recalled: false
      });
      inventory.stacks.push({
        id: stackId(inventory.id, id, sequence),
        inventoryId: inventory.id,
        productId: target.productId,
        batchId: id,
        quantity,
        reservedQuantity: 0,
        unitCost: target.unitCost ?? product.basePrice,
        quality,
        condition: 100,
        acquiredAt: input.timestamp,
        expiresAt,
        status: expiresAt !== undefined && expiresAt <= input.timestamp ? "expired" : "available"
      });
    }

    adapterQuantities[target.key] = target.quantity;
    adapterBindings[target.key] = {
      inventoryId: target.inventoryId,
      ownerEntityId: target.ownerEntityId,
      ownerKind: target.ownerKind,
      compartment: target.compartment,
      locationId: target.locationId,
      productId: target.productId
    };
  }

  let state: ProductInventoryState = {
    ...emptyState(input.timestamp),
    batches,
    inventories,
    adapterQuantities,
    adapterBindings,
    sequence
  };
  state = expireStacks(state, input.timestamp);
  state.totals = totals(state);
  state.integrity = integrity(state, input.timestamp);
  return state;
}

export function normalizeProductInventoryState(value: unknown, input: ProductInventoryInput): ProductInventoryState {
  if (!value || typeof value !== "object") return createProductInventoryState(input);
  const raw = value as Partial<ProductInventoryState>;
  const base = emptyState(input.timestamp);
  const normalized: ProductInventoryState = {
    ...base,
    ...raw,
    version: 1,
    catalogVersion: PRODUCT_CATALOG_VERSION,
    batches: Array.isArray(raw.batches) ? raw.batches : [],
    inventories: Array.isArray(raw.inventories) ? raw.inventories : [],
    transfers: Array.isArray(raw.transfers) ? raw.transfers.slice(-MAX_TRANSFERS) : [],
    recalls: Array.isArray(raw.recalls) ? raw.recalls : [],
    adapterQuantities: raw.adapterQuantities && typeof raw.adapterQuantities === "object" ? raw.adapterQuantities : {},
    adapterBindings: raw.adapterBindings && typeof raw.adapterBindings === "object" ? raw.adapterBindings : {},
    sequence: typeof raw.sequence === "number" ? raw.sequence : 0,
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : input.timestamp
  };
  return advanceProductInventoryState({ ...input, previous: normalized });
}

export function importLegacyTransitionalInventory(input: ProductInventoryInput): ProductInventoryState {
  if (!input.previous) return createProductInventoryState(input);
  let state: ProductInventoryState = {
    ...input.previous,
    batches: input.previous.batches.map((item) => ({ ...item })),
    inventories: input.previous.inventories.map((inventory) => ({ ...inventory, stacks: inventory.stacks.map((stack) => ({ ...stack })) })),
    transfers: input.previous.transfers.map((item) => ({ ...item })),
    recalls: input.previous.recalls.map((item) => ({ ...item })),
    adapterQuantities: { ...input.previous.adapterQuantities },
    adapterBindings: { ...input.previous.adapterBindings },
    catalogVersion: PRODUCT_CATALOG_VERSION
  };
  const targets = adapterTargets(input, false);
  const nextKeys = new Set(targets.map((target) => target.key));
  for (const target of targets) {
    const previousQuantity = state.adapterQuantities[target.key]
      ?? getInventoryQuantity(state, target.inventoryId, target.productId, input.timestamp);
    state = applyAdapterDelta(state, input, target, previousQuantity);
    state.adapterQuantities[target.key] = target.quantity;
    state.adapterBindings[target.key] = {
      inventoryId: target.inventoryId,
      ownerEntityId: target.ownerEntityId,
      ownerKind: target.ownerKind,
      compartment: target.compartment,
      locationId: target.locationId,
      productId: target.productId
    };
  }
  for (const key of Object.keys(state.adapterQuantities)) {
    if (nextKeys.has(key) || key.startsWith("venue:") || key.startsWith("shop:")) continue;
    const binding = state.adapterBindings[key];
    if (!binding) continue;
    const target: AdapterTarget = { key, ...binding, quantity: 0, origin: "migration" };
    state = applyAdapterDelta(state, input, target, state.adapterQuantities[key] ?? 0);
  }
  state.adapterQuantities = {};
  state.adapterBindings = {};
  state = expireStacks(state, input.timestamp);
  state.totals = totals(state);
  state.integrity = integrity(state, input.timestamp);
  return state;
}

export function advanceProductInventoryState(input: ProductInventoryInput): ProductInventoryState {
  if (!input.previous) return createProductInventoryState(input);
  let state: ProductInventoryState = {
    ...input.previous,
    adapterQuantities: {},
    adapterBindings: {},
    catalogVersion: PRODUCT_CATALOG_VERSION
  };
  // Legacy food, household and production fields are read models. They seed a
  // missing inventory during bootstrap only; normal ticks never import them back.
  state = expireStacks(state, input.timestamp);
  state.totals = totals(state);
  state.integrity = integrity(state, input.timestamp);
  return state;
}

export function applyPopulationInventoryCommands(
  state: ProductInventoryState,
  commands: PopulationInventoryCommand[],
  worldCore: WorldCoreState,
  seed: string,
  timestamp: number
): ProductInventoryState {
  if (!commands.length) return finalizeProductInventoryState(state, timestamp);
  const batches = state.batches.map((batch) => ({ ...batch }));
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const inventories = state.inventories.map((inventory) => ({ ...inventory, stacks: inventory.stacks.map((stack) => ({ ...stack })) }));
  const inventoryById = new Map(inventories.map((inventory) => [inventory.id, inventory]));
  const transfers = state.transfers.map((transfer) => ({ ...transfer }));
  const imports = new Map<string, { householdId: string; productId: string; quantity: number; timestamp: number }>();
  let sequence = state.sequence;

  const ensure = (ownerEntityId: string, ownerKind: InventoryOwnerKind, compartment: string, at: number): InventoryState => {
    const id = inventoryId(ownerEntityId, compartment);
    const current = inventoryById.get(id);
    if (current) return current;
    const created: InventoryState = { id, ownerEntityId, ownerKind, compartment, stacks: [], lastUpdatedAt: at };
    inventories.push(created);
    inventoryById.set(id, created);
    return created;
  };

  const take = (source: InventoryState | undefined, productId: string, quantity: number, at: number, decrementBatch: boolean) => {
    if (!source || quantity <= 0) return [] as Array<{ batchId: string; quantity: number; unitCost: number; quality: number; condition: number; expiresAt?: number }>;
    let remaining = quantity;
    const removed: Array<{ batchId: string; quantity: number; unitCost: number; quality: number; condition: number; expiresAt?: number }> = [];
    const candidates = source.stacks
      .filter((stack) => stack.productId === productId && stack.status === "available" && (stack.expiresAt === undefined || stack.expiresAt > at))
      .sort((left, right) => (left.expiresAt ?? Number.MAX_SAFE_INTEGER) - (right.expiresAt ?? Number.MAX_SAFE_INTEGER) || left.acquiredAt - right.acquiredAt);
    for (const stack of candidates) {
      if (remaining <= 0) break;
      const available = Math.max(0, stack.quantity - stack.reservedQuantity);
      const used = Math.min(available, remaining);
      if (used <= 0) continue;
      stack.quantity -= used;
      remaining -= used;
      removed.push({ batchId: stack.batchId, quantity: used, unitCost: stack.unitCost, quality: stack.quality, condition: stack.condition, expiresAt: stack.expiresAt });
      if (decrementBatch) {
        const batch = batchById.get(stack.batchId);
        if (batch) batch.quantityRemaining = Math.max(0, batch.quantityRemaining - used);
      }
    }
    source.stacks = source.stacks.filter((stack) => stack.quantity > 0);
    source.lastUpdatedAt = at;
    return removed;
  };

  const move = (sourceId: string, target: InventoryState, productId: string, quantity: number, at: number, reason: ProductTransferReason, unitPrice = 0): number => {
    const source = inventoryById.get(sourceId);
    const removed = take(source, productId, quantity, at, false);
    let moved = 0;
    for (const item of removed) {
      moved += item.quantity;
      sequence += 1;
      const existing = target.stacks.find((stack) => stack.batchId === item.batchId && stack.productId === productId && stack.status === "available");
      if (existing) {
        existing.quantity += item.quantity;
        existing.acquiredAt = at;
      } else {
        target.stacks.push({
          id: stackId(target.id, item.batchId, sequence),
          inventoryId: target.id,
          productId,
          batchId: item.batchId,
          quantity: item.quantity,
          reservedQuantity: 0,
          unitCost: item.unitCost,
          quality: item.quality,
          condition: item.condition,
          acquiredAt: at,
          expiresAt: item.expiresAt,
          status: item.expiresAt !== undefined && item.expiresAt <= at ? "expired" : "available"
        });
      }
      transfers.push({
        id: createStableEntityId("product-transfer", `${sourceId}:${target.id}:${item.batchId}:${at}:${sequence}`),
        productId,
        batchId: item.batchId,
        sourceInventoryId: sourceId,
        targetInventoryId: target.id,
        quantity: item.quantity,
        unitPrice,
        totalValue: round(item.quantity * unitPrice),
        reason,
        createdAt: at,
        completedAt: at
      });
    }
    target.lastUpdatedAt = at;
    return moved;
  };

  const consume = (householdId: string, productId: string, quantity: number, at: number): number => {
    const sourceId = householdInventoryId(householdId);
    const removed = take(inventoryById.get(sourceId), productId, quantity, at, true);
    let consumed = 0;
    for (const item of removed) {
      consumed += item.quantity;
      sequence += 1;
      transfers.push({
        id: createStableEntityId("product-transfer", `${sourceId}:${householdId}:consumed:${item.batchId}:${at}:${sequence}`),
        productId,
        batchId: item.batchId,
        sourceInventoryId: sourceId,
        targetInventoryId: inventoryId(householdId, "consumed"),
        quantity: item.quantity,
        unitPrice: 0,
        totalValue: 0,
        reason: "consumption",
        createdAt: at,
        completedAt: at
      });
    }
    return consumed;
  };

  for (const command of commands) {
    const at = Math.min(timestamp, command.timestamp);
    if (command.kind === "purchase") {
      const business = canonicalBusinessForLocation(worldCore, command.locationId);
      if (!business) continue;
      const target = ensure(command.householdId, "household", "pantry", at);
      move(businessInventoryId(business.id), target, command.productId, command.quantity, at, "household-purchase", command.unitPrice);
    } else if (command.kind === "consume") {
      consume(command.householdId, command.productId, command.quantity, at);
    } else if (command.kind === "transfer") {
      const target = ensure(command.targetHouseholdId, "household", "pantry", at);
      move(householdInventoryId(command.sourceHouseholdId), target, command.productId, command.quantity, at, "storage");
    } else {
      const key = `${command.householdId}|${command.productId}`;
      const current = imports.get(key);
      imports.set(key, { householdId: command.householdId, productId: command.productId, quantity: (current?.quantity ?? 0) + command.quantity, timestamp: Math.max(current?.timestamp ?? 0, at) });
    }
  }

  let next: ProductInventoryState = {
    ...state,
    batches,
    inventories,
    transfers: transfers.slice(-MAX_TRANSFERS),
    adapterQuantities: {},
    adapterBindings: {},
    sequence,
    lastUpdatedAt: timestamp
  };
  for (const item of imports.values()) {
    next = stockCanonicalInventory(next, seed, item.householdId, "household", "pantry", item.productId, item.quantity, item.timestamp, { origin: "import", producerEntityId: kernelSystemInventoryOwner(seed, "external-trade") });
  }
  return finalizeProductInventoryState(next, timestamp);
}

type SimulationInventoryOwner = {
  inventoryId: string;
  ownerEntityId: string;
  ownerKind: InventoryOwnerKind;
  compartment: string;
  locationId?: string;
  productId: string;
  quantity: number;
  gainOrigin: ProductBatchOrigin;
};

function kernelSystemInventoryOwner(seed: string, name: string): string {
  return createStableEntityId("inventory-source", `${seed}:${name}`);
}

function productionInventorySnapshot(production: ProductionState, food: FoodState, worldCore: WorldCoreState): SimulationInventoryOwner[] {
  const entries: SimulationInventoryOwner[] = [];
  for (const facility of production.facilities) {
    for (const item of facility.inventory) {
      const product = productForLegacyResource(item.resource, `${facility.name}:${facility.kind}`);
      entries.push({
        inventoryId: facilityInventoryId(facility.id),
        ownerEntityId: facility.id,
        ownerKind: "facility",
        compartment: "warehouse",
        locationId: facility.locationId,
        productId: product.id,
        quantity: Math.max(0, Math.round(item.amount)),
        gainOrigin: facility.kind === "import-terminal" ? "import" : "production"
      });
    }
  }
  for (const [locationId, stock] of Object.entries(food.shopStocks)) {
    const business = canonicalBusinessForLocation(worldCore, locationId);
    if (!business) continue;
    for (const [productId, quantity] of Object.entries(stock)) {
      if (!PRODUCT_IDS.has(productId)) continue;
      entries.push({
        inventoryId: businessInventoryId(business.id),
        ownerEntityId: business.id,
        ownerKind: "business",
        compartment: "stockroom",
        locationId,
        productId,
        quantity: Math.max(0, Math.round(quantity)),
        gainOrigin: "production"
      });
    }
  }
  return entries;
}

export function commitProductionInventoryChanges(
  state: ProductInventoryState,
  seed: string,
  worldCore: WorldCoreState,
  beforeProduction: ProductionState,
  afterProduction: ProductionState,
  beforeFood: FoodState,
  afterFood: FoodState,
  timestamp: number
): ProductInventoryState {
  const before = productionInventorySnapshot(beforeProduction, beforeFood, worldCore);
  const after = productionInventorySnapshot(afterProduction, afterFood, worldCore);
  const beforeByKey = new Map(before.map((item) => [`${item.inventoryId}|${item.productId}`, item]));
  const afterByKey = new Map(after.map((item) => [`${item.inventoryId}|${item.productId}`, item]));
  const keys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const lossesByProduct = new Map<string, Array<SimulationInventoryOwner & { remaining: number }>>();
  const gainsByProduct = new Map<string, Array<SimulationInventoryOwner & { remaining: number }>>();
  let next = state;

  for (const key of keys) {
    const previous = beforeByKey.get(key);
    const current = afterByKey.get(key);
    const template = current ?? previous;
    if (!template) continue;
    next = ensureCanonicalInventory(next, template.ownerEntityId, template.ownerKind, template.compartment, timestamp, template.locationId);
    const delta = (current?.quantity ?? 0) - (previous?.quantity ?? 0);
    if (delta < 0) {
      const list = lossesByProduct.get(template.productId) ?? [];
      list.push({ ...template, remaining: Math.abs(delta) });
      lossesByProduct.set(template.productId, list);
    } else if (delta > 0) {
      const list = gainsByProduct.get(template.productId) ?? [];
      list.push({ ...template, remaining: delta });
      gainsByProduct.set(template.productId, list);
    }
  }

  const products = new Set([...lossesByProduct.keys(), ...gainsByProduct.keys()]);
  for (const productId of products) {
    const losses = lossesByProduct.get(productId) ?? [];
    const gains = gainsByProduct.get(productId) ?? [];
    for (const gain of gains) {
      for (const loss of losses) {
        if (gain.remaining <= 0) break;
        if (loss.remaining <= 0) continue;
        const requested = Math.min(gain.remaining, loss.remaining);
        const transfer = transferProduct(next, loss.inventoryId, gain.inventoryId, productId, requested, timestamp, "shipment");
        next = transfer.state;
        gain.remaining -= transfer.transferred;
        loss.remaining -= transfer.transferred;
      }
      if (gain.remaining > 0) {
        next = stockCanonicalInventory(next, seed, gain.ownerEntityId, gain.ownerKind, gain.compartment, productId, gain.remaining, timestamp, { locationId: gain.locationId, origin: gain.gainOrigin, producerEntityId: gain.ownerEntityId });
        gain.remaining = 0;
      }
    }
    for (const loss of losses) {
      if (loss.remaining <= 0) continue;
      const consumed = consumeInventoryProduct(next, loss.inventoryId, productId, loss.remaining, timestamp, loss.ownerKind === "business" ? "market-consumption" : "consumption", 0, loss.ownerEntityId);
      next = consumed.state;
      loss.remaining -= consumed.consumed;
    }
  }
  return finalizeProductInventoryState(next, timestamp);
}

export function destroyExpiredInventoryStacks(
  state: ProductInventoryState,
  inventoryIds: string[],
  timestamp: number
): { state: ProductInventoryState; destroyed: number } {
  const targets = new Set(inventoryIds);
  let destroyed = 0;
  const inventories = state.inventories.map((inventory) => {
    if (!targets.has(inventory.id)) return inventory;
    return {
      ...inventory,
      stacks: inventory.stacks.map((stack) => {
        const expired = stack.status === "expired" || (stack.expiresAt !== undefined && stack.expiresAt <= timestamp);
        if (!expired || stack.status === "destroyed") return stack;
        destroyed += stack.quantity;
        return { ...stack, status: "destroyed" as const, condition: 0 };
      }),
      lastUpdatedAt: timestamp
    };
  });
  return { state: finalizeProductInventoryState({ ...state, inventories, lastUpdatedAt: timestamp }, timestamp), destroyed };
}

interface ProductInventoryProjectionIndex {
  byId: Map<string, InventoryState>;
  byOwnerCompartment: Map<string, InventoryState>;
  quantitiesByInventoryId: Map<string, Map<string, number>>;
  availableUnitsByInventoryId: Map<string, number>;
  targetUnitsByInventoryId: Map<string, number>;
}

function ownerCompartmentKey(ownerEntityId: string, compartment: string): string {
  return `${ownerEntityId}|${compartment}`;
}

function buildProductInventoryProjectionIndex(state: ProductInventoryState, timestamp: number): ProductInventoryProjectionIndex {
  const byId = new Map<string, InventoryState>();
  const byOwnerCompartment = new Map<string, InventoryState>();
  const quantitiesByInventoryId = new Map<string, Map<string, number>>();
  const availableUnitsByInventoryId = new Map<string, number>();
  const targetUnitsByInventoryId = new Map<string, number>();

  for (const inventory of state.inventories) {
    byId.set(inventory.id, inventory);
    byOwnerCompartment.set(ownerCompartmentKey(inventory.ownerEntityId, inventory.compartment), inventory);
    const quantities = new Map<string, number>();
    let availableUnits = 0;
    let targetUnits = 0;
    for (const stack of inventory.stacks) {
      targetUnits += Math.max(stack.quantity, getProduct(stack.productId).stackLimit);
      if (stack.status !== "available" || (stack.expiresAt !== undefined && stack.expiresAt <= timestamp)) continue;
      const available = Math.max(0, stack.quantity - stack.reservedQuantity);
      if (available <= 0) continue;
      quantities.set(stack.productId, (quantities.get(stack.productId) ?? 0) + available);
      availableUnits += stack.quantity;
    }
    quantitiesByInventoryId.set(inventory.id, quantities);
    availableUnitsByInventoryId.set(inventory.id, availableUnits);
    targetUnitsByInventoryId.set(inventory.id, targetUnits);
  }

  return { byId, byOwnerCompartment, quantitiesByInventoryId, availableUnitsByInventoryId, targetUnitsByInventoryId };
}

function indexedInventory(index: ProductInventoryProjectionIndex, ownerEntityId: string, compartment: string): InventoryState | undefined {
  return index.byOwnerCompartment.get(ownerCompartmentKey(ownerEntityId, compartment));
}

function indexedQuantity(index: ProductInventoryProjectionIndex, inventory: InventoryState | undefined, productId: string): number {
  return inventory ? index.quantitiesByInventoryId.get(inventory.id)?.get(productId) ?? 0 : 0;
}

function foodStacksFor(inventory: InventoryState | undefined): FoodStack[] {
  if (!inventory) return [];
  return inventory.stacks.filter((stack) => FOOD_PRODUCT_IDS.has(stack.productId) && stack.status === "available").map((stack) => ({ id: stack.id, productId: stack.productId, quantity: stack.quantity, purchasedAt: stack.acquiredAt, expiresAt: stack.expiresAt ?? Number.MAX_SAFE_INTEGER }));
}

function projectFood(index: ProductInventoryProjectionIndex, input: ProductInventoryInput): FoodState {
  const carried = foodStacksFor(index.byId.get(playerCarriedInventoryId(input.playerId)));
  const storage = foodStacksFor(index.byId.get(playerStorageInventoryId(input.playerId)));
  const shopStocks: FoodState["shopStocks"] = { ...input.food.shopStocks };
  for (const business of input.worldCore.businesses) {
    if (!business.locationId) continue;
    const inventory = indexedInventory(index, business.id, "stockroom");
    if (!inventory) continue;
    const quantities = index.quantitiesByInventoryId.get(inventory.id);
    const stock = quantities
      ? Object.fromEntries([...quantities.entries()].filter(([productId, quantity]) => FOOD_PRODUCT_IDS.has(productId) && quantity > 0))
      : {};
    if (Object.keys(stock).length || shopStocks[business.locationId]) shopStocks[business.locationId] = stock;
  }
  return { ...input.food, carried, storage, shopStocks };
}

function projectHouseholds(index: ProductInventoryProjectionIndex, population: PopulationState): PopulationState {
  const households = population.households.map((household) => {
    const inventory = indexedInventory(index, household.id, "pantry");
    if (!inventory) return household;
    const quantities = index.quantitiesByInventoryId.get(inventory.id);
    const pantry = PRODUCT_CATALOG
      .map((product) => ({ productId: product.id, units: quantities?.get(product.id) ?? 0 }))
      .filter((item) => item.units > 0);
    return { ...household, pantry, foodUnits: pantry.filter((item) => {
      const category = getProduct(item.productId).category;
      return category === "food" || category === "drink";
    }).reduce((sum, item) => sum + item.units, 0) };
  });
  return { ...population, households };
}

function projectVenueOperations(index: ProductInventoryProjectionIndex, urban: UrbanFabricState, worldCore: WorldCoreState): UrbanFabricState {
  const businessLookup = buildWorldCoreBusinessLookup(worldCore);
  const operations = urban.venueOperations.operations.map((operation): VenueOperationState => {
    const business = canonicalBusinessForVenue(worldCore, operation.venueId, businessLookup);
    if (!business) return operation;
    const inventory = indexedInventory(index, business.id, "stockroom");
    if (!inventory) return operation;
    return { ...operation, offers: operation.offers.map((offer) => offer.productId ? { ...offer, stock: indexedQuantity(index, inventory, offer.productId) } : offer) };
  });
  return { ...urban, venueOperations: { ...urban.venueOperations, operations, totals: { ...urban.venueOperations.totals, stockUnits: operations.reduce((sum, operation) => sum + operation.offers.reduce((inner, offer) => inner + offer.stock, 0), 0) } } };
}

function projectProduction(index: ProductInventoryProjectionIndex, production: ProductionState): ProductionState {
  const facilities = production.facilities.map((facility) => {
    const inventory = indexedInventory(index, facility.id, "warehouse");
    if (!inventory) return facility;
    const quantities = index.quantitiesByInventoryId.get(inventory.id);
    return { ...facility, inventory: facility.inventory.map((entry) => ({
      ...entry,
      amount: PRODUCT_CATALOG.reduce((sum, product) => product.legacyResource === entry.resource ? sum + (quantities?.get(product.id) ?? 0) : sum, 0)
    })) };
  });
  return { ...production, facilities };
}

function projectWorldCore(index: ProductInventoryProjectionIndex, worldCore: WorldCoreState, timestamp: number): WorldCoreState {
  const businesses = worldCore.businesses.map((business) => {
    const inventory = indexedInventory(index, business.id, "stockroom");
    if (!inventory) return business;
    const units = index.availableUnitsByInventoryId.get(inventory.id) ?? 0;
    const target = Math.max(1, index.targetUnitsByInventoryId.get(inventory.id) ?? 0);
    return { ...business, stockUnits: units, stockPercent: clamp(Math.round(units / target * 100)), lastUpdatedAt: timestamp };
  });
  return { ...worldCore, businesses, lastUpdatedAt: timestamp };
}

export function projectProductInventoryState(state: ProductInventoryState, input: ProductInventoryInput): ProductInventoryProjectionResult {
  const index = buildProductInventoryProjectionIndex(state, input.timestamp);
  const worldCore = projectWorldCore(index, input.worldCore, input.timestamp);
  const food = projectFood(index, input);
  const population = projectHouseholds(index, input.population);
  const production = projectProduction(index, input.production);
  const urban = projectVenueOperations(index, input.urban, worldCore);
  const projectionsAreCurrent = state.lastUpdatedAt === input.timestamp && state.integrity.checkedAt === input.timestamp;
  const projectedState = {
    ...state,
    adapterQuantities: {},
    adapterBindings: {},
    totals: projectionsAreCurrent ? state.totals : totals(state),
    integrity: projectionsAreCurrent ? state.integrity : integrity(state, input.timestamp),
    lastUpdatedAt: input.timestamp
  };
  return { state: projectedState, food, population, production, urban, worldCore };
}

export function findInventory(state: ProductInventoryState, ownerEntityId: string, compartment = "main"): InventoryState | undefined {
  return state.inventories.find((item) => item.ownerEntityId === ownerEntityId && item.compartment === compartment);
}
