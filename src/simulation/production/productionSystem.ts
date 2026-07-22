import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import { FOOD_CATALOG } from "../../data/products/foodCatalog";
import type { BusinessState, LocalEconomyState, SupplyClass } from "../../gameplay/economy/types";
import type { FoodState } from "../../gameplay/food/foodSystem";
import type { DistrictState, LocationState, OrganizationState } from "../../world/state/types";
import { getPopulationWorkerAvailability } from "../population/populationSystem";
import type { PopulationState } from "../population/types";
import type { InfrastructureKind, InfrastructureState } from "../infrastructure/types";
import type { KernelResource, KernelTransactionDraft } from "../kernel/types";
import type {
  ProductionAdvanceResult,
  ProductionFacilityKind,
  ProductionFacilityState,
  ProductionFacilityStatus,
  ProductionInventoryItem,
  ProductionNotice,
  ProductionOrganizationBudgetDelta,
  ProductionRecipeState,
  ProductionResource,
  ProductionShipmentState,
  ProductionState,
  ProductionSupplyContract,
  ProductionTargetKind,
  ProductionTotals,
  ShipmentLegality
} from "./types";

const CYCLE_MS = 6 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_SHIPMENTS = 600;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function kernelSystem(seed: string, scope: string): string {
  return createStableEntityId("kernel-system", `${seed}:${scope}`);
}

export function kernelResourceForProduction(resource: ProductionResource): KernelResource {
  if (resource === "food-units") return "food-units";
  if (resource === "medical-units") return "medical-units";
  if (resource === "parts-units") return "parts-units";
  if (resource === "document-units") return "document-units";
  if (resource === "mixed-units") return "mixed-units";
  if (resource === "biomass-feedstock") return "biomass-units";
  if (resource === "chemical-feedstock") return "chemical-units";
  if (resource === "alloy-feedstock") return "alloy-units";
  if (resource === "electronic-components") return "electronic-units";
  if (resource === "data-substrate") return "data-substrate-units";
  return "packaging-units";
}

function emptyTotals(): ProductionTotals {
  return {
    importedUnits: 0,
    producedUnits: 0,
    deliveredUnits: 0,
    lostUnits: 0,
    legalWholesaleRevenue: 0,
    blackMarketRevenue: 0,
    importCosts: 0,
    productionCosts: 0,
    shipmentsCreated: 0,
    shipmentsDelivered: 0,
    contractBreaches: 0
  };
}

function addTotals(target: ProductionTotals, delta: Partial<ProductionTotals>): void {
  for (const [key, value] of Object.entries(delta) as Array<[keyof ProductionTotals, number | undefined]>) {
    if (typeof value === "number") target[key] += value;
  }
}

function inventoryAmount(facility: ProductionFacilityState, resource: ProductionResource): number {
  return facility.inventory.find((item) => item.resource === resource)?.amount ?? 0;
}

function setInventory(facility: ProductionFacilityState, resource: ProductionResource, amount: number): ProductionFacilityState {
  const inventory = facility.inventory.filter((item) => item.resource !== resource);
  inventory.push({ resource, amount: Math.max(0, round(amount)) });
  return { ...facility, inventory };
}

function addInventory(facility: ProductionFacilityState, resource: ProductionResource, amount: number): ProductionFacilityState {
  return setInventory(facility, resource, inventoryAmount(facility, resource) + amount);
}

function removeInventory(facility: ProductionFacilityState, resource: ProductionResource, amount: number): ProductionFacilityState {
  return setInventory(facility, resource, inventoryAmount(facility, resource) - amount);
}

