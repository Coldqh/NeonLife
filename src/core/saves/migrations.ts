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
import { normalizeSimulationKernel } from "../../simulation/kernel/simulationKernel";
import { normalizeInfrastructureState } from "../../simulation/infrastructure/infrastructureSystem";
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

function migrateLocationSchedules(locations: LocationState[]): LocationState[] {
  return locations.map((location) => {
    if (typeof location.openHour === "number" && typeof location.closeHour === "number") return location;
    if (location.type === "food") return { ...location, openHour: 18, closeHour: 5 };
    if (location.type === "market") return { ...location, openHour: 16, closeHour: 6 };
    if (location.type === "workshop") return { ...location, openHour: 6, closeHour: 2 };
    if (location.type === "office") return { ...location, openHour: 7, closeHour: 22 };
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
  return {
    ...fresh,
    ...value,
    residents: value.residents.map((resident) => ({ ...resident, transportAccess: typeof (resident as unknown as Record<string, unknown>).transportAccess === "number" ? (resident as unknown as { transportAccess: number }).transportAccess : 100 })),
    households: value.households.map((household, index) => {
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
        lastLedger: isObject(raw.lastLedger) ? { ...(raw.lastLedger as unknown as NonNullable<PopulationState["households"][number]["lastLedger"]>), utilitySpent: typeof (raw.lastLedger as Record<string, unknown>).utilitySpent === "number" ? Number((raw.lastLedger as Record<string, unknown>).utilitySpent) : 0 } : null
      };
    }),
    employments: value.employments.map((employment) => ({ ...employment, unpaidDays: typeof (employment as unknown as Record<string, unknown>).unpaidDays === "number" ? (employment as unknown as { unpaidDays: number }).unpaidDays : 0 })),
    housing: Array.isArray((value as unknown as Record<string, unknown>).housing)
      ? (value as unknown as { housing: PopulationState["housing"] }).housing
      : fresh.housing,
    laborMarket: normalizeLaborMarketState(
      isObject((value as unknown as Record<string, unknown>).laborMarket)
        ? (value as unknown as { laborMarket: PopulationState["laborMarket"] }).laborMarket
        : undefined,
      Math.floor(timestamp / (24 * 60 * 60_000))
    ),
    totals: isObject((value as unknown as Record<string, unknown>).totals)
      ? { ...fresh.totals, ...(value as unknown as { totals: Partial<PopulationState["totals"]> }).totals }
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
  const districts = (Array.isArray(world.districts) ? world.districts : []) as GameSession["world"]["districts"];
  const organizations = (Array.isArray(world.organizations) ? world.organizations : []) as GameSession["world"]["organizations"];
  const locations = ensureDistrictHousing(String((world.meta as Record<string, unknown> | undefined)?.seed ?? "NEON-LIFE-MIGRATED"), districts, rawLocations);
  const housingLocation = locations.find((location) => location.type === "housing") ?? locations[0];
  const marketLocation = locations.find((location) => location.type === "market") ?? locations[0];
  const kitchenLocation = locations.find((location) => location.type === "food") ?? marketLocation;
  const clinicLocation = locations.find((location) => location.type === "clinic") ?? marketLocation;
  const seed = String(meta?.seed ?? "NEON-LIFE-MIGRATED");
  const existingLife = isObject(payload.life) ? payload.life : null;
  const migratedEvents = (Array.isArray(payload.events) ? payload.events : []).filter((event) => !isLegacyStoryEvent(event));
  const migratedQueue = (Array.isArray(payload.eventQueue) ? payload.eventQueue : []).filter((event) => !isObject(event) || (event.type !== "vacancy-expiry" && event.type !== "grid-restoration"));
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
  const population = normalizePopulationState(payload.population, seed, timestamp, districts, locations, organizations, people.people);
  const economy = normalizeEconomyState(payload.economy, seed, timestamp, locations, people.people, population, foodState, pulseState);
  const courier = migrateCourierState(existingJobs.courier, seed, timestamp, locations, people.people, economy.businesses);
  const pressure = hasPressureState(payload.pressure)
    ? payload.pressure
    : createPressureState(seed, timestamp, housingState, people.people, locations);
  const playerState = payload.player as unknown as GameSession["player"];
  const cityState = world.city as unknown as GameSession["world"]["city"];
  const infrastructure = normalizeInfrastructureState(payload.infrastructure, seed, timestamp, cityState, districts, locations, organizations, population, economy);
  const kernel = normalizeSimulationKernel(payload.kernel, {
    timestamp,
    seed,
    city: cityState,
    districts,
    locations,
    organizations,
    player: playerState,
    population,
    economy,
    infrastructure
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
    currentActivity: `На месте: ${existingLocationName}`,
    world: {
      ...world,
      primaryContactId: selectedPerson?.id ?? String(world.primaryContactId ?? "person-missing"),
      locations
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
