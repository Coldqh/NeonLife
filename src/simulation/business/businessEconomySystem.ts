import { createStableEntityId } from "../../core/ids/entityId";
import { SeededRandom } from "../../core/random/seededRandom";
import { PRODUCT_CATALOG, getProduct } from "../../data/products/productCatalog";
import type { ProductCategory } from "../../data/products/types";
import type { BusinessStatus } from "../../gameplay/economy/types";
import {
  businessInventoryId,
  ensureCanonicalInventory,
  finalizeProductInventoryState,
  stockCanonicalInventory,
  seedCanonicalInventories
} from "../inventory/inventorySystem";
import type { InventoryState, ProductBatchState, ProductInventoryState, ProductTransferState } from "../inventory/types";
import { kernelSystemEntityId } from "../kernel/simulationKernel";
import type { KernelAccountState, KernelResource, KernelTransactionDraft, SimulationKernelState } from "../kernel/types";
import { indexCitywideVenues } from "../urban/urbanSystem";
import type { VenueCategory, VenueOperatingStatus, VenueState } from "../urban/types";
import type { WorldCoreBusinessState, WorldCoreBusinessStatus, WorldCoreState } from "../worldCore/types";
import type {
  BusinessCompanyKind,
  BusinessCompanyState,
  BusinessEconomyAdvanceResult,
  BusinessEconomyDailySnapshot,
  BusinessEconomyInput,
  BusinessEconomyIntegrityState,
  BusinessEconomyState,
  BusinessEconomyTotals,
  BusinessLeaseState,
  BusinessLifecycleEventKind,
  BusinessLifecycleEventState,
  BusinessLicenseStatus,
  BusinessMarketState,
  BusinessStrategy,
  UnifiedBusinessState
} from "./types";

const DAY_MS = 24 * 60 * 60_000;
const HISTORY_LIMIT = 180;
const EVENT_LIMIT = 800;
const BUSINESS_CAP = 8_000;

const CATEGORY_PRODUCTS: Partial<Record<UnifiedBusinessState["category"], ProductCategory[]>> = {
  convenience: ["food", "drink", "household", "electronics"],
  food: ["food", "drink"],
  bar: ["drink", "food", "contraband"],
  pharmacy: ["medicine", "household"],
  clinic: ["medicine", "cyberware"],
  repair: ["vehicle-part", "tool", "fuel"],
  cyberware: ["cyberware", "electronics", "medicine"],
  clothing: ["apparel", "armor"],
  entertainment: ["drink", "electronics", "contraband"],
  hotel: ["food", "drink", "household"],
  "office-service": ["electronics", "household"],
  market: ["food", "drink", "medicine", "household", "tool", "apparel", "electronics", "contraband"],
  logistics: ["tool", "vehicle-part", "fuel"],
  corporate: ["electronics", "household"],
  education: ["electronics", "household"],
  government: ["electronics", "household"],
  transport: ["fuel", "vehicle-part", "food", "drink"]
};

const DEMAND_PER_THOUSAND: Record<UnifiedBusinessState["category"], number> = {
  convenience: 1.5,
  food: 1.25,
  bar: .38,
  pharmacy: .42,
  clinic: .18,
  repair: .22,
  cyberware: .04,
  clothing: .18,
  entertainment: .2,
  hotel: .08,
  "office-service": .16,
  market: .78,
  logistics: .14,
  corporate: .09,
  education: .08,
  government: .06,
  transport: .32
};

const SERVICE_CATEGORIES = new Set<UnifiedBusinessState["category"]>(["clinic", "repair", "cyberware", "entertainment", "hotel", "office-service", "logistics", "corporate", "education", "government", "transport"]);

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function dayIndex(timestamp: number): number {
  return Math.floor(timestamp / DAY_MS);
}

function creditBalance(kernel: SimulationKernelState | undefined, entityId: string): number | undefined {
  const account: KernelAccountState | undefined = kernel?.accounts.find((item) => item.entityId === entityId);
  return account?.balances.find((item) => item.resource === "credits")?.amount;
}

function categoryStrategy(category: UnifiedBusinessState["category"], companyKind: BusinessCompanyKind, rng: SeededRandom): BusinessStrategy {
  if (companyKind === "criminal") return rng.pick(["premium", "specialist", "survival"] as const);
  if (companyKind === "corporate" || companyKind === "franchise") return rng.pick(["volume", "premium", "expansion"] as const);
  if (["clinic", "cyberware", "repair", "office-service"].includes(category)) return "specialist";
  return rng.pick(["value", "volume", "specialist", "survival"] as const);
}

function companyKindFor(venue: VenueState, input: BusinessEconomyInput): { kind: BusinessCompanyKind; id: string; parentOrganizationId?: string } {
  const rng = new SeededRandom(`${input.seed}:business-company:${venue.id}:v1`);
  const parent = venue.organizationId ?? input.organizations[0]?.id;
  const roll = rng.next();
  if (venue.permanent && parent) {
    const org = input.organizations.find((item) => item.id === parent);
    if (org?.type === "government" || org?.type === "medical" || org?.type === "transport") return { kind: "public", id: parent, parentOrganizationId: parent };
    if (org?.type === "gang") return { kind: "criminal", id: parent, parentOrganizationId: parent };
    return { kind: "corporate", id: parent, parentOrganizationId: parent };
  }
  if (roll < .36) return { kind: "independent", id: createStableEntityId("business-company", `independent:${venue.id}`) };
  if (roll < .52) {
    const bucket = rng.integer(0, 16);
    return { kind: "independent", id: createStableEntityId("business-company", `chain:${venue.districtId}:${venue.category}:${bucket}`) };
  }
  if (roll < .66 && parent) {
    const bucket = rng.integer(0, 8);
    return { kind: "franchise", id: createStableEntityId("business-company", `franchise:${parent}:${venue.districtId}:${venue.category}:${bucket}`), parentOrganizationId: parent };
  }
  if (roll < .82 && parent) return { kind: "corporate", id: parent, parentOrganizationId: parent };
  if (roll < .92) {
    const bucket = rng.integer(0, 9);
    return { kind: "cooperative", id: createStableEntityId("business-company", `cooperative:${venue.districtId}:${venue.category}:${bucket}`) };
  }
  if (["bar", "market", "cyberware", "entertainment", "repair"].includes(venue.category)) {
    const gang = input.organizations.find((item) => item.type === "gang");
    return { kind: "criminal", id: gang?.id ?? createStableEntityId("business-company", `criminal:${venue.districtId}:${venue.category}`), parentOrganizationId: gang?.id };
  }
  return { kind: "independent", id: createStableEntityId("business-company", `independent:${venue.id}`) };
}

function companyName(id: string, kind: BusinessCompanyKind, venue: VenueState, input: BusinessEconomyInput): string {
  const organization = input.organizations.find((item) => item.id === id);
  if (organization) return organization.name;
  const suffix = kind === "franchise" ? "FRANCHISE GROUP" : kind === "cooperative" ? "WORKERS CO-OP" : kind === "criminal" ? "BACKCHANNEL" : kind === "independent" ? "TRADING" : "HOLDINGS";
  return `${venue.name.split(" ").slice(0, 2).join(" ")} ${suffix}`;
}

function businessStatusFromLegacy(status: BusinessStatus): UnifiedBusinessState["status"] {
  if (status === "closed") return "closed";
  if (status === "restricted") return "restricted";
  if (status === "strained") return "strained";
  return "operating";
}

function licenseStatus(venue: VenueState, businessId: string, companyKind: BusinessCompanyKind, input: BusinessEconomyInput): BusinessLicenseStatus {
  const governmentLicense = input.government.licenses.find((item) => item.businessId === businessId || item.businessId === venue.id || item.businessId === `venue-account:${venue.id}`);
  if (governmentLicense) return governmentLicense.status;
  if (companyKind === "criminal") return "unlicensed";
  const rng = new SeededRandom(`${input.seed}:business-license:${businessId}`);
  return rng.chance(.035) ? "probation" : "active";
}

function materializedVenue(input: BusinessEconomyInput, venueId: string): VenueState | undefined {
  return input.urban.venueOperations.registry.find((entry) => entry.venue.id === venueId)?.venue
    ?? input.urban.venues.find((venue) => venue.id === venueId);
}

function premisesLandlord(venue: VenueState, input: BusinessEconomyInput): string {
  return input.urban.buildings.find((item) => item.id === venue.buildingId)?.ownerEntityId
    ?? venue.organizationId
    ?? input.organizations.find((item) => item.type === "government")?.id
    ?? input.worldCore.businesses[0]?.ownerEntityId
    ?? venue.id;
}

function initialCash(venue: VenueState, companyKind: BusinessCompanyKind, input: BusinessEconomyInput): number {
  const rng = new SeededRandom(`${input.seed}:business-cash:${venue.id}:v1`);
  const scale = companyKind === "corporate" ? 2.2 : companyKind === "franchise" ? 1.55 : companyKind === "public" ? 2.8 : companyKind === "criminal" ? 1.25 : 1;
  return Math.round(rng.integer(700, 6_500) * venue.priceTier * scale);
}

function businessIdForVenue(venue: VenueState, worldCore: WorldCoreState): string {
  return worldCore.aliasToBusinessId[venue.id] ?? worldCore.aliasToBusinessId[`venue-account:${venue.id}`] ?? `venue-account:${venue.id}`;
}

