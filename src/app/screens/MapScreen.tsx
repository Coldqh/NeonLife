import { useEffect, useMemo, useState } from "react";
import type { GameSession } from "../../world/state/types";
import type { LocalMovementTargetState } from "../../simulation/localMovement/types";
import { getTravelOptions } from "../../gameplay/travel/travelSystem";
import { getSectorStreetTopology } from "../../simulation/streets/streetTopologySystem";
import { GlobalCityMap, type MapLayers, type MapPointSelection } from "../map/GlobalCityMap";
import { LocalSectorMap, type LocalMapSelection } from "../map/LocalSectorMap";
import { MapTopBar } from "../map/MapTopBar";
import { MapSelectionSheet } from "../map/MapSelectionSheet";
import { MapProfileOverlay } from "../map/MapProfileOverlay";
import { BuildingInteriorMap } from "../map/BuildingInteriorMap";
import type { LocalLifeAction } from "../actions/localLifeActions";
import type { StreetIncidentAction } from "../../simulation/streetScene/types";
import type { CityMapSelection, GlobalLayerId, LocalLayerId, MapMode } from "../map/mapUi";
import {
  locationMatchesLayer,
  mapDistrictForSector,
  selectionKey,
  selectionTitle,
  sectorForLocation
} from "../map/mapUi";
import {
  localMovementTargetForActor,
  localMovementTargetForBuilding,
  localMovementTargetForLocation,
  localMovementTargetForPoint,
  localMovementTargetForStop,
  localMovementTargetForVehicle,
  planLocalMovement
} from "../../simulation/localMovement/localMovementSystem";
import type { StreetIntersectionState, StreetSegmentState } from "../../simulation/streets/types";

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }

function pointSegmentDistance(x: number, y: number, from: StreetIntersectionState, to: StreetIntersectionState): number {
  const dx = to.xM - from.xM;
  const dy = to.yM - from.yM;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= .0001) return Math.hypot(x - from.xM, y - from.yM);
  const ratio = clamp(((x - from.xM) * dx + (y - from.yM) * dy) / lengthSquared, 0, 1);
  return Math.hypot(x - (from.xM + dx * ratio), y - (from.yM + dy * ratio));
}

