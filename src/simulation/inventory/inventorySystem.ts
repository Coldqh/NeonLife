import { createStableEntityId } from "../../core/ids/entityId";
import { FOOD_CATALOG } from "../../data/products/foodCatalog";
import { PRODUCT_CATALOG, PRODUCT_CATALOG_VERSION, getProduct, productForLegacyResource } from "../../data/products/productCatalog";
import type { ProductDefinition } from "../../data/products/types";
import type { FoodStack, FoodState } from "../../gameplay/food/foodSystem";
import type { HouseholdState, PopulationState } from "../population/types";
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

function canonicalBusinessForLocation(worldCore: WorldCoreState, locationId: string): WorldCoreBusinessState | undefined {
  return worldCore.businesses.find((business) => business.locationId === locationId);
}

function canonicalBusinessForVenue(worldCore: WorldCoreState, venueId: string): WorldCoreBusinessState | undefined {
  const canonicalId = worldCore.aliasToBusinessId[venueId] ?? worldCore.aliasToBusinessId[`venue-account:${venueId}`];
  return canonicalId ? worldCore.businesses.find((business) => business.id === canonicalId) : undefined;
}

function adapterTargets(input: ProductInventoryInput): AdapterTarget[] {
  const targets: AdapterTarget[] = [];
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

  const venueBusinessIds = new Set<string>();
  for (const operation of input.urban.venueOperations.operations) {
    const business = canonicalBusinessForVenue(input.worldCore, operation.venueId);
    if (!business) continue;
    venueBusinessIds.add(business.id);
    for (const offer of operation.offers) {
      if (!offer.productId || !PRODUCT_CATALOG.some((product) => product.id === offer.productId)) continue;
      targets.push({ key: `venue:${offer.id}`, inventoryId: businessInventoryId(business.id), ownerEntityId: business.id, ownerKind: "business", compartment: "stockroom", locationId: business.locationId, productId: offer.productId, quantity: Math.max(0, offer.stock), unitCost: Math.max(1, Math.round(offer.currentPrice * .42)), origin: "migration" });
    }
  }

  for (const [locationId, stock] of Object.entries(input.food.shopStocks)) {
    const business = canonicalBusinessForLocation(input.worldCore, locationId);
    if (!business || venueBusinessIds.has(business.id)) continue;
    for (const [productId, quantity] of Object.entries(stock)) {
      if (!PRODUCT_CATALOG.some((product) => product.id === productId)) continue;
      targets.push({ key: `shop:${locationId}:${productId}`, inventoryId: businessInventoryId(business.id), ownerEntityId: business.id, ownerKind: "business", compartment: "stockroom", locationId, productId, quantity, origin: "migration" });
    }
  }

  for (const household of input.population.households) {
    for (const pantry of household.pantry) {
      if (!PRODUCT_CATALOG.some((product) => product.id === pantry.productId)) continue;
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
  let state = emptyState(input.timestamp);
  const targets = adapterTargets(input);
  for (const target of targets) {
    state = applyAdapterDelta(state, input, target, 0);
    state.adapterQuantities[target.key] = target.quantity;
    state.adapterBindings[target.key] = { inventoryId: target.inventoryId, ownerEntityId: target.ownerEntityId, ownerKind: target.ownerKind, compartment: target.compartment, locationId: target.locationId, productId: target.productId };
  }
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

export function advanceProductInventoryState(input: ProductInventoryInput): ProductInventoryState {
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
  const targets = adapterTargets(input);
  const nextKeys = new Set(targets.map((target) => target.key));
  for (const target of targets) {
    state = applyAdapterDelta(state, input, target, state.adapterQuantities[target.key] ?? 0);
    state.adapterQuantities[target.key] = target.quantity;
    state.adapterBindings[target.key] = { inventoryId: target.inventoryId, ownerEntityId: target.ownerEntityId, ownerKind: target.ownerKind, compartment: target.compartment, locationId: target.locationId, productId: target.productId };
  }
  for (const key of Object.keys(state.adapterQuantities)) {
    if (nextKeys.has(key)) continue;
    const binding = state.adapterBindings[key];
    if (!binding) continue;
    const zeroTarget: AdapterTarget = { key, ...binding, quantity: 0, origin: "reconciliation" };
    state = applyAdapterDelta(state, input, zeroTarget, state.adapterQuantities[key] ?? 0);
    delete state.adapterQuantities[key];
    delete state.adapterBindings[key];
  }
  state = expireStacks(state, input.timestamp);
  state.totals = totals(state);
  state.integrity = integrity(state, input.timestamp);
  return state;
}

function foodStacksFor(inventory: InventoryState | undefined): FoodStack[] {
  if (!inventory) return [];
  return inventory.stacks.filter((stack) => FOOD_PRODUCT_IDS.has(stack.productId) && stack.status === "available").map((stack) => ({ id: stack.id, productId: stack.productId, quantity: stack.quantity, purchasedAt: stack.acquiredAt, expiresAt: stack.expiresAt ?? Number.MAX_SAFE_INTEGER }));
}

function projectFood(state: ProductInventoryState, input: ProductInventoryInput): FoodState {
  const carried = foodStacksFor(state.inventories.find((item) => item.id === playerCarriedInventoryId(input.playerId)));
  const storage = foodStacksFor(state.inventories.find((item) => item.id === playerStorageInventoryId(input.playerId)));
  const shopStocks: FoodState["shopStocks"] = { ...input.food.shopStocks };
  for (const business of input.worldCore.businesses) {
    if (!business.locationId) continue;
    const inventory = state.inventories.find((item) => item.id === businessInventoryId(business.id));
    if (!inventory) continue;
    const stockEntries: Array<[string, number]> = FOOD_CATALOG.map((product) => [product.id, quantityInInventory(inventory, product.id, input.timestamp)]);
    const stock = Object.fromEntries(stockEntries.filter((entry) => entry[1] > 0));
    if (Object.keys(stock).length || shopStocks[business.locationId]) shopStocks[business.locationId] = stock;
  }
  return { ...input.food, carried, storage, shopStocks };
}

function projectHouseholds(state: ProductInventoryState, population: PopulationState, timestamp: number): PopulationState {
  const households = population.households.map((household) => {
    const inventory = state.inventories.find((item) => item.id === householdInventoryId(household.id));
    if (!inventory) return household;
    const pantry = PRODUCT_CATALOG.map((product) => ({ productId: product.id, units: quantityInInventory(inventory, product.id, timestamp) })).filter((item) => item.units > 0);
    return { ...household, pantry, foodUnits: pantry.filter((item) => getProduct(item.productId).category === "food" || getProduct(item.productId).category === "drink").reduce((sum, item) => sum + item.units, 0) };
  });
  return { ...population, households };
}

function projectVenueOperations(state: ProductInventoryState, urban: UrbanFabricState, worldCore: WorldCoreState, timestamp: number): UrbanFabricState {
  const operations = urban.venueOperations.operations.map((operation): VenueOperationState => {
    const business = canonicalBusinessForVenue(worldCore, operation.venueId);
    if (!business) return operation;
    const inventory = state.inventories.find((item) => item.id === businessInventoryId(business.id));
    if (!inventory) return operation;
    return { ...operation, offers: operation.offers.map((offer) => offer.productId ? { ...offer, stock: quantityInInventory(inventory, offer.productId, timestamp) } : offer) };
  });
  return { ...urban, venueOperations: { ...urban.venueOperations, operations, totals: { ...urban.venueOperations.totals, stockUnits: operations.reduce((sum, operation) => sum + operation.offers.reduce((inner, offer) => inner + offer.stock, 0), 0) } } };
}

function aggregateResource(inventory: InventoryState | undefined, resource: ProductionResource, timestamp: number): number {
  if (!inventory) return 0;
  return PRODUCT_CATALOG.filter((product) => product.legacyResource === resource).reduce((sum, product) => sum + quantityInInventory(inventory, product.id, timestamp), 0);
}

function projectProduction(state: ProductInventoryState, production: ProductionState, timestamp: number): ProductionState {
  const facilities = production.facilities.map((facility) => {
    const inventory = state.inventories.find((item) => item.id === facilityInventoryId(facility.id));
    if (!inventory) return facility;
    return { ...facility, inventory: facility.inventory.map((entry) => ({ ...entry, amount: aggregateResource(inventory, entry.resource, timestamp) })) };
  });
  return { ...production, facilities };
}

function projectWorldCore(state: ProductInventoryState, worldCore: WorldCoreState, timestamp: number): WorldCoreState {
  const businesses = worldCore.businesses.map((business) => {
    const inventory = state.inventories.find((item) => item.id === businessInventoryId(business.id));
    if (!inventory) return business;
    const units = inventory.stacks.reduce((sum, stack) => sum + (stack.status === "available" ? stack.quantity : 0), 0);
    const target = Math.max(1, inventory.stacks.reduce((sum, stack) => sum + Math.max(stack.quantity, getProduct(stack.productId).stackLimit), 0));
    return { ...business, stockUnits: units, stockPercent: clamp(Math.round(units / target * 100)), lastUpdatedAt: timestamp };
  });
  return { ...worldCore, businesses, lastUpdatedAt: timestamp };
}

export function projectProductInventoryState(state: ProductInventoryState, input: ProductInventoryInput): ProductInventoryProjectionResult {
  const worldCore = projectWorldCore(state, input.worldCore, input.timestamp);
  const food = projectFood(state, input);
  const population = projectHouseholds(state, input.population, input.timestamp);
  const production = projectProduction(state, input.production, input.timestamp);
  const urban = projectVenueOperations(state, input.urban, worldCore, input.timestamp);
  const projectedInput: ProductInventoryInput = { ...input, worldCore, food, population, production, urban };
  const projectedTargets = adapterTargets(projectedInput);
  const adapterQuantities = Object.fromEntries(projectedTargets.map((target) => [target.key, target.quantity]));
  const adapterBindings = Object.fromEntries(projectedTargets.map((target) => [target.key, { inventoryId: target.inventoryId, ownerEntityId: target.ownerEntityId, ownerKind: target.ownerKind, compartment: target.compartment, locationId: target.locationId, productId: target.productId }]));
  const projectedState = { ...state, adapterQuantities, adapterBindings, totals: totals(state), integrity: integrity(state, input.timestamp), lastUpdatedAt: input.timestamp };
  return { state: projectedState, food, population, production, urban, worldCore };
}

export function findInventory(state: ProductInventoryState, ownerEntityId: string, compartment = "main"): InventoryState | undefined {
  return state.inventories.find((item) => item.ownerEntityId === ownerEntityId && item.compartment === compartment);
}