function eligibleProducts(category: UnifiedBusinessState["category"], businessId: string): string[] {
  const categories = CATEGORY_PRODUCTS[category] ?? ["household"];
  const candidates = PRODUCT_CATALOG.filter((product) => categories.includes(product.category));
  const rng = new SeededRandom(`business-assortment:${businessId}:v1`);
  const count = Math.min(candidates.length, SERVICE_CATEGORIES.has(category) ? rng.integer(2, 3) : rng.integer(2, 5));
  const pool = [...candidates];
  const result: string[] = [];
  while (pool.length && result.length < count) {
    const product = rng.pick(pool);
    result.push(product.id);
    pool.splice(pool.indexOf(product), 1);
  }
  return result;
}

function inventoryStats(state: ProductInventoryState, businessId: string, timestamp: number): { units: number; value: number } {
  const inventory = state.inventories.find((item) => item.id === businessInventoryId(businessId));
  if (!inventory) return { units: 0, value: 0 };
  let units = 0;
  let value = 0;
  for (const stack of inventory.stacks) {
    if (stack.status !== "available" || (stack.expiresAt !== undefined && stack.expiresAt <= timestamp)) continue;
    const available = Math.max(0, stack.quantity - stack.reservedQuantity);
    units += available;
    value += available * stack.unitCost;
  }
  return { units: round(units), value: round(value) };
}

function seedBusinessInventory(state: ProductInventoryState, business: UnifiedBusinessState, input: BusinessEconomyInput, isNew: boolean): ProductInventoryState {
  let next = ensureCanonicalInventory(state, business.id, "business", "stockroom", input.timestamp, business.locationId, 2_500_000, 5_000_000);
  const inventory = next.inventories.find((item) => item.id === businessInventoryId(business.id));
  if (!inventory || inventory.stacks.length || !isNew) return next;
  const rng = new SeededRandom(`${input.seed}:business-opening-stock:${business.id}:v1`);
  for (const productId of eligibleProducts(business.category, business.id)) {
    const product = getProduct(productId);
    const quantity = rng.integer(Math.max(3, Math.floor(product.stackLimit * .18)), Math.max(8, Math.floor(product.stackLimit * .65)));
    next = stockCanonicalInventory(next, input.seed, business.id, "business", "stockroom", productId, quantity, input.timestamp, {
      locationId: business.locationId,
      unitCost: Math.max(1, Math.round(product.basePrice * rng.integer(38, 62) / 100)),
      quality: rng.integer(58, 92),
      origin: "migration",
      producerEntityId: business.companyId,
      capacityMassGrams: 2_500_000,
      capacityVolumeMl: 5_000_000
    });
  }
  return next;
}

