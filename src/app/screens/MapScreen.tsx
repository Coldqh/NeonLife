import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { LocalActorState } from "../../simulation/localScene/types";
import type { MapDistrictState, MetropolitanSectorState } from "../../simulation/spatial/types";
import type { StreetIntersectionState, StreetSegmentState } from "../../simulation/streets/types";
import { getSectorStreetTopology } from "../../simulation/streets/streetTopologySystem";
import type { BuildingState, BuildingUnitState } from "../../simulation/urban/types";
import type { TransitStopState } from "../../simulation/transit/types";
import type { PhysicalVehicleEntityState } from "../../simulation/vehicles/types";
import { getTravelOptions, isLocationOpen } from "../../gameplay/travel/travelSystem";
import { compactNumber, currentLocation, personPortrait, vehicleStateLabel, PLACE_ICONS } from "../shared/presentation";
import type { LocalMovementTargetState } from "../../simulation/localMovement/types";
import {
  localMovementTargetForActor,
  localMovementTargetForBuilding,
  localMovementTargetForLocation,
  localMovementTargetForPoint,
  localMovementTargetForStop,
  localMovementTargetForVehicle,
  planLocalMovement
} from "../../simulation/localMovement/localMovementSystem";

const GLOBAL_FILTERS = [
  { id: "districts", label: "Районы" },
  { id: "transport", label: "Транспорт" },
  { id: "work", label: "Работа" },
  { id: "risk", label: "Риск" },
  { id: "services", label: "Сервисы" }
] as const;

const DISTRICT_CLIPS = [
  "polygon(7% 13%, 88% 4%, 98% 72%, 78% 96%, 10% 88%, 1% 38%)",
  "polygon(14% 3%, 92% 11%, 99% 76%, 69% 99%, 4% 84%, 0 23%)",
  "polygon(3% 15%, 76% 0, 100% 28%, 91% 91%, 25% 100%, 0 72%)",
  "polygon(11% 0, 95% 8%, 100% 64%, 82% 100%, 8% 91%, 0 34%)"
] as const;

const LOCAL_FILTERS = [
  { id: "all", label: "Все" },
  { id: "markets", label: "Магазины" },
  { id: "food", label: "Еда" },
  { id: "clinic", label: "Клиники" },
  { id: "transport", label: "Транспорт" },
  { id: "work", label: "Работа" },
  { id: "people", label: "Люди рядом" },
  { id: "cars", label: "Машины рядом" }
] as const;

type GlobalFilterId = typeof GLOBAL_FILTERS[number]["id"];
type LocalFilterId = typeof LOCAL_FILTERS[number]["id"];

type MapSelection =
  | { kind: "district"; district: MapDistrictState }
  | { kind: "sector"; sector: MetropolitanSectorState }
  | { kind: "location"; location: LocationState }
  | { kind: "building"; building: BuildingState }
  | { kind: "actor"; actor: LocalActorState }
  | { kind: "vehicle"; vehicle: PhysicalVehicleEntityState }
  | { kind: "stop"; stop: TransitStopState }
  | { kind: "point"; xM: number; yM: number };

function landUseLabel(value: MetropolitanSectorState["landUse"]): string {
  const labels: Record<MetropolitanSectorState["landUse"], string> = {
    residential: "Жилая зона",
    mixed: "Смешанная застройка",
    commercial: "Коммерция",
    industrial: "Промышленность",
    corporate: "Корпоративный сектор",
    civic: "Городские службы",
    transport: "Транспортный узел",
    utility: "Инфраструктура",
    vacant: "Незастроенная зона"
  };
  return labels[value];
}

function locationTypeLabel(value: LocationState["type"]): string {
  const labels: Record<LocationState["type"], string> = {
    housing: "Жильё",
    food: "Еда",
    workshop: "Мастерская",
    transport: "Транспорт",
    clinic: "Клиника",
    office: "Работа",
    market: "Магазин",
    government: "Сервис",
    education: "Образование"
  };
  return labels[value];
}

function buildingUseLabel(value: BuildingState["use"]): string {
  const labels: Record<BuildingState["use"], string> = {
    residential: "Жилой дом",
    mixed: "Смешанное здание",
    retail: "Торговое здание",
    office: "Офисное здание",
    industrial: "Промышленный объект",
    warehouse: "Склад",
    medical: "Медицинский объект",
    education: "Учебное здание",
    civic: "Городской объект",
    transport: "Транспортный объект",
    utility: "Инфраструктура",
    hotel: "Отель",
    entertainment: "Заведение",
    vacant: "Пустующее здание"
  };
  return labels[value];
}

function districtTone(district: MapDistrictState): string {
  if (district.riskScore >= 70) return "danger";
  if (district.activityScore >= 72) return "accent";
  if (district.transitScore >= 68) return "blue";
  return "violet";
}

function locationOpenText(location: LocationState, session: GameSession): string {
  return isLocationOpen(location, session.timestamp) ? "Открыто" : "Закрыто";
}

function locationTags(location: LocationState): string[] {
  const base = [locationTypeLabel(location.type)];
  if (location.type === "food") base.push("Быстрая еда");
  if (location.type === "clinic") base.push("Медицина");
  if (location.type === "transport") base.push("Транспорт");
  if (location.type === "market") base.push("Покупки");
  if (location.type === "office") base.push("Работа");
  if (location.type === "housing") base.push("Жильцы");
  return base;
}

function filterLocation(location: LocationState, filter: LocalFilterId): boolean {
  if (filter === "all") return true;
  if (filter === "food") return location.type === "food";
  if (filter === "clinic") return location.type === "clinic";
  if (filter === "transport") return location.type === "transport";
  if (filter === "markets") return location.type === "market";
  if (filter === "work") return ["office", "workshop", "government", "education"].includes(location.type);
  return false;
}

