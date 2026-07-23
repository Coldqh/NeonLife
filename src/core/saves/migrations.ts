import { SAVE_SCHEMA_VERSION, type SaveEnvelope, type SaveSlotId } from "./types";
import { createStableEntityId } from "../ids/entityId";
import type { GameSession, LocationState } from "../../world/state/types";
import { createInitialFoodState } from "../../gameplay/food/foodSystem";
import { createInitialHousing } from "../../gameplay/housing/housingSystem";
import { createInitialCourierState, type CourierOrder, type CourierState } from "../../gameplay/jobs/courier/courierSystem";
import { createHumanNetwork, getPerson, toKnownNpc } from "../../people/network/humanNetwork";
import type { HumanNetworkState, PersonState } from "../../people/network/types";
import { createPressureState } from "../../gameplay/pressure/pressureSystem";
import type { PressureState } from "../../gameplay/pressure/types";
import { createLocalEconomy } from "../../gameplay/economy/localEconomy";
import type { LocalEconomyState } from "../../gameplay/economy/types";
import { createPopulationState } from "../../simulation/population/populationSystem";
import type { PopulationState } from "../../simulation/population/types";
import { normalizeLaborMarketState } from "../../simulation/labor/laborMarket";
import { normalizePopulationLifecycleState } from "../../simulation/lifecycle/lifecycleSystem";
import type { PopulationLifecycleState } from "../../simulation/lifecycle/types";
import { advanceSimulationKernel, normalizeSimulationKernel } from "../../simulation/kernel/simulationKernel";
import { normalizeInfrastructureState } from "../../simulation/infrastructure/infrastructureSystem";
import { normalizeProductionState } from "../../simulation/production/productionSystem";
import { normalizeOrganizationEcosystem } from "../../simulation/organizations/organizationSystem";
import { normalizeGovernmentCrimeState } from "../../simulation/government/governmentSystem";
import { normalizeHealthCyberwareState } from "../../simulation/health/healthSystem";
import { normalizeDataSurveillanceState } from "../../simulation/data/dataSystem";
import { normalizeMetropolitanState } from "../../simulation/spatial/metropolitanSystem";
import { normalizeUrbanFabricState, synchronizeMetropolitanFromUrban } from "../../simulation/urban/urbanSystem";
import { normalizeMetropolitanMobilityState, synchronizeMetropolitanFromMobility } from "../../simulation/mobility/mobilitySystem";
import { normalizeLocalSceneState } from "../../simulation/localScene/localSceneSystem";
import { createInitialDistrictPulse } from "../../world/city/districtPulse";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLegacyStoryEvent(value: unknown): boolean {
  if (!isObject(value)) return false;
  const text = `${String(value.title ?? "")} ${String(value.detail ?? "")}`.toLowerCase();
  return ["временный пропуск", "собеседован", "ночная вакансия", "сервисной стойке", "главный вход не используй"].some((marker) => text.includes(marker));
}

function hasBaseSessionShape(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  return typeof value.timestamp === "number"
    && isObject(value.world)
    && isObject(value.player)
    && Array.isArray(value.events)
    && isObject(value.district)
    && isObject(value.primaryContact);
}


function ensureMetropolitanDistrictPopulation(districts: GameSession["world"]["districts"]): GameSession["world"]["districts"] {
  const total = districts.reduce((sum, district) => sum + district.population, 0);
  if (total >= 4_000_000 || !districts.length) return districts;
  const target = 6_800_000;
  const weights = districts.map((district, index) => Math.max(1, district.population || (index === 0 ? 45 : index === 1 ? 32 : 23)));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  let allocated = 0;
  return districts.map((district, index) => {
    const population = index === districts.length - 1 ? target - allocated : Math.max(100_000, Math.floor(target * weights[index] / weightTotal));
    allocated += population;
    return { ...district, population };
  });
}

function migrateLocationSchedules(locations: LocationState[]): LocationState[] {
  return locations.map((location) => {
    if (typeof location.openHour === "number" && typeof location.closeHour === "number") return location;
    if (location.type === "food") return { ...location, openHour: 18, closeHour: 5 };
    if (location.type === "market") return { ...location, openHour: 16, closeHour: 6 };
    if (location.type === "workshop") return { ...location, openHour: 6, closeHour: 2 };
    if (location.type === "office") return { ...location, openHour: 7, closeHour: 22 };
    if (location.type === "education") return { ...location, openHour: 7, closeHour: 20 };
    return { ...location, openHour: 0, closeHour: 24 };
  });
}