function buildRegistry(input: BusinessEconomyInput): { businesses: UnifiedBusinessState[]; companies: BusinessCompanyState[]; leases: BusinessLeaseState[]; inventory: ProductInventoryState } {
  const materializedVenues = input.urban.venueOperations.registry.map((entry) => entry.venue);
  const materializedById = new Map(materializedVenues.map((venue) => [venue.id, venue]));
  const venues = indexCitywideVenues({
    timestamp: input.timestamp,
    seed: input.seed,
    activeLocationId: input.locations[0]?.id ?? input.playerId,
    metropolitan: input.metropolitan,
    districts: input.districts,
    locations: input.locations,
    organizations: input.organizations,
    population: input.population,
    transportServiceLevel: input.infrastructure.networks.find((item) => item.kind === "transport")?.averageServiceLevel ?? 100,
    dataServiceLevel: input.infrastructure.networks.find((item) => item.kind === "data")?.averageServiceLevel ?? 100,
    externallyManagedBusinessEconomy: true
  }, materializedVenues);
  const previousBusinesses = new Map((input.previous?.businesses ?? []).map((item) => [item.id, item]));
  const previousCompanies = new Map((input.previous?.companies ?? []).map((item) => [item.id, item]));
  const previousLeases = new Map((input.previous?.leases ?? []).map((item) => [item.businessId, item]));
  const worldCoreById = new Map(input.worldCore.businesses.map((item) => [item.id, item]));
  const buildingOwners = new Map(input.urban.buildings.map((item) => [item.id, item.ownerEntityId]));
  const workerCounts = new Map<string, number>();
  for (const employment of input.worldCore.employments) {
    if (employment.status === "ended") continue;
    workerCounts.set(employment.businessId, (workerCounts.get(employment.businessId) ?? 0) + 1);
  }
  const existingInventoryIds = new Set(input.productInventory.inventories.map((item) => item.id));
  const businesses: UnifiedBusinessState[] = [];
  const registeredIds = new Set<string>();
  const companySeed = new Map<string, { venue: VenueState; kind: BusinessCompanyKind; parentOrganizationId?: string; businessIds: string[] }>();
  const inventorySpecs: Parameters<typeof seedCanonicalInventories>[2] = [];

  for (const venue of venues.slice(0, BUSINESS_CAP)) {
    const id = businessIdForVenue(venue, input.worldCore);
    const currentVenue = materializedById.get(venue.id) ?? venue;
    const previous = previousBusinesses.get(id);
    const core = worldCoreById.get(id);
    const companyChoice = previous
      ? { kind: previous.companyKind, id: previous.companyId, parentOrganizationId: previousCompanies.get(previous.companyId)?.parentOrganizationId }
      : companyKindFor(currentVenue, input);
    const companyId = companyChoice.id;
    const landlordEntityId = buildingOwners.get(currentVenue.buildingId)
      ?? currentVenue.organizationId
      ?? input.organizations.find((item) => item.type === "government")?.id
      ?? id;
    const observedCash = creditBalance(input.kernel, id) ?? core?.cash;
    const status = previous?.status ?? core?.status ?? currentVenue.operatingStatus;
    const targetStaff = Math.max(1, core?.targetStaff ?? Math.round(currentVenue.staffing / 13));
    const activeWorkers = workerCounts.get(id) ?? core?.activeWorkers ?? Math.max(1, Math.round(targetStaff * currentVenue.staffing / 100));
    const business: UnifiedBusinessState = {
      id,
      venueId: currentVenue.id,
      aliases: [...new Set([id, currentVenue.id, `venue-account:${currentVenue.id}`, ...(core?.aliases ?? [])])],
      companyId,
      ownerEntityId: companyId,
      operatorEntityId: id,
      landlordEntityId,
      districtId: currentVenue.districtId,
      sectorId: currentVenue.sectorId,
      buildingId: currentVenue.buildingId,
      unitId: currentVenue.unitId,
      locationId: currentVenue.anchorLocationId,
      name: currentVenue.name,
      category: currentVenue.category,
      status,
      companyKind: companyChoice.kind,
      strategy: previous?.strategy ?? categoryStrategy(currentVenue.category, companyChoice.kind, new SeededRandom(`${input.seed}:business-strategy:${id}`)),
      materialized: materializedById.has(currentVenue.id),
      inventoryId: businessInventoryId(id),
      licenseStatus: licenseStatus(currentVenue, id, companyChoice.kind, input),
      foundedDay: previous?.foundedDay ?? Math.max(0, dayIndex(input.timestamp) - new SeededRandom(`${input.seed}:business-age:${id}`).integer(30, 2_400)),
      closedDay: previous?.closedDay,
      priceIndex: previous?.priceIndex ?? clamp(75 + currentVenue.priceTier * 12 + new SeededRandom(`${input.seed}:business-price:${id}`).integer(-8, 10), 65, 155),
      reputation: previous?.reputation ?? clamp(Math.round((currentVenue.quality + currentVenue.popularity) / 2)),
      quality: previous?.quality ?? currentVenue.quality,
      demandScore: previous?.demandScore ?? currentVenue.demand,
      marketShare: previous?.marketShare ?? 0,
      targetStaff,
      activeWorkers,
      serviceCapacity: previous?.serviceCapacity ?? Math.max(4, targetStaff * 8),
      stockUnits: previous?.stockUnits ?? core?.stockUnits ?? 0,
      inventoryValue: previous?.inventoryValue ?? 0,
      cash: observedCash ?? previous?.cash ?? initialCash(currentVenue, companyChoice.kind, input),
      debt: previous?.debt ?? 0,
      revenueToday: previous?.revenueToday ?? 0,
      expensesToday: previous?.expensesToday ?? 0,
      profitToday: previous?.profitToday ?? 0,
      lifetimeRevenue: previous?.lifetimeRevenue ?? 0,
      lifetimeExpenses: previous?.lifetimeExpenses ?? 0,
      consecutiveLossDays: previous?.consecutiveLossDays ?? 0,
      rentArrearsDays: previous?.rentArrearsDays ?? 0,
      taxArrears: previous?.taxArrears ?? 0,
      lastOpenedAt: previous?.lastOpenedAt,
      lastClosedAt: previous?.lastClosedAt,
      lastUpdatedAt: input.timestamp
    };
    businesses.push(business);
    registeredIds.add(business.id);
    if (!existingInventoryIds.has(business.inventoryId)) {
      const rng = new SeededRandom(`${input.seed}:business-opening-stock:${business.id}:v1`);
      inventorySpecs.push({
        ownerEntityId: business.id,
        ownerKind: "business",
        compartment: "stockroom",
        locationId: business.locationId,
        capacityMassGrams: 2_500_000,
        capacityVolumeMl: 5_000_000,
        products: eligibleProducts(business.category, business.id).map((productId) => {
          const product = getProduct(productId);
          return {
            productId,
            quantity: rng.integer(Math.max(3, Math.floor(product.stackLimit * .18)), Math.max(8, Math.floor(product.stackLimit * .65))),
            unitCost: Math.max(1, Math.round(product.basePrice * rng.integer(38, 62) / 100)),
            quality: rng.integer(58, 92),
            origin: "migration" as const,
            producerEntityId: business.companyId
          };
        })
      });
    }
    const company = companySeed.get(companyId);
    if (company) company.businessIds.push(id);
    else companySeed.set(companyId, { venue: currentVenue, kind: companyChoice.kind, parentOrganizationId: companyChoice.parentOrganizationId, businessIds: [id] });
  }

  for (const core of input.worldCore.businesses) {
    if (registeredIds.has(core.id)) continue;
    const organization = input.organizations.find((item) => item.id === core.ownerEntityId);
    const companyKind: BusinessCompanyKind = organization?.type === "gang" ? "criminal"
      : organization && ["government", "medical", "transport", "police"].includes(organization.type) ? "public"
        : "corporate";
    const companyId = core.ownerEntityId;
    const placement = core.locationId ? input.metropolitan.locations.find((item) => item.locationId === core.locationId) : undefined;
    const sector = placement?.sectorId ? input.metropolitan.sectors.find((item) => item.id === placement.sectorId) : input.metropolitan.sectors.find((item) => item.districtId === core.districtId);
    if (!sector) continue;
    const buildingId = core.buildingId ?? createStableEntityId("building", `institution:${core.id}`);
    const unitId = core.unitId ?? createStableEntityId("building-unit", `institution:${core.id}`);
    const syntheticVenue: VenueState = {
      id: core.venueId ?? createStableEntityId("venue", `institution:${core.id}`),
      sectorId: sector.id, districtId: core.districtId, buildingId, unitId, anchorLocationId: core.locationId, organizationId: companyId,
      name: core.name, code: `CORE/${core.id.slice(-8)}`, category: core.category === "logistics" || core.category === "corporate" || core.category === "education" || core.category === "government" || core.category === "transport" ? "office-service" : core.category,
      floor: 1, unitNumber: "01-C01", openHour: 0, closeHour: 24, priceTier: 2, quality: 65, demand: 55, staffing: clamp(Math.round(core.activeWorkers / Math.max(1, core.targetStaff) * 100)),
      stock: core.stockPercent, security: 65, popularity: 55, tags: ["institution"], mapPriority: 90, operatingStatus: core.status === "restricted" || core.status === "strained" ? "operating" : core.status, active: core.status === "operating", permanent: true, lastUpdatedAt: input.timestamp
    };
    const previous = previousBusinesses.get(core.id);
    const business: UnifiedBusinessState = {
      id: core.id, venueId: core.venueId, aliases: [...new Set([core.id, ...core.aliases])], companyId, ownerEntityId: companyId, operatorEntityId: core.operatorEntityId, landlordEntityId: companyId,
      districtId: core.districtId, sectorId: sector.id, buildingId, unitId, locationId: core.locationId, name: core.name, category: core.category, status: previous?.status ?? core.status,
      companyKind, strategy: previous?.strategy ?? categoryStrategy(core.category, companyKind, new SeededRandom(`${input.seed}:business-strategy:${core.id}`)), materialized: Boolean(core.buildingId), inventoryId: businessInventoryId(core.id),
      licenseStatus: companyKind === "criminal" ? "unlicensed" : "active", foundedDay: previous?.foundedDay ?? Math.max(0, dayIndex(input.timestamp) - 900), closedDay: previous?.closedDay,
      priceIndex: previous?.priceIndex ?? 100, reputation: previous?.reputation ?? 60, quality: previous?.quality ?? 65, demandScore: previous?.demandScore ?? 55, marketShare: previous?.marketShare ?? 0,
      targetStaff: core.targetStaff, activeWorkers: core.activeWorkers, serviceCapacity: previous?.serviceCapacity ?? Math.max(4, core.targetStaff * 8), stockUnits: previous?.stockUnits ?? core.stockUnits, inventoryValue: previous?.inventoryValue ?? 0,
      cash: creditBalance(input.kernel, core.id) ?? previous?.cash ?? core.cash, debt: previous?.debt ?? 0, revenueToday: previous?.revenueToday ?? 0, expensesToday: previous?.expensesToday ?? 0, profitToday: previous?.profitToday ?? 0,
      lifetimeRevenue: previous?.lifetimeRevenue ?? 0, lifetimeExpenses: previous?.lifetimeExpenses ?? 0, consecutiveLossDays: previous?.consecutiveLossDays ?? 0, rentArrearsDays: 0, taxArrears: previous?.taxArrears ?? 0,
      lastOpenedAt: previous?.lastOpenedAt, lastClosedAt: previous?.lastClosedAt, lastUpdatedAt: input.timestamp
    };
    businesses.push(business);
    registeredIds.add(business.id);
    if (!existingInventoryIds.has(business.inventoryId)) {
      const rng = new SeededRandom(`${input.seed}:business-opening-stock:${business.id}:v1`);
      inventorySpecs.push({ ownerEntityId: business.id, ownerKind: "business", compartment: "stockroom", locationId: business.locationId, capacityMassGrams: 2_500_000, capacityVolumeMl: 5_000_000, products: eligibleProducts(business.category, business.id).map((productId) => {
        const product = getProduct(productId);
        return { productId, quantity: rng.integer(8, Math.max(12, Math.floor(product.stackLimit * .5))), unitCost: Math.max(1, Math.round(product.basePrice * .5)), quality: 72, origin: "migration" as const, producerEntityId: business.companyId };
      }) });
    }
    const company = companySeed.get(companyId);
    if (company) company.businessIds.push(core.id);
    else companySeed.set(companyId, { venue: syntheticVenue, kind: companyKind, parentOrganizationId: companyId, businessIds: [core.id] });
  }

  const inventory = seedCanonicalInventories(input.productInventory, input.seed, inventorySpecs, input.timestamp);
  const inventoryById = new Map(inventory.inventories.map((item) => [item.id, item]));
  const batchesById = new Map(inventory.batches.map((item) => [item.id, item]));
  for (let index = 0; index < businesses.length; index += 1) {
    const business = businesses[index];
    const stockroom = inventoryById.get(business.inventoryId);
    let units = 0;
    let value = 0;
    for (const stack of stockroom?.stacks ?? []) {
      if (stack.status !== "available" || (stack.expiresAt !== undefined && stack.expiresAt <= input.timestamp)) continue;
      const available = Math.max(0, stack.quantity - stack.reservedQuantity);
      units += available;
      value += available * stack.unitCost;
      void batchesById.get(stack.batchId);
    }
    businesses[index] = { ...business, stockUnits: round(units), inventoryValue: round(value) };
  }

  const businessById = new Map(businesses.map((business) => [business.id, business]));
  const companies: BusinessCompanyState[] = [...companySeed.entries()].map(([id, value]) => {
    const previous = previousCompanies.get(id);
    const businessCash = value.businessIds.reduce((sum, businessId) => sum + (businessById.get(businessId)?.cash ?? 0), 0);
    return {
      id,
      name: previous?.name ?? companyName(id, value.kind, value.venue, input),
      kind: value.kind,
      parentOrganizationId: previous?.parentOrganizationId ?? value.parentOrganizationId,
      founderResidentId: previous?.founderResidentId,
      businessIds: [...new Set(value.businessIds)].sort(),
      strategy: previous?.strategy ?? categoryStrategy(value.venue.category, value.kind, new SeededRandom(`${input.seed}:company-strategy:${id}`)),
      status: previous?.status ?? "active",
      treasury: creditBalance(input.kernel, id) ?? previous?.treasury ?? Math.max(0, Math.round(businessCash * .18)),
      debt: previous?.debt ?? 0,
      reputation: previous?.reputation ?? clamp(value.venue.popularity + new SeededRandom(`${input.seed}:company-reputation:${id}`).integer(-12, 12)),
      foundedDay: previous?.foundedDay ?? Math.max(0, dayIndex(input.timestamp) - new SeededRandom(`${input.seed}:company-age:${id}`).integer(90, 4_000)),
      dissolvedDay: previous?.dissolvedDay,
      lastUpdatedAt: input.timestamp
    };
  }).sort((left, right) => left.id.localeCompare(right.id));

  const districtById = new Map(input.districts.map((district) => [district.id, district]));
  const leases: BusinessLeaseState[] = businesses.map((business) => {
    const previous = previousLeases.get(business.id);
    const ownerOccupied = business.landlordEntityId === business.companyId || business.companyKind === "public";
    const rng = new SeededRandom(`${input.seed}:business-lease:${business.id}:v1`);
    const district = districtById.get(business.districtId);
    const monthlyRent = ownerOccupied ? 0 : Math.round((45 + (district?.costOfLiving ?? 50) * 2.4 + business.quality * 1.6) * (business.category === "hotel" || business.category === "market" ? 1.6 : business.category === "repair" ? 1.35 : 1));
    return previous ? { ...previous, landlordEntityId: business.landlordEntityId, tenantCompanyId: business.companyId, monthlyRent, status: business.status === "closed" ? "terminated" : previous.status } : {
      id: createStableEntityId("business-lease", business.id),
      businessId: business.id,
      premisesId: business.unitId,
      landlordEntityId: business.landlordEntityId,
      tenantCompanyId: business.companyId,
      monthlyRent,
      deposit: ownerOccupied ? 0 : monthlyRent * rng.integer(1, 3),
      status: ownerOccupied ? "owner-occupied" : business.status === "closed" ? "terminated" : "active",
      startedDay: business.foundedDay,
      nextPaymentDay: dayIndex(input.timestamp) + 30,
      arrearsDays: 0
    };
  });

  return { businesses: businesses.sort((a, b) => a.id.localeCompare(b.id)), companies, leases, inventory };
}

function marketId(districtId: string, category: UnifiedBusinessState["category"]): string {
  return createStableEntityId("business-market", `${districtId}:${category}`);
}

function representedPopulation(input: BusinessEconomyInput, districtId: string): number {
  return input.metropolitan.districts.find((item) => item.districtId === districtId)?.representedPopulation
    ?? input.districts.find((item) => item.id === districtId)?.population
    ?? 0;
}