function metricStyle(xPercent: number, yPercent: number, widthPercent = 0, heightPercent = 0): CSSProperties {
  return {
    left: `${xPercent}%`,
    top: `${yPercent}%`,
    width: widthPercent ? `${widthPercent}%` : undefined,
    height: heightPercent ? `${heightPercent}%` : undefined
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildingStatColor(value: number): string {
  if (value >= 75) return "good";
  if (value >= 45) return "warn";
  return "danger";
}

function riskLabel(score: number): string {
  if (score >= 78) return "Очень высокий";
  if (score >= 60) return "Высокий";
  if (score >= 40) return "Средний";
  return "Низкий";
}

function formatTimeRange(location: LocationState): string {
  if (location.openHour == null || location.closeHour == null) return "24/7";
  return `${String(location.openHour).padStart(2, "0")}:00 – ${String(location.closeHour).padStart(2, "0")}:00`;
}

function renderBars(value: number, segments = 5): string[] {
  const fill = Math.round(clamp(value, 0, 100) / 100 * segments);
  return Array.from({ length: segments }, (_, index) => index < fill ? "filled" : "empty");
}

function pointSegmentDistance(
  x: number,
  y: number,
  from: StreetIntersectionState,
  to: StreetIntersectionState
): number {
  const dx = to.xM - from.xM;
  const dy = to.yM - from.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.0001) return Math.hypot(x - from.xM, y - from.yM);
  const ratio = clamp(((x - from.xM) * dx + (y - from.yM) * dy) / lengthSquared, 0, 1);
  return Math.hypot(x - (from.xM + dx * ratio), y - (from.yM + dy * ratio));
}

function nearestStreetId(
  x: number,
  y: number,
  segments: StreetSegmentState[],
  nodes: Map<string, StreetIntersectionState>
): string | null {
  let nearest: { id: string; distance: number } | null = null;
  for (const segment of segments) {
    const from = nodes.get(segment.fromIntersectionId);
    const to = nodes.get(segment.toIntersectionId);
    if (!from || !to) continue;
    const distance = pointSegmentDistance(x, y, from, to);
    if (!nearest || distance < nearest.distance) nearest = { id: segment.id, distance };
  }
  return nearest && nearest.distance <= 32 ? nearest.id : null;
}

function globalMarkerType(filter: GlobalFilterId, location: LocationState): boolean {
  if (filter === "transport") return location.type === "transport";
  if (filter === "work") return ["office", "workshop", "education"].includes(location.type);
  if (filter === "services") return ["clinic", "market", "government", "food"].includes(location.type);
  return false;
}

export function MapScreen({
  session,
  requestedLocationId,
  onRequestedLocationHandled,
  onTravel,
  onWalk,
  onEnterBuilding,
  onLeaveBuilding,
  onMoveBuildingFloor,
  onEnterVehicle,
  onLeaveVehicle
}: {
  session: GameSession;
  requestedLocationId?: string;
  onRequestedLocationHandled: () => void;
  onTravel: (locationId: string) => void;
  onWalk: (target: LocalMovementTargetState) => void;
  onEnterBuilding: (buildingId: string) => void;
  onLeaveBuilding: () => void;
  onMoveBuildingFloor: (floor: number, method: "stairs" | "elevator") => void;
  onEnterVehicle: (vehicleId: string) => void;
  onLeaveVehicle: () => void;
}) {
  const currentPlace = currentLocation(session);
  const focusSector = session.metropolitan.sectors.find((sector) => sector.id === session.metropolitan.streaming.focusSectorId)
    ?? session.metropolitan.sectors[0];
  const [mode, setMode] = useState<"global" | "local">("local");
  const [globalFilter, setGlobalFilter] = useState<GlobalFilterId>("districts");
  const [localFilter, setLocalFilter] = useState<LocalFilterId>("all");
  const [selectedDistrictId, setSelectedDistrictId] = useState(focusSector.mapDistrictId);
  const [selectedSectorId, setSelectedSectorId] = useState(focusSector.id);
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [globalZoom, setGlobalZoom] = useState(1);
  const [localZoom, setLocalZoom] = useState(1);
  const [activeFloor, setActiveFloor] = useState<number | null>(null);
  const [routePinned, setRoutePinned] = useState(false);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("neon-life/map-favorites/v1") ?? "[]") as unknown;
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  });

  const selectedSector = session.metropolitan.sectors.find((sector) => sector.id === selectedSectorId) ?? focusSector;
  const selectedDistrict = session.metropolitan.mapDistricts.find((district) => district.id === selectedDistrictId)
    ?? session.metropolitan.mapDistricts.find((district) => district.id === selectedSector.mapDistrictId)
    ?? session.metropolitan.mapDistricts[0];

  const sectorPlacements = useMemo(() => session.metropolitan.locations.filter((placement) => placement.sectorId === selectedSector.id), [session.metropolitan.locations, selectedSector.id]);
  const sectorLocations = useMemo(() => sectorPlacements.flatMap((placement) => {
    const location = session.world.locations.find((item) => item.id === placement.locationId);
    return location ? [location] : [];
  }), [sectorPlacements, session.world.locations]);
  const localBuildings = useMemo(() => session.urban.buildings
    .filter((building) => building.sectorId === selectedSector.id)
    .sort((left, right) => (right.floorAreaM2 - left.floorAreaM2) || left.addressCode.localeCompare(right.addressCode)), [selectedSector.id, session.urban.buildings]);
  const localStops = useMemo(() => session.transit.stops.filter((stop) => stop.sectorId === selectedSector.id), [selectedSector.id, session.transit.stops]);
  const localTopology = useMemo(() => getSectorStreetTopology(session.streets, {
    timestamp: session.timestamp,
    seed: session.world.meta.seed,
    metropolitan: session.metropolitan,
    urban: session.urban,
    preferredSectorId: selectedSector.id
  }, selectedSector.id), [selectedSector.id, session.metropolitan, session.streets, session.timestamp, session.urban, session.world.meta.seed]);
  const localStreetNodes = useMemo(() => new Map(localTopology.intersections.map((node) => [node.id, node])), [localTopology.intersections]);
  const playerStreetId = useMemo(() => nearestStreetId(
    session.localScene.playerPosition.xM,
    session.localScene.playerPosition.yM,
    localTopology.segments,
    localStreetNodes
  ), [localStreetNodes, localTopology.segments, session.localScene.playerPosition.xM, session.localScene.playerPosition.yM]);
  const nearbyActors = useMemo(() => {
    const player = session.localScene.playerPosition;
    return session.localScene.actors
      .filter((actor) => actor.visible && actor.position.sectorId === selectedSector.id)
      .filter((actor) => {
        if (player.state === "inside") {
          return Boolean(player.buildingId && actor.position.buildingId === player.buildingId && (!player.unitId || actor.position.unitId === player.unitId || actor.distanceToPlayerM <= 28));
        }
        if (actor.position.state !== "outside") return false;
        if (actor.distanceToPlayerM <= 36) return true;
        const actorStreetId = nearestStreetId(actor.position.xM, actor.position.yM, localTopology.segments, localStreetNodes);
        return Boolean(playerStreetId && actorStreetId === playerStreetId && actor.distanceToPlayerM <= 135);
      })
      .sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM);
  }, [localStreetNodes, localTopology.segments, playerStreetId, selectedSector.id, session.localScene.actors, session.localScene.playerPosition]);
  const nearbyVehicles = useMemo(() => {
    const player = session.localScene.playerPosition;
    return session.vehicles.vehicles
      .filter((vehicle) => vehicle.visible && vehicle.position.sectorId === selectedSector.id)
      .filter((vehicle) => {
        if (player.state === "inside") return Boolean(player.buildingId && vehicle.position.buildingId === player.buildingId);
        if (vehicle.distanceToPlayerM <= 42) return true;
        const vehicleStreetId = nearestStreetId(vehicle.position.xM, vehicle.position.yM, localTopology.segments, localStreetNodes);
        return Boolean(playerStreetId && vehicleStreetId === playerStreetId && vehicle.distanceToPlayerM <= 150);
      })
      .sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM);
  }, [localStreetNodes, localTopology.segments, playerStreetId, selectedSector.id, session.localScene.playerPosition, session.vehicles.vehicles]);
  const districtPlacements = useMemo(() => session.metropolitan.locations.filter((placement) => {
    const sector = session.metropolitan.sectors.find((item) => item.id === placement.sectorId);
    return sector?.mapDistrictId === selectedDistrict.id;
  }), [selectedDistrict.id, session.metropolitan.locations, session.metropolitan.sectors]);
  const districtLocations = useMemo(() => districtPlacements.flatMap((placement) => {
    const location = session.world.locations.find((item) => item.id === placement.locationId);
    return location ? [location] : [];
  }), [districtPlacements, session.world.locations]);

  useEffect(() => {
    if (!requestedLocationId) return;
    const placement = session.metropolitan.locations.find((item) => item.locationId === requestedLocationId);
    const location = session.world.locations.find((item) => item.id === requestedLocationId);
    if (placement && location) {
      const sector = session.metropolitan.sectors.find((item) => item.id === placement.sectorId);
      setSelectedSectorId(placement.sectorId);
      if (sector) setSelectedDistrictId(sector.mapDistrictId);
      setMode("local");
      setSelection({ kind: "location", location });
    }
    onRequestedLocationHandled();
  }, [onRequestedLocationHandled, requestedLocationId, session.metropolitan.locations, session.metropolitan.sectors, session.world.locations]);

  useEffect(() => {
    try { localStorage.setItem("neon-life/map-favorites/v1", JSON.stringify(favorites)); } catch { /* optional UI state */ }
  }, [favorites]);

  useEffect(() => {
    setRoutePinned(false);
    setFlashMessage(null);
  }, [selection]);

  useEffect(() => {
    if (!flashMessage) return;
    const timer = window.setTimeout(() => setFlashMessage(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flashMessage]);

  useEffect(() => {
    if (selection?.kind === "building") {
      const availableFloors = session.urban.units
        .filter((unit) => unit.buildingId === selection.building.id)
        .map((unit) => unit.floor);
      if (availableFloors.length && (activeFloor == null || !availableFloors.includes(activeFloor))) {
        setActiveFloor(Math.max(...availableFloors));
      }
      if (!availableFloors.length && activeFloor == null) {
        setActiveFloor(selection.building.floors);
      }
      return;
    }
    setActiveFloor(null);
  }, [activeFloor, selection, session.urban.units]);

  const playerBuilding = session.localScene.playerPosition.buildingId
    ? session.urban.buildings.find((item) => item.id === session.localScene.playerPosition.buildingId)
    : undefined;

  const movementTarget = useMemo<LocalMovementTargetState | null>(() => {
    if (!selection) return null;
    if (selection.kind === "location") return localMovementTargetForLocation(session, selection.location.id);
    if (selection.kind === "building") return localMovementTargetForBuilding(session, selection.building.id);
    if (selection.kind === "actor") return localMovementTargetForActor(session, selection.actor.id);
    if (selection.kind === "vehicle") return localMovementTargetForVehicle(session, selection.vehicle.id);
    if (selection.kind === "stop") return localMovementTargetForStop(session, selection.stop.id);
    if (selection.kind === "sector") return localMovementTargetForPoint(
      session,
      selection.sector.id,
      selection.sector.bounds.xM + selection.sector.bounds.widthM / 2,
      selection.sector.bounds.yM + selection.sector.bounds.heightM / 2,
      selection.sector.code
    );
    if (selection.kind === "point") return localMovementTargetForPoint(session, selectedSector.id, selection.xM, selection.yM);
    return null;
  }, [selectedSector.id, selection, session]);

  const movementPreview = useMemo(() => {
    if (!movementTarget || session.localMovement) return null;
    return planLocalMovement(session, movementTarget);
  }, [movementTarget, session]);

  const selectedLocation = selection?.kind === "location"
    ? selection.location
    : selection?.kind === "building" && selection.building.anchorLocationId
      ? session.world.locations.find((item) => item.id === selection.building.anchorLocationId) ?? null
      : null;

  const selectedBuilding = selection?.kind === "building"
    ? selection.building
    : selection?.kind === "location"
      ? localBuildings.find((item) => item.anchorLocationId === selection.location.id) ?? null
      : null;

  const selectedBuildingUnits = useMemo(() => selectedBuilding
    ? session.urban.units.filter((unit) => unit.buildingId === selectedBuilding.id).sort((left, right) => right.floor - left.floor || left.unitNumber.localeCompare(right.unitNumber))
    : [], [selectedBuilding, session.urban.units]);

  const floorSummaries = useMemo(() => {
    if (!selectedBuilding) return [] as Array<{ floor: number; total: number; occupied: number; apartments: BuildingUnitState[] }>;
    const floorMap = new Map<number, BuildingUnitState[]>();
    selectedBuildingUnits.forEach((unit) => {
      const list = floorMap.get(unit.floor) ?? [];
      list.push(unit);
      floorMap.set(unit.floor, list);
    });
    if (!floorMap.size) {
      return Array.from({ length: selectedBuilding.floors }, (_, index) => {
        const floor = selectedBuilding.floors - index;
        return { floor, total: 0, occupied: 0, apartments: [] };
      });
    }
    return [...floorMap.entries()]
      .map(([floor, apartments]) => ({ floor, total: apartments.length, occupied: apartments.filter((item) => item.occupied).length, apartments }))
      .sort((left, right) => right.floor - left.floor);
  }, [selectedBuilding, selectedBuildingUnits]);

  const featuredFloor = floorSummaries.find((item) => item.floor === activeFloor) ?? floorSummaries[0] ?? null;
  const residentsInSelectedBuilding = useMemo(() => selectedBuilding
    ? nearbyActors.filter((actor) => actor.position.buildingId === selectedBuilding.id).slice(0, 4)
    : [], [nearbyActors, selectedBuilding]);
  const actorsAtSelectedPlace = useMemo(() => selectedLocation
    ? session.localScene.actors.filter((actor) => actor.visible && (actor.position.locationId === selectedLocation.id || Boolean(selectedBuilding && actor.position.buildingId === selectedBuilding.id)))
    : [], [selectedBuilding, selectedLocation, session.localScene.actors]);
  const vehiclesAtSelectedPlace = useMemo(() => selectedLocation
    ? session.vehicles.vehicles.filter((vehicle) => vehicle.visible && (vehicle.position.locationId === selectedLocation.id || Boolean(selectedBuilding && vehicle.position.buildingId === selectedBuilding.id) || (movementTarget && Math.hypot(vehicle.position.xM - movementTarget.xM, vehicle.position.yM - movementTarget.yM) <= 55)))
    : [], [movementTarget, selectedBuilding, selectedLocation, session.vehicles.vehicles]);

  const filteredLocations = useMemo(() => sectorPlacements.flatMap((placement) => {
    const location = session.world.locations.find((item) => item.id === placement.locationId);
    return location && filterLocation(location, localFilter) ? [{ placement, location }] : [];
  }), [localFilter, sectorPlacements, session.world.locations]);

  const districtBounds = session.metropolitan.mapDistricts.reduce((accumulator, district) => ({
    minX: Math.min(accumulator.minX, district.bounds.xM),
    minY: Math.min(accumulator.minY, district.bounds.yM),
    maxX: Math.max(accumulator.maxX, district.bounds.xM + district.bounds.widthM),
    maxY: Math.max(accumulator.maxY, district.bounds.yM + district.bounds.heightM)
  }), { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });

  const globalRoadNodes = useMemo(() => new Map(session.metropolitan.roadNodes.map((node) => [node.id, node])), [session.metropolitan.roadNodes]);
  const globalRoads = useMemo(() => session.metropolitan.roadLinks.flatMap((link) => {
    if (link.class !== "expressway" && link.class !== "arterial") return [];
    const from = globalRoadNodes.get(link.fromNodeId);
    const to = globalRoadNodes.get(link.toNodeId);
    return from && to ? [{ link, from, to }] : [];
  }), [globalRoadNodes, session.metropolitan.roadLinks]);
  const globalStations = useMemo(() => new Map(session.metropolitan.transitStations.map((station) => [station.id, station])), [session.metropolitan.transitStations]);
  const globalTransitLines = useMemo(() => session.metropolitan.transitLines.flatMap((line) => {
    const points = line.stationIds.map((id) => globalStations.get(id)).filter((station): station is NonNullable<typeof station> => Boolean(station));
    return points.length >= 2 ? [{ line, points }] : [];
  }), [globalStations, session.metropolitan.transitLines]);
  const globalMarkers = useMemo(() => globalFilter === "districts" || globalFilter === "risk" ? [] : session.metropolitan.locations.flatMap((placement) => {
    const location = session.world.locations.find((item) => item.id === placement.locationId);
    if (!location || !globalMarkerType(globalFilter, location)) return [];
    return [{ location, placement }];
  }).slice(0, 40), [globalFilter, session.metropolitan.locations, session.world.locations]);
  const localRoads = useMemo(() => localTopology.segments.flatMap((segment) => {
    const from = localStreetNodes.get(segment.fromIntersectionId);
    const to = localStreetNodes.get(segment.toIntersectionId);
    return from && to ? [{ segment, from, to }] : [];
  }), [localStreetNodes, localTopology.segments]);
  const routePoints = routePinned && movementPreview ? movementPreview.points.filter((point) => point.sectorId === selectedSector.id) : [];

  function districtRect(district: MapDistrictState): CSSProperties {
    const totalWidth = Math.max(1, districtBounds.maxX - districtBounds.minX);
    const totalHeight = Math.max(1, districtBounds.maxY - districtBounds.minY);
    const left = (district.bounds.xM - districtBounds.minX) / totalWidth * 100;
    const top = (district.bounds.yM - districtBounds.minY) / totalHeight * 100;
    const width = district.bounds.widthM / totalWidth * 100;
    const height = district.bounds.heightM / totalHeight * 100;
    return {
      ...metricStyle(left, top, width, height)
    };
  }

  function globalPoint(xM: number, yM: number): { x: number; y: number } {
    const totalWidth = Math.max(1, districtBounds.maxX - districtBounds.minX);
    const totalHeight = Math.max(1, districtBounds.maxY - districtBounds.minY);
    return {
      x: (xM - districtBounds.minX) / totalWidth * 100,
      y: (yM - districtBounds.minY) / totalHeight * 100
    };
  }

  function localRect(bounds: { xM: number; yM: number; widthM: number; heightM: number }): CSSProperties {
    const width = Math.max(1, selectedSector.bounds.widthM);
    const height = Math.max(1, selectedSector.bounds.heightM);
    const left = (bounds.xM - selectedSector.bounds.xM) / width * 100;
    const top = (bounds.yM - selectedSector.bounds.yM) / height * 100;
    return {
      ...metricStyle(left, top, bounds.widthM / width * 100, bounds.heightM / height * 100)
    };
  }

  function localCoordinate(xM: number, yM: number): { x: number; y: number } {
    const width = Math.max(1, selectedSector.bounds.widthM);
    const height = Math.max(1, selectedSector.bounds.heightM);
    return {
      x: (xM - selectedSector.bounds.xM) / width * 100,
      y: (yM - selectedSector.bounds.yM) / height * 100
    };
  }

  function localPoint(xM: number, yM: number): CSSProperties {
    const point = localCoordinate(xM, yM);
    return {
      ...metricStyle(point.x, point.y),
      transform: "translate(-50%, -50%)"
    };
  }

  function toggleFavorite(entityId: string): void {
    setFavorites((value) => value.includes(entityId) ? value.filter((item) => item !== entityId) : [...value, entityId]);
  }

  function openDistrict(district: MapDistrictState): void {
    setSelectedDistrictId(district.id);
    const sector = session.metropolitan.sectors.find((item) => item.mapDistrictId === district.id) ?? focusSector;
    setSelectedSectorId(sector.id);
    setSelection({ kind: "district", district });
    setMode("global");
  }

  function openSector(sector: MetropolitanSectorState): void {
    setSelectedSectorId(sector.id);
    setSelectedDistrictId(sector.mapDistrictId);
    setMode("local");
    setSelection({ kind: "sector", sector });
  }

  function goToPlayer(): void {
    setSelectedSectorId(focusSector.id);
    setSelectedDistrictId(focusSector.mapDistrictId);
    setMode("local");
    if (currentPlace) {
      setSelection({ kind: "location", location: currentPlace });
      return;
    }
    if (playerBuilding) {
      setSelection({ kind: "building", building: playerBuilding });
      return;
    }
    setSelection({ kind: "point", xM: session.localScene.playerPosition.xM, yM: session.localScene.playerPosition.yM });
  }

  function beginWalk(): void {
    if (!movementTarget || !movementPreview) return;
    onWalk(movementTarget);
  }

  function beginTravel(): void {
    if (!selectedLocation || selectedLocation.id === session.life.currentLocationId) return;
    onTravel(selectedLocation.id);
  }

  function pinRoute(): void {
    if (!movementPreview && !travelOption) {
      setFlashMessage("Маршрут к этой точке сейчас недоступен");
      return;
    }
    setRoutePinned(true);
    setMode("local");
    setFlashMessage(movementPreview ? `Маршрут построен · ${movementPreview.estimatedMinutes} мин` : `Маршрут построен · ${travelOption?.durationMinutes ?? 0} мин`);
  }

  function goToSelection(): void {
    if (movementTarget && movementPreview) {
      beginWalk();
      return;
    }
    if (selectedLocation) beginTravel();
  }

  function shareSelection(): void {
    const title = selection?.kind === "location" ? selection.location.name
      : selection?.kind === "building" ? selection.building.addressCode
        : selection?.kind === "district" ? selection.district.name
          : selection?.kind === "actor" ? selection.actor.name
            : selection?.kind === "vehicle" ? `${selection.vehicle.modelName} ${selection.vehicle.plate}`
              : selection?.kind === "stop" ? selection.stop.name
                : selectedSector.code;
    const text = `${title} · ${selectedDistrict.name} · ${selectedSector.code}`;
    if (navigator.share) {
      void navigator.share({ title, text }).then(() => setFlashMessage("Карточка отправлена")).catch(() => undefined);
      return;
    }
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text).then(() => setFlashMessage("Данные скопированы")).catch(() => setFlashMessage("Не удалось скопировать"));
      return;
    }
    setFlashMessage(text);
  }

  const isFavorite = selection?.kind === "location"
    ? favorites.includes(selection.location.id)
    : selection?.kind === "building"
      ? favorites.includes(selection.building.id)
      : selection?.kind === "district"
        ? favorites.includes(selection.district.id)
        : selection?.kind === "vehicle"
          ? favorites.includes(selection.vehicle.id)
          : selection?.kind === "actor"
            ? favorites.includes(selection.actor.id)
            : false;

  const travelOption = selectedLocation ? getTravelOptions(session).find((option) => option.location.id === selectedLocation.id) : undefined;

  function renderLocalSelectionPanel(): JSX.Element {
    if (selection?.kind === "building" && selectedBuilding) {
      const featuredUnit = featuredFloor?.apartments[0];
      const securityBars = renderBars(selectedBuilding.security);
      const conditionBars = renderBars(selectedBuilding.condition);
      const occupiedPct = selectedBuilding.residentialUnits > 0 ? Math.round(selectedBuilding.representedResidents / Math.max(1, selectedBuilding.residentCapacity) * 100) : Math.round((selectedBuildingUnits.filter((unit) => unit.occupied).length / Math.max(1, selectedBuildingUnits.length)) * 100);
      const localPresence = session.localScene.buildings.find((item) => item.buildingId === selectedBuilding.id);
      const playerInside = session.localScene.playerPosition.state === "inside" && session.localScene.playerPosition.buildingId === selectedBuilding.id;
      const canEnter = session.localScene.playerPosition.state === "outside" && (localPresence?.distanceToPlayerM ?? Number.POSITIVE_INFINITY) <= 20;
      const verticalMethod = selectedBuilding.elevatorCount > 0 && selectedBuilding.utilityService >= 25 ? "elevator" as const : "stairs" as const;

      return (
        <section className="city-sheet city-sheet--building">
          <header className="city-sheet__hero city-sheet__hero--building">
            <div>
              <span className="city-sheet__eyebrow">{buildingUseLabel(selectedBuilding.use)}</span>
              <h2>{selectedBuilding.addressCode}</h2>
              <p>{selectedSector.code} · {landUseLabel(selectedSector.landUse)} · {selectedBuilding.floors} этажей</p>
            </div>
            <div className="city-sheet__icon-actions">
              <button type="button" className="city-sheet__icon-button" onClick={shareSelection} aria-label="Поделиться">↗</button>
              <button type="button" className={`city-sheet__icon-button ${isFavorite ? "is-active" : ""}`} onClick={() => toggleFavorite(selectedBuilding.id)} aria-label="Избранное">♥</button>
              <button type="button" className="city-sheet__icon-button" onClick={() => setSelection(null)} aria-label="Закрыть">×</button>
            </div>
          </header>

          <div className="city-sheet__metric-grid city-sheet__metric-grid--compact">
            <article><small>Безопасность</small><strong>{riskLabel(selectedBuilding.security)}</strong><div className="city-bars">{securityBars.map((bar, index) => <span key={index} className={bar} />)}</div></article>
            <article><small>Состояние</small><strong>{selectedBuilding.condition}%</strong><div className="city-bars">{conditionBars.map((bar, index) => <span key={index} className={bar} />)}</div></article>
            <article><small>Жильцов</small><strong>{compactNumber(selectedBuilding.representedResidents)}</strong><em>{selectedBuilding.residentialUnits || "—"} квартир</em></article>
            <article><small>Доступ</small><strong>{selectedBuilding.publicEntrances > 0 ? "Открыт" : "Ограничен"}</strong><em>{selectedBuilding.publicEntrances} входа</em></article>
          </div>

          <div className="building-profile__layout">
            <section className="building-profile__floors">
              <header><strong>Этажи</strong><span>{selectedBuilding.floors} этажей</span></header>
              <div className="building-profile__floor-list">
                {floorSummaries.slice(0, 8).map((floor) => (
                  <button
                    type="button"
                    key={floor.floor}
                    className={activeFloor === floor.floor ? "is-active" : ""}
                    onClick={() => {
                      setActiveFloor(floor.floor);
                      if (playerInside && floor.floor !== (session.localScene.playerPosition.floor ?? 1)) {
                        onMoveBuildingFloor(floor.floor, verticalMethod);
                      }
                    }}
                  >
                    <span>{floor.floor}F</span>
                    <strong>{floor.total ? `Занято ${floor.occupied}/${floor.total}` : "Нет данных"}</strong>
                  </button>
                ))}
              </div>
            </section>

            <section className="building-profile__details">
              <header>
                <strong>{featuredUnit ? `Квартира ${featuredUnit.unitNumber}` : "Обзор этажа"}</strong>
                <span>{featuredFloor ? `${featuredFloor.floor} этаж` : "Без распределения"}</span>
              </header>
              <div className="building-profile__cards">
                <article>
                  <small>Подъезды</small>
                  <strong>{selectedBuilding.publicEntrances}</strong>
                  <em>доступных входа</em>
                </article>
                <article>
                  <small>Лифты / лестницы</small>
                  <strong>{selectedBuilding.elevatorCount} / {selectedBuilding.stairwellCount}</strong>
                  <em>вертикальная навигация</em>
                </article>
                <article>
                  <small>Заполненность</small>
                  <strong>{occupiedPct}%</strong>
                  <em>{selectedBuilding.representedResidents} из {selectedBuilding.residentCapacity}</em>
                </article>
              </div>
              {residentsInSelectedBuilding.length ? (
                <div className="building-profile__neighbors">
                  <strong>Рядом сейчас</strong>
                  <div>
                    {residentsInSelectedBuilding.map((actor) => (
                      <button key={actor.id} type="button" onClick={() => setSelection({ kind: "actor", actor })}>
                        <img src={personPortrait(actor.id)} alt="" />
                        <span><b>{actor.name}</b><small>{actor.roleLabel}</small></span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <footer className="city-sheet__footer city-sheet__footer--dual">
            <button
              type="button"
              className="city-sheet__ghost-button"
              disabled={!playerInside && !canEnter && !movementPreview}
              onClick={() => {
                if (playerInside) onLeaveBuilding();
                else if (canEnter) onEnterBuilding(selectedBuilding.id);
                else beginWalk();
              }}
            >
              {playerInside ? "Выйти на улицу" : canEnter ? "Войти" : "Идти ко входу"}
            </button>
            <button type="button" className={`city-sheet__accent-button ${routePinned ? "is-active" : ""}`} disabled={!movementPreview && !travelOption} onClick={pinRoute}>
              {routePinned ? "Маршрут построен" : "Построить маршрут"}
            </button>
          </footer>
        </section>
      );
    }

    if (selection?.kind === "location" && selectedLocation) {
      const status = locationOpenText(selectedLocation, session);
      const security = selectedBuilding?.security ?? selectedLocation.security;
      const crowd = clamp(Math.round(selectedSector.crowdLoad), 0, 100);
      const tags = locationTags(selectedLocation);
      const routeMinutes = movementPreview?.estimatedMinutes ?? travelOption?.durationMinutes ?? 0;
      const routeDistance = movementPreview?.totalDistanceM ?? ((travelOption?.distanceKm ?? 0) * 1000);
      const venuePresence = selectedBuilding ? session.localScene.buildings.find((item) => item.buildingId === selectedBuilding.id) : undefined;
      const playerInsideVenue = Boolean(selectedBuilding && session.localScene.playerPosition.state === "inside" && session.localScene.playerPosition.buildingId === selectedBuilding.id);
      const canEnterVenue = Boolean(selectedBuilding && session.localScene.playerPosition.state === "outside" && (venuePresence?.distanceToPlayerM ?? Number.POSITIVE_INFINITY) <= 20);

      return (
        <section className="city-sheet city-sheet--venue">
          <header className="city-sheet__hero city-sheet__hero--venue">
            <div>
              <span className="city-sheet__eyebrow">{locationTypeLabel(selectedLocation.type)} · <b className={status === "Открыто" ? "is-good" : "is-warn"}>{status}</b></span>
              <h2>{selectedLocation.name}</h2>
              <p>{selectedDistrict.name} · {selectedSector.code} · {formatTimeRange(selectedLocation)}</p>
            </div>
            <div className="city-sheet__icon-actions">
              <button type="button" className="city-sheet__icon-button" onClick={shareSelection} aria-label="Поделиться">↗</button>
              <button type="button" className={`city-sheet__icon-button ${isFavorite ? "is-active" : ""}`} onClick={() => toggleFavorite(selectedLocation.id)} aria-label="Избранное">♥</button>
              <button type="button" className="city-sheet__icon-button" onClick={() => setSelection(null)} aria-label="Закрыть">×</button>
            </div>
          </header>

          <div className="city-sheet__tags">
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>

          <div className="city-sheet__metric-grid">
            <article><small>Адрес</small><strong>{selectedBuilding?.addressCode ?? selectedLocation.code}</strong><em>рядом с {selectedSector.code}</em></article>
            <article><small>Район</small><strong>{selectedDistrict.name}</strong><em>{landUseLabel(selectedSector.landUse)}</em></article>
            <article><small>Безопасность</small><strong className={`tone-${buildingStatColor(security)}`}>{riskLabel(security)}</strong><div className="city-bars">{renderBars(security).map((bar, index) => <span key={index} className={bar} />)}</div></article>
            <article><small>Трафик</small><strong>{crowd >= 65 ? "Высокий" : crowd >= 35 ? "Средний" : "Низкий"}</strong><div className="city-bars">{renderBars(crowd).map((bar, index) => <span key={index} className={bar} />)}</div></article>
            <article><small>Расстояние</small><strong>{Math.round(routeDistance)} м</strong><em>{routeMinutes ? `${routeMinutes} мин` : "рядом"}</em></article>
            <article><small>Маршрут</small><strong>{travelOption ? `${travelOption.mode === "taxi" ? "Такси" : travelOption.mode === "metro" ? "Метро" : travelOption.mode === "bus" ? "Автобус" : "Пешком"}` : "Пешком"}</strong><em>{travelOption ? `${travelOption.cost} кр.` : "локально"}</em></article>
          </div>

          <section className="city-sheet__inside">
            <header><strong>Что внутри</strong><span>{selectedBuilding ? selectedBuilding.floors : 1} этаж</span></header>
            <div>
              <article><small>Входы</small><strong>{selectedBuilding?.publicEntrances ?? 1}</strong></article>
              <article><small>Помещения</small><strong>{selectedBuilding ? selectedBuilding.commercialUnits + selectedBuilding.residentialUnits : 1}</strong></article>
              <article><small>Сейчас внутри</small><strong>{actorsAtSelectedPlace.length}</strong></article>
              <article><small>Машины у входа</small><strong>{vehiclesAtSelectedPlace.length}</strong></article>
            </div>
          </section>

          <footer className="city-sheet__footer city-sheet__footer--dual">
            <button
              type="button"
              className="city-sheet__ghost-button"
              disabled={!playerInsideVenue && !canEnterVenue && !movementPreview && !travelOption}
              onClick={() => {
                if (playerInsideVenue) onLeaveBuilding();
                else if (canEnterVenue && selectedBuilding) onEnterBuilding(selectedBuilding.id);
                else goToSelection();
              }}
            >
              {playerInsideVenue ? "Выйти" : canEnterVenue ? "Войти" : movementPreview ? "Идти сюда" : "Начать поездку"}
            </button>
            <button type="button" className={`city-sheet__accent-button ${routePinned ? "is-active" : ""}`} disabled={!movementPreview && !travelOption} onClick={pinRoute}>
              {routePinned ? "Маршрут построен" : "Построить маршрут"}
            </button>
          </footer>
        </section>
      );
    }

    if (selection?.kind === "stop") {
      const routeLabels = selection.stop.routeIds
        .map((routeId) => session.transit.routes.find((route) => route.id === routeId)?.code)
        .filter((value): value is string => Boolean(value));
      return (
        <section className="city-sheet city-sheet--stop">
          <header className="city-sheet__hero city-sheet__hero--transport">
            <div>
              <span className="city-sheet__eyebrow">{selection.stop.mode === "metro" ? "Станция метро" : "Автобусная остановка"}</span>
              <h2>{selection.stop.name}</h2>
              <p>{selectedDistrict.name} · {selectedSector.code} · {routeLabels.join(" · ") || "Маршруты обновляются"}</p>
            </div>
            <div className="city-sheet__icon-actions">
              <button type="button" className="city-sheet__icon-button" onClick={shareSelection} aria-label="Поделиться">↗</button>
              <button type="button" className="city-sheet__icon-button" onClick={() => setSelection(null)} aria-label="Закрыть">×</button>
            </div>
          </header>
          <div className="city-sheet__metric-grid city-sheet__metric-grid--compact">
            <article><small>Маршрутов</small><strong>{selection.stop.routeIds.length}</strong></article>
            <article><small>Пассажиров в день</small><strong>{compactNumber(selection.stop.dailyBoardings)}</strong></article>
            <article><small>Укрытие</small><strong>{selection.stop.shelter ? "Есть" : "Нет"}</strong></article>
            <article><small>Доступность</small><strong>{selection.stop.accessible ? "Полная" : "Ограничена"}</strong></article>
          </div>
          <footer className="city-sheet__footer city-sheet__footer--dual">
            <button type="button" className="city-sheet__ghost-button" disabled={!movementPreview} onClick={beginWalk}>Идти к остановке</button>
            <button type="button" className={`city-sheet__accent-button ${routePinned ? "is-active" : ""}`} disabled={!movementPreview} onClick={pinRoute}>
              {routePinned ? "Маршрут построен" : "Построить маршрут"}
            </button>
          </footer>
        </section>
      );
    }

    if (selection?.kind === "actor") {
      return (
        <section className="city-sheet city-sheet--person">
          <header className="city-sheet__person-header">
            <img src={personPortrait(selection.actor.id)} alt="" />
            <div className="city-sheet__person-copy">
              <span className="city-sheet__eyebrow">Человек рядом</span>
              <h2>{selection.actor.name}</h2>
              <p>{selection.actor.roleLabel} · {selection.actor.activityLabel}</p>
            </div>
            <div className="city-sheet__icon-actions">
              <button type="button" className="city-sheet__icon-button" onClick={shareSelection} aria-label="Поделиться">↗</button>
              <button type="button" className="city-sheet__icon-button" onClick={() => setSelection(null)} aria-label="Закрыть">×</button>
            </div>
          </header>
          <div className="city-sheet__metric-grid city-sheet__metric-grid--compact">
            <article><small>Расстояние</small><strong>{Math.round(selection.actor.distanceToPlayerM)} м</strong></article>
            <article><small>Состояние</small><strong>{selection.actor.health}</strong></article>
            <article><small>Возраст</small><strong>{selection.actor.age}</strong></article>
            <article><small>Статус</small><strong>{selection.actor.knownToPlayer ? "Знаком" : "Незнакомец"}</strong></article>
          </div>
          <footer className="city-sheet__footer city-sheet__footer--single">
            <button type="button" className="city-sheet__accent-button" disabled={!movementPreview} onClick={beginWalk}>Подойти</button>
          </footer>
        </section>
      );
    }

    if (selection?.kind === "vehicle") {
      const playerInsideVehicle = session.localScene.playerPosition.state === "vehicle" && session.vehicles.player.currentVehicleId === selection.vehicle.id;
      const canEnterVehicle = session.localScene.playerPosition.state === "outside" && selection.vehicle.distanceToPlayerM <= 6 && selection.vehicle.playerCanEnter;
      return (
        <section className="city-sheet city-sheet--vehicle">
          <header className="city-sheet__hero city-sheet__hero--vehicle">
            <div>
              <span className="city-sheet__eyebrow">Транспорт рядом</span>
              <h2>{selection.vehicle.modelName}</h2>
              <p>{selection.vehicle.plate} · {vehicleStateLabel(selection.vehicle)}</p>
            </div>
            <div className="city-sheet__icon-actions">
              <button type="button" className="city-sheet__icon-button" onClick={shareSelection} aria-label="Поделиться">↗</button>
              <button type="button" className={`city-sheet__icon-button ${isFavorite ? "is-active" : ""}`} onClick={() => toggleFavorite(selection.vehicle.id)} aria-label="Избранное">♥</button>
              <button type="button" className="city-sheet__icon-button" onClick={() => setSelection(null)} aria-label="Закрыть">×</button>
            </div>
          </header>
          <div className="city-sheet__metric-grid city-sheet__metric-grid--compact">
            <article><small>Расстояние</small><strong>{Math.round(selection.vehicle.distanceToPlayerM)} м</strong></article>
            <article><small>Топливо</small><strong>{Math.round(selection.vehicle.fuelL / Math.max(1, selection.vehicle.fuelCapacityL) * 100)}%</strong></article>
            <article><small>Состояние</small><strong>{selection.vehicle.condition}%</strong></article>
            <article><small>Доступ</small><strong>{selection.vehicle.playerCanEnter ? "Разрешён" : "Нет"}</strong></article>
          </div>
          <footer className="city-sheet__footer city-sheet__footer--dual">
            <button
              type="button"
              className="city-sheet__ghost-button"
              disabled={!playerInsideVehicle && !canEnterVehicle && !movementPreview}
              onClick={() => {
                if (playerInsideVehicle) onLeaveVehicle();
                else if (canEnterVehicle) onEnterVehicle(selection.vehicle.id);
                else beginWalk();
              }}
            >
              {playerInsideVehicle ? "Выйти из машины" : canEnterVehicle ? "Сесть" : "Идти к машине"}
            </button>
            <button type="button" className={`city-sheet__accent-button ${routePinned ? "is-active" : ""}`} disabled={!movementPreview} onClick={pinRoute}>
              {routePinned ? "Маршрут построен" : "Построить маршрут"}
            </button>
          </footer>
        </section>
      );
    }

    return (
      <section className="city-sheet city-sheet--summary">
        <header className="city-sheet__hero city-sheet__hero--summary">
          <div>
            <span className="city-sheet__eyebrow">Локальная карта</span>
            <h2>{selectedSector.code}</h2>
            <p>{selectedDistrict.name} · {landUseLabel(selectedSector.landUse)}</p>
          </div>
        </header>
        <div className="city-sheet__metric-grid">
          <article><small>Локации</small><strong>{sectorLocations.length}</strong><em>точек интереса</em></article>
          <article><small>Здания</small><strong>{localBuildings.length}</strong><em>в секторе</em></article>
          <article><small>Люди</small><strong>{nearbyActors.length}</strong><em>вокруг тебя</em></article>
          <article><small>Машины</small><strong>{nearbyVehicles.length}</strong><em>видимые сейчас</em></article>
        </div>
        <footer className="city-sheet__footer city-sheet__footer--dual">
          <button type="button" className="city-sheet__ghost-button" onClick={goToPlayer}>К игроку</button>
          <button type="button" className="city-sheet__accent-button" onClick={() => setMode("global")}>Глобальная карта</button>
        </footer>
      </section>
    );
  }

  function renderGlobalSelectionPanel(): JSX.Element {
    const chosenDistrict = selection?.kind === "district" ? selection.district : selectedDistrict;
    const districtSectors = session.metropolitan.sectors.filter((sector) => sector.mapDistrictId === chosenDistrict.id);
    const highlightedLocations = districtLocations
      .filter((location) => {
        if (globalFilter === "transport") return location.type === "transport";
        if (globalFilter === "work") return ["office", "workshop", "government", "education"].includes(location.type);
        if (globalFilter === "services") return ["clinic", "market", "government", "education"].includes(location.type);
        return true;
      })
      .slice(0, 5);

    return (
      <section className="city-sheet city-sheet--global">
        <header className="city-sheet__hero city-sheet__hero--global">
          <div>
            <span className="city-sheet__eyebrow">Выбранный район</span>
            <h2>{chosenDistrict.name}</h2>
            <p>{riskLabel(chosenDistrict.riskScore)} риск · {chosenDistrict.sectorIds.length} секторов</p>
          </div>
          <div className="city-sheet__icon-actions">
            <button type="button" className="city-sheet__icon-button" onClick={shareSelection} aria-label="Поделиться">↗</button>
            <button type="button" className={`city-sheet__icon-button ${favorites.includes(chosenDistrict.id) ? "is-active" : ""}`} onClick={() => toggleFavorite(chosenDistrict.id)} aria-label="Избранное">♥</button>
          </div>
        </header>

        <div className="city-sheet__metric-grid">
          <article><small>Население</small><strong>{compactNumber(chosenDistrict.representedPopulation)}</strong></article>
          <article><small>Транспорт</small><strong>{chosenDistrict.transitScore}/100</strong><div className="city-bars">{renderBars(chosenDistrict.transitScore).map((bar, index) => <span key={index} className={bar} />)}</div></article>
          <article><small>Активность</small><strong>{chosenDistrict.activityScore}/100</strong><div className="city-bars">{renderBars(chosenDistrict.activityScore).map((bar, index) => <span key={index} className={bar} />)}</div></article>
          <article><small>Риск</small><strong>{chosenDistrict.riskScore}/100</strong><div className="city-bars">{renderBars(chosenDistrict.riskScore).map((bar, index) => <span key={index} className={bar} />)}</div></article>
        </div>

        <section className="global-sheet__list">
          <header><strong>Ключевые локации</strong><span>{highlightedLocations.length}</span></header>
          <div>
            {highlightedLocations.map((location) => (
              <button type="button" key={location.id} onClick={() => {
                const building = session.urban.buildings.find((item) => item.anchorLocationId === location.id);
                const sector = session.metropolitan.locations.find((placement) => placement.locationId === location.id)?.sectorId;
                if (sector) setSelectedSectorId(sector);
                setMode("local");
                setSelection(building ? { kind: "building", building } : { kind: "location", location });
              }}>
                <i>{PLACE_ICONS[location.type]}</i>
                <span><strong>{location.name}</strong><small>{locationTypeLabel(location.type)} · {locationOpenText(location, session)}</small></span>
                <em>{location.security}%</em>
              </button>
            ))}
          </div>
        </section>

        <section className="global-sheet__sectors">
          {districtSectors.slice(0, 4).map((sector) => (
            <button type="button" key={sector.id} onClick={() => openSector(sector)}>
              <strong>{sector.code}</strong>
              <small>{landUseLabel(sector.landUse)}</small>
            </button>
          ))}
        </section>

        <footer className="city-sheet__footer city-sheet__footer--dual">
          <button type="button" className="city-sheet__ghost-button" onClick={goToPlayer}>К игроку</button>
          <button type="button" className="city-sheet__accent-button" onClick={() => openSector(session.metropolitan.sectors.find((sector) => sector.mapDistrictId === chosenDistrict.id) ?? focusSector)}>Выбрать район</button>
        </footer>
      </section>
    );
  }

  return (
    <section className="screen city-map-screen" aria-label="Карта города">
      {mode === "global" ? (
        <div className="city-map city-map--global">
          <header className="city-map__topbar">
            <div>
              <span className="city-map__eyebrow">Уровень: город</span>
              <h1>Карта города</h1>
            </div>
            <div className="city-map__segmented">
              <button type="button" className="is-active" onClick={() => setMode("global")}>Город</button>
              <button type="button" onClick={() => setMode("local")}>Сектор</button>
            </div>
          </header>

          <div className="city-map__filter-row">
            {GLOBAL_FILTERS.map((filter) => (
              <button type="button" key={filter.id} className={globalFilter === filter.id ? "is-active" : ""} onClick={() => setGlobalFilter(filter.id)}>{filter.label}</button>
            ))}
          </div>

          <div className="city-map__canvas city-map__canvas--global">
            <div className="city-map__legend">
              {session.metropolitan.mapDistricts.map((district) => (
                <button type="button" key={district.id} className={selectedDistrictId === district.id ? "is-active" : ""} onClick={() => openDistrict(district)}>
                  <i data-tone={districtTone(district)} />
                  <span>{district.name}</span>
                </button>
              ))}
            </div>
            <div className="city-map__controls">
              <button type="button" onClick={() => setGlobalZoom((value) => clamp(Number((value + 0.12).toFixed(2)), 0.8, 1.4))}>+</button>
              <button type="button" onClick={() => setGlobalZoom((value) => clamp(Number((value - 0.12).toFixed(2)), 0.8, 1.4))}>−</button>
              <button type="button" onClick={goToPlayer}>⌖</button>
            </div>
            <div className="global-map-board">
              <div className="global-map-world" style={{ transform: `scale(${globalZoom})` }}>
                <svg className={`global-map-network filter-${globalFilter}`} viewBox="0 0 100 100" aria-hidden="true">
                  <defs>
                    <filter id="global-road-glow"><feGaussianBlur stdDeviation="0.45" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  </defs>
                  <g className="global-map-network__roads">
                    {globalRoads.map(({ link, from, to }) => {
                      const startPoint = globalPoint(from.xM, from.yM);
                      const endPoint = globalPoint(to.xM, to.yM);
                      return <line key={link.id} x1={startPoint.x} y1={startPoint.y} x2={endPoint.x} y2={endPoint.y} className={`road-${link.class}`} />;
                    })}
                  </g>
                  {(globalFilter === "districts" || globalFilter === "transport") ? (
                    <g className="global-map-network__transit">
                      {globalTransitLines.map(({ line, points }) => (
                        <polyline
                          key={line.id}
                          className={`transit-${line.mode}`}
                          points={points.map((point) => { const value = globalPoint(point.xM, point.yM); return `${value.x},${value.y}`; }).join(" ")}
                        />
                      ))}
                    </g>
                  ) : null}
                </svg>

                {session.metropolitan.mapDistricts.map((district, index) => (
                  <button
                    type="button"
                    key={district.id}
                    className={`global-district-card tone-${districtTone(district)} ${selectedDistrictId === district.id ? "is-selected" : ""} ${globalFilter === "risk" ? "show-risk" : ""}`}
                    style={{ ...districtRect(district), clipPath: DISTRICT_CLIPS[index % DISTRICT_CLIPS.length] }}
                    onClick={() => openDistrict(district)}
                  >
                    <strong>{district.name}</strong>
                    <small>{riskLabel(district.riskScore)} риск</small>
                    <div className="global-district-card__bars">{renderBars(globalFilter === "risk" ? district.riskScore : district.activityScore).map((bar, barIndex) => <span key={barIndex} className={bar} />)}</div>
                    <em>{landUseLabel(district.dominantLandUse)}</em>
                  </button>
                ))}

                {globalMarkers.map(({ location, placement }) => {
                  const point = globalPoint(placement.bounds.xM + placement.bounds.widthM / 2, placement.bounds.yM + placement.bounds.heightM / 2);
                  return (
                    <button
                      type="button"
                      key={location.id}
                      className={`global-map-marker type-${location.type}`}
                      style={{ left: `${point.x}%`, top: `${point.y}%` }}
                      onClick={() => {
                        const sector = session.metropolitan.sectors.find((item) => item.id === placement.sectorId);
                        if (sector) { setSelectedSectorId(sector.id); setSelectedDistrictId(sector.mapDistrictId); }
                        setMode("local");
                        setSelection({ kind: "location", location });
                      }}
                      aria-label={location.name}
                    >
                      <i>{PLACE_ICONS[location.type]}</i><span>{location.name}</span>
                    </button>
                  );
                })}

                {(() => {
                  const point = globalPoint(session.localScene.playerPosition.xM, session.localScene.playerPosition.yM);
                  return <div className="global-player-pin" style={{ left: `${point.x}%`, top: `${point.y}%` }}><span>Я</span></div>;
                })()}
              </div>
            </div>
          </div>

          <div className="city-map__sheet-area">{renderGlobalSelectionPanel()}</div>
        </div>
      ) : (
        <div className="city-map city-map--local">
          <header className="city-map__topbar">
            <div>
              <span className="city-map__eyebrow">{selectedDistrict.name}</span>
              <h1>{selectedSector.code}</h1>
            </div>
            <div className="city-map__segmented">
              <button type="button" onClick={() => setMode("global")}>Город</button>
              <button type="button" className="is-active" onClick={() => setMode("local")}>Сектор</button>
            </div>
          </header>

          <div className="city-map__filter-row city-map__filter-row--dense">
            {LOCAL_FILTERS.map((filter) => (
              <button type="button" key={filter.id} className={localFilter === filter.id ? "is-active" : ""} onClick={() => setLocalFilter(filter.id)}>{filter.label}</button>
            ))}
            <button type="button" className="city-map__chip-button" onClick={goToPlayer}>Я</button>
          </div>

          <div className="city-map__canvas city-map__canvas--local">
            <div className="city-map__controls">
              <button type="button" onClick={() => setLocalZoom((value) => clamp(Number((value + 0.12).toFixed(2)), 0.9, 1.6))}>+</button>
              <button type="button" onClick={() => setLocalZoom((value) => clamp(Number((value - 0.12).toFixed(2)), 0.9, 1.6))}>−</button>
              <button type="button" onClick={goToPlayer}>⌖</button>
            </div>
            <div className="local-map-board">
              <div className="local-map-world" style={{ transform: `scale(${localZoom})` }}>
                <svg className="local-map-network" viewBox="0 0 100 100" aria-hidden="true">
                  <defs>
                    <filter id="local-road-glow"><feGaussianBlur stdDeviation="0.34" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  </defs>
                  <g className="local-map-network__blocks">
                    {localTopology.blocks.map((block) => {
                      const point = localCoordinate(block.bounds.xM, block.bounds.yM);
                      const width = block.bounds.widthM / Math.max(1, selectedSector.bounds.widthM) * 100;
                      const height = block.bounds.heightM / Math.max(1, selectedSector.bounds.heightM) * 100;
                      return <rect key={block.id} x={point.x} y={point.y} width={width} height={height} rx="1.2" className={`land-${block.landUse}`} />;
                    })}
                  </g>
                  <g className="local-map-network__roads">
                    {localRoads.map(({ segment, from, to }) => {
                      const startPoint = localCoordinate(from.xM, from.yM);
                      const endPoint = localCoordinate(to.xM, to.yM);
                      const midpointX = (startPoint.x + endPoint.x) / 2;
                      const midpointY = (startPoint.y + endPoint.y) / 2;
                      return (
                        <g key={segment.id}>
                          <line className={`street-halo street-${segment.class}`} x1={startPoint.x} y1={startPoint.y} x2={endPoint.x} y2={endPoint.y} />
                          <line className={`street-core street-${segment.class}`} x1={startPoint.x} y1={startPoint.y} x2={endPoint.x} y2={endPoint.y} />
                          {(segment.class === "arterial" || segment.class === "collector") && segment.lengthM > 115 ? <text x={midpointX} y={midpointY - 0.7}>{segment.name}</text> : null}
                        </g>
                      );
                    })}
                  </g>
                  {routePoints.length >= 2 ? (
                    <polyline
                      className="local-map-network__route"
                      points={routePoints.map((point) => { const value = localCoordinate(point.xM, point.yM); return `${value.x},${value.y}`; }).join(" ")}
                    />
                  ) : null}
                </svg>

                {localBuildings.map((building) => (
                  <button
                    type="button"
                    key={building.id}
                    className={`local-building-card use-${building.use} ${selection?.kind === "building" && selection.building.id === building.id ? "is-selected" : ""}`}
                    style={localRect(building.bounds)}
                    onClick={() => setSelection({ kind: "building", building })}
                    aria-label={`${buildingUseLabel(building.use)} ${building.addressCode}`}
                  >
                    <span>{building.addressCode}</span>
                    <small>{building.floors}F</small>
                  </button>
                ))}

                {filteredLocations.map(({ placement, location }) => (
                  <button
                    type="button"
                    key={location.id}
                    className={`local-poi-marker type-${location.type} ${selection?.kind === "location" && selection.location.id === location.id ? "is-selected" : ""}`}
                    style={localPoint(placement.bounds.xM + placement.bounds.widthM / 2, placement.bounds.yM + placement.bounds.heightM / 2)}
                    onClick={() => setSelection({ kind: "location", location })}
                  >
                    <i>{PLACE_ICONS[location.type]}</i>
                    <span>{location.name}</span>
                    <small>{locationOpenText(location, session)}</small>
                  </button>
                ))}

                {(localFilter === "all" || localFilter === "transport") && localStops.map((stop) => (
                  <button
                    type="button"
                    key={stop.id}
                    className={`local-mini-marker local-mini-marker--transport ${selection?.kind === "stop" && selection.stop.id === stop.id ? "is-selected" : ""}`}
                    style={localPoint(stop.xM, stop.yM)}
                    onClick={() => setSelection({ kind: "stop", stop })}
                    aria-label={stop.name}
                  >
                    <span>{stop.mode === "metro" ? "M" : "B"}</span>
                  </button>
                ))}

                {(localFilter === "all" || localFilter === "people") && nearbyActors.slice(0, 12).map((actor) => (
                  <button
                    type="button"
                    key={actor.id}
                    className={`local-mini-marker local-mini-marker--person ${selection?.kind === "actor" && selection.actor.id === actor.id ? "is-selected" : ""}`}
                    style={localPoint(actor.position.xM, actor.position.yM)}
                    onClick={() => setSelection({ kind: "actor", actor })}
                    aria-label={`${actor.name}, ${Math.round(actor.distanceToPlayerM)} м`}
                  >
                    <span>●</span><small>{Math.round(actor.distanceToPlayerM)} м</small>
                  </button>
                ))}

                {(localFilter === "all" || localFilter === "cars") && nearbyVehicles.slice(0, 12).map((vehicle) => (
                  <button
                    type="button"
                    key={vehicle.id}
                    className={`local-mini-marker local-mini-marker--vehicle ${selection?.kind === "vehicle" && selection.vehicle.id === vehicle.id ? "is-selected" : ""}`}
                    style={localPoint(vehicle.position.xM, vehicle.position.yM)}
                    onClick={() => setSelection({ kind: "vehicle", vehicle })}
                    aria-label={`${vehicle.modelName}, ${Math.round(vehicle.distanceToPlayerM)} м`}
                  >
                    <span>▰</span><small>{Math.round(vehicle.distanceToPlayerM)} м</small>
                  </button>
                ))}

                <div className="local-player-pin" style={localPoint(session.localScene.playerPosition.xM, session.localScene.playerPosition.yM)}>
                  <span>Я</span>
                </div>
              </div>

              {routePinned && (movementPreview || travelOption) ? (
                <div className="city-route-banner">
                  <div><small>Маршрут готов</small><strong>{movementPreview?.target.label ?? selectedLocation?.name ?? "Точка назначения"}</strong><span>{movementPreview ? `${Math.round(movementPreview.totalDistanceM)} м · ${movementPreview.estimatedMinutes} мин` : `${travelOption?.distanceKm ?? 0} км · ${travelOption?.durationMinutes ?? 0} мин`}</span></div>
                  <button type="button" onClick={goToSelection}>Начать</button>
                  <button type="button" className="city-route-banner__close" onClick={() => setRoutePinned(false)} aria-label="Скрыть маршрут">×</button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="city-map__sheet-area">{renderLocalSelectionPanel()}</div>
        </div>
      )}
      {flashMessage ? <div className="city-map-toast" role="status">{flashMessage}</div> : null}
    </section>
  );
}