function hasHumanNetwork(value: unknown): value is HumanNetworkState {
  return isObject(value)
    && Array.isArray(value.people)
    && typeof value.lastUpdatedAt === "number"
    && typeof value.cycle === "number";
}


function hasPressureState(value: unknown): value is PressureState {
  return isObject(value)
    && Array.isArray(value.obligations)
    && Array.isArray(value.requests)
    && isObject(value.currentDay)
    && Array.isArray(value.summaries);
}


function hasEconomyState(value: unknown): value is LocalEconomyState {
  return isObject(value)
    && Array.isArray(value.businesses)
    && typeof value.lastUpdatedAt === "number"
    && typeof value.cycle === "number";
}


function hasPopulationState(value: unknown): value is PopulationState {
  return isObject(value)
    && Array.isArray(value.residents)
    && Array.isArray(value.households)
    && Array.isArray(value.employments)
    && Array.isArray(value.cohorts)
    && typeof value.lastUpdatedAt === "number";
}


function normalizePopulationState(
  value: unknown,
  seed: string,
  timestamp: number,
  districts: GameSession["world"]["districts"],
  locations: LocationState[],
  organizations: GameSession["world"]["organizations"],
  people: PersonState[]
): PopulationState {
  const fresh = createPopulationState(seed, timestamp, districts, locations, organizations, people);
  if (!hasPopulationState(value)) return fresh;
  const rawValue = value as PopulationState & { lifecycle?: PopulationLifecycleState };
  const residents = rawValue.residents.map((resident) => ({
    ...resident,
    transportAccess: typeof (resident as unknown as Record<string, unknown>).transportAccess === "number"
      ? (resident as unknown as { transportAccess: number }).transportAccess
      : 100
  }));
  const households = rawValue.households.map((household, index) => {
    const raw = household as unknown as Record<string, unknown>;
    const fallback = fresh.households[index % Math.max(1, fresh.households.length)];
    const foodUnits = typeof raw.foodUnits === "number" ? raw.foodUnits : 0;
    return {
      ...fallback,
      ...household,
      pantry: Array.isArray(raw.pantry)
        ? raw.pantry as PopulationState["households"][number]["pantry"]
        : foodUnits > 0 ? [{ productId: "kernel-9-brick", units: foodUnits }] : [],
      spendingMode: ["survival", "restricted", "standard", "comfortable"].includes(String(raw.spendingMode))
        ? raw.spendingMode as PopulationState["households"][number]["spendingMode"]
        : fallback.spendingMode,
      consecutiveRentMisses: typeof raw.consecutiveRentMisses === "number" ? raw.consecutiveRentMisses : 0,
      moveCount: typeof raw.moveCount === "number" ? raw.moveCount : 0,
      foundedDay: typeof raw.foundedDay === "number" ? raw.foundedDay : fallback.foundedDay,
      originHouseholdIds: Array.isArray(raw.originHouseholdIds) ? raw.originHouseholdIds as string[] : [],
      lastLedger: isObject(raw.lastLedger)
        ? { ...(raw.lastLedger as unknown as NonNullable<PopulationState["households"][number]["lastLedger"]>), utilitySpent: typeof (raw.lastLedger as Record<string, unknown>).utilitySpent === "number" ? Number((raw.lastLedger as Record<string, unknown>).utilitySpent) : 0 }
        : null
    };
  });
  const currentEmployments = rawValue.employments.map((employment) => ({
    ...employment,
    organizationId: employment.organizationId ?? locations.find((location) => location.id === employment.locationId)?.organizationId,
    unpaidDays: typeof (employment as unknown as Record<string, unknown>).unpaidDays === "number" ? (employment as unknown as { unpaidDays: number }).unpaidDays : 0
  }));
  const existingEmploymentIds = new Set(currentEmployments.map((employment) => employment.id));
  const educationEmployment = fresh.employments.filter((employment) => locations.find((location) => location.id === employment.locationId)?.type === "education" && !existingEmploymentIds.has(employment.id));
  const employments = [...currentEmployments, ...educationEmployment];
  const housing = Array.isArray((rawValue as unknown as Record<string, unknown>).housing)
    ? (rawValue as unknown as { housing: PopulationState["housing"] }).housing.map((item) => ({ ...item, ownerOrganizationId: item.ownerOrganizationId ?? locations.find((location) => location.id === item.locationId)?.organizationId }))
    : fresh.housing;
  const dayIndex = Math.floor(timestamp / (24 * 60 * 60_000));
  const lifecycle = normalizePopulationLifecycleState(rawValue.lifecycle, seed, dayIndex, residents, households, districts, locations);
  return {
    ...fresh,
    ...rawValue,
    residents: lifecycle.residents,
    households: lifecycle.households,
    employments,
    housing,
    lifecycle: lifecycle.state,
    laborMarket: normalizeLaborMarketState(rawValue.laborMarket, dayIndex),
    totals: isObject((rawValue as unknown as Record<string, unknown>).totals)
      ? { ...fresh.totals, ...(rawValue as unknown as { totals: Partial<PopulationState["totals"]> }).totals }
      : fresh.totals
  };
}