function stockAvailability(business: UnifiedBusinessState): number {
  if (SERVICE_CATEGORIES.has(business.category)) return clamp(45 + business.activeWorkers / Math.max(1, business.targetStaff) * 55);
  return clamp(business.stockUnits / Math.max(10, business.serviceCapacity * 2) * 100);
}

function attractiveness(business: UnifiedBusinessState): number {
  const priceFactor = clamp(170 - business.priceIndex, 25, 115) / 100;
  const staffFactor = clamp(business.activeWorkers / Math.max(1, business.targetStaff) * 100, 15, 115) / 100;
  const stockFactor = Math.max(.08, stockAvailability(business) / 100);
  const licenseFactor = business.licenseStatus === "active" ? 1 : business.licenseStatus === "probation" ? .82 : business.licenseStatus === "unlicensed" ? .65 : .15;
  return Math.max(.01, (business.reputation * .45 + business.quality * .35 + business.demandScore * .2) * priceFactor * staffFactor * stockFactor * licenseFactor);
}

function creditAmount(value: number): number {
  return Math.max(0, Math.round(value));
}

function draft(timestamp: number, key: string, debitEntityId: string, creditEntityId: string, amount: number, reason: KernelTransactionDraft["reason"], description: string): KernelTransactionDraft | null {
  const rounded = creditAmount(amount);
  if (!rounded) return null;
  return { idempotencyKey: key, timestamp, debitEntityId, creditEntityId, resource: "credits", amount: rounded, reason, description };
}

function resourceDraft(timestamp: number, key: string, debitEntityId: string, creditEntityId: string, resource: KernelResource, amount: number, description: string): KernelTransactionDraft | null {
  const rounded = Math.max(0, Math.round(amount * 100) / 100);
  if (!rounded) return null;
  return { idempotencyKey: key, timestamp, debitEntityId, creditEntityId, resource, amount: rounded, reason: "inventory-transfer", description };
}

function inventoryResource(category: UnifiedBusinessState["category"]): KernelResource {
  if (["convenience", "food", "bar", "market", "hotel"].includes(category)) return "food-units";
  if (["clinic", "pharmacy", "cyberware"].includes(category)) return "medical-units";
  if (["repair", "transport", "logistics"].includes(category)) return "parts-units";
  if (["office-service", "corporate", "education", "government"].includes(category)) return "document-units";
  return "mixed-units";
}

function utilityProvider(input: BusinessEconomyInput, districtId: string): string {
  const service = input.infrastructure.services.find((item) => item.districtId === districtId && item.kind === "power")
    ?? input.infrastructure.services.find((item) => item.districtId === districtId);
  return input.infrastructure.networks.find((item) => item.id === service?.networkId)?.providerEntityId
    ?? input.government.budget.authorityOrganizationId;
}

interface MarketInventoryContext {
  inventories: InventoryState[];
  inventoryById: Map<string, InventoryState>;
  batches: ProductBatchState[];
  batchById: Map<string, ProductBatchState>;
  transfers: ProductTransferState[];
  sequence: number;
}

function marketInventoryContext(state: ProductInventoryState): MarketInventoryContext {
  const inventories = state.inventories.map((inventory) => ({ ...inventory, stacks: inventory.stacks.map((stack) => ({ ...stack })) }));
  const batches = state.batches.map((batch) => ({ ...batch }));
  return {
    inventories,
    inventoryById: new Map(inventories.map((inventory) => [inventory.id, inventory])),
    batches,
    batchById: new Map(batches.map((batch) => [batch.id, batch])),
    transfers: [...state.transfers],
    sequence: state.sequence
  };
}

function sellInventory(
  context: MarketInventoryContext,
  business: UnifiedBusinessState,
  targetUnits: number,
  timestamp: number,
  consumerEntityId: string
): { units: number; revenue: number; cost: number } {
  let remaining = Math.max(0, Math.floor(targetUnits));
  let units = 0;
  let revenue = 0;
  let cost = 0;
  const source = context.inventoryById.get(business.inventoryId);
  if (!source || remaining <= 0) return { units, revenue, cost };

  const grouped = new Map<string, typeof source.stacks>();
  for (const stack of source.stacks) {
    if (stack.status !== "available" || stack.quantity <= stack.reservedQuantity || (stack.expiresAt !== undefined && stack.expiresAt <= timestamp)) continue;
    const list = grouped.get(stack.productId);
    if (list) list.push(stack);
    else grouped.set(stack.productId, [stack]);
  }
  const productIds = [...grouped.keys()].sort((left, right) => getProduct(right).basePrice - getProduct(left).basePrice);
  for (const productId of productIds) {
    if (remaining <= 0) break;
    const unitPrice = Math.max(1, Math.round(getProduct(productId).basePrice * business.priceIndex / 100));
    const stacks = grouped.get(productId) ?? [];
    stacks.sort((left, right) => (left.expiresAt ?? Number.MAX_SAFE_INTEGER) - (right.expiresAt ?? Number.MAX_SAFE_INTEGER) || left.acquiredAt - right.acquiredAt);
    for (const stack of stacks) {
      if (remaining <= 0) break;
      const available = Math.max(0, stack.quantity - stack.reservedQuantity);
      const take = Math.min(remaining, available);
      if (take <= 0) continue;
      stack.quantity -= take;
      remaining -= take;
      units += take;
      revenue += take * unitPrice;
      cost += take * stack.unitCost;
      const batch = context.batchById.get(stack.batchId);
      if (batch) batch.quantityRemaining = Math.max(0, batch.quantityRemaining - take);
      context.sequence += 1;
      const targetInventoryId = createStableEntityId("inventory", `${consumerEntityId}:consumed`);
      context.transfers.push({
        id: createStableEntityId("product-transfer", `${source.id}:${targetInventoryId}:${stack.batchId}:${timestamp}:${context.sequence}`),
        productId,
        batchId: stack.batchId,
        sourceInventoryId: source.id,
        targetInventoryId,
        quantity: take,
        unitPrice,
        totalValue: round(take * unitPrice),
        reason: "market-consumption",
        createdAt: timestamp,
        completedAt: timestamp
      });
    }
  }
  source.stacks = source.stacks.filter((stack) => stack.quantity > 0);
  source.lastUpdatedAt = timestamp;
  return { units, revenue: round(revenue), cost: round(cost) };
}

function finalizeMarketInventory(base: ProductInventoryState, context: MarketInventoryContext, timestamp: number): ProductInventoryState {
  return finalizeProductInventoryState({
    ...base,
    inventories: context.inventories,
    batches: context.batches,
    transfers: context.transfers.slice(-2_000),
    sequence: context.sequence
  }, timestamp);
}

function marketInventoryStats(context: MarketInventoryContext, business: UnifiedBusinessState, timestamp: number): { units: number; value: number } {
  const source = context.inventoryById.get(business.inventoryId);
  if (!source) return { units: 0, value: 0 };
  let units = 0;
  let value = 0;
  for (const stack of source.stacks) {
    if (stack.status !== "available" || (stack.expiresAt !== undefined && stack.expiresAt <= timestamp)) continue;
    const available = Math.max(0, stack.quantity - stack.reservedQuantity);
    units += available;
    value += available * stack.unitCost;
  }
  return { units: round(units), value: round(value) };
}

function lifecycleEvent(input: BusinessEconomyInput, business: UnifiedBusinessState, kind: BusinessLifecycleEventKind, day: number, detail: string): BusinessLifecycleEventState {
  return {
    id: createStableEntityId("business-event", `${business.id}:${kind}:${day}`),
    businessId: business.id,
    companyId: business.companyId,
    districtId: business.districtId,
    kind,
    dayIndex: day,
    timestamp: day * DAY_MS,
    detail
  };
}

