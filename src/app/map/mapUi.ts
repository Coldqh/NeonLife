import type { GameSession, LocationState } from "../../world/state/types";
import type { MapDistrictState, MetropolitanSectorState } from "../../simulation/spatial/types";
import type { BuildingState } from "../../simulation/urban/types";
import type { LocalActorState } from "../../simulation/localScene/types";
import type { PhysicalVehicleEntityState } from "../../simulation/vehicles/types";
import type { TransitStopState } from "../../simulation/transit/types";

export type MapMode = "global" | "local" | "interior";
export type GlobalLayerId = "districts" | "transport" | "work" | "risk" | "services";
export type LocalLayerId = "all" | "markets" | "food" | "clinic" | "transport" | "work" | "people" | "cars";

export type CityMapSelection =
  | { kind: "district"; district: MapDistrictState }
  | { kind: "sector"; sector: MetropolitanSectorState }
  | { kind: "location"; location: LocationState }
  | { kind: "building"; building: BuildingState }
  | { kind: "actor"; actor: LocalActorState }
  | { kind: "vehicle"; vehicle: PhysicalVehicleEntityState }
  | { kind: "stop"; stop: TransitStopState }
  | { kind: "point"; sector: MetropolitanSectorState; xM: number; yM: number };

export const GLOBAL_LAYERS: Array<{ id: GlobalLayerId; label: string; icon: string }> = [
  { id: "districts", label: "Районы", icon: "▦" },
  { id: "transport", label: "Транспорт", icon: "▰" },
  { id: "work", label: "Работа", icon: "▣" },
  { id: "risk", label: "Риск", icon: "◇" },
  { id: "services", label: "Сервисы", icon: "◉" }
];

export const LOCAL_LAYERS: Array<{ id: LocalLayerId; label: string; icon: string }> = [
  { id: "all", label: "Все", icon: "▦" },
  { id: "markets", label: "Магазины", icon: "▤" },
  { id: "food", label: "Еда", icon: "♨" },
  { id: "clinic", label: "Клиники", icon: "+" },
  { id: "transport", label: "Транспорт", icon: "▰" },
  { id: "work", label: "Работа", icon: "▣" },
  { id: "people", label: "Люди рядом", icon: "♙" },
  { id: "cars", label: "Машины рядом", icon: "◆" }
];

export function landUseLabel(value: MetropolitanSectorState["landUse"]): string {
  const labels: Record<MetropolitanSectorState["landUse"], string> = {
    residential: "Жилая зона",
    mixed: "Смешанная застройка",
    commercial: "Коммерческий сектор",
    industrial: "Промышленный сектор",
    corporate: "Корпоративный сектор",
    civic: "Городские службы",
    transport: "Транспортный узел",
    utility: "Инфраструктура",
    vacant: "Пустующая территория"
  };
  return labels[value];
}

export function locationTypeLabel(value: LocationState["type"]): string {
  const labels: Record<LocationState["type"], string> = {
    housing: "Жилой объект",
    food: "Кафе и еда",
    workshop: "Техносервис",
    transport: "Транспорт",
    clinic: "Клиника",
    office: "Работа",
    market: "Магазин",
    government: "Городской сервис",
    education: "Образование"
  };
  return labels[value];
}

export function buildingUseLabel(value: BuildingState["use"]): string {
  const labels: Record<BuildingState["use"], string> = {
    residential: "Жилой дом",
    mixed: "Многофункциональное здание",
    retail: "Торговое здание",
    office: "Офисный комплекс",
    industrial: "Промышленный объект",
    warehouse: "Склад",
    medical: "Медицинский объект",
    education: "Учебный корпус",
    civic: "Городской объект",
    transport: "Транспортный объект",
    utility: "Инфраструктурный объект",
    hotel: "Отель",
    entertainment: "Развлекательное заведение",
    vacant: "Пустующее здание"
  };
  return labels[value];
}

export function riskLabel(value: number): string {
  if (value >= 78) return "Очень высокий";
  if (value >= 60) return "Высокий";
  if (value >= 40) return "Средний";
  return "Низкий";
}

export function activityLabel(value: number): string {
  if (value >= 82) return "Очень высокая";
  if (value >= 62) return "Высокая";
  if (value >= 38) return "Средняя";
  return "Низкая";
}

export function formatHours(location: LocationState): string {
  if (location.openHour == null || location.closeHour == null) return "24/7";
  return `${String(location.openHour).padStart(2, "0")}:00 — ${String(location.closeHour).padStart(2, "0")}:00`;
}

export function locationMatchesLayer(location: LocationState, layer: LocalLayerId): boolean {
  if (layer === "all") return true;
  if (layer === "markets") return location.type === "market";
  if (layer === "food") return location.type === "food";
  if (layer === "clinic") return location.type === "clinic";
  if (layer === "transport") return location.type === "transport";
  if (layer === "work") return ["office", "workshop", "government", "education"].includes(location.type);
  return false;
}

export function selectionKey(selection: CityMapSelection | null): string | null {
  if (!selection) return null;
  if (selection.kind === "district") return `district:${selection.district.id}`;
  if (selection.kind === "sector") return `sector:${selection.sector.id}`;
  if (selection.kind === "location") return `location:${selection.location.id}`;
  if (selection.kind === "building") return `building:${selection.building.id}`;
  if (selection.kind === "actor") return `actor:${selection.actor.id}`;
  if (selection.kind === "vehicle") return `vehicle:${selection.vehicle.id}`;
  if (selection.kind === "stop") return `stop:${selection.stop.id}`;
  return `point:${selection.sector.id}:${Math.round(selection.xM)}:${Math.round(selection.yM)}`;
}

export function selectedBuildingForLocation(session: GameSession, locationId: string): BuildingState | undefined {
  return session.urban.buildings.find((building) => building.anchorLocationId === locationId);
}

export function locationForBuilding(session: GameSession, building: BuildingState): LocationState | undefined {
  return building.anchorLocationId ? session.world.locations.find((location) => location.id === building.anchorLocationId) : undefined;
}

export function mapDistrictForSector(session: GameSession, sector: MetropolitanSectorState): MapDistrictState | undefined {
  return session.metropolitan.mapDistricts.find((district) => district.id === sector.mapDistrictId);
}

export function sectorForLocation(session: GameSession, locationId: string): MetropolitanSectorState | undefined {
  const placement = session.metropolitan.locations.find((item) => item.locationId === locationId);
  return placement ? session.metropolitan.sectors.find((sector) => sector.id === placement.sectorId) : undefined;
}

export function selectionTitle(selection: CityMapSelection): string {
  if (selection.kind === "district") return selection.district.name;
  if (selection.kind === "sector") return selection.sector.code;
  if (selection.kind === "location") return selection.location.name;
  if (selection.kind === "building") return selection.building.addressCode;
  if (selection.kind === "actor") return selection.actor.name;
  if (selection.kind === "vehicle") return selection.vehicle.modelName;
  if (selection.kind === "stop") return selection.stop.name;
  return "Точка на карте";
}