function normalizeEconomyState(
  value: unknown,
  seed: string,
  timestamp: number,
  locations: LocationState[],
  people: PersonState[],
  population: PopulationState,
  foodState: GameSession["life"]["food"],
  pulseState: GameSession["district"]
): LocalEconomyState {
  const fresh = createLocalEconomy(seed, timestamp, locations, people, population, foodState, pulseState);
  if (!hasEconomyState(value)) return fresh;
  return {
    ...fresh,
    ...value,
    businesses: value.businesses.map((business, index) => {
      const fallback = fresh.businesses.find((item) => item.id === business.id || item.locationId === business.locationId)
        ?? fresh.businesses[index % Math.max(1, fresh.businesses.length)];
      return {
        ...fallback,
        ...business,
        organizationId: business.organizationId ?? fallback.organizationId,
        targetStaff: Math.max(fallback.targetStaff, business.targetStaff ?? 0)
      };
    })
  };
}


function normalizeUrbanFoodState(food: GameSession["life"]["food"], schemaVersion: number): GameSession["life"]["food"] {
  if (schemaVersion >= 10) return food;
  const totalStock = Object.values(food.shopStocks).reduce((total, shop) => total + Object.values(shop).reduce((sum, units) => sum + units, 0), 0);
  if (totalStock >= 500) return food;
  return {
    ...food,
    shopStocks: Object.fromEntries(
      Object.entries(food.shopStocks).map(([locationId, shop]) => [
        locationId,
        Object.fromEntries(Object.entries(shop).map(([productId, units]) => [productId, units * 24]))
      ])
    )
  };
}

function ensureDistrictHousing(
  seed: string,
  districts: GameSession["world"]["districts"],
  locations: LocationState[]
): LocationState[] {
  const next = [...locations];
  for (const [index, district] of districts.entries()) {
    if (next.some((location) => location.districtId === district.id && location.type === "housing")) continue;
    next.push({
      id: createStableEntityId("location", `${seed}:migration-housing:${district.id}`),
      districtId: district.id,
      name: index === 1 ? "WORKER DORM 12" : "CROWN RESIDENCES 03",
      code: index === 1 ? "HAB/R12" : "HAB/T03",
      type: "housing",
      open: true,
      security: district.securityLevel,
      openHour: 0,
      closeHour: 24
    });
  }
  return next;
}