function simulateDay(
  state: BusinessEconomyState,
  inventoryInput: ProductInventoryState,
  input: BusinessEconomyInput,
  day: number
): { state: BusinessEconomyState; inventory: ProductInventoryState; drafts: KernelTransactionDraft[] } {
  const timestamp = day * DAY_MS;
  const marketInventory = marketInventoryContext(inventoryInput);
  const drafts: KernelTransactionDraft[] = [];
  const events: BusinessLifecycleEventState[] = [];
  const leasesByBusiness = new Map(state.leases.map((item) => [item.businessId, item]));
  const businesses = state.businesses.map((item) => ({ ...item, revenueToday: 0, expensesToday: 0, profitToday: 0, lastUpdatedAt: timestamp }));
  const businessIndex = new Map(businesses.map((business, index) => [business.id, index]));
  const groupIndices = new Map<string, number[]>();
  const companyIndices = new Map<string, number[]>();
  for (let index = 0; index < businesses.length; index += 1) {
    const business = businesses[index];
    const key = `${business.districtId}|${business.category}`;
    const marketGroup = groupIndices.get(key);
    if (marketGroup) marketGroup.push(index);
    else groupIndices.set(key, [index]);
    const companyGroup = companyIndices.get(business.companyId);
    if (companyGroup) companyGroup.push(index);
    else companyIndices.set(business.companyId, [index]);
  }

  const populationByDistrict = new Map(input.metropolitan.districts.map((item) => [item.districtId, item.representedPopulation]));
  for (const district of input.districts) if (!populationByDistrict.has(district.id)) populationByDistrict.set(district.id, district.population);
  const serviceAccumulator = new Map<string, { total: number; count: number }>();
  const utilityByDistrict = new Map<string, string>();
  const networkProvider = new Map(input.infrastructure.networks.map((network) => [network.id, network.providerEntityId]));
  for (const service of input.infrastructure.services) {
    const current = serviceAccumulator.get(service.districtId) ?? { total: 0, count: 0 };
    current.total += service.serviceLevel;
    current.count += 1;
    serviceAccumulator.set(service.districtId, current);
    if (!utilityByDistrict.has(service.districtId) || service.kind === "power") {
      utilityByDistrict.set(service.districtId, networkProvider.get(service.networkId) ?? input.government.budget.authorityOrganizationId);
    }
  }

  const markets: BusinessMarketState[] = [];
  let openings = 0;
  let closures = 0;
  let acquisitions = 0;
  let revenueTotal = 0;
  let expensesTotal = 0;
  let unitsSoldTotal = 0;
  let taxesPaid = 0;
  let rentPaid = 0;
  let payrollPaid = 0;

  for (let index = 0; index < businesses.length; index += 1) {
    const business = businesses[index];
    if (business.status !== "insolvent") continue;
    const lossDays = business.consecutiveLossDays + 1;
    const rentArrearsDays = business.rentArrearsDays + (leasesByBusiness.get(business.id)?.monthlyRent ? 1 : 0);
    const debt = round(business.debt + Math.max(1, business.debt * .0007));
    let status: UnifiedBusinessState["status"] = "insolvent";
    if (lossDays >= 60 || rentArrearsDays >= 45) {
      status = "closed";
      closures += 1;
      events.push(lifecycleEvent(input, business, "bankrupt", day, `${business.name} ликвидирован после затяжной неплатёжеспособности.`));
    }
    businesses[index] = {
      ...business,
      status,
      debt,
      consecutiveLossDays: lossDays,
      rentArrearsDays,
      expensesToday: round(Math.max(1, debt - business.debt)),
      profitToday: round(-Math.max(1, debt - business.debt)),
      lastClosedAt: status === "closed" ? timestamp : business.lastClosedAt,
      closedDay: status === "closed" ? day : business.closedDay,
      lastUpdatedAt: timestamp
    };
  }

  for (const [key, localIndices] of groupIndices) {
    const separator = key.indexOf("|");
    const districtId = key.slice(0, separator);
    const category = key.slice(separator + 1) as UnifiedBusinessState["category"];
    const activeIndices = localIndices.filter((index) => {
      const business = businesses[index];
      return ["operating", "restricted", "strained"].includes(business.status) && !["suspended", "revoked"].includes(business.licenseStatus);
    });
    const population = populationByDistrict.get(districtId) ?? 0;
    const demand = Math.max(activeIndices.length ? activeIndices.length * 2 : 0, Math.round(population / 1_000 * DEMAND_PER_THOUSAND[category]));
    const weights = activeIndices.map((index) => attractiveness(businesses[index]));
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    let supplied = 0;
    const openingsBefore = openings;
    const closuresBefore = closures;

    for (let position = 0; position < activeIndices.length; position += 1) {
      const index = activeIndices[position];
      let business = businesses[index];
      const share = weightTotal > 0 ? weights[position] / weightTotal : 0;
      const capacity = Math.max(1, Math.round(business.serviceCapacity * Math.max(.2, business.activeWorkers / Math.max(1, business.targetStaff))));
      const targetUnits = Math.min(capacity, Math.max(0, Math.round(demand * share)));
      let units = 0;
      let grossRevenue = 0;
      let inventoryCost = 0;
      let inventoryUnitsSold = 0;
      if (SERVICE_CATEGORIES.has(business.category)) {
        const stockFactor = business.category === "clinic" || business.category === "repair" || business.category === "cyberware" ? Math.max(.15, stockAvailability(business) / 100) : 1;
        units = Math.floor(targetUnits * stockFactor);
        const serviceBase = business.category === "clinic" ? 68 : business.category === "cyberware" ? 130 : business.category === "repair" ? 76 : business.category === "hotel" ? 52 : 34;
        grossRevenue = Math.round(units * serviceBase * business.priceIndex / 100);
        if (["clinic", "repair", "cyberware"].includes(business.category) && units > 0) {
          const sold = sellInventory(marketInventory, business, Math.max(1, Math.ceil(units / 5)), timestamp, `consumer-pool:${districtId}`);
          inventoryCost += sold.cost;
          inventoryUnitsSold += sold.units;
        }
      } else {
        const sold = sellInventory(marketInventory, business, targetUnits, timestamp, `consumer-pool:${districtId}`);
        units = sold.units;
        grossRevenue = sold.revenue;
        inventoryCost = sold.cost;
        inventoryUnitsSold = sold.units;
      }
      supplied += units;
      unitsSoldTotal += units;

      const lease = leasesByBusiness.get(business.id);
      const dailyRent = lease && lease.status !== "owner-occupied" && lease.status !== "terminated" ? lease.monthlyRent / 30 : 0;
      const payroll = Math.round(Math.max(1, business.activeWorkers) * (business.category === "clinic" || business.category === "cyberware" ? 18 : business.category === "repair" ? 15 : 11));
      const serviceSample = serviceAccumulator.get(business.districtId);
      const serviceLevel = serviceSample?.count ? serviceSample.total / serviceSample.count : 100;
      const utilities = Math.round((5 + business.serviceCapacity * .28) * (1.7 - serviceLevel / 145));
      const preTaxProfit = grossRevenue - inventoryCost - payroll - dailyRent - utilities;
      const tax = Math.round(Math.max(0, preTaxProfit) * input.government.policy.businessProfitTaxRate / 100);
      const debtInterest = Math.round(Math.max(0, business.debt) * .0007);
      const expenses = round(inventoryCost + payroll + dailyRent + utilities + tax + debtInterest);
      const profit = round(grossRevenue - expenses);
      // Cost of goods sold is an accounting expense, not a second cash payment at
      // the moment of sale. Inventory procurement already moved credits earlier.
      const cashFlow = round(creditAmount(grossRevenue) - creditAmount(payroll) - creditAmount(dailyRent) - creditAmount(utilities) - creditAmount(tax) - creditAmount(debtInterest));
      let cash = round(business.cash + cashFlow);
      let debt = business.debt;
      if (cash < -800) {
        debt = round(debt + Math.abs(cash) + 400);
        cash = 0;
      }
      const lossDays = profit < 0 ? business.consecutiveLossDays + 1 : Math.max(0, business.consecutiveLossDays - 2);
      const rentArrearsDays = dailyRent > 0 && cash < dailyRent ? business.rentArrearsDays + 1 : Math.max(0, business.rentArrearsDays - 1);
      let status = business.status;
      if (rentArrearsDays >= 30 || debt > Math.max(8_000, business.lifetimeRevenue * .35) || lossDays >= 45) status = "insolvent";
      else if (lossDays >= 18 || rentArrearsDays >= 10) status = "strained";
      else if (status === "strained" && profit > 0 && lossDays < 5) status = "operating";
      if (status === "insolvent" && (lossDays >= 60 || rentArrearsDays >= 45)) {
        status = "closed";
        closures += 1;
        events.push(lifecycleEvent(input, business, "bankrupt", day, `${business.name} закрыт после неплатёжеспособности.`));
      }
      const stock = marketInventoryStats(marketInventory, business, timestamp);
      business = {
        ...business,
        status,
        cash,
        debt,
        revenueToday: round(grossRevenue),
        expensesToday: expenses,
        profitToday: profit,
        lifetimeRevenue: round(business.lifetimeRevenue + grossRevenue),
        lifetimeExpenses: round(business.lifetimeExpenses + expenses),
        consecutiveLossDays: lossDays,
        rentArrearsDays,
        taxArrears: tax > cash ? round(business.taxArrears + tax) : Math.max(0, business.taxArrears - tax),
        marketShare: round(share * 100),
        demandScore: clamp(Math.round(business.demandScore * .72 + Math.min(100, targetUnits / Math.max(1, capacity) * 100) * .28)),
        reputation: clamp(business.reputation + (profit > 0 ? .08 : -.12)),
        priceIndex: clamp(Math.round(business.priceIndex + (stock.units < capacity * .35 ? 1 : stock.units > capacity * 2 ? -1 : 0)), 60, 180),
        stockUnits: stock.units,
        inventoryValue: stock.value,
        lastClosedAt: status === "closed" && business.status !== "closed" ? timestamp : business.lastClosedAt,
        closedDay: status === "closed" ? day : business.closedDay,
        lastUpdatedAt: timestamp
      };
      businesses[index] = business;
      revenueTotal += grossRevenue;
      expensesTotal += expenses;
      taxesPaid += tax;
      rentPaid += dailyRent;
      payrollPaid += payroll;

      const provider = utilityByDistrict.get(districtId) ?? input.government.budget.authorityOrganizationId;
      const saleDraft = draft(timestamp, `${input.seed}:business:${day}:${business.id}:sales`, `consumer-pool:${districtId}`, business.id, grossRevenue, business.category === "clinic" ? "medical-service" : business.category === "transport" ? "transport-service" : SERVICE_CATEGORIES.has(business.category) ? "discretionary-service" : "food-sale", `${business.name}: daily sales`);
      const payrollDraft = draft(timestamp, `${input.seed}:business:${day}:${business.id}:payroll`, business.id, `workforce-pool:${business.id}`, payroll, "wage", `${business.name}: payroll`);
      const rentDraft = draft(timestamp, `${input.seed}:business:${day}:${business.id}:rent`, business.id, business.landlordEntityId, dailyRent, "rent", `${business.name}: premises rent`);
      const utilityDraft = draft(timestamp, `${input.seed}:business:${day}:${business.id}:utilities`, business.id, provider, utilities, "utility-service", `${business.name}: utilities`);
      const taxDraft = draft(timestamp, `${input.seed}:business:${day}:${business.id}:tax`, business.id, input.government.budget.authorityOrganizationId, tax, "tax", `${business.name}: profit tax`);
      const interestDraft = draft(timestamp, `${input.seed}:business:${day}:${business.id}:interest`, business.id, kernelSystemEntityId(input.seed, "credit-bureau"), debtInterest, "debt-repayment", `${business.name}: debt interest`);
      const inventoryDraft = resourceDraft(timestamp, `${input.seed}:business:${day}:${business.id}:inventory-consumption`, business.id, kernelSystemEntityId(input.seed, "consumption"), inventoryResource(business.category), inventoryUnitsSold, `${business.name}: inventory sold to represented consumers`);
      for (const item of [saleDraft, payrollDraft, rentDraft, utilityDraft, taxDraft, interestDraft, inventoryDraft]) if (item) drafts.push(item);
    }

    const unmet = Math.max(0, demand - supplied);
    if (day % 7 === 0 && unmet > Math.max(8, demand * .18)) {
      const reopenIndex = localIndices
        .filter((index) => ["vacant", "closed", "renovation"].includes(businesses[index].status) && businesses[index].licenseStatus !== "revoked" && businesses[index].stockUnits > 0)
        .sort((left, right) => businesses[right].reputation - businesses[left].reputation)[0];
      if (reopenIndex !== undefined) {
        const reopen = businesses[reopenIndex];
        businesses[reopenIndex] = { ...reopen, status: "operating", cash: Math.max(1_200, reopen.cash), consecutiveLossDays: 0, rentArrearsDays: 0, closedDay: undefined, lastOpenedAt: timestamp, lastUpdatedAt: timestamp };
        openings += 1;
        events.push(lifecycleEvent(input, reopen, reopen.lastClosedAt ? "reopened" : "opened", day, `${reopen.name} начал работу из-за неудовлетворённого спроса.`));
      }
    }

    const activeAfter = localIndices.map((index) => businesses[index]).filter((item) => ["operating", "restricted", "strained"].includes(item.status));
    const shares = activeAfter.map((item) => item.marketShare / 100);
    markets.push({
      id: marketId(districtId, category),
      districtId,
      category,
      representedPopulation: population,
      activeBusinessIds: activeAfter.map((item) => item.id),
      dailyDemandUnits: demand,
      suppliedUnits: supplied,
      unmetDemandUnits: unmet,
      averagePriceIndex: activeAfter.length ? round(activeAfter.reduce((sum, item) => sum + item.priceIndex, 0) / activeAfter.length) : 100,
      concentration: round(shares.reduce((sum, share) => sum + share * share, 0) * 10_000),
      openingsToday: openings - openingsBefore,
      closuresToday: closures - closuresBefore,
      lastUpdatedDay: day
    });
  }

  const acquisitionCostByCompany = new Map<string, number>();
  if (day % 7 === 0) {
    const companyById = new Map(state.companies.map((company) => [company.id, company]));
    const profitableByMarket = new Map<string, UnifiedBusinessState[]>();
    for (const business of businesses) {
      if (!["operating", "restricted", "strained"].includes(business.status) || business.profitToday <= 0) continue;
      const key = `${business.districtId}|${business.category}`;
      const list = profitableByMarket.get(key);
      if (list) list.push(business);
      else profitableByMarket.set(key, [business]);
    }
    const targets = businesses
      .filter((business) => business.status === "insolvent" && business.companyKind !== "public" && business.companyKind !== "criminal")
      .sort((left, right) => right.debt - left.debt || left.reputation - right.reputation)
      .slice(0, 12);
    for (const target of targets) {
      const key = `${target.districtId}|${target.category}`;
      const buyerBusiness = (profitableByMarket.get(key) ?? [])
        .filter((candidate) => candidate.companyId !== target.companyId)
        .sort((left, right) => right.profitToday - left.profitToday || right.cash - left.cash)[0];
      if (!buyerBusiness) continue;
      const buyerCompany = companyById.get(buyerBusiness.companyId);
      if (!buyerCompany || buyerCompany.status !== "active") continue;
      const price = Math.max(600, Math.round(target.inventoryValue * .55 + target.reputation * 18 + Math.max(0, target.cash) + Math.min(target.debt, 3_000) * .2));
      const alreadyCommitted = acquisitionCostByCompany.get(buyerCompany.id) ?? 0;
      if (buyerCompany.treasury - alreadyCommitted < price) continue;
      const index = businessIndex.get(target.id);
      if (index === undefined) continue;
      acquisitionCostByCompany.set(buyerCompany.id, alreadyCommitted + price);
      businesses[index] = {
        ...target,
        companyId: buyerCompany.id,
        ownerEntityId: buyerCompany.id,
        companyKind: buyerCompany.kind,
        strategy: buyerCompany.strategy,
        status: "strained",
        cash: round(target.cash + price * .35),
        debt: round(Math.max(0, target.debt - price * .45)),
        consecutiveLossDays: Math.max(4, Math.floor(target.consecutiveLossDays * .45)),
        rentArrearsDays: Math.max(0, Math.floor(target.rentArrearsDays * .4)),
        lastOpenedAt: timestamp,
        lastUpdatedAt: timestamp
      };
      acquisitions += 1;
      events.push(lifecycleEvent(input, businesses[index], "acquired", day, `${target.name} перешёл под контроль ${buyerCompany.name}.`));
      const acquisitionDraft = draft(timestamp, `${input.seed}:business:${day}:${target.id}:acquisition`, buyerCompany.id, target.id, price, "organization-investment", `${buyerCompany.name} acquired ${target.name}`);
      if (acquisitionDraft) drafts.push(acquisitionDraft);
    }
  }

  const updatedCompanyIndices = new Map<string, number[]>();
  for (let index = 0; index < businesses.length; index += 1) {
    const ids = updatedCompanyIndices.get(businesses[index].companyId);
    if (ids) ids.push(index);
    else updatedCompanyIndices.set(businesses[index].companyId, [index]);
  }

  const leases = state.leases.map((lease) => {
    const index = businessIndex.get(lease.businessId);
    const business = index === undefined ? undefined : businesses[index];
    if (!business) return lease;
    if (business.status === "closed") return { ...lease, tenantCompanyId: business.companyId, status: "terminated" as const, terminatedDay: day, arrearsDays: business.rentArrearsDays };
    if (lease.status === "owner-occupied" && lease.tenantCompanyId === business.companyId) return lease;
    return { ...lease, tenantCompanyId: business.companyId, status: business.rentArrearsDays > 0 ? "arrears" as const : "active" as const, arrearsDays: business.rentArrearsDays, nextPaymentDay: Math.max(lease.nextPaymentDay, day + 30) };
  });
  const companies = state.companies.map((company) => {
    const local = (updatedCompanyIndices.get(company.id) ?? []).map((index) => businesses[index]);
    const cash = local.reduce((sum, item) => sum + item.cash, 0);
    const debt = local.reduce((sum, item) => sum + item.debt, 0);
    const activeCount = local.filter((item) => ["operating", "restricted", "strained"].includes(item.status)).length;
    return {
      ...company,
      businessIds: local.map((item) => item.id),
      treasury: round(Math.max(0, company.treasury - (acquisitionCostByCompany.get(company.id) ?? 0))),
      debt: round(debt),
      status: activeCount === 0 ? "dissolved" as const : debt > Math.max(20_000, cash * 1.5) ? "insolvent" as const : local.some((item) => item.status === "insolvent") ? "strained" as const : "active" as const,
      dissolvedDay: activeCount === 0 ? day : undefined,
      lastUpdatedAt: timestamp
    };
  });
  const activeBusinesses = businesses.filter((item) => ["operating", "restricted", "strained"].includes(item.status)).length;
  const insolventBusinesses = businesses.filter((item) => item.status === "insolvent").length;
  const closedBusinesses = businesses.filter((item) => item.status === "closed").length;
  const independent = businesses.filter((item) => item.companyKind === "independent" || item.companyKind === "cooperative").length;
  const snapshot: BusinessEconomyDailySnapshot = {
    dayIndex: day,
    activeBusinesses,
    insolventBusinesses,
    closedBusinesses,
    openings,
    closures,
    revenue: round(revenueTotal),
    expenses: round(expensesTotal),
    profit: round(revenueTotal - expensesTotal),
    unitsSold: unitsSoldTotal,
    unmetDemandUnits: markets.reduce((sum, item) => sum + item.unmetDemandUnits, 0),
    independentShare: businesses.length ? round(independent / businesses.length * 100) : 0,
    marketConcentration: markets.length ? round(markets.reduce((sum, item) => sum + item.concentration, 0) / markets.length) : 0
  };

  return {
    state: {
      ...state,
      companies,
      businesses,
      leases,
      markets,
      events: [...events, ...state.events].slice(0, EVENT_LIMIT),
      history: [...state.history, snapshot].slice(-HISTORY_LIMIT),
      lastProcessedDay: day,
      simulatedDays: state.simulatedDays + 1,
      lastUpdatedAt: timestamp,
      totals: {
        ...state.totals,
        openings: state.totals.openings + openings,
        closures: state.totals.closures + closures,
        bankruptcies: state.totals.bankruptcies + events.filter((item) => item.kind === "bankrupt").length,
        acquisitions: state.totals.acquisitions + acquisitions,
        revenue: round(state.totals.revenue + revenueTotal),
        expenses: round(state.totals.expenses + expensesTotal),
        unitsSold: state.totals.unitsSold + unitsSoldTotal,
        taxesPaid: round(state.totals.taxesPaid + taxesPaid),
        rentPaid: round(state.totals.rentPaid + rentPaid),
        payrollPaid: round(state.totals.payrollPaid + payrollPaid)
      }
    },
    inventory: finalizeMarketInventory(inventoryInput, marketInventory, timestamp),
    drafts
  };
}
function baseTotals(companies: BusinessCompanyState[], businesses: UnifiedBusinessState[], leases: BusinessLeaseState[]): BusinessEconomyTotals {
  return {
    companies: companies.length,
    businesses: businesses.length,
    activeBusinesses: businesses.filter((item) => ["operating", "restricted", "strained"].includes(item.status)).length,
    materializedBusinesses: businesses.filter((item) => item.materialized).length,
    leases: leases.length,
    openings: 0,
    closures: 0,
    bankruptcies: 0,
    acquisitions: 0,
    revenue: 0,
    expenses: 0,
    unitsSold: 0,
    taxesPaid: 0,
    rentPaid: 0,
    payrollPaid: 0
  };
}

