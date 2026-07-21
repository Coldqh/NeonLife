import { SAVE_SCHEMA_VERSION, type SaveEnvelope, type SaveSlotId } from "./types";
import type { GameSession, LocationState } from "../../world/state/types";
import { createInitialFoodState } from "../../gameplay/food/foodSystem";
import { createInitialHousing } from "../../gameplay/housing/housingSystem";
import { createInitialCourierState, type CourierOrder, type CourierState } from "../../gameplay/jobs/courier/courierSystem";
import { createHumanNetwork, getPerson, toKnownNpc } from "../../people/network/humanNetwork";
import type { HumanNetworkState, PersonState } from "../../people/network/types";

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
  people: PersonState[]
): CourierState {
  if (!isObject(value) || !Array.isArray(value.orders)) {
    return createInitialCourierState(seed, timestamp, locations, people);
  }
  const orders = value.orders
    .map((order, index) => migrateCourierOrder(order, people, index))
    .filter((order): order is CourierOrder => Boolean(order));
  if (!orders.length) return createInitialCourierState(seed, timestamp, locations, people);
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
  const locations = migrateLocationSchedules((Array.isArray(world.locations) ? world.locations : []) as LocationState[]);
  const housingLocation = locations.find((location) => location.type === "housing") ?? locations[0];
  const marketLocation = locations.find((location) => location.type === "market") ?? locations[0];
  const kitchenLocation = locations.find((location) => location.type === "food") ?? marketLocation;
  const clinicLocation = locations.find((location) => location.type === "clinic") ?? marketLocation;
  const seed = String(meta?.seed ?? "NEON-LIFE-MIGRATED");
  const existingLife = isObject(payload.life) ? payload.life : null;
  const migratedEvents = (Array.isArray(payload.events) ? payload.events : []).filter((event) => !isLegacyStoryEvent(event));
  const migratedQueue = (Array.isArray(payload.eventQueue) ? payload.eventQueue : []).filter((event) => !isObject(event) || event.type !== "vacancy-expiry");
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
  const courier = migrateCourierState(existingJobs.courier, seed, timestamp, locations, people.people);

  const migratedPayload = {
    ...payload,
    schemaVersion: SAVE_SCHEMA_VERSION,
    events: migratedEvents,
    eventQueue: migratedQueue,
    primaryContact,
    people,
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
    life: existingLife ?? {
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