function ensureLocalOperators(
  seed: string,
  sourceOrganizations: GameSession["world"]["organizations"],
  sourceLocations: LocationState[],
  cityName: string
): { organizations: GameSession["world"]["organizations"]; locations: LocationState[] } {
  const organizations = sourceOrganizations.map((organization) => ({ ...organization, locationIds: [...organization.locationIds] }));
  const definitions: Array<{ scope: string; name: string; code: string; type: GameSession["world"]["organizations"][number]["type"]; budget: number; reputation: number; employeeCount: number; locationType: LocationState["type"]; locationName: string }> = [
    { scope: "habstack-trust", name: "HABSTACK PROPERTY TRUST", code: "HAB/TRUST", type: "company", budget: 780_000, reputation: 28, employeeCount: 54, locationType: "housing", locationName: "HAB-STACK 07" },
    { scope: "underline-market", name: "UNDERLINE MARKET COOPERATIVE", code: "MKT/COOP", type: "independent", budget: 620_000, reputation: 44, employeeCount: 96, locationType: "market", locationName: "UNDERLINE NIGHT MARKET" },
    { scope: "night-kitchen", name: "NIGHT KITCHEN COLLECTIVE", code: "FOOD/COL", type: "independent", budget: 240_000, reputation: 38, employeeCount: 34, locationType: "food", locationName: "NIGHT KITCHEN 14" }
  ];
  let locations = sourceLocations.map((location) => ({ ...location }));
  for (const definition of definitions) {
    const id = createStableEntityId("org", `${seed}:${definition.scope}`);
    let organization = organizations.find((entry) => entry.id === id);
    if (!organization) {
      organization = { id, name: definition.name, code: definition.code, type: definition.type, budget: definition.budget, reputation: definition.reputation, employeeCount: definition.employeeCount, locationIds: [] };
      organizations.push(organization);
    }
    locations = locations.map((location) => {
      const matches = location.name === definition.locationName || (location.type === definition.locationType && !location.organizationId && definition.locationType !== "housing");
      if (!matches) return location;
      if (!organization!.locationIds.includes(location.id)) organization!.locationIds.push(location.id);
      return { ...location, organizationId: id };
    });
  }
  const civicId = createStableEntityId("org", `${seed}:civic-authority`);
  let civic = organizations.find((entry) => entry.id === civicId || entry.type === "government");
  if (!civic) {
    civic = { id: civicId, name: `${cityName} CIVIC AUTHORITY`, code: "CIV/AUTH", type: "government", budget: 46_000_000, reputation: 39, employeeCount: 8_200, locationIds: [] };
    organizations.push(civic);
  }
  if (!locations.some((location) => location.type === "government" && location.organizationId === civic!.id)) {
    const office = locations.find((location) => location.type === "office") ?? locations[0];
    if (office) {
      locations.push({
        id: createStableEntityId("location", `${seed}:civic-hall`),
        districtId: office.districtId,
        organizationId: civic.id,
        name: `${cityName} CIVIC ADMINISTRATION`,
        code: "CIV/T01",
        type: "government",
        open: true,
        security: Math.max(72, office.security - 8),
        openHour: 7,
        closeHour: 21
      });
    }
  }

  const vectra = organizations.find((organization) => organization.code === "VEC/WRK" || organization.name.includes("VECTRA"));
  const aurelian = organizations.find((organization) => organization.code === "AUR/SYS" || organization.name.includes("AURELIAN"));
  const lowerDistrictId = locations.find((location) => location.type === "market")?.districtId ?? locations[0]?.districtId;
  const industrialDistrictId = locations.find((location) => location.type === "workshop")?.districtId ?? lowerDistrictId;
  const corporateDistrictId = locations.find((location) => location.type === "office")?.districtId ?? industrialDistrictId;
  const educationDefinitions = [
    { scope: "lower-learning-hub", name: "CIVIC LEARNING HUB U-04", code: "EDU/U04", districtId: lowerDistrictId, organizationId: civic.id, security: 44 },
    { scope: "technical-institute", name: "VECTRA TECHNICAL INSTITUTE", code: "EDU/R12", districtId: industrialDistrictId, organizationId: vectra?.id ?? civic.id, security: 63 },
    { scope: "corporate-academy", name: "AURELIAN ACADEMY", code: "EDU/T03", districtId: corporateDistrictId, organizationId: aurelian?.id ?? civic.id, security: 91 }
  ];
  for (const definition of educationDefinitions) {
    if (!definition.districtId || locations.some((location) => location.code === definition.code || location.name === definition.name)) continue;
    locations.push({
      id: createStableEntityId("location", `${seed}:${definition.scope}`),
      districtId: definition.districtId,
      organizationId: definition.organizationId,
      name: definition.name,
      code: definition.code,
      type: "education",
      open: true,
      security: definition.security,
      openHour: 7,
      closeHour: 22
    });
  }

  const medical = organizations.find((organization) => organization.type === "medical");
  const gang = organizations.find((organization) => organization.type === "gang");
  const healthDefinitions = [
    { scope: "trauma-station", name: "CMU INDUSTRIAL TRAUMA STATION", code: "CMU/R08", districtId: industrialDistrictId, organizationId: medical?.id ?? civic.id, security: 68, openHour: 0, closeHour: 24 },
    { scope: "regional-hospital", name: "CMU REGIONAL HOSPITAL", code: "CMU/T02", districtId: corporateDistrictId, organizationId: medical?.id ?? civic.id, security: 86, openHour: 0, closeHour: 24 },
    { scope: "occupational-clinic", name: "AURELIAN OCCUPATIONAL CLINIC", code: "AUR/MED-01", districtId: corporateDistrictId, organizationId: aurelian?.id ?? medical?.id ?? civic.id, security: 92, openHour: 6, closeHour: 23 },
    { scope: "underground-clinic", name: "CUTWIRE BACKROOM SURGERY", code: "CW/MED-U", districtId: lowerDistrictId, organizationId: gang?.id ?? civic.id, security: 19, openHour: 20, closeHour: 5 }
  ];
  for (const definition of healthDefinitions) {
    if (!definition.districtId || locations.some((location) => location.code === definition.code || location.name === definition.name)) continue;
    locations.push({
      id: createStableEntityId("location", `${seed}:${definition.scope}`),
      districtId: definition.districtId,
      organizationId: definition.organizationId,
      name: definition.name,
      code: definition.code,
      type: "clinic",
      open: true,
      security: definition.security,
      openHour: definition.openHour,
      closeHour: definition.closeHour
    });
  }

  for (const organization of organizations) {
    organization.locationIds = locations.filter((location) => location.organizationId === organization.id).map((location) => location.id);
  }
  return { organizations, locations };
}