function emptyIntegrity(timestamp: number): BusinessEconomyIntegrityState {
  return { healthy: true, checkedAt: timestamp, duplicateBusinessIds: 0, duplicateVenueLinks: 0, orphanCompanies: 0, orphanLeases: 0, missingPremises: 0, missingInventories: 0, cashDrift: 0, warnings: [] };
}

function integrity(state: BusinessEconomyState, input: BusinessEconomyInput, inventory: ProductInventoryState): BusinessEconomyIntegrityState {
  const ids = state.businesses.map((item) => item.id);
  const venueIds = state.businesses.map((item) => item.venueId).filter((value): value is string => Boolean(value));
  const companies = new Set(state.companies.map((item) => item.id));
  const businessIds = new Set(ids);
  const inventoryIds = new Set(inventory.inventories.map((item) => item.id));
  const duplicateBusinessIds = ids.length - new Set(ids).size;
  const duplicateVenueLinks = venueIds.length - new Set(venueIds).size;
  const orphanCompanies = state.businesses.filter((item) => !companies.has(item.companyId)).length;
  const orphanLeases = state.leases.filter((item) => !businessIds.has(item.businessId)).length;
  const missingPremises = state.businesses.filter((item) => !item.sectorId || !item.buildingId || !item.unitId).length;
  const missingInventories = state.businesses.filter((item) => !inventoryIds.has(item.inventoryId)).length;
  const cashDrift = input.kernel ? state.businesses.filter((item) => {
    const observed = creditBalance(input.kernel, item.id);
    return observed !== undefined && Math.abs(observed - item.cash) >= .02;
  }).length : 0;
  const warnings: string[] = [];
  if (duplicateBusinessIds) warnings.push(`${duplicateBusinessIds} duplicate business ids`);
  if (duplicateVenueLinks) warnings.push(`${duplicateVenueLinks} venues linked to multiple businesses`);
  if (orphanCompanies) warnings.push(`${orphanCompanies} businesses reference missing companies`);
  if (orphanLeases) warnings.push(`${orphanLeases} leases reference missing businesses`);
  if (missingPremises) warnings.push(`${missingPremises} businesses have no premises`);
  if (missingInventories) warnings.push(`${missingInventories} businesses have no canonical inventory`);
  if (cashDrift) warnings.push(`${cashDrift} business balances differ from kernel`);
  return { healthy: warnings.length === 0, checkedAt: input.timestamp, duplicateBusinessIds, duplicateVenueLinks, orphanCompanies, orphanLeases, missingPremises, missingInventories, cashDrift, warnings };
}