function nearestStreetId(x: number, y: number, segments: StreetSegmentState[], nodes: Map<string, StreetIntersectionState>): string | null {
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

function localSelectionToCity(selection: LocalMapSelection, sector: GameSession["metropolitan"]["sectors"][number]): CityMapSelection {
  if (selection.kind === "location") return { kind: "location", location: selection.location };
  if (selection.kind === "building") return { kind: "building", building: selection.building };
  if (selection.kind === "actor") return { kind: "actor", actor: selection.actor };
  if (selection.kind === "vehicle") return { kind: "vehicle", vehicle: selection.vehicle };
  if (selection.kind === "incident") return { kind: "incident", incident: selection.incident };
  if (selection.kind === "stop") return { kind: "stop", stop: selection.stop };
  if (selection.kind === "point") return { kind: "point", sector, xM: selection.xM, yM: selection.yM };
  return {
    kind: "point",
    sector,
    xM: sector.bounds.xM + sector.bounds.widthM / 2,
    yM: sector.bounds.yM + sector.bounds.heightM / 2
  };
}

function citySelectionToLocal(selection: CityMapSelection | null): LocalMapSelection | null {
  if (!selection) return null;
  if (selection.kind === "location") return { kind: "location", location: selection.location };
  if (selection.kind === "building") return { kind: "building", building: selection.building };
  if (selection.kind === "actor") return { kind: "actor", actor: selection.actor };
  if (selection.kind === "vehicle") return { kind: "vehicle", vehicle: selection.vehicle };
  if (selection.kind === "incident") return { kind: "incident", incident: selection.incident };
  if (selection.kind === "stop") return { kind: "stop", stop: selection.stop };
  if (selection.kind === "point") return { kind: "point", xM: selection.xM, yM: selection.yM };
  return null;
}

export function MapScreen({
  session,
  requestedLocationId,
  onRequestedLocationHandled,
  onSettings,
  onTravel,
  onWalk,
  onEnterBuilding,
  onLeaveBuilding,
  onMoveBuildingFloor,
  onEnterBuildingUnit,
  onLeaveBuildingUnit,
  onEnterInteriorRoom,
  onLeaveInteriorRoom,
  onLifeAction,
  onEnterVehicle,
  onLeaveVehicle,
  onStreetIncidentAction
}: {
  session: GameSession;
  requestedLocationId?: string;
  onRequestedLocationHandled: () => void;
  onSettings: () => void;
  onTravel: (locationId: string) => void;
  onWalk: (target: LocalMovementTargetState) => void;
  onEnterBuilding: (buildingId: string) => void;
  onLeaveBuilding: () => void;
  onMoveBuildingFloor: (floor: number, method: "stairs" | "elevator") => void;
  onEnterBuildingUnit: (unitId: string) => void;
  onLeaveBuildingUnit: () => void;
  onEnterInteriorRoom: (roomId: string) => void;
  onLeaveInteriorRoom: () => void;
  onLifeAction: (action: LocalLifeAction) => void;
  onEnterVehicle: (vehicleId: string) => void;
  onLeaveVehicle: () => void;
  onStreetIncidentAction: (incidentId: string, action: StreetIncidentAction) => void;
}) {
  const focusSector = session.metropolitan.sectors.find((sector) => sector.id === session.metropolitan.streaming.focusSectorId) ?? session.metropolitan.sectors[0];
  const playerSector = session.metropolitan.sectors.find((sector) => sector.id === session.localScene.playerPosition.sectorId) ?? focusSector;
  const insideBuilding = session.localScene.playerPosition.state === "inside" && Boolean(session.localScene.playerPosition.buildingId);
  const currentBuilding = insideBuilding ? session.urban.buildings.find((item) => item.id === session.localScene.playerPosition.buildingId) : undefined;
  const [mode, setMode] = useState<MapMode>(insideBuilding ? "interior" : "local");
  const [globalLayer, setGlobalLayer] = useState<GlobalLayerId>("districts");
  const [localLayer, setLocalLayer] = useState<LocalLayerId>("all");
  const [selectedSectorId, setSelectedSectorId] = useState(playerSector.id);
  const [selection, setSelection] = useState<CityMapSelection | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [globalFocusRevision, setGlobalFocusRevision] = useState(0);
  const [localFocusRevision, setLocalFocusRevision] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("neon-life/map-favorites/v2") ?? "[]") as unknown;
      return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
    } catch { return []; }
  });

  const selectedSector = session.metropolitan.sectors.find((sector) => sector.id === selectedSectorId) ?? playerSector;
  const selectedDistrict = mapDistrictForSector(session, selectedSector) ?? session.metropolitan.mapDistricts[0];
  const localTopology = useMemo(() => getSectorStreetTopology(session.streets, {
    timestamp: session.timestamp,
    seed: session.world.meta.seed,
    metropolitan: session.metropolitan,
    urban: session.urban,
    preferredSectorId: selectedSector.id
  }, selectedSector.id), [selectedSector.id, session.metropolitan, session.streets, session.timestamp, session.urban, session.world.meta.seed]);
  const localNodes = useMemo(() => new Map(localTopology.intersections.map((node) => [node.id, node])), [localTopology.intersections]);
  const playerStreetId = useMemo(() => nearestStreetId(session.localScene.playerPosition.xM, session.localScene.playerPosition.yM, localTopology.segments, localNodes), [localNodes, localTopology.segments, session.localScene.playerPosition.xM, session.localScene.playerPosition.yM]);

  const nearbyActors = useMemo(() => {
    const player = session.localScene.playerPosition;
    return session.localScene.actors.filter((actor) => actor.visible && actor.position.sectorId === selectedSector.id).filter((actor) => {
      if (player.state === "inside") return Boolean(player.buildingId && actor.position.buildingId === player.buildingId && (!player.unitId || actor.position.unitId === player.unitId || actor.distanceToPlayerM <= 28));
      if (actor.position.state !== "outside") return false;
      if (actor.distanceToPlayerM <= 38) return true;
      const actorStreetId = nearestStreetId(actor.position.xM, actor.position.yM, localTopology.segments, localNodes);
      return Boolean(playerStreetId && actorStreetId === playerStreetId && actor.distanceToPlayerM <= 135);
    }).sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM).slice(0, 16);
  }, [localNodes, localTopology.segments, playerStreetId, selectedSector.id, session.localScene.actors, session.localScene.playerPosition]);

  const nearbyVehicles = useMemo(() => {
    const player = session.localScene.playerPosition;
    return session.vehicles.vehicles.filter((vehicle) => vehicle.visible && vehicle.position.sectorId === selectedSector.id).filter((vehicle) => {
      if (player.state === "inside") return Boolean(player.buildingId && vehicle.position.buildingId === player.buildingId);
      if (vehicle.distanceToPlayerM <= 42) return true;
      const streetId = nearestStreetId(vehicle.position.xM, vehicle.position.yM, localTopology.segments, localNodes);
      return Boolean(playerStreetId && streetId === playerStreetId && vehicle.distanceToPlayerM <= 150);
    }).sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM).slice(0, 16);
  }, [localNodes, localTopology.segments, playerStreetId, selectedSector.id, session.localScene.playerPosition, session.vehicles.vehicles]);


  useEffect(() => {
    if (insideBuilding) { setMode("interior"); setSelection(null); setProfileOpen(false); }
    else if (mode === "interior") setMode("local");
  }, [insideBuilding, currentBuilding?.id]);

  useEffect(() => {
    if (!requestedLocationId) return;
    const location = session.world.locations.find((item) => item.id === requestedLocationId);
    const sector = sectorForLocation(session, requestedLocationId);
    if (location && sector) {
      setSelectedSectorId(sector.id);
      setSelection({ kind: "location", location });
      setMode("local");
      setLocalFocusRevision((value) => value + 1);
      setRouteReady(false);
    }
    onRequestedLocationHandled();
  }, [onRequestedLocationHandled, requestedLocationId, session]);

  useEffect(() => { try { localStorage.setItem("neon-life/map-favorites/v2", JSON.stringify(favorites)); } catch { /* optional */ } }, [favorites]);
  useEffect(() => { setRouteReady(false); setProfileOpen(false); }, [selectionKey(selection)]);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const target = useMemo<LocalMovementTargetState | null>(() => {
    if (!selection) return null;
    if (selection.kind === "location") return localMovementTargetForLocation(session, selection.location.id);
    if (selection.kind === "building") return localMovementTargetForBuilding(session, selection.building.id);
    if (selection.kind === "actor") {
      const pedestrian = session.streetScene.pedestrians.find((item) => item.actorId === selection.actor.id);
      return pedestrian ? localMovementTargetForPoint(session, session.streetScene.focusSectorId, pedestrian.xM, pedestrian.yM) : localMovementTargetForActor(session, selection.actor.id);
    }
    if (selection.kind === "vehicle") {
      const trafficVehicle = session.streetScene.traffic.find((item) => item.vehicleId === selection.vehicle.id);
      return trafficVehicle && trafficVehicle.motion !== "parked" ? localMovementTargetForPoint(session, session.streetScene.focusSectorId, trafficVehicle.xM, trafficVehicle.yM) : localMovementTargetForVehicle(session, selection.vehicle.id);
    }
    if (selection.kind === "stop") return localMovementTargetForStop(session, selection.stop.id);
    if (selection.kind === "incident") return localMovementTargetForPoint(session, selection.incident.sectorId, selection.incident.xM, selection.incident.yM);
    if (selection.kind === "point") return localMovementTargetForPoint(session, selection.sector.id, selection.xM, selection.yM);
    return null;
  }, [selection, session]);
  const preview = useMemo(() => target && !session.localMovement ? planLocalMovement(session, target) : null, [session, target]);
  const selectedLocation = selection?.kind === "location" ? selection.location : undefined;
  const travel = selectedLocation ? getTravelOptions(session).find((option) => option.location.id === selectedLocation.id) : undefined;
  const activeRoute = routeReady ? preview : session.localMovement ?? null;
  const favoriteKey = selectionKey(selection);
  const favorite = Boolean(favoriteKey && favorites.includes(favoriteKey));
  const profileLocation = profileOpen && selection?.kind === "location" ? selection.location : undefined;
  const profileBuilding = profileOpen && selection?.kind === "building" ? selection.building : undefined;
  const streetSceneVisible = session.streetScene.focusSectorId === selectedSector.id;

  useEffect(() => {
    if (selection?.kind !== "incident") return;
    const current = session.streetScene.incidents.find((item) => item.id === selection.incident.id);
    if (!current) { setSelection(null); return; }
    if (current.status !== selection.incident.status || current.outcome !== selection.incident.outcome || current.playerObserved !== selection.incident.playerObserved) {
      setSelection({ kind: "incident", incident: current });
    }
  }, [selection, session.streetScene.incidents]);

  const globalLayers: MapLayers = {
    districts: true,
    roads: true,
    rail: globalLayer === "transport" || globalLayer === "districts",
    bus: globalLayer === "transport",
    traffic: globalLayer === "transport",
    risk: globalLayer === "risk",
    activity: globalLayer === "work" || globalLayer === "services"
  };

  function chooseDistrict(district: GameSession["metropolitan"]["mapDistricts"][number]): void {
    setSelection({ kind: "district", district });
    const sector = session.metropolitan.sectors.find((item) => item.mapDistrictId === district.id);
    if (sector) setSelectedSectorId(sector.id);
  }

  function chooseSector(point: MapPointSelection): void {
    setSelectedSectorId(point.sector.id);
    setSelection({ kind: "sector", sector: point.sector });
  }

  function chooseLocal(local: LocalMapSelection): void {
    if (local.kind === "street") {
      const from = localNodes.get(local.segment.fromIntersectionId);
      const to = localNodes.get(local.segment.toIntersectionId);
      if (from && to) setSelection({ kind: "point", sector: selectedSector, xM: (from.xM + to.xM) / 2, yM: (from.yM + to.yM) / 2 });
      return;
    }
    setSelection(localSelectionToCity(local, selectedSector));
  }

  function openSelectedArea(): void {
    if (selection?.kind === "district") {
      const sector = session.metropolitan.sectors.find((item) => item.mapDistrictId === selection.district.id) ?? selectedSector;
      setSelectedSectorId(sector.id);
    } else if (selection?.kind === "sector") setSelectedSectorId(selection.sector.id);
    setMode("local");
    setSelection(null);
    setLocalFocusRevision((value) => value + 1);
  }

  function showPlayer(): void {
    setSelectedSectorId(playerSector.id);
    setMode(insideBuilding ? "interior" : "local");
    setSelection(null);
    if (!insideBuilding) setLocalFocusRevision((value) => value + 1);
  }

  function buildRoute(): void {
    if (!preview && !travel) { setFlash("Маршрут к этой точке сейчас недоступен"); return; }
    setRouteReady(true);
    setFlash("Маршрут построен");
  }

  function startRoute(): void {
    if (preview && target) { onWalk(target); return; }
    if (travel && selectedLocation) { onTravel(selectedLocation.id); return; }
    setFlash("Сначала построй маршрут");
  }

  function toggleFavorite(): void {
    if (!favoriteKey) return;
    setFavorites((current) => current.includes(favoriteKey) ? current.filter((item) => item !== favoriteKey) : [...current, favoriteKey]);
  }

  async function shareSelection(): Promise<void> {
    if (!selection) return;
    const text = `${selectionTitle(selection)} · NEON LIFE`;
    try {
      if (navigator.share) await navigator.share({ title: selectionTitle(selection), text });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(text); setFlash("Данные скопированы"); }
    } catch { setFlash("Не удалось поделиться"); }
  }

  const routeCaption = preview ? `${preview.estimatedMinutes} мин · ${Math.round(preview.totalDistanceM)} м` : travel ? `${travel.durationMinutes} мин · ${travel.distanceKm} км${travel.cost ? ` · ₵ ${travel.cost}` : ""}` : "Маршрут не построен";

  return (
    <section className="map-screen map-screen--immersive" aria-label="Карта города">
      <MapTopBar
        session={session}
        mode={mode}
        globalLayer={globalLayer}
        localLayer={localLayer}
        districtName={selectedDistrict?.name ?? session.world.city.name}
        sectorCode={selectedSector.code}
        buildingName={currentBuilding?.addressCode}
        insideBuilding={insideBuilding}
        onMode={(next) => { if (next === "interior" && !insideBuilding) return; setMode(next); setSelection(next === "global" ? { kind: "district", district: selectedDistrict } : null); if (next === "global") setGlobalFocusRevision((value) => value + 1); }}
        onGlobalLayer={setGlobalLayer}
        onLocalLayer={setLocalLayer}
        onSettings={onSettings}
        onPlayer={showPlayer}
      />

      <div className="map-viewport">
        {mode === "global" ? (
          <>
            <GlobalCityMap
              session={session}
              selectedSectorId={selection?.kind === "sector" ? selection.sector.id : undefined}
              selectedDistrictId={selection?.kind === "district" ? selection.district.id : selectedDistrict?.id}
              selectedPoint={null}
              layers={globalLayers}
              focusDistrictId={selection?.kind === "district" ? selection.district.id : selectedDistrict?.id}
              focusSectorId={selection?.kind === "sector" ? selection.sector.id : undefined}
              focusRevision={globalFocusRevision}
              onSelectSector={chooseSector}
              onSelectDistrict={chooseDistrict}
            />
            <aside className="global-district-legend" data-no-swipe>
              <span>РАЙОНЫ</span>
              {session.metropolitan.mapDistricts.slice(0, 8).map((district, index) => <button type="button" key={district.id} className={selection?.kind === "district" && selection.district.id === district.id ? "is-active" : ""} onClick={() => chooseDistrict(district)}><i data-index={index % 8} /><span>{district.name}</span></button>)}
            </aside>
          </>
        ) : mode === "interior" && insideBuilding ? (
          <BuildingInteriorMap
            session={session}
            onMoveFloor={onMoveBuildingFloor}
            onEnterUnit={onEnterBuildingUnit}
            onLeaveUnit={onLeaveBuildingUnit}
            onEnterRoom={onEnterInteriorRoom}
            onLeaveRoom={onLeaveInteriorRoom}
            onLeaveBuilding={onLeaveBuilding}
            onLifeAction={onLifeAction}
            onNotice={setFlash}
          />
        ) : (
          <LocalSectorMap
            session={session}
            sector={selectedSector}
            selected={citySelectionToLocal(selection)}
            route={activeRoute}
            locationFilter={(location) => locationMatchesLayer(location, localLayer)}
            showStops={localLayer === "all" || localLayer === "transport"}
            actors={localLayer === "all" || localLayer === "people" ? nearbyActors : []}
            vehicles={localLayer === "all" || localLayer === "cars" ? nearbyVehicles : []}
            pedestrians={streetSceneVisible && (localLayer === "all" || localLayer === "people") ? session.streetScene.pedestrians : []}
            traffic={streetSceneVisible && (localLayer === "all" || localLayer === "cars") ? session.streetScene.traffic : []}
            incidents={streetSceneVisible && (localLayer === "all" || localLayer === "incidents") ? session.streetScene.incidents.filter((item) => item.sectorId === selectedSector.id) : []}
            crossings={streetSceneVisible ? session.streetScene.crossings : []}
            focusRevision={localFocusRevision}
            onSelect={chooseLocal}
          />
        )}
      </div>

      {selection && mode !== "interior" ? (
        <MapSelectionSheet
          session={session}
          selection={selection}
          target={target}
          preview={preview}
          travel={travel}
          favorite={favorite}
          onClose={() => setSelection(null)}
          onDetails={() => selection.kind === "location" || selection.kind === "building" ? setProfileOpen(true) : setFlash("Подробный профиль появится после системы контактов")}
          onFavorite={toggleFavorite}
          onShare={() => { void shareSelection(); }}
          onBuildRoute={buildRoute}
          onStartRoute={startRoute}
          onOpenDistrict={openSelectedArea}
          onSelectLocation={(locationId) => {
            const location = session.world.locations.find((item) => item.id === locationId);
            const sector = sectorForLocation(session, locationId);
            if (!location || !sector) return;
            setSelectedSectorId(sector.id);
            setSelection({ kind: "location", location });
            setMode("local");
            setLocalFocusRevision((value) => value + 1);
          }}
          onEnterBuilding={onEnterBuilding}
          onLeaveBuilding={onLeaveBuilding}
          onEnterVehicle={onEnterVehicle}
          onLeaveVehicle={onLeaveVehicle}
          onStreetIncidentAction={onStreetIncidentAction}
        />
      ) : null}

      {profileOpen && (profileLocation || profileBuilding) ? (
        <MapProfileOverlay
          session={session}
          location={profileLocation}
          building={profileBuilding}
          favorite={favorite}
          routeCaption={routeCaption}
          onClose={() => setProfileOpen(false)}
          onFavorite={toggleFavorite}
          onShare={() => { void shareSelection(); }}
          onBuildRoute={buildRoute}
          onStartRoute={startRoute}
          onEnterBuilding={onEnterBuilding}
          onLeaveBuilding={onLeaveBuilding}
          onMoveFloor={onMoveBuildingFloor}
          onNotice={setFlash}
        />
      ) : null}

      {flash ? <div className="map-toast" role="status">{flash}</div> : null}
    </section>
  );
}