function migrateCourierOrder(order: unknown, people: PersonState[], index: number): CourierOrder | null {
  if (!isObject(order) || typeof order.id !== "string" || typeof order.code !== "string") return null;
  const matchedPerson = typeof order.clientId === "string"
    ? people.find((item) => item.id === order.clientId)
    : undefined;
  const person = matchedPerson ?? people[index % Math.max(1, people.length)];
  if (!person) return null;
  return {
    id: order.id,
    code: order.code,
    clientId: person.id,
    client: matchedPerson && typeof order.client === "string" ? order.client : person.name,
    requestNote: typeof order.requestNote === "string" ? order.requestNote : person.problem.detail,
    businessId: typeof order.businessId === "string" ? order.businessId : null,
    economicPurpose: order.economicPurpose === "restock" ? "restock" : "personal",
    pickupLocationId: String(order.pickupLocationId ?? "location-missing"),
    dropoffLocationId: String(order.dropoffLocationId ?? person.currentLocationId),
    cargoName: String(order.cargoName ?? "sealed parcel"),
    cargoClass: ["documents", "food", "medical", "parts", "sealed"].includes(String(order.cargoClass))
      ? order.cargoClass as CourierOrder["cargoClass"]
      : "sealed",
    weightKg: typeof order.weightKg === "number" ? order.weightKg : 1,
    payout: typeof order.payout === "number" ? order.payout : 40,
    latePenalty: typeof order.latePenalty === "number" ? order.latePenalty : 18,
    deadlineAt: typeof order.deadlineAt === "number" ? order.deadlineAt : 0,
    status: ["available", "accepted", "in-transit", "completed", "failed", "expired"].includes(String(order.status))
      ? order.status as CourierOrder["status"]
      : "available",
    risk: ["low", "medium", "high"].includes(String(order.risk)) ? order.risk as CourierOrder["risk"] : "low",
    legality: ["legal", "restricted", "unknown"].includes(String(order.legality)) ? order.legality as CourierOrder["legality"] : "legal",
    condition: typeof order.condition === "number" ? order.condition : 100,
    acceptedAt: typeof order.acceptedAt === "number" ? order.acceptedAt : null,
    collectedAt: typeof order.collectedAt === "number" ? order.collectedAt : null,
    completedAt: typeof order.completedAt === "number" ? order.completedAt : null
  };
}