function worldCoreStatus(status: UnifiedBusinessState["status"]): WorldCoreBusinessStatus {
  return status;
}

function supplyClass(category: UnifiedBusinessState["category"]): WorldCoreBusinessState["supplyClass"] {
  if (["convenience", "food", "bar", "market", "hotel"].includes(category)) return "food";
  if (["clinic", "pharmacy", "cyberware"].includes(category)) return "medical";
  if (["repair", "transport", "logistics"].includes(category)) return "parts";
  if (["office-service", "corporate", "education", "government"].includes(category)) return "documents";
  return "mixed";
}

export function projectBusinessEconomyToWorldCore(state: BusinessEconomyState, worldCore: WorldCoreState, timestamp: number): WorldCoreState {
  const previousById = new Map(worldCore.businesses.map((item) => [item.id, item]));
  const businesses: WorldCoreBusinessState[] = state.businesses.map((business) => {
    const previous = previousById.get(business.id);
    return {
      id: business.id,
      source: previous?.source ?? "registry",
      aliases: [...new Set([business.id, ...business.aliases, ...(previous?.aliases ?? [])])],
      legacyBusinessId: previous?.legacyBusinessId,
      venueId: business.venueId,
      locationId: business.locationId,
      districtId: business.districtId,
      buildingId: business.buildingId,
      unitId: business.unitId,
      ownerEntityId: business.companyId,
      operatorEntityId: business.id,
      name: business.name,
      category: business.category,
      supplyClass: supplyClass(business.category),
      status: worldCoreStatus(business.status),
      cash: business.cash,
      legacyCashObserved: previous?.legacyCashObserved,
      venueCashObserved: previous?.venueCashObserved,
      stockPercent: clamp(Math.round(business.stockUnits / Math.max(1, business.serviceCapacity * 2) * 100)),
      stockUnits: business.stockUnits,
      targetStaff: business.targetStaff,
      activeWorkers: business.activeWorkers,
      lastUpdatedAt: timestamp
    };
  });
  const aliasToBusinessId: Record<string, string> = {};
  for (const business of businesses) {
    aliasToBusinessId[business.id] = business.id;
    for (const alias of business.aliases) aliasToBusinessId[alias] = business.id;
  }
  const employmentBusinessIds = new Set(businesses.map((item) => item.id));
  return {
    ...worldCore,
    businesses,
    employments: worldCore.employments.filter((item) => employmentBusinessIds.has(item.businessId)),
    aliasToBusinessId,
    lastUpdatedAt: timestamp
  };
}

function venueStatus(status: UnifiedBusinessState["status"]): VenueOperatingStatus {
  return status === "restricted" || status === "strained" ? "operating" : status;
}

function legacyStatus(status: UnifiedBusinessState["status"]): BusinessStatus {
  if (["closed", "vacant", "renovation", "insolvent", "seized"].includes(status)) return "closed";
  if (status === "restricted") return "restricted";
  if (status === "strained") return "strained";
  return "stable";
}

function projectCompatibility(state: BusinessEconomyState, input: BusinessEconomyInput, worldCore: WorldCoreState, inventory: ProductInventoryState): Pick<BusinessEconomyAdvanceResult, "urban" | "economy"> {
  const byVenue = new Map(state.businesses.filter((item) => item.venueId).map((item) => [item.venueId as string, item]));
  const operations = input.urban.venueOperations.operations.map((operation) => {
    const business = byVenue.get(operation.venueId);
    if (!business) return operation;
    return {
      ...operation,
      cash: business.cash,
      status: venueStatus(business.status),
      revenueToday: business.revenueToday,
      expensesToday: business.expensesToday,
      lifetimeRevenue: business.lifetimeRevenue,
      lifetimeExpenses: business.lifetimeExpenses,
      lastUpdatedAt: input.timestamp
    };
  });
  const registry = input.urban.venueOperations.registry.map((entry) => {
    const business = byVenue.get(entry.venue.id);
    if (!business) return entry;
    return { ...entry, venue: { ...entry.venue, organizationId: business.companyId, operatingStatus: venueStatus(business.status), active: business.status === "operating", lastUpdatedAt: input.timestamp } };
  });
  const urban = {
    ...input.urban,
    venues: input.urban.venues.map((venue) => {
      const business = byVenue.get(venue.id);
      return business ? { ...venue, organizationId: business.companyId, operatingStatus: venueStatus(business.status), active: business.status === "operating", lastUpdatedAt: input.timestamp } : venue;
    }),
    venueOperations: { ...input.urban.venueOperations, operations, registry, lastUpdatedAt: input.timestamp },
    lastUpdatedAt: input.timestamp
  };
  const businessById = new Map(state.businesses.map((item) => [item.id, item]));
  const economy = {
    ...input.economy,
    businesses: input.economy.businesses.map((legacy) => {
      const canonicalId = worldCore.aliasToBusinessId[legacy.id] ?? legacy.id;
      const business = businessById.get(canonicalId);
      if (!business) return legacy;
      return {
        ...legacy,
        organizationId: business.companyId,
        cash: business.cash,
        stock: clamp(Math.round(business.stockUnits / Math.max(1, business.serviceCapacity * 2) * 100)),
        staffing: clamp(Math.round(business.activeWorkers / Math.max(1, business.targetStaff) * 100)),
        demand: business.demandScore,
        priceIndex: business.priceIndex,
        status: legacyStatus(business.status),
        shortage: business.stockUnits < business.serviceCapacity * .4,
        revenueToday: business.revenueToday,
        operatingCostsToday: business.expensesToday,
        rollingProfit: business.profitToday,
        lossDays: business.consecutiveLossDays,
        lastUpdatedAt: input.timestamp
      };
    }),
    lastUpdatedAt: input.timestamp
  };
  void inventory;
  return { urban, economy };
}

