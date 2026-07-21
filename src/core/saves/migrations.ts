import { SAVE_SCHEMA_VERSION, type SaveEnvelope, type SaveSlotId } from "./types";
import type { GameSession, LocationState } from "../../world/state/types";
import { createInitialFoodState } from "../../gameplay/food/foodSystem";
import { createInitialHousing } from "../../gameplay/housing/housingSystem";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

  const migratedPayload = {
    ...payload,
    schemaVersion: SAVE_SCHEMA_VERSION,
    eventQueue: Array.isArray(payload.eventQueue) ? payload.eventQueue : [],
    world: {
      ...world,
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
    }
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