function migrateCourierState(
  value: unknown,
  seed: string,
  timestamp: number,
  locations: LocationState[],
  people: PersonState[],
  businesses: LocalEconomyState["businesses"]
): CourierState {
  if (!isObject(value) || !Array.isArray(value.orders)) {
    return createInitialCourierState(seed, timestamp, locations, people, businesses);
  }
  const orders = value.orders
    .map((order, index) => migrateCourierOrder(order, people, index))
    .filter((order): order is CourierOrder => Boolean(order));
  if (!orders.length) return createInitialCourierState(seed, timestamp, locations, people, businesses);
  return {
    orders,
    activeOrderId: typeof value.activeOrderId === "string" ? value.activeOrderId : null,
    boardGeneration: typeof value.boardGeneration === "number" ? value.boardGeneration : 1,
    boardRefreshAt: typeof value.boardRefreshAt === "number" ? value.boardRefreshAt : timestamp + 8 * 60 * 60_000,
    rating: typeof value.rating === "number" ? value.rating : 50,
    completedDeliveries: typeof value.completedDeliveries === "number" ? value.completedDeliveries : 0,
    failedDeliveries: typeof value.failedDeliveries === "number" ? value.failedDeliveries : 0,
    totalEarnings: typeof value.totalEarnings === "number" ? value.totalEarnings : 0,
    cargoCapacityKg: typeof value.cargoCapacityKg === "number" ? value.cargoCapacityKg : 9
  };
}

