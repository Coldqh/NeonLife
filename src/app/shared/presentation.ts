import type { GameSession, LocationState } from "../../world/state/types";
import type { LocalActorState, LocalBuildingPresenceState } from "../../simulation/localScene/types";
import type { PhysicalVehicleEntityState } from "../../simulation/vehicles/types";

export const ASSET_BASE = `${import.meta.env.BASE_URL}ui/`;
const PERSON_ASSETS = ["npc-01.webp", "npc-02.webp", "npc-03.webp", "npc-04.webp"] as const;

export function asset(name: string): string {
  return `${ASSET_BASE}${name}`;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function personPortrait(personId: string): string {
  return asset(PERSON_ASSETS[hashText(personId) % PERSON_ASSETS.length]);
}

export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString("ru-RU");
}

export function districtName(session: GameSession, districtId = session.world.activeDistrictId): string {
  return session.world.districts.find((district) => district.id === districtId)?.name ?? session.player.district;
}

export function currentLocation(session: GameSession): LocationState | undefined {
  return session.world.locations.find((location) => location.id === session.life.currentLocationId);
}

export function playerOccupation(session: GameSession): string {
  const value = session.player.occupation.trim();
  return !value || value.toUpperCase() === "UNEMPLOYED" ? "Без постоянной работы" : value;
}

export function currentActivity(session: GameSession): string {
  const position = session.localScene.playerPosition;
  if (session.transit.player.journey) return session.transit.player.journey.phase === "waiting" ? "Ожидает транспорт" : "В общественном транспорте";
  if (position.state === "vehicle") return "В машине";
  if (position.state === "inside") return "Внутри здания";
  return session.currentActivity || "На улице";
}

export function actorActivityIcon(actor: LocalActorState): string {
  if (actor.activity === "commute") return "🚌";
  if (actor.activity === "work") return "🛠";
  if (actor.activity === "medical") return "✚";
  if (actor.activity === "school") return "▣";
  if (actor.activity === "home") return "⌂";
  return "◉";
}

export function buildingUseLabel(building: LocalBuildingPresenceState): string {
  const labels: Record<string, string> = {
    residential: "Жилой дом",
    retail: "Магазин",
    office: "Офисы",
    industrial: "Промышленный объект",
    warehouse: "Склад",
    medical: "Медицина",
    education: "Учебное здание",
    transport: "Транспортный объект",
    hotel: "Гостиница",
    entertainment: "Заведение",
    civic: "Государственный объект",
    mixed: "Смешанное здание",
    utility: "Инфраструктура",
    vacant: "Пустующее здание"
  };
  return labels[building.use] ?? building.use;
}

export function vehicleStateLabel(vehicle: PhysicalVehicleEntityState): string {
  if (vehicle.state === "parked") return "Припаркована";
  if (vehicle.state === "moving") return "В движении";
  if (vehicle.state === "occupied") return "Занята";
  if (vehicle.state === "service") return "На обслуживании";
  return "Неисправна";
}

export const PLACE_ICONS: Record<LocationState["type"], string> = {
  housing: "⌂",
  food: "☕",
  workshop: "⌁",
  transport: "▣",
  clinic: "✚",
  office: "◫",
  market: "◇",
  government: "◆",
  education: "◉"
};