function reconcileObservedVenueMetrics(state: BusinessEconomyState, input: BusinessEconomyInput): BusinessEconomyState {
  const operationByVenueId = new Map(input.urban.venueOperations.operations.map((operation) => [operation.venueId, operation]));
  let revenueDelta = 0;
  let expenseDelta = 0;
  let changed = false;
  const businesses = state.businesses.map((business) => {
    if (!business.venueId) return business;
    const operation = operationByVenueId.get(business.venueId);
    if (!operation) return business;
    const observedLifetimeRevenue = Math.max(0, operation.lifetimeRevenue ?? operation.revenueToday);
    const observedLifetimeExpenses = Math.max(0, operation.lifetimeExpenses ?? operation.expensesToday);
    const addedRevenue = Math.max(0, observedLifetimeRevenue - business.lifetimeRevenue);
    const addedExpenses = Math.max(0, observedLifetimeExpenses - business.lifetimeExpenses);
    const cashChanged = Math.abs(operation.cash - business.cash) >= .02;
    if (addedRevenue <= 0 && addedExpenses <= 0 && !cashChanged) return business;
    changed = true;
    revenueDelta += addedRevenue;
    expenseDelta += addedExpenses;
    const currentRevenue = round(business.revenueToday + addedRevenue);
    const currentExpenses = round(business.expensesToday + addedExpenses);
    return {
      ...business,
      cash: round(operation.cash),
      revenueToday: currentRevenue,
      expensesToday: currentExpenses,
      profitToday: round(currentRevenue - currentExpenses),
      lifetimeRevenue: round(business.lifetimeRevenue + addedRevenue),
      lifetimeExpenses: round(business.lifetimeExpenses + addedExpenses),
      lastUpdatedAt: input.timestamp
    };
  });
  if (!changed) return state;
  return {
    ...state,
    businesses,
    totals: {
      ...state.totals,
      revenue: round(state.totals.revenue + revenueDelta),
      expenses: round(state.totals.expenses + expenseDelta)
    }
  };
}

function normalizePrevious(input: BusinessEconomyInput, registry: ReturnType<typeof buildRegistry>): BusinessEconomyState {
  const base: BusinessEconomyState = {
    version: 1,
    companies: registry.companies,
    businesses: registry.businesses,
    leases: registry.leases,
    markets: [],
    events: [],
    history: [],
    totals: baseTotals(registry.companies, registry.businesses, registry.leases),
    integrity: emptyIntegrity(input.timestamp),
    lastProcessedDay: dayIndex(input.timestamp),
    simulatedDays: 0,
    lastUpdatedAt: input.timestamp
  };
  if (!input.previous) return base;
  return {
    ...base,
    ...input.previous,
    version: 1,
    companies: registry.companies,
    businesses: registry.businesses,
    leases: registry.leases,
    markets: Array.isArray(input.previous.markets) ? input.previous.markets : [],
    events: Array.isArray(input.previous.events) ? input.previous.events.slice(0, EVENT_LIMIT) : [],
    history: Array.isArray(input.previous.history) ? input.previous.history.slice(-HISTORY_LIMIT) : [],
    totals: { ...base.totals, ...(input.previous.totals ?? {}) },
    integrity: input.previous.integrity ?? base.integrity,
    lastProcessedDay: input.previous.lastProcessedDay ?? dayIndex(input.timestamp),
    simulatedDays: input.previous.simulatedDays ?? 0,
    lastUpdatedAt: input.previous.lastUpdatedAt ?? input.timestamp
  };
}

export function createBusinessEconomyState(input: Omit<BusinessEconomyInput, "previous">): BusinessEconomyAdvanceResult {
  return advanceBusinessEconomyState({ ...input, previous: undefined });
}

export function normalizeBusinessEconomyState(value: unknown, input: Omit<BusinessEconomyInput, "previous">): BusinessEconomyAdvanceResult {
  const previous = value && typeof value === "object" ? value as BusinessEconomyState : undefined;
  return advanceBusinessEconomyState({ ...input, previous });
}

export function advanceBusinessEconomyState(input: BusinessEconomyInput): BusinessEconomyAdvanceResult {
  const targetDay = dayIndex(input.timestamp);
  if (input.previous && targetDay === input.previous.lastProcessedDay) {
    const observedPrevious = reconcileObservedVenueMetrics(input.previous, input);
    const businessByVenue = new Map(observedPrevious.businesses.filter((business) => business.venueId).map((business) => [business.venueId as string, business.id]));
    const allMaterializedKnown = input.urban.venueOperations.registry.every((entry) => businessByVenue.has(entry.venue.id));
    if (allMaterializedKnown) {
      const materializedVenueIds = new Set(input.urban.venueOperations.registry.map((entry) => entry.venue.id));
      const inventoryById = new Map(input.productInventory.inventories.map((inventory) => [inventory.id, inventory]));
      const businesses = observedPrevious.businesses.map((business) => {
        const stockroom = inventoryById.get(business.inventoryId);
        let units = 0;
        let value = 0;
        for (const stack of stockroom?.stacks ?? []) {
          if (stack.status !== "available" || (stack.expiresAt !== undefined && stack.expiresAt <= input.timestamp)) continue;
          const available = Math.max(0, stack.quantity - stack.reservedQuantity);
          units += available;
          value += available * stack.unitCost;
        }
        return { ...business, stockUnits: round(units), inventoryValue: round(value), materialized: Boolean(business.venueId && materializedVenueIds.has(business.venueId)), lastUpdatedAt: input.timestamp };
      });
      let state: BusinessEconomyState = {
        ...observedPrevious,
        businesses,
        totals: { ...observedPrevious.totals, activeBusinesses: businesses.filter((item) => ["operating", "restricted", "strained"].includes(item.status)).length, materializedBusinesses: businesses.filter((item) => item.materialized).length },
        lastUpdatedAt: input.timestamp
      };
      const worldCore = projectBusinessEconomyToWorldCore(state, input.worldCore, input.timestamp);
      state = { ...state, integrity: integrity(state, input, input.productInventory) };
      const compatibility = projectCompatibility(state, input, worldCore, input.productInventory);
      return { state, worldCore, productInventory: input.productInventory, urban: compatibility.urban, economy: compatibility.economy, drafts: [] };
    }
  }
  const registry = buildRegistry(input);
  let state = reconcileObservedVenueMetrics(normalizePrevious(input, registry), input);
  let inventory = registry.inventory;
  const draftTotals = new Map<string, KernelTransactionDraft>();
  const startingDay = state.lastProcessedDay;
  let cursor = state.lastProcessedDay;
  while (cursor < targetDay) {
    cursor += 1;
    const advanced = simulateDay(state, inventory, input, cursor);
    state = advanced.state;
    inventory = advanced.inventory;
    for (const transaction of advanced.drafts) {
      const key = `${transaction.debitEntityId}|${transaction.creditEntityId}|${transaction.resource}|${transaction.reason}`;
      const previous = draftTotals.get(key);
      if (previous) previous.amount = round(previous.amount + transaction.amount);
      else draftTotals.set(key, { ...transaction });
    }
  }
  const drafts = [...draftTotals.entries()].map(([key, transaction]) => ({
    ...transaction,
    idempotencyKey: `${input.seed}:business-aggregate:${startingDay}:${targetDay}:${key}`,
    timestamp: input.timestamp,
    description: `${transaction.description ?? "Business settlement"} (${Math.max(0, targetDay - startingDay)} day aggregate)`
  }));
  const inventoryById = new Map(inventory.inventories.map((item) => [item.id, item]));
  const stockBusinesses = state.businesses.map((business) => {
    const stockroom = inventoryById.get(business.inventoryId);
    let units = 0;
    let value = 0;
    for (const stack of stockroom?.stacks ?? []) {
      if (stack.status !== "available" || (stack.expiresAt !== undefined && stack.expiresAt <= input.timestamp)) continue;
      const available = Math.max(0, stack.quantity - stack.reservedQuantity);
      units += available;
      value += available * stack.unitCost;
    }
    return { ...business, stockUnits: round(units), inventoryValue: round(value), materialized: Boolean(business.venueId && materializedVenue(input, business.venueId)), lastUpdatedAt: input.timestamp };
  });
  const businessIdsByCompany = new Map<string, string[]>();
  for (const business of stockBusinesses) {
    const ids = businessIdsByCompany.get(business.companyId);
    if (ids) ids.push(business.id);
    else businessIdsByCompany.set(business.companyId, [business.id]);
  }
  state = {
    ...state,
    businesses: stockBusinesses,
    companies: state.companies.map((company) => ({ ...company, businessIds: businessIdsByCompany.get(company.id) ?? [], lastUpdatedAt: input.timestamp })),
    totals: {
      ...state.totals,
      companies: state.companies.length,
      businesses: stockBusinesses.length,
      activeBusinesses: stockBusinesses.filter((item) => ["operating", "restricted", "strained"].includes(item.status)).length,
      materializedBusinesses: stockBusinesses.filter((item) => item.materialized).length,
      leases: state.leases.length
    },
    lastUpdatedAt: input.timestamp
  };
  const worldCore = projectBusinessEconomyToWorldCore(state, input.worldCore, input.timestamp);
  state = { ...state, integrity: integrity(state, input, inventory) };
  const compatibility = projectCompatibility(state, input, worldCore, inventory);
  return { state, worldCore, productInventory: inventory, urban: compatibility.urban, economy: compatibility.economy, drafts };
}

export function synchronizeBusinessEconomyFromKernel(state: BusinessEconomyState, kernel: SimulationKernelState, timestamp: number): BusinessEconomyState {
  const balances = new Map(kernel.accounts.map((account) => [account.entityId, account.balances.find((entry) => entry.resource === "credits")?.amount]));
  const businesses = state.businesses.map((business) => {
    const cash = balances.get(business.id);
    return cash === undefined ? business : { ...business, cash: round(cash), lastUpdatedAt: timestamp };
  });
  const companies = state.companies.map((company) => {
    const cash = balances.get(company.id);
    return cash === undefined ? company : { ...company, treasury: round(cash), lastUpdatedAt: timestamp };
  });
  const warnings = state.integrity.warnings.filter((warning) => !warning.includes("business balances differ from kernel"));
  const integrityState = { ...state.integrity, healthy: warnings.length === 0, checkedAt: timestamp, cashDrift: 0, warnings };
  return { ...state, businesses, companies, integrity: integrityState, lastUpdatedAt: timestamp };
}