export function migrateEnvelope(raw: unknown, slotId: SaveSlotId): SaveEnvelope | null {
  if (!isObject(raw) || !hasBaseSessionShape(raw.payload)) return null;
  const schemaVersion = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;
  if (schemaVersion > SAVE_SCHEMA_VERSION) return null;

  const payload = raw.payload;
  const world = payload.world as Record<string, unknown>;
  const meta = world.meta as Record<string, unknown> | undefined;
  const district = payload.district as Record<string, unknown>;
  const timestamp = payload.timestamp as number;
  const rawLocations = migrateLocationSchedules((Array.isArray(world.locations) ? world.locations : []) as LocationState[]);
  const districts = ensureMetropolitanDistrictPopulation((Array.isArray(world.districts) ? world.districts : []) as GameSession["world"]["districts"]);
  const seed = String(meta?.seed ?? "NEON-LIFE-MIGRATED");
  const districtHousingLocations = ensureDistrictHousing(seed, districts, rawLocations);
  const localOperators = ensureLocalOperators(seed, (Array.isArray(world.organizations) ? world.organizations : []) as GameSession["world"]["organizations"], districtHousingLocations, String((world.city as Record<string, unknown> | undefined)?.name ?? "CITY"));
  const organizations = localOperators.organizations;
  const locations = localOperators.locations;
  const housingLocation = locations.find((location) => location.type === "housing") ?? locations[0];
  const marketLocation = locations.find((location) => location.type === "market") ?? locations[0];
  const kitchenLocation = locations.find((location) => location.type === "food") ?? marketLocation;
  const clinicLocation = locations.find((location) => location.type === "clinic") ?? marketLocation;
  const existingLife = isObject(payload.life) ? payload.life : null;
  const migratedEvents = (Array.isArray(payload.events) ? payload.events : []).filter((event) => !isLegacyStoryEvent(event));
  const migratedQueue = (Array.isArray(payload.eventQueue) ? payload.eventQueue : []).filter((event) => !isObject(event) || (event.type !== "vacancy-expiry" && event.type !== "grid-restoration" && event.type !== "patrol-shift"));
  const people = hasHumanNetwork(payload.people)
    ? payload.people
    : createHumanNetwork(seed, timestamp, locations);
  const currentContactId = typeof world.primaryContactId === "string"
    ? world.primaryContactId
    : people.selectedPersonId;
  const selectedPerson = getPerson(people, currentContactId) ?? people.people[0] ?? null;
  const existingContact = isObject(payload.primaryContact) ? payload.primaryContact : {};
  const primaryContact = selectedPerson
    ? toKnownNpc(selectedPerson, locations, timestamp)
    : {
      ...existingContact,
      role: "LOCAL ACQUAINTANCE",
      status: "Занят своими делами",
      location: housingLocation?.name ?? "LOCAL DISTRICT",
      knownFacts: ["живёт в том же районе", "работает по сменному графику", "не связан с активными заданиями игрока"]
    };
  const existingLocationId = existingLife && typeof existingLife.currentLocationId === "string"
    ? existingLife.currentLocationId
    : housingLocation?.id;
  const existingLocationName = locations.find((location) => location.id === existingLocationId)?.name
    ?? housingLocation?.name
    ?? "LOCAL DISTRICT";
  const existingJobs = isObject(payload.jobs) ? payload.jobs : {};
  const housingState = existingLife && isObject(existingLife.housing)
    ? existingLife.housing as unknown as GameSession["life"]["housing"]
    : createInitialHousing(housingLocation?.id ?? "location-missing", timestamp);
  const rawFoodState = existingLife && isObject(existingLife.food)
    ? existingLife.food as unknown as GameSession["life"]["food"]
    : createInitialFoodState(
      seed,
      timestamp,
      marketLocation?.id ?? "market-missing",
      kitchenLocation?.id ?? "kitchen-missing",
      clinicLocation?.id ?? "clinic-missing"
    );
  const foodState = normalizeUrbanFoodState(rawFoodState, schemaVersion);
  const pulseState = isObject(payload.district)
    ? payload.district as unknown as GameSession["district"]
    : createInitialDistrictPulse(timestamp, seed);
  let population = normalizePopulationState(payload.population, seed, timestamp, districts, locations, organizations, people.people);
  if (schemaVersion < 20) {
    population = {
      ...population,
      lifecycle: {
        ...population.lifecycle,
        representedPopulationByDistrict: Object.fromEntries(districts.map((district) => [district.id, district.population]))
      }
    };
  }
  const economy = normalizeEconomyState(payload.economy, seed, timestamp, locations, people.people, population, foodState, pulseState);
  const courier = migrateCourierState(existingJobs.courier, seed, timestamp, locations, people.people, economy.businesses);
  const pressure = hasPressureState(payload.pressure)
    ? payload.pressure
    : createPressureState(seed, timestamp, housingState, people.people, locations);
  const playerState = payload.player as unknown as GameSession["player"];
  const cityState = world.city as unknown as GameSession["world"]["city"];
  const infrastructure = normalizeInfrastructureState(payload.infrastructure, seed, timestamp, cityState, districts, locations, organizations, population, economy);
  const production = normalizeProductionState(payload.production, seed, timestamp, districts, locations, organizations, economy);
  const baseKernel = normalizeSimulationKernel(payload.kernel, {
    timestamp,
    seed,
    city: cityState,
    districts,
    locations,
    organizations,
    player: playerState,
    population,
    economy,
    infrastructure,
    production,
    food: foodState
  });
  const organizationEcosystem = normalizeOrganizationEcosystem(payload.organizationEcosystem, {
    timestamp,
    seed,
    organizations,
    population,
    economy,
    infrastructure,
    production,
    kernel: baseKernel,
    districts,
    locations
  });
  const government = normalizeGovernmentCrimeState(payload.government, {
    timestamp,
    seed,
    cityId: cityState.id,
    districts,
    locations,
    organizations,
    population,
    economy,
    infrastructure,
    production,
    organizationEcosystem
  });
  const health = normalizeHealthCyberwareState(payload.health, {
    timestamp,
    seed,
    districts,
    locations,
    organizations,
    population,
    economy,
    infrastructure,
    production,
    government
  });
  const data = normalizeDataSurveillanceState(payload.data, {
    timestamp,
    seed,
    cityId: cityState.id,
    districts,
    locations,
    organizations,
    population,
    economy,
    infrastructure,
    organizationEcosystem,
    government,
    health
  });
  const metropolitan = normalizeMetropolitanState(payload.metropolitan, {
    timestamp,
    seed,
    activeLocationId: existingLocationId ?? housingLocation?.id ?? locations[0]?.id ?? "location-missing",
    districts,
    locations,
    representedPopulationByDistrict: population.lifecycle.representedPopulationByDistrict,
    transportServiceLevel: infrastructure.networks.find((item) => item.kind === "transport")?.averageServiceLevel ?? 100,
    dataServiceLevel: infrastructure.networks.find((item) => item.kind === "data")?.averageServiceLevel ?? 100,
    recentEventCount: migratedEvents.length,
    recentObservationCount: data.observations.length
  });
  const urban = normalizeUrbanFabricState(payload.urban, {
    timestamp,
    seed,
    activeLocationId: existingLocationId ?? housingLocation?.id ?? locations[0]?.id ?? "location-missing",
    metropolitan,
    districts,
    locations,
    organizations,
    population,
    transportServiceLevel: infrastructure.networks.find((item) => item.kind === "transport")?.averageServiceLevel ?? 100,
    dataServiceLevel: infrastructure.networks.find((item) => item.kind === "data")?.averageServiceLevel ?? 100
  });
  const synchronizedMetropolitan = synchronizeMetropolitanFromUrban(metropolitan, urban);
  const mobility = normalizeMetropolitanMobilityState(payload.mobility, {
    timestamp,
    seed,
    metropolitan: synchronizedMetropolitan,
    urban,
    districts,
    locations,
    organizations,
    population,
    economy,
    production,
    transportServiceLevel: infrastructure.networks.find((item) => item.kind === "transport")?.averageServiceLevel ?? 100,
    dataServiceLevel: infrastructure.networks.find((item) => item.kind === "data")?.averageServiceLevel ?? 100
  });
  const mobilitySynchronizedMetropolitan = synchronizeMetropolitanFromMobility(synchronizedMetropolitan, mobility);
  population = {
    ...population,
    lifecycle: {
      ...population.lifecycle,
      representedPopulationByDistrict: Object.fromEntries(mobilitySynchronizedMetropolitan.districts.map((district) => [district.districtId, district.representedPopulation]))
    }
  };
  const localScene = normalizeLocalSceneState(payload.localScene, {
    timestamp,
    seed,
    activeLocationId: existingLocationId ?? housingLocation?.id ?? locations[0]?.id ?? "location-missing",
    locations,
    people,
    population,
    metropolitan: mobilitySynchronizedMetropolitan,
    urban,
    mobility
  });
  const kernel = advanceSimulationKernel(baseKernel, {
    timestamp,
    seed,
    city: cityState,
    districts,
    locations,
    organizations,
    player: playerState,
    population,
    economy,
    infrastructure,
    production,
    organizationEcosystem,
    government,
    health,
    data,
    food: foodState
  });

  const { situations: _discardedSituations, ...payloadWithoutSituations } = payload;
  const migratedPayload = {
    ...payloadWithoutSituations,
    schemaVersion: SAVE_SCHEMA_VERSION,
    events: migratedEvents,
    eventQueue: migratedQueue,
    primaryContact,
    people,
    pressure,
    economy,
    population,
    kernel,
    infrastructure,
    production,
    organizationEcosystem,
    government,
    health,
    data,
    metropolitan: mobilitySynchronizedMetropolitan,
    urban,
    mobility,
    localScene,
    currentActivity: `На месте: ${existingLocationName}`,
    world: {
      ...world,
      primaryContactId: selectedPerson?.id ?? String(world.primaryContactId ?? "person-missing"),
      locations,
      organizations,
      districts: districts.map((district) => ({
        ...district,
        population: Math.round(population.lifecycle.representedPopulationByDistrict[district.id] ?? district.population)
      })),
      city: { ...cityState, population: mobilitySynchronizedMetropolitan.totals.representedPopulation }
    },
    district: {
      ...district,
      seedScope: typeof district.seedScope === "string" ? district.seedScope : seed
    },
    life: existingLife ? { ...existingLife, food: foodState, housing: housingState } : {
      currentLocationId: housingLocation?.id ?? "location-missing",
      housing: createInitialHousing(housingLocation?.id ?? "location-missing", timestamp),
      food: createInitialFoodState(
        seed,
        timestamp,
        marketLocation?.id ?? "market-missing",
        kitchenLocation?.id ?? "kitchen-missing",
        clinicLocation?.id ?? "clinic-missing"
      ),
      lastSleepAt: null
    },
    jobs: { ...existingJobs, courier }
  } as unknown as GameSession;

  return {
    slotId,
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    checksum: typeof raw.checksum === "string" ? raw.checksum : "",
    payload: migratedPayload
  };
}