function inventory(items: Partial<Record<ProductionResource, number>>): ProductionInventoryItem[] {
  return Object.entries(items)
    .filter((entry): entry is [ProductionResource, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([resource, amount]) => ({ resource, amount }));
}

function findOrganization(organizations: OrganizationState[], type: OrganizationState["type"], fallback: OrganizationState): OrganizationState {
  return organizations.find((item) => item.type === type) ?? fallback;
}

function findLocation(locations: LocationState[], type: LocationState["type"], fallback: LocationState, organizationId?: string): LocationState {
  return locations.find((item) => item.type === type && (!organizationId || item.organizationId === organizationId))
    ?? locations.find((item) => item.type === type)
    ?? fallback;
}

function recipe(
  seed: string,
  scope: string,
  name: string,
  facilityKind: ProductionRecipeState["facilityKind"],
  inputs: ProductionRecipeState["inputs"],
  outputs: ProductionRecipeState["outputs"],
  batchHours: number,
  laborHours: number,
  powerUnits: number,
  waterUnits: number,
  dataUnits: number,
  wasteUnits: number,
  operatingCost: number,
  legality: ShipmentLegality = "licensed"
): ProductionRecipeState {
  return {
    id: createStableEntityId("production-recipe", `${seed}:${scope}`),
    name,
    facilityKind,
    inputs,
    outputs,
    batchHours,
    laborHours,
    powerUnits,
    waterUnits,
    dataUnits,
    wasteUnits,
    operatingCost,
    legality
  };
}

function facility(
  seed: string,
  scope: string,
  name: string,
  kind: ProductionFacilityKind,
  location: LocationState,
  owner: OrganizationState,
  cash: number,
  startingInventory: Partial<Record<ProductionResource, number>>,
  recipeIds: string[],
  timestamp: number
): ProductionFacilityState {
  return {
    id: createStableEntityId("production-facility", `${seed}:${scope}`),
    name,
    kind,
    districtId: location.districtId,
    locationId: location.id,
    ownerEntityId: owner.id,
    status: "stable",
    condition: 82,
    capacityLevel: kind === "warehouse" || kind === "distribution-hub" ? 3 : 2,
    staffing: 72,
    infrastructureLevel: 100,
    cash,
    inventory: inventory(startingInventory),
    recipeIds,
    batchProgressHours: 0,
    productionBacklog: 0,
    shortageHours: 0,
    throughputToday: 0,
    operatingCostToday: 0,
    lossesToday: 0,
    lastSettlementDay: Math.floor(timestamp / DAY_MS),
    lastUpdatedAt: timestamp
  };
}

function contract(
  seed: string,
  scope: string,
  sourceFacilityId: string,
  targetKind: ProductionTargetKind,
  resource: ProductionResource,
  reorderPoint: number,
  targetStock: number,
  batchSize: number,
  unitPrice: number,
  timestamp: number,
  targetFacilityId?: string,
  targetBusinessId?: string,
  legality: ShipmentLegality = "licensed"
): ProductionSupplyContract {
  return {
    id: createStableEntityId("production-contract", `${seed}:${scope}`),
    sourceFacilityId,
    targetKind,
    targetFacilityId,
    targetBusinessId,
    resource,
    reorderPoint,
    targetStock,
    batchSize,
    unitPrice,
    legality,
    status: "active",
    breachCount: 0,
    nextReviewAt: timestamp + DAY_MS
  };
}

function resourceForSupply(supplyClass: SupplyClass): ProductionResource {
  if (supplyClass === "food") return "food-units";
  if (supplyClass === "medical") return "medical-units";
  if (supplyClass === "parts") return "parts-units";
  if (supplyClass === "documents") return "document-units";
  return "mixed-units";
}

function outputProducer(facilities: ProductionFacilityState[], resource: ProductionResource): ProductionFacilityState | undefined {
  return facilities.find((item) => inventoryAmount(item, resource) > 0 && item.kind !== "distribution-hub" && item.kind !== "warehouse" && item.kind !== "black-market")
    ?? facilities.find((item) => item.recipeIds.length > 0 && item.kind !== "distribution-hub" && item.kind !== "warehouse" && item.kind !== "black-market");
}

export function createProductionState(
  seed: string,
  timestamp: number,
  districts: DistrictState[],
  locations: LocationState[],
  organizations: OrganizationState[],
  economy: LocalEconomyState
): ProductionState {
  const fallbackOrganization = organizations[0];
  const fallbackLocation = locations[0];
  if (!fallbackOrganization || !fallbackLocation) {
    return { version: 1, recipes: [], facilities: [], contracts: [], shipments: [], totals: emptyTotals(), cycleIndex: Math.floor(timestamp / CYCLE_MS), dayIndex: Math.floor(timestamp / DAY_MS), simulatedCycles: 0, lastUpdatedAt: timestamp };
  }

  const transitOwner = findOrganization(organizations, "transport", fallbackOrganization);
  const companyOwner = findOrganization(organizations, "company", fallbackOrganization);
  const medicalOwner = findOrganization(organizations, "medical", fallbackOrganization);
  const corporateOwner = findOrganization(organizations, "corporation", fallbackOrganization);
  const gangOwner = findOrganization(organizations, "gang", fallbackOrganization);
  const transitLocation = findLocation(locations, "transport", fallbackLocation, transitOwner.id);
  const logisticsLocation = locations.find((item) => item.type === "transport" && item.organizationId === companyOwner.id)
    ?? locations.find((item) => item.type === "transport" && item.name.includes("MESHLINE"))
    ?? transitLocation;
  const workshop = findLocation(locations, "workshop", fallbackLocation, companyOwner.id);
  const clinic = findLocation(locations, "clinic", fallbackLocation, medicalOwner.id);
  const office = findLocation(locations, "office", fallbackLocation, corporateOwner.id);
  const market = findLocation(locations, "market", fallbackLocation);
  const foodLocation = findLocation(locations, "food", workshop);

  const recipes = [
    recipe(seed, "nutrient", "CULTURED NUTRIENT BATCH", "processor", [{ resource: "biomass-feedstock", amount: 3 }, { resource: "packaging-units", amount: 1 }], [{ resource: "food-units", amount: 5 }], 6, 12, 18, 22, 4, 8, 10),
    recipe(seed, "medical", "CLINICAL REAGENT BATCH", "processor", [{ resource: "chemical-feedstock", amount: 3 }, { resource: "biomass-feedstock", amount: 1 }, { resource: "packaging-units", amount: 1 }], [{ resource: "medical-units", amount: 3 }], 8, 18, 22, 16, 14, 6, 14),
    recipe(seed, "parts", "MICROFAB SERVICE PARTS", "factory", [{ resource: "alloy-feedstock", amount: 4 }, { resource: "electronic-components", amount: 2 }], [{ resource: "parts-units", amount: 3 }], 8, 20, 34, 4, 12, 12, 18),
    recipe(seed, "documents", "SECURE DATA SUBSTRATE", "factory", [{ resource: "data-substrate", amount: 3 }, { resource: "electronic-components", amount: 1 }], [{ resource: "document-units", amount: 4 }], 4, 10, 12, 2, 28, 4, 12),
    recipe(seed, "mixed", "CONSOLIDATED SERVICE CARGO", "factory", [{ resource: "parts-units", amount: 1 }, { resource: "document-units", amount: 1 }, { resource: "packaging-units", amount: 1 }], [{ resource: "mixed-units", amount: 3 }], 6, 12, 14, 2, 18, 5, 10)
  ];

  const importTerminal = facility(seed, "freight-intake", "NORTHLINE FREIGHT INTAKE", "import-terminal", transitLocation, transitOwner, 52_000, {
    "biomass-feedstock": 760,
    "chemical-feedstock": 520,
    "alloy-feedstock": 620,
    "electronic-components": 430,
    "data-substrate": 480,
    "packaging-units": 760
  }, [], timestamp);
  const foodPlant = facility(seed, "nutrient-plant", "MIREVA CULTURE LINE", "processor", foodLocation, companyOwner, 18_000, { "biomass-feedstock": 140, "packaging-units": 90, "food-units": 180 }, [recipes[0].id], timestamp);
  const medicalLab = facility(seed, "reagent-lab", "CMU REAGENT LAB", "processor", clinic, medicalOwner, 28_000, { "chemical-feedstock": 110, "biomass-feedstock": 55, "packaging-units": 60, "medical-units": 95 }, [recipes[1].id], timestamp);
  const partsFactory = facility(seed, "microfab", "VECTRA MICROFAB 12", "factory", workshop, companyOwner, 24_000, { "alloy-feedstock": 160, "electronic-components": 80, "parts-units": 120 }, [recipes[2].id], timestamp);
  const dataFoundry = facility(seed, "data-foundry", "AURELIAN DATA FOUNDRY", "factory", office, corporateOwner, 64_000, { "data-substrate": 170, "electronic-components": 70, "document-units": 150 }, [recipes[3].id], timestamp);
  const distributionHub = facility(seed, "distribution-hub", "MESHLINE CONSOLIDATION HUB", "distribution-hub", logisticsLocation, companyOwner, 32_000, { "food-units": 220, "medical-units": 120, "parts-units": 150, "document-units": 170, "mixed-units": 90, "packaging-units": 120 }, [recipes[4].id], timestamp);
  const blackMarket = facility(seed, "backchannel", "UNDERLINE BACKCHANNEL", "black-market", market, gangOwner, 12_000, { "food-units": 55, "medical-units": 35, "parts-units": 45, "document-units": 30, "mixed-units": 80 }, [], timestamp);
  const facilities = [importTerminal, foodPlant, medicalLab, partsFactory, dataFoundry, distributionHub, blackMarket];

  const contracts: ProductionSupplyContract[] = [];
  const rawTargets: Array<[ProductionFacilityState, ProductionResource, number, number, number]> = [
    [foodPlant, "biomass-feedstock", 70, 180, 90],
    [foodPlant, "packaging-units", 45, 120, 60],
    [medicalLab, "chemical-feedstock", 60, 150, 75],
    [medicalLab, "biomass-feedstock", 35, 90, 45],
    [medicalLab, "packaging-units", 35, 90, 45],
    [partsFactory, "alloy-feedstock", 80, 200, 100],
    [partsFactory, "electronic-components", 45, 120, 60],
    [dataFoundry, "data-substrate", 80, 210, 105],
    [dataFoundry, "electronic-components", 40, 110, 55],
    [distributionHub, "packaging-units", 55, 150, 75]
  ];
  rawTargets.forEach(([target, resource, reorderPoint, targetStock, batchSize], index) => {
    const price = resource === "electronic-components" ? 8 : resource === "data-substrate" ? 6 : resource === "chemical-feedstock" ? 5 : resource === "alloy-feedstock" ? 4 : resource === "packaging-units" ? 2 : 3;
    contracts.push(contract(seed, `raw:${index}:${target.id}:${resource}`, importTerminal.id, "facility", resource, reorderPoint, targetStock, batchSize, price, timestamp, target.id));
  });

  for (const resource of ["food-units", "medical-units", "parts-units", "document-units"] as const) {
    const source = outputProducer(facilities, resource);
    if (!source) continue;
    const price = resource === "medical-units" ? 12 : resource === "parts-units" ? 18 : resource === "document-units" ? 11 : 5;
    contracts.push(contract(seed, `hub:${resource}`, source.id, "facility", resource, 90, 260, 120, price, timestamp, distributionHub.id));
  }

  for (const business of economy.businesses) {
    const resource = resourceForSupply(business.supplyClass);
    const wholesalePrice = resource === "medical-units" ? 17 : resource === "parts-units" ? 24 : resource === "document-units" ? 15 : resource === "mixed-units" ? 18 : 7;
    contracts.push(contract(seed, `business:${business.id}`, distributionHub.id, "business", resource, 42, 82, Math.max(24, business.capacityLevel * 30), wholesalePrice, timestamp, undefined, business.id));
  }

  return {
    version: 1,
    recipes,
    facilities,
    contracts,
    shipments: [],
    totals: emptyTotals(),
    cycleIndex: Math.floor(timestamp / CYCLE_MS),
    dayIndex: Math.floor(timestamp / DAY_MS),
    simulatedCycles: 0,
    lastUpdatedAt: timestamp
  };
}

function infrastructureLevelAt(state: InfrastructureState, locationId: string, kinds: InfrastructureKind[]): number {
  const levels = kinds.map((kind) => state.services.find((item) => item.locationId === locationId && item.kind === kind)?.serviceLevel ?? 100);
  if (!levels.length) return 100;
  const average = levels.reduce((sum, value) => sum + value, 0) / levels.length;
  const weakest = Math.min(...levels);
  return clamp(Math.round(average * 0.76 + weakest * 0.24));
}

function facilityStatus(condition: number, staffing: number, infrastructureLevel: number, cash: number, shortageHours: number): ProductionFacilityStatus {
  if (condition < 15 || staffing < 12 || infrastructureLevel < 18 || cash <= -500) return "offline";
  if (condition < 34 || staffing < 28 || infrastructureLevel < 38 || cash < 120 || shortageHours >= 36) return "restricted";
  if (condition < 58 || staffing < 52 || infrastructureLevel < 68 || cash < 900 || shortageHours >= 12) return "strained";
  return "stable";
}

function facilityDemandAmount(facility: ProductionFacilityState, resource: ProductionResource): number {
  return inventoryAmount(facility, resource);
}

function targetAmount(contractState: ProductionSupplyContract, facilities: ProductionFacilityState[], economy: LocalEconomyState): number {
  if (contractState.targetKind === "facility" && contractState.targetFacilityId) {
    const target = facilities.find((item) => item.id === contractState.targetFacilityId);
    return target ? facilityDemandAmount(target, contractState.resource) : contractState.targetStock;
  }
  if (contractState.targetBusinessId) {
    return economy.businesses.find((item) => item.id === contractState.targetBusinessId)?.stock ?? contractState.targetStock;
  }
  return contractState.targetStock;
}

function shipmentRoute(source: ProductionFacilityState, targetDistrictId: string): string[] {
  return source.districtId === targetDistrictId ? [source.districtId] : [source.districtId, targetDistrictId];
}

function targetDistrict(contractState: ProductionSupplyContract, facilities: ProductionFacilityState[], economy: LocalEconomyState, locations: LocationState[]): string | undefined {
  if (contractState.targetKind === "facility" && contractState.targetFacilityId) return facilities.find((item) => item.id === contractState.targetFacilityId)?.districtId;
  const business = economy.businesses.find((item) => item.id === contractState.targetBusinessId);
  return business ? locations.find((item) => item.id === business.locationId)?.districtId : undefined;
}

function openShipmentForContract(shipments: ProductionShipmentState[], contractId: string): boolean {
  return shipments.some((item) => item.contractId === contractId && (item.status === "queued" || item.status === "in-transit"));
}

function createShipment(
  seed: string,
  cycle: number,
  sequence: number,
  source: ProductionFacilityState,
  contractState: ProductionSupplyContract | undefined,
  targetKind: ProductionTargetKind,
  resource: ProductionResource,
  units: number,
  unitPrice: number,
  legality: ShipmentLegality,
  timestamp: number,
  transportLevel: number,
  targetDistrictId: string,
  targetFacilityId?: string,
  targetBusinessId?: string
): ProductionShipmentState {
  const distanceHours = source.districtId === targetDistrictId ? 2 : 5;
  const delayHours = Math.max(0, Math.ceil((100 - transportLevel) / 18));
  const transitHours = distanceHours + delayHours;
  const condition = clamp(100 - Math.round((100 - transportLevel) * 0.18) - (source.districtId === targetDistrictId ? 1 : 5), 42, 100);
  return {
    id: createStableEntityId("production-shipment", `${seed}:${cycle}:${sequence}:${source.id}:${targetFacilityId ?? targetBusinessId}:${resource}`),
    contractId: contractState?.id,
    sourceFacilityId: source.id,
    targetKind,
    targetFacilityId,
    targetBusinessId,
    resource,
    units,
    unitPrice,
    status: "in-transit",
    legality,
    createdAt: timestamp,
    departedAt: timestamp,
    estimatedArrivalAt: timestamp + transitHours * 60 * 60_000,
    condition,
    delayHours,
    transportCapacityUsed: Math.max(1, Math.ceil(units / 8)),
    routeDistrictIds: shipmentRoute(source, targetDistrictId)
  };
}

function pushBudgetDelta(deltas: ProductionOrganizationBudgetDelta[], organizationId: string, delta: number): void {
  if (!delta) return;
  const existing = deltas.find((item) => item.organizationId === organizationId);
  if (existing) existing.delta += delta;
  else deltas.push({ organizationId, delta });
}

function businessStatus(stock: number, staffing: number, cash: number): BusinessState["status"] {
  if (stock <= 4 || staffing <= 16 || cash <= 0) return "closed";
  if (stock < 18 || staffing < 31 || cash < 240) return "restricted";
  if (stock < 42 || staffing < 52 || cash < 900) return "strained";
  return "stable";
}

function addFoodStock(food: FoodState, locationId: string, resource: ProductionResource, units: number): FoodState {
  const current = food.shopStocks[locationId];
  if (!current || units <= 0) return food;
  const eligible = Object.keys(current).filter((productId) => {
    const product = FOOD_CATALOG.find((item) => item.id === productId);
    if (!product) return false;
    if (resource === "medical-units") return product.category === "medical" || product.tags.includes("MEDICAL");
    return resource === "food-units" ? product.category !== "medical" : false;
  });
  const keys = eligible.length ? eligible : Object.keys(current);
  if (!keys.length) return food;
  const next = { ...current };
  for (let index = 0; index < units; index += 1) {
    const key = keys[index % keys.length];
    next[key] = (next[key] ?? 0) + 1;
  }
  return { ...food, shopStocks: { ...food.shopStocks, [locationId]: next } };
}

function processDeliveredShipment(
  shipment: ProductionShipmentState,
  timestamp: number,
  facilities: ProductionFacilityState[],
  economy: LocalEconomyState,
  food: FoodState,
  contracts: ProductionSupplyContract[],
  totals: ProductionTotals,
  transactions: KernelTransactionDraft[],
  seed: string
): { shipment: ProductionShipmentState; facilities: ProductionFacilityState[]; economy: LocalEconomyState; food: FoodState; contracts: ProductionSupplyContract[] } {
  const source = facilities.find((item) => item.id === shipment.sourceFacilityId);
  if (!source) return { shipment: { ...shipment, status: "lost", deliveredAt: timestamp }, facilities, economy, food, contracts };
  const deliveredUnits = Math.max(0, Math.floor(shipment.units * shipment.condition / 100));
  const lostUnits = shipment.units - deliveredUnits;
  let payment = 0;
  let nextFacilities = facilities;
  let nextEconomy = economy;
  let nextFood = food;
  let contractBreached = false;
  const logisticsClearing = kernelSystem(seed, "logistics-clearing");

  if (shipment.targetKind === "facility" && shipment.targetFacilityId) {
    const target = nextFacilities.find((item) => item.id === shipment.targetFacilityId);
    if (!target) return { shipment: { ...shipment, status: "lost", deliveredAt: timestamp }, facilities, economy, food, contracts };
    payment = Math.min(target.cash, Math.round(deliveredUnits * shipment.unitPrice));
    contractBreached = payment < deliveredUnits * shipment.unitPrice;
    nextFacilities = nextFacilities.map((item) => {
      if (item.id === target.id) return addInventory({ ...item, cash: item.cash - payment }, shipment.resource, deliveredUnits);
      if (item.id === source.id) return { ...item, cash: item.cash + payment, throughputToday: item.throughputToday + deliveredUnits };
      return item;
    });
  } else if (shipment.targetBusinessId) {
    const business = nextEconomy.businesses.find((item) => item.id === shipment.targetBusinessId);
    if (!business) return { shipment: { ...shipment, status: "lost", deliveredAt: timestamp }, facilities, economy, food, contracts };
    payment = Math.min(Math.max(0, business.cash), Math.round(deliveredUnits * shipment.unitPrice));
    contractBreached = payment < deliveredUnits * shipment.unitPrice;
    const stockGain = Math.max(1, Math.round(deliveredUnits / 3));
    nextEconomy = {
      ...nextEconomy,
      businesses: nextEconomy.businesses.map((item) => {
        if (item.id !== business.id) return item;
        const stock = clamp(item.stock + stockGain);
        return {
          ...item,
          cash: item.cash - payment,
          stock,
          shortage: stock < 42,
          supplierCostsToday: item.supplierCostsToday + payment,
          status: businessStatus(stock, item.staffing, item.cash - payment),
          priceIndex: clamp(item.priceIndex - Math.max(1, Math.round(stockGain / 4)), 82, 175)
        };
      })
    };
    if (shipment.resource === "food-units" || shipment.resource === "medical-units") {
      nextFood = addFoodStock(nextFood, business.locationId, shipment.resource, deliveredUnits);
    }
    nextFacilities = nextFacilities.map((item) => item.id === source.id ? { ...item, cash: item.cash + payment, throughputToday: item.throughputToday + deliveredUnits } : item);
  }

  transactions.push({
    idempotencyKey: `${shipment.id}:delivery:${deliveredUnits}`,
    timestamp,
    debitEntityId: logisticsClearing,
    creditEntityId: shipment.targetFacilityId ?? shipment.targetBusinessId ?? logisticsClearing,
    resource: kernelResourceForProduction(shipment.resource),
    amount: deliveredUnits,
    reason: shipment.legality === "unregistered" ? "black-market-delivery" : "shipment-delivery",
    contractId: shipment.contractId,
    description: `${source.name} shipment delivered.`
  });
  if (payment > 0) transactions.push({
    idempotencyKey: `${shipment.id}:payment:${payment}`,
    timestamp,
    debitEntityId: shipment.targetFacilityId ?? shipment.targetBusinessId ?? logisticsClearing,
    creditEntityId: source.id,
    resource: "credits",
    amount: payment,
    reason: shipment.legality === "unregistered" ? "black-market-delivery" : "wholesale-delivery",
    contractId: shipment.contractId,
    description: `${source.name} wholesale settlement.`
  });
  if (lostUnits > 0) transactions.push({
    idempotencyKey: `${shipment.id}:loss:${lostUnits}`,
    timestamp,
    debitEntityId: logisticsClearing,
    creditEntityId: kernelSystem(seed, "waste-grid"),
    resource: kernelResourceForProduction(shipment.resource),
    amount: lostUnits,
    reason: "shipment-loss",
    contractId: shipment.contractId,
    description: "Cargo lost or spoiled in transit."
  });

  addTotals(totals, {
    deliveredUnits,
    lostUnits,
    shipmentsDelivered: 1,
    legalWholesaleRevenue: shipment.legality === "unregistered" ? 0 : payment,
    blackMarketRevenue: shipment.legality === "unregistered" ? payment : 0,
    contractBreaches: contractBreached ? 1 : 0
  });
  const nextContracts = contracts.map((item) => item.id === shipment.contractId
    ? { ...item, lastDeliveredAt: timestamp, breachCount: contractBreached ? item.breachCount + 1 : Math.max(0, item.breachCount - 1), status: contractBreached ? "strained" as const : "active" as const }
    : item);
  return { shipment: { ...shipment, status: "delivered", deliveredAt: timestamp }, facilities: nextFacilities, economy: nextEconomy, food: nextFood, contracts: nextContracts };
}

function productionInputsAvailable(facilityState: ProductionFacilityState, recipeState: ProductionRecipeState): number {
  return recipeState.inputs.reduce((batches, input) => Math.min(batches, Math.floor(inventoryAmount(facilityState, input.resource) / input.amount)), Number.POSITIVE_INFINITY);
}

function runFacilityProduction(
  facilityState: ProductionFacilityState,
  recipes: ProductionRecipeState[],
  cycleHours: number,
  timestamp: number,
  transactions: KernelTransactionDraft[],
  totals: ProductionTotals,
  seed: string
): ProductionFacilityState {
  const recipeState = recipes.find((item) => facilityState.recipeIds.includes(item.id));
  if (!recipeState || facilityState.status === "offline") return facilityState;
  const efficiency = Math.min(facilityState.staffing, facilityState.infrastructureLevel, facilityState.condition) / 100;
  const availableBatches = productionInputsAvailable(facilityState, recipeState);
  const hours = facilityState.batchProgressHours + cycleHours * efficiency * facilityState.capacityLevel;
  const timeBatches = Math.floor(hours / recipeState.batchHours);
  const affordableBatches = Math.floor(Math.max(0, facilityState.cash) / recipeState.operatingCost);
  const outputCapacity = facilityState.capacityLevel * (facilityState.kind === "distribution-hub" ? 320 : 240);
  const outputHeadroomBatches = recipeState.outputs.reduce((limit, output) => Math.min(limit, Math.floor(Math.max(0, outputCapacity - inventoryAmount(facilityState, output.resource)) / output.amount)), Number.POSITIVE_INFINITY);
  const batches = Math.max(0, Math.min(timeBatches, availableBatches, affordableBatches, outputHeadroomBatches, 12));
  if (batches <= 0) {
    const shortage = availableBatches <= 0 ? facilityState.shortageHours + cycleHours : Math.max(0, facilityState.shortageHours - cycleHours);
    return { ...facilityState, batchProgressHours: hours, shortageHours: shortage, productionBacklog: facilityState.productionBacklog + (availableBatches <= 0 ? 1 : 0) };
  }

  let next = { ...facilityState, batchProgressHours: hours - batches * recipeState.batchHours, shortageHours: Math.max(0, facilityState.shortageHours - cycleHours), productionBacklog: Math.max(0, facilityState.productionBacklog - batches) };
  for (const input of recipeState.inputs) {
    const amount = input.amount * batches;
    next = removeInventory(next, input.resource, amount);
    transactions.push({
      idempotencyKey: `${seed}:production:${timestamp}:${facilityState.id}:${recipeState.id}:input:${input.resource}:${amount}`,
      timestamp,
      debitEntityId: facilityState.id,
      creditEntityId: kernelSystem(seed, "production-consumption"),
      resource: kernelResourceForProduction(input.resource),
      amount,
      reason: "production-consumption",
      description: `${facilityState.name} consumed production inputs.`
    });
  }
  for (const output of recipeState.outputs) {
    const amount = output.amount * batches;
    next = addInventory(next, output.resource, amount);
    transactions.push({
      idempotencyKey: `${seed}:production:${timestamp}:${facilityState.id}:${recipeState.id}:output:${output.resource}:${amount}`,
      timestamp,
      debitEntityId: kernelSystem(seed, "production-output"),
      creditEntityId: facilityState.id,
      resource: kernelResourceForProduction(output.resource),
      amount,
      reason: "production-output",
      description: `${facilityState.name} completed ${batches} production batches.`
    });
    addTotals(totals, { producedUnits: amount });
  }
  const operatingCost = recipeState.operatingCost * batches;
  next = {
    ...next,
    cash: next.cash - operatingCost,
    throughputToday: next.throughputToday + recipeState.outputs.reduce((sum, item) => sum + item.amount * batches, 0),
    operatingCostToday: next.operatingCostToday + operatingCost,
    condition: clamp(next.condition - Math.max(0.2, batches * 0.16), 0, 100)
  };
  transactions.push({
    idempotencyKey: `${seed}:production:${timestamp}:${facilityState.id}:${recipeState.id}:cost:${operatingCost}`,
    timestamp,
    debitEntityId: facilityState.id,
    creditEntityId: kernelSystem(seed, "city-services"),
    resource: "credits",
    amount: operatingCost,
    reason: "production-operating-cost",
    description: `${facilityState.name} operating cost.`
  });
  addTotals(totals, { productionCosts: operatingCost });
  return next;
}

function importRawMaterials(
  facilityState: ProductionFacilityState,
  dayIndex: number,
  timestamp: number,
  transportLevel: number,
  dataLevel: number,
  totals: ProductionTotals,
  transactions: KernelTransactionDraft[],
  seed: string
): ProductionFacilityState {
  if (facilityState.kind !== "import-terminal" || facilityState.lastSettlementDay >= dayIndex) return facilityState;
  const service = Math.min(transportLevel, dataLevel);
  const multiplier = Math.max(0.25, service / 100) * facilityState.capacityLevel;
  const plan: Array<[ProductionResource, number, number, number]> = [
    ["biomass-feedstock", 150, 2, 920],
    ["chemical-feedstock", 90, 4, 620],
    ["alloy-feedstock", 110, 3, 720],
    ["electronic-components", 75, 7, 520],
    ["data-substrate", 95, 5, 620],
    ["packaging-units", 140, 1, 920]
  ];
  let next = { ...facilityState, lastSettlementDay: dayIndex, throughputToday: 0, operatingCostToday: 0, lossesToday: 0 };
  for (const [resource, baseUnits, unitCost, targetStock] of plan) {
    const gap = Math.max(0, targetStock - inventoryAmount(next, resource));
    const desired = Math.max(0, Math.min(gap, Math.floor(baseUnits * multiplier)));
    const affordable = Math.floor(Math.max(0, next.cash) / unitCost);
    const units = Math.min(desired, affordable);
    if (units <= 0) continue;
    const cost = units * unitCost;
    next = addInventory({ ...next, cash: next.cash - cost }, resource, units);
    transactions.push({
      idempotencyKey: `${seed}:import:${dayIndex}:${facilityState.id}:${resource}:${units}`,
      timestamp,
      debitEntityId: kernelSystem(seed, "external-trade"),
      creditEntityId: facilityState.id,
      resource: kernelResourceForProduction(resource),
      amount: units,
      reason: "import-purchase",
      description: `${facilityState.name} received external feedstock.`
    });
    transactions.push({
      idempotencyKey: `${seed}:import-payment:${dayIndex}:${facilityState.id}:${resource}:${cost}`,
      timestamp,
      debitEntityId: facilityState.id,
      creditEntityId: kernelSystem(seed, "external-trade"),
      resource: "credits",
      amount: cost,
      reason: "import-purchase",
      description: `${facilityState.name} paid external supplier.`
    });
    addTotals(totals, { importedUnits: units, importCosts: cost });
  }
  return next;
}

function replenishBlackMarket(
  facilityState: ProductionFacilityState,
  dayIndex: number,
  timestamp: number,
  gangInfluence: number,
  transportLevel: number,
  totals: ProductionTotals,
  transactions: KernelTransactionDraft[],
  seed: string
): ProductionFacilityState {
  if (facilityState.kind !== "black-market" || facilityState.lastSettlementDay >= dayIndex) return facilityState;
  const access = Math.max(0.15, Math.min(1, (gangInfluence + transportLevel * 0.45) / 100));
  const plan: Array<[ProductionResource, number, number, number]> = [
    ["food-units", 30, 7, 110],
    ["medical-units", 18, 16, 70],
    ["parts-units", 22, 14, 90],
    ["document-units", 18, 10, 75],
    ["mixed-units", 35, 9, 130]
  ];
  let next = { ...facilityState, lastSettlementDay: dayIndex, throughputToday: 0, operatingCostToday: 0, lossesToday: 0 };
  for (const [resource, baseUnits, unitCost, targetStock] of plan) {
    const gap = Math.max(0, targetStock - inventoryAmount(next, resource));
    const units = Math.min(gap, Math.floor(baseUnits * access), Math.floor(Math.max(0, next.cash) / unitCost));
    if (units <= 0) continue;
    const cost = units * unitCost;
    next = addInventory({ ...next, cash: next.cash - cost }, resource, units);
    transactions.push({
      idempotencyKey: `${seed}:unregistered-import:${dayIndex}:${facilityState.id}:${resource}:${units}`,
      timestamp,
      debitEntityId: kernelSystem(seed, "unregistered-market"),
      creditEntityId: facilityState.id,
      resource: kernelResourceForProduction(resource),
      amount: units,
      reason: "import-purchase",
      description: `${facilityState.name} received unregistered cargo.`
    });
    transactions.push({
      idempotencyKey: `${seed}:unregistered-payment:${dayIndex}:${facilityState.id}:${resource}:${cost}`,
      timestamp,
      debitEntityId: facilityState.id,
      creditEntityId: kernelSystem(seed, "unregistered-market"),
      resource: "credits",
      amount: cost,
      reason: "import-purchase",
      description: `${facilityState.name} settled an unregistered supplier.`
    });
    addTotals(totals, { importedUnits: units, importCosts: cost });
  }
  return next;
}

function createContractShipment(
  contractState: ProductionSupplyContract,
  cycle: number,
  sequence: number,
  timestamp: number,
  seed: string,
  facilities: ProductionFacilityState[],
  economy: LocalEconomyState,
  locations: LocationState[],
  infrastructure: InfrastructureState,
  transactions: KernelTransactionDraft[]
): { shipment?: ProductionShipmentState; facilities: ProductionFacilityState[]; contract: ProductionSupplyContract } {
  const source = facilities.find((item) => item.id === contractState.sourceFacilityId);
  const targetDistrictId = targetDistrict(contractState, facilities, economy, locations);
  if (!source || !targetDistrictId || source.status === "offline") {
    const recordBreach = timestamp >= contractState.nextReviewAt;
    return { facilities, contract: { ...contractState, breachCount: recordBreach ? Math.min(99, contractState.breachCount + 1) : contractState.breachCount, status: contractState.breachCount >= 1 ? "breached" : "strained", nextReviewAt: recordBreach ? timestamp + DAY_MS : contractState.nextReviewAt } };
  }
  const amountAtTarget = targetAmount(contractState, facilities, economy);
  if (amountAtTarget > contractState.reorderPoint) return { facilities, contract: { ...contractState, status: "active", breachCount: Math.max(0, contractState.breachCount - 1) } };
  const available = Math.floor(inventoryAmount(source, contractState.resource));
  const needed = Math.max(0, contractState.targetStock - amountAtTarget);
  let units = Math.min(contractState.batchSize, needed, available);
  if (contractState.targetBusinessId) {
    const business = economy.businesses.find((item) => item.id === contractState.targetBusinessId);
    if (business) units = Math.min(units, Math.floor(Math.max(0, business.cash) / Math.max(1, contractState.unitPrice)));
  } else if (contractState.targetFacilityId) {
    const target = facilities.find((item) => item.id === contractState.targetFacilityId);
    if (target) units = Math.min(units, Math.floor(Math.max(0, target.cash) / Math.max(1, contractState.unitPrice)));
  }
  if (units <= 0) {
    const recordBreach = timestamp >= contractState.nextReviewAt;
    return { facilities, contract: { ...contractState, breachCount: recordBreach ? Math.min(99, contractState.breachCount + 1) : contractState.breachCount, status: contractState.breachCount >= 1 ? "breached" : "strained", nextReviewAt: recordBreach ? timestamp + DAY_MS : contractState.nextReviewAt } };
  }
  const transportLevel = Math.min(
    infrastructureLevelAt(infrastructure, source.locationId, ["transport", "data"]),
    contractState.targetFacilityId
      ? infrastructureLevelAt(infrastructure, facilities.find((item) => item.id === contractState.targetFacilityId)?.locationId ?? source.locationId, ["transport", "data"])
      : infrastructureLevelAt(infrastructure, economy.businesses.find((item) => item.id === contractState.targetBusinessId)?.locationId ?? source.locationId, ["transport", "data"])
  );
  const shipment = createShipment(seed, cycle, sequence, source, contractState, contractState.targetKind, contractState.resource, units, contractState.unitPrice, contractState.legality, timestamp, transportLevel, targetDistrictId, contractState.targetFacilityId, contractState.targetBusinessId);
  const nextFacilities = facilities.map((item) => item.id === source.id ? removeInventory(item, contractState.resource, units) : item);
  transactions.push({
    idempotencyKey: `${shipment.id}:dispatch:${units}`,
    timestamp,
    debitEntityId: source.id,
    creditEntityId: kernelSystem(seed, "logistics-clearing"),
    resource: kernelResourceForProduction(contractState.resource),
    amount: units,
    reason: "shipment-dispatch",
    contractId: contractState.id,
    description: `${source.name} dispatched wholesale cargo.`
  });
  return { shipment, facilities: nextFacilities, contract: { ...contractState, lastOrderedAt: timestamp, status: "active", nextReviewAt: timestamp + DAY_MS } };
}

function createEmergencyShipment(
  business: BusinessState,
  cycle: number,
  sequence: number,
  timestamp: number,
  seed: string,
  facilities: ProductionFacilityState[],
  locations: LocationState[],
  infrastructure: InfrastructureState,
  transactions: KernelTransactionDraft[]
): { shipment?: ProductionShipmentState; facilities: ProductionFacilityState[] } {
  const black = facilities.find((item) => item.kind === "black-market");
  const location = locations.find((item) => item.id === business.locationId);
  if (!black || !location || black.status === "offline") return { facilities };
  const resource = resourceForSupply(business.supplyClass);
  const available = Math.floor(inventoryAmount(black, resource));
  const unitPrice = Math.max(8, Math.round(business.priceIndex / 7));
  const units = Math.min(24, available, Math.floor(Math.max(0, business.cash) / unitPrice));
  if (units <= 0) return { facilities };
  const transportLevel = Math.min(
    infrastructureLevelAt(infrastructure, black.locationId, ["transport", "data"]),
    infrastructureLevelAt(infrastructure, business.locationId, ["transport", "data"])
  );
  const shipment = createShipment(seed, cycle, sequence, black, undefined, "business", resource, units, unitPrice, "unregistered", timestamp, transportLevel, location.districtId, undefined, business.id);
  const nextFacilities = facilities.map((item) => item.id === black.id ? removeInventory(item, resource, units) : item);
  transactions.push({
    idempotencyKey: `${shipment.id}:dispatch:${units}`,
    timestamp,
    debitEntityId: black.id,
    creditEntityId: kernelSystem(seed, "logistics-clearing"),
    resource: kernelResourceForProduction(resource),
    amount: units,
    reason: "shipment-dispatch",
    description: `${black.name} dispatched unregistered cargo.`
  });
  return { shipment, facilities: nextFacilities };
}

export function advanceProductionAndLogistics(
  state: ProductionState,
  timestamp: number,
  seed: string,
  districts: DistrictState[],
  locations: LocationState[],
  organizations: OrganizationState[],
  population: PopulationState,
  economyInput: LocalEconomyState,
  foodInput: FoodState,
  infrastructure: InfrastructureState
): ProductionAdvanceResult {
  if (timestamp <= state.lastUpdatedAt) return { state, economy: economyInput, food: foodInput, notices: [], organizationBudgetDeltas: [], transactions: [] };
  const targetCycle = Math.floor(timestamp / CYCLE_MS);
  let cycle = Math.max(state.cycleIndex, Math.floor(state.lastUpdatedAt / CYCLE_MS));
  let facilities = state.facilities.map((item) => ({ ...item, inventory: item.inventory.map((entry) => ({ ...entry })) }));
  let contracts = state.contracts.map((item) => ({ ...item }));
  let shipments = state.shipments.map((item) => ({ ...item }));
  let economy = economyInput;
  let food = foodInput;
  const notices: ProductionNotice[] = [];
  const organizationBudgetDeltas: ProductionOrganizationBudgetDelta[] = [];
  const transactions: KernelTransactionDraft[] = [];
  const totals = { ...state.totals };
  let simulatedCycles = state.simulatedCycles;
  let dayIndex = state.dayIndex;

  while (cycle < targetCycle) {
    cycle += 1;
    simulatedCycles += 1;
    const cycleTimestamp = cycle * CYCLE_MS;
    const currentDay = Math.floor(cycleTimestamp / DAY_MS);
    const rng = new SeededRandom(`${seed}:production-cycle:${cycle}`);

    for (let index = 0; index < shipments.length; index += 1) {
      const shipment = shipments[index];
      if (shipment.status !== "in-transit" || shipment.estimatedArrivalAt > cycleTimestamp) continue;
      const result = processDeliveredShipment(shipment, cycleTimestamp, facilities, economy, food, contracts, totals, transactions, seed);
      shipments[index] = result.shipment;
      facilities = result.facilities;
      economy = result.economy;
      food = result.food;
      contracts = result.contracts;
      if (result.shipment.condition < 70 && notices.length < 10) notices.push({
        districtId: result.shipment.routeDistrictIds[result.shipment.routeDistrictIds.length - 1],
        title: "Поставка прибыла с потерями.",
        detail: `${result.shipment.resource} · состояние ${result.shipment.condition}% · потеряно ${result.shipment.units - Math.floor(result.shipment.units * result.shipment.condition / 100)} ед.`,
        importance: 2
      });
    }

    facilities = facilities.map((item) => {
      const previousStatus = item.status;
      const staffingAvailability = getPopulationWorkerAvailability(population, item.locationId);
      const observedStaffing = staffingAvailability.total
        ? clamp(Math.round(staffingAvailability.active / Math.max(1, staffingAvailability.total) * 100 - staffingAvailability.ill / Math.max(1, staffingAvailability.total) * 18), 8, 100)
        : item.staffing;
      const staffing = clamp(Math.round(item.staffing * 0.72 + observedStaffing * 0.28), 42, 100);
      const rawInfrastructureLevel = item.kind === "import-terminal" || item.kind === "distribution-hub" || item.kind === "warehouse" || item.kind === "black-market"
        ? infrastructureLevelAt(infrastructure, item.locationId, ["transport", "data", "power"])
        : infrastructureLevelAt(infrastructure, item.locationId, ["power", "water", "data", "waste"]);
      const infrastructureLevel = Math.max(item.kind === "black-market" ? 30 : item.kind === "import-terminal" || item.kind === "distribution-hub" ? 45 : 38, rawInfrastructureLevel);
      const dailyMaintenance = currentDay > item.lastSettlementDay && item.cash > 1_500 && item.condition < 82 ? Math.min(3.5, (82 - item.condition) * 0.25) : 0;
      const maintenanceCost = dailyMaintenance > 0 ? Math.round(dailyMaintenance * 32) : 0;
      const condition = clamp(item.condition - (item.infrastructureLevel < 55 ? 0.18 : 0.03) + dailyMaintenance, 0, 100);
      const status = facilityStatus(condition, staffing, infrastructureLevel, item.cash - maintenanceCost, item.shortageHours);
      if (status !== previousStatus && notices.length < 10) notices.push({
        districtId: item.districtId,
        locationId: item.locationId,
        title: status === "offline" ? `${item.name} остановил работу.` : status === "restricted" ? `${item.name} ограничил выпуск.` : status === "strained" ? `${item.name} работает нестабильно.` : `${item.name} восстановил выпуск.`,
        detail: `Состояние ${Math.round(condition)}% · персонал ${staffing}% · инфраструктура ${infrastructureLevel}%.`,
        importance: status === "offline" ? 3 : status === "restricted" ? 2 : 1
      });
      if (maintenanceCost > 0) transactions.push({
        idempotencyKey: `${seed}:production-maintenance:${currentDay}:${item.id}:${maintenanceCost}`,
        timestamp: cycleTimestamp,
        debitEntityId: item.id,
        creditEntityId: kernelSystem(seed, "maintenance"),
        resource: "credits",
        amount: maintenanceCost,
        reason: "maintenance",
        description: `${item.name} preventive maintenance.`
      });
      return { ...item, staffing, infrastructureLevel, condition, cash: item.cash - maintenanceCost, operatingCostToday: item.operatingCostToday + maintenanceCost, status, lastUpdatedAt: cycleTimestamp };
    });

    const transportLevel = infrastructure.networks.find((item) => item.kind === "transport")?.averageServiceLevel ?? 100;
    const dataLevel = infrastructure.networks.find((item) => item.kind === "data")?.averageServiceLevel ?? 100;
    const lowerDistrict = districts.slice().sort((left, right) => right.gangInfluence - left.gangInfluence)[0];
    facilities = facilities.map((item) => importRawMaterials(item, currentDay, cycleTimestamp, transportLevel, dataLevel, totals, transactions, seed));
    facilities = facilities.map((item) => replenishBlackMarket(item, currentDay, cycleTimestamp, lowerDistrict?.gangInfluence ?? 35, transportLevel, totals, transactions, seed));

    facilities = facilities.map((item) => runFacilityProduction(item, state.recipes, 6, cycleTimestamp, transactions, totals, seed));

    let sequence = shipments.length;
    for (let contractIndex = 0; contractIndex < contracts.length; contractIndex += 1) {
      const current = contracts[contractIndex];
      if (current.status === "suspended" || openShipmentForContract(shipments, current.id)) continue;
      const result = createContractShipment(current, cycle, sequence, cycleTimestamp, seed, facilities, economy, locations, infrastructure, transactions);
      facilities = result.facilities;
      contracts[contractIndex] = result.contract;
      if (result.shipment) {
        shipments.push(result.shipment);
        sequence += 1;
        addTotals(totals, { shipmentsCreated: 1 });
      } else if (result.contract.breachCount > current.breachCount) {
        addTotals(totals, { contractBreaches: 1 });
      }
    }

    const legalShipmentTargets = new Set(shipments.filter((item) => item.status === "in-transit" && item.targetBusinessId).map((item) => item.targetBusinessId));
    const failingContracts = contracts.filter((item) => item.targetKind === "business" && item.targetBusinessId && item.breachCount >= 2);
    for (const failing of failingContracts) {
      const business = economy.businesses.find((item) => item.id === failing.targetBusinessId);
      if (!business || business.stock >= 24 || legalShipmentTargets.has(business.id) || !rng.chance(0.38 + Math.min(0.35, failing.breachCount * 0.06))) continue;
      const emergency = createEmergencyShipment(business, cycle, sequence, cycleTimestamp, seed, facilities, locations, infrastructure, transactions);
      facilities = emergency.facilities;
      if (!emergency.shipment) continue;
      shipments.push(emergency.shipment);
      sequence += 1;
      addTotals(totals, { shipmentsCreated: 1 });
      if (notices.length < 10) notices.push({
        districtId: locations.find((item) => item.id === business.locationId)?.districtId,
        locationId: business.locationId,
        title: "Нелегальная поставка заняла пустой маршрут.",
        detail: `${emergency.shipment.resource} · обычный контракт сорван ${failing.breachCount} раза.`,
        importance: 2
      });
    }

    contracts = contracts.map((item) => ({
      ...item,
      status: item.breachCount >= 5 ? "breached" : item.breachCount >= 2 ? "strained" : item.status === "suspended" ? "suspended" : "active"
    }));

    if (currentDay > dayIndex) {
      dayIndex = currentDay;
      facilities = facilities.map((item) => ({ ...item, throughputToday: 0, operatingCostToday: 0, lossesToday: 0, lastSettlementDay: Math.max(item.lastSettlementDay, currentDay) }));
    }
  }

  shipments = shipments.slice(-MAX_SHIPMENTS);
  const weekAdvanced = Math.floor(timestamp / (7 * DAY_MS)) > Math.floor(state.lastUpdatedAt / (7 * DAY_MS));
  if (weekAdvanced) {
    facilities = facilities.map((item) => {
      const organization = organizations.find((entry) => entry.id === item.ownerEntityId);
      if (!organization || item.cash <= 20_000) return item;
      const transfer = Math.round((item.cash - 20_000) * 0.015);
      if (transfer <= 0) return item;
      pushBudgetDelta(organizationBudgetDeltas, organization.id, transfer);
      transactions.push({
        idempotencyKey: `${seed}:production-dividend:${Math.floor(timestamp / (7 * DAY_MS))}:${item.id}:${transfer}`,
        timestamp,
        debitEntityId: item.id,
        creditEntityId: organization.id,
        resource: "credits",
        amount: transfer,
        reason: "operating-settlement",
        description: `${item.name} transferred retained operating surplus.`
      });
      return { ...item, cash: item.cash - transfer };
    });
  }

  return {
    state: { ...state, facilities, contracts, shipments, totals, cycleIndex: cycle, dayIndex, simulatedCycles, lastUpdatedAt: timestamp },
    economy,
    food,
    notices,
    organizationBudgetDeltas,
    transactions
  };
}

export function productionResourceForSupplyClass(supplyClass: SupplyClass): ProductionResource {
  return resourceForSupply(supplyClass);
}

export function normalizeProductionState(
  value: unknown,
  seed: string,
  timestamp: number,
  districts: DistrictState[],
  locations: LocationState[],
  organizations: OrganizationState[],
  economy: LocalEconomyState
): ProductionState {
  const fresh = createProductionState(seed, timestamp, districts, locations, organizations, economy);
  if (!value || typeof value !== "object") return fresh;
  const raw = value as Partial<ProductionState>;
  if (raw.version !== 1 || !Array.isArray(raw.facilities) || !Array.isArray(raw.contracts) || !Array.isArray(raw.shipments)) return fresh;
  const facilities = fresh.facilities.map((fallback) => {
    const existing = raw.facilities?.find((item) => item.id === fallback.id);
    return existing ? { ...fallback, ...existing, inventory: Array.isArray(existing.inventory) ? existing.inventory.map((item) => ({ ...item })) : fallback.inventory } : fallback;
  });
  const contractIds = new Set(fresh.contracts.map((item) => item.id));
  const contracts = fresh.contracts.map((fallback) => {
    const existing = raw.contracts?.find((item) => item.id === fallback.id);
    return existing ? { ...fallback, ...existing } : fallback;
  });
  const shipments = raw.shipments
    .filter((item) => facilities.some((facilityState) => facilityState.id === item.sourceFacilityId))
    .filter((item) => !item.contractId || contractIds.has(item.contractId))
    .map((item) => ({ ...item }))
    .slice(-MAX_SHIPMENTS);
  return {
    ...fresh,
    ...raw,
    version: 1,
    recipes: fresh.recipes,
    facilities,
    contracts,
    shipments,
    totals: { ...fresh.totals, ...(raw.totals ?? {}) },
    cycleIndex: typeof raw.cycleIndex === "number" ? raw.cycleIndex : fresh.cycleIndex,
    dayIndex: typeof raw.dayIndex === "number" ? raw.dayIndex : fresh.dayIndex,
    simulatedCycles: typeof raw.simulatedCycles === "number" ? raw.simulatedCycles : 0,
    lastUpdatedAt: typeof raw.lastUpdatedAt === "number" ? raw.lastUpdatedAt : timestamp
  };
}
