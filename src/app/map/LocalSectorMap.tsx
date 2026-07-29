import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { MetropolitanSectorState } from "../../simulation/spatial/types";
import type { LocalActorState } from "../../simulation/localScene/types";
import type { PhysicalVehicleEntityState } from "../../simulation/vehicles/types";
import type { StreetSegmentState } from "../../simulation/streets/types";
import type { LocalMovementState } from "../../simulation/localMovement/types";
import type { StreetCrossingState, StreetIncidentState, StreetPedestrianState, StreetTrafficState } from "../../simulation/streetScene/types";
import { getSectorStreetTopology } from "../../simulation/streets/streetTopologySystem";
import { PLACE_ICONS } from "../shared/presentation";

interface CameraState { zoom: number; centerX: number; centerY: number }
interface Point { x: number; y: number }
interface PinchState { distance: number; zoom: number; centerX: number; centerY: number }

export type LocalMapSelection =
  | { kind: "location"; location: LocationState }
  | { kind: "building"; building: GameSession["urban"]["buildings"][number] }
  | { kind: "stop"; stop: GameSession["transit"]["stops"][number] }
  | { kind: "street"; segment: StreetSegmentState }
  | { kind: "actor"; actor: LocalActorState }
  | { kind: "vehicle"; vehicle: PhysicalVehicleEntityState }
  | { kind: "incident"; incident: StreetIncidentState }
  | { kind: "point"; xM: number; yM: number };

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function selectionKey(selection: LocalMapSelection | null): string | null {
  if (!selection) return null;
  if (selection.kind === "point") return `point:${Math.round(selection.xM)}:${Math.round(selection.yM)}`;
  if (selection.kind === "location") return `location:${selection.location.id}`;
  if (selection.kind === "building") return `building:${selection.building.id}`;
  if (selection.kind === "stop") return `stop:${selection.stop.id}`;
  if (selection.kind === "actor") return `actor:${selection.actor.id}`;
  if (selection.kind === "vehicle") return `vehicle:${selection.vehicle.id}`;
  if (selection.kind === "incident") return `incident:${selection.incident.id}`;
  return `street:${selection.segment.id}`;
}
function locationPriority(location: LocationState): number {
  if (location.type === "clinic") return 90;
  if (location.type === "transport") return 82;
  if (location.type === "market") return 76;
  if (location.type === "food") return 72;
  if (location.type === "housing") return 62;
  if (location.type === "office" || location.type === "workshop") return 55;
  return 40;
}
function stringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function LocalSectorMap({
  session,
  sector,
  selected,
  route,
  locationFilter,
  showStops = true,
  actors = [],
  vehicles = [],
  pedestrians = [],
  traffic = [],
  incidents = [],
  crossings = [],
  focusRevision = 0,
  onSelect
}: {
  session: GameSession;
  sector: MetropolitanSectorState;
  selected: LocalMapSelection | null;
  route?: LocalMovementState | null;
  locationFilter?: (location: LocationState) => boolean;
  showStops?: boolean;
  actors?: LocalActorState[];
  vehicles?: PhysicalVehicleEntityState[];
  pedestrians?: StreetPedestrianState[];
  traffic?: StreetTrafficState[];
  incidents?: StreetIncidentState[];
  crossings?: StreetCrossingState[];
  focusRevision?: number;
  onSelect?: (selection: LocalMapSelection) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<PinchState | null>(null);
  const moved = useRef(0);
  const [camera, setCamera] = useState<CameraState>({ zoom: 1, centerX: 50, centerY: 50 });

  useEffect(() => { setCamera({ zoom: 1, centerX: 50, centerY: 50 }); }, [sector.id]);
  useEffect(() => {
    if (!focusRevision || session.localScene.playerPosition.sectorId !== sector.id) return;
    const x = (session.localScene.playerPosition.xM - sector.bounds.xM) / sector.bounds.widthM * 100;
    const y = (session.localScene.playerPosition.yM - sector.bounds.yM) / sector.bounds.heightM * 100;
    setCamera((current) => ({ ...current, zoom: Math.max(current.zoom, 2.35), centerX: clamp(x, 12, 88), centerY: clamp(y, 12, 88) }));
  }, [focusRevision, sector.bounds.heightM, sector.bounds.widthM, sector.bounds.xM, sector.bounds.yM, sector.id, session.localScene.playerPosition]);

  const buildings = useMemo(() => session.urban.buildings.filter((building) => building.sectorId === sector.id), [sector.id, session.urban.buildings]);
  const topology = useMemo(() => getSectorStreetTopology(session.streets, {
    timestamp: session.timestamp,
    seed: session.world.meta.seed,
    metropolitan: session.metropolitan,
    urban: session.urban,
    preferredSectorId: sector.id
  }, sector.id), [sector.id, session.metropolitan, session.streets, session.timestamp, session.urban, session.world.meta.seed]);
  const nodeById = useMemo(() => new Map(topology.intersections.map((node) => [node.id, node])), [topology.intersections]);
  const roads = useMemo(() => topology.segments.flatMap((segment) => {
    const from = nodeById.get(segment.fromIntersectionId);
    const to = nodeById.get(segment.toIntersectionId);
    return from && to ? [{ segment, from, to }] : [];
  }), [nodeById, topology.segments]);
  const locations = useMemo(() => session.metropolitan.locations
    .filter((placement) => placement.sectorId === sector.id)
    .flatMap((placement) => {
      const location = session.world.locations.find((item) => item.id === placement.locationId);
      return location && (!locationFilter || locationFilter(location)) ? [{ location, placement }] : [];
    })
    .sort((left, right) => locationPriority(right.location) - locationPriority(left.location)), [locationFilter, sector.id, session.metropolitan.locations, session.world.locations]);
  const stops = useMemo(() => showStops ? session.transit.stops.filter((stop) => stop.sectorId === sector.id) : [], [sector.id, session.transit.stops, showStops]);
  const selectedKey = selectionKey(selected);
  const selectedBuildingId = selected?.kind === "building" ? selected.building.id : selected?.kind === "location" ? buildings.find((building) => building.anchorLocationId === selected.location.id)?.id : undefined;

  const size = 100 / camera.zoom;
  const viewX = clamp(camera.centerX - size / 2, 0, 100 - size);
  const viewY = clamp(camera.centerY - size / 2, 0, 100 - size);
  const player = session.localScene.playerPosition;
  const playerInSector = player.sectorId === sector.id;
  const playerX = clamp((player.xM - sector.bounds.xM) / sector.bounds.widthM * 100, 0, 100);
  const playerY = clamp((player.yM - sector.bounds.yM) / sector.bounds.heightM * 100, 0, 100);
  const remainingRoutePoints = route ? [{ xM: player.xM, yM: player.yM }, ...route.points.slice(Math.min(route.currentLegIndex + 1, route.points.length))] : [];
  const visibleMeters = Math.round(sector.bounds.widthM / camera.zoom);
  const showFineRoads = camera.zoom >= 1.65;
  const showParcels = camera.zoom >= 2.15;
  const showParking = camera.zoom >= 2.65;
  const showStreetLabels = camera.zoom >= 2.65;
  const showCrossings = camera.zoom >= 3.2;
  const showDynamicPeople = camera.zoom >= 3.05;
  const showDynamicCars = camera.zoom >= 2.75;
  const showEntrances = camera.zoom >= 3.15 && Boolean(selectedBuildingId);
  const visibleLocations = camera.zoom < 1.45 ? locations.slice(0, 14) : camera.zoom < 2.2 ? locations.slice(0, 28) : locations;

  function toX(xM: number): number { return (xM - sector.bounds.xM) / sector.bounds.widthM * 100; }
  function toY(yM: number): number { return (yM - sector.bounds.yM) / sector.bounds.heightM * 100; }
  function applyZoom(nextZoom: number): void {
    setCamera((current) => {
      const zoom = clamp(nextZoom, 1, 7);
      const nextSize = 100 / zoom;
      return { zoom, centerX: clamp(current.centerX, nextSize / 2, 100 - nextSize / 2), centerY: clamp(current.centerY, nextSize / 2, 100 - nextSize / 2) };
    });
  }
  function pointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    moved.current = 0;
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(second.x - first.x, second.y - first.y), zoom: camera.zoom, centerX: camera.centerX, centerY: camera.centerY };
    }
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    moved.current += Math.abs(dx) + Math.abs(dy);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      const state = pinch.current;
      if (!state) return;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const zoom = clamp(state.zoom * distance / Math.max(1, state.distance), 1, 7);
      const nextSize = 100 / zoom;
      setCamera({ zoom, centerX: clamp(state.centerX, nextSize / 2, 100 - nextSize / 2), centerY: clamp(state.centerY, nextSize / 2, 100 - nextSize / 2) });
      return;
    }
    setCamera((current) => {
      const currentSize = 100 / current.zoom;
      return { ...current, centerX: clamp(current.centerX - dx / Math.max(1, bounds.width) * currentSize, currentSize / 2, 100 - currentSize / 2), centerY: clamp(current.centerY - dy / Math.max(1, bounds.height) * currentSize, currentSize / 2, 100 - currentSize / 2) };
    });
  }
  function pointerUp(event: ReactPointerEvent<SVGSVGElement>): void { pointers.current.delete(event.pointerId); pinch.current = null; }
  function wheel(event: ReactWheelEvent<SVGSVGElement>): void { event.preventDefault(); applyZoom(camera.zoom + (event.deltaY > 0 ? -.4 : .4)); }
  function localCoordinates(clientX: number, clientY: number): { xM: number; yM: number } | null {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX; point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { xM: Math.round(sector.bounds.xM + local.x / 100 * sector.bounds.widthM), yM: Math.round(sector.bounds.yM + local.y / 100 * sector.bounds.heightM) };
  }
  function selectPoint(event: ReactMouseEvent<SVGRectElement>): void {
    if (!onSelect || moved.current > 8) return;
    const point = localCoordinates(event.clientX, event.clientY);
    if (point) onSelect({ kind: "point", ...point });
  }
  function interactiveKey(event: ReactKeyboardEvent<SVGGElement>, action: () => void): void {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
  }

  return (
    <div className="local-map local-map--city" data-no-swipe>
      <svg ref={svgRef} viewBox={`${viewX} ${viewY} ${size} ${size}`} role="img" aria-label={`Локальная карта сектора ${sector.code}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheel}>
        <defs>
          <radialGradient id={`local-ground-${sector.id}`} cx="50%" cy="48%" r="72%"><stop offset="0" stopColor="#0c1a27"/><stop offset=".58" stopColor="#07111b"/><stop offset="1" stopColor="#03070c"/></radialGradient>
          <pattern id={`sector-grid-${sector.id}`} width="3.6" height="3.6" patternUnits="userSpaceOnUse"><path d="M3.6 0H0V3.6" fill="none" stroke="rgba(138,163,191,.035)" strokeWidth=".14" /></pattern>
          <pattern id={`roof-grid-${sector.id}`} width="1.8" height="1.8" patternUnits="userSpaceOnUse"><path d="M0 .9H1.8M.9 0V1.8" stroke="rgba(255,255,255,.04)" strokeWidth=".08" /></pattern>
          <linearGradient id={`road-${sector.id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1d3042"/><stop offset=".5" stopColor="#263f55"/><stop offset="1" stopColor="#162737"/></linearGradient>
          <filter id={`map-glow-${sector.id}`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation=".7" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id={`building-shadow-${sector.id}`} x="-50%" y="-50%" width="220%" height="220%"><feDropShadow dx=".7" dy="1" stdDeviation=".55" floodColor="#000" floodOpacity=".82"/></filter>
        </defs>
        <rect width="100" height="100" fill={`url(#local-ground-${sector.id})`} />
        <rect className="local-map__hit" width="100" height="100" fill={`url(#sector-grid-${sector.id})`} onClick={onSelect ? selectPoint : undefined} />

        {topology.blocks.map((block) => <rect key={block.id} x={toX(block.bounds.xM)} y={toY(block.bounds.yM)} width={block.bounds.widthM / sector.bounds.widthM * 100} height={block.bounds.heightM / sector.bounds.heightM * 100} rx="1.1" className={`local-map__block local-map__block--${block.landUse}`} />)}
        {showParking ? topology.parkingZones.map((zone) => <rect key={zone.id} x={toX(zone.bounds.xM)} y={toY(zone.bounds.yM)} width={Math.max(.25, zone.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.25, zone.bounds.heightM / sector.bounds.heightM * 100)} rx=".25" className="local-map__parking" />) : null}

        {roads.filter(({ segment }) => showFineRoads || segment.class === "arterial" || segment.class === "collector").map(({ segment, from, to }) => {
          const active = selectedKey === `street:${segment.id}`;
          const midpointX = (toX(from.xM) + toX(to.xM)) / 2;
          const midpointY = (toY(from.yM) + toY(to.yM)) / 2;
          const vertical = Math.abs(from.xM - to.xM) < Math.abs(from.yM - to.yM);
          const major = segment.class === "arterial" || segment.class === "collector";
          return (
            <g key={segment.id} className={`local-map__street local-map__street--${segment.class}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "street", segment }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "street", segment })) : undefined}>
              <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__road-shadow" />
              <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__sidewalk" />
              <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__road" />
              {major && camera.zoom >= 1.75 ? <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__lane-divider" /> : null}
              {showStreetLabels && major ? <text className="local-map__street-label" x={midpointX} y={midpointY} textAnchor="middle" transform={vertical ? `rotate(-90 ${midpointX} ${midpointY})` : undefined}>{segment.name}</text> : null}
            </g>
          );
        })}

        {showCrossings ? crossings.map((crossing) => <g key={crossing.id} transform={`translate(${toX(crossing.xM)} ${toY(crossing.yM)})`} className={`local-map__crossing local-map__crossing--${crossing.signal}`} aria-hidden="true"><rect x="-2.4" y="-.95" width="4.8" height="1.9" rx=".35"/><path d="M-1.8-.7v1.4M-.9-.7v1.4M0-.7v1.4M.9-.7v1.4M1.8-.7v1.4"/></g>) : null}
        {showParcels ? topology.parcels.map((parcel) => <rect key={parcel.id} x={toX(parcel.bounds.xM)} y={toY(parcel.bounds.yM)} width={Math.max(.5, parcel.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.5, parcel.bounds.heightM / sector.bounds.heightM * 100)} rx=".35" className={`local-map__parcel local-map__parcel--${parcel.kind}`} />) : null}

        {buildings.map((building) => {
          const active = selectedBuildingId === building.id;
          const x = toX(building.bounds.xM); const y = toY(building.bounds.yM);
          const width = Math.max(1, building.bounds.widthM / sector.bounds.widthM * 100);
          const height = Math.max(1, building.bounds.heightM / sector.bounds.heightM * 100);
          const seed = stringHash(building.id);
          const showLabel = active || camera.zoom >= 4.45;
          return (
            <g key={building.id} className={`local-map__building-wrap${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "building", building }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "building", building })) : undefined}>
              <rect x={x + .9} y={y + 1.05} width={width} height={height} rx=".8" className="local-map__building-shadow" />
              <rect x={x} y={y} width={width} height={height} rx=".8" className={`local-map__building local-map__building--${building.use}`} filter={`url(#building-shadow-${sector.id})`} />
              <rect x={x + .42} y={y + .42} width={Math.max(.25, width - .84)} height={Math.max(.25, height - .84)} rx=".55" fill={`url(#roof-grid-${sector.id})`} className="local-map__roof-grid" />
              {camera.zoom >= 2.25 && width > 2.5 && height > 2.5 ? <g className="local-map__roof-details" aria-hidden="true"><rect x={x + width * .16} y={y + height * .17} width={Math.max(.45, width * .18)} height={Math.max(.35, height * .13)} rx=".2"/><rect x={x + width * (.54 + (seed % 11) / 100)} y={y + height * .58} width={Math.max(.45, width * .21)} height={Math.max(.35, height * .14)} rx=".2"/></g> : null}
              {active ? <rect x={x - .45} y={y - .45} width={width + .9} height={height + .9} rx="1.15" className="local-map__building-selection" /> : null}
              {showLabel ? <text className="local-map__building-label" x={x + width / 2} y={y + height / 2} textAnchor="middle">{building.streetNumber ?? `${building.floors}F`}</text> : null}
            </g>
          );
        })}

        {showEntrances ? topology.buildingEntrances.filter((entrance) => entrance.buildingId === selectedBuildingId).map((entrance) => <g key={entrance.id} className={`local-map__entrance local-map__entrance--${entrance.kind}`}><line x1={toX(entrance.xM)} y1={toY(entrance.yM)} x2={toX(entrance.walkwayTo.xM)} y2={toY(entrance.walkwayTo.yM)} /><circle cx={toX(entrance.xM)} cy={toY(entrance.yM)} r=".8" /></g>) : null}

        {stops.map((stop) => {
          const active = selectedKey === `stop:${stop.id}`;
          if (!active && camera.zoom < 1.65 && stop.mode !== "metro") return null;
          return <g key={stop.id} transform={`translate(${toX(stop.xM)} ${toY(stop.yM)})`} className={`local-map__stop local-map__stop--${stop.mode}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "stop", stop }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "stop", stop })) : undefined}><circle r={camera.zoom < 1.6 ? 1.75 : 2.2} /><text textAnchor="middle" y=".7">{stop.mode === "metro" ? "M" : "B"}</text></g>;
        })}

        {visibleLocations.map(({ location, placement }) => {
          const x = toX(placement.bounds.xM + placement.bounds.widthM / 2); const y = toY(placement.bounds.yM + placement.bounds.heightM / 2);
          const active = selectedKey === `location:${location.id}`;
          const showLabel = active || camera.zoom >= 3.55;
          const markerScale = camera.zoom < 1.55 ? .78 : 1;
          return (
            <g key={location.id} className={`local-map__poi local-map__poi--${location.type}${active ? " is-selected" : ""}`} transform={`translate(${x} ${y}) scale(${markerScale})`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "location", location }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "location", location })) : undefined}>
              <path d="M0-4.2 3.4-2.1 3.4 2.1 0 4.2-3.4 2.1-3.4-2.1z" filter={`url(#map-glow-${sector.id})`} /><text textAnchor="middle" y="1.15">{PLACE_ICONS[location.type]}</text>{showLabel ? <g className="local-map__poi-label"><rect x="-9.5" y="5" width="19" height="4.2" rx="1.1"/><text textAnchor="middle" y="7.8">{location.name.slice(0, 20)}</text></g> : null}
            </g>
          );
        })}

        {showDynamicPeople ? (pedestrians.length ? pedestrians : actors.map((actor) => ({ id: actor.id, actorId: actor.id, segmentId: "", xM: actor.position.xM, yM: actor.position.yM, headingDeg: 0, speedMPerMinute: 0, motion: "waiting" as const, sidewalkSide: "left" as const, updatedAt: session.timestamp }))).map((pedestrian) => {
          const actor = actors.find((item) => item.id === pedestrian.actorId) ?? session.localScene.actors.find((item) => item.id === pedestrian.actorId);
          if (!actor) return null;
          const active = selectedKey === `actor:${actor.id}`;
          return <g key={pedestrian.id} transform={`translate(${toX(pedestrian.xM)} ${toY(pedestrian.yM)}) rotate(${pedestrian.headingDeg})`} className={`local-map__actor local-map__actor--${pedestrian.motion}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); onSelect({ kind: "actor", actor }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "actor", actor })) : undefined}><circle r="1.35"/><path d="M0-.8v1.55M-.8.1 0-.45.8.1M-.55 1.45 0 .75.55 1.45"/><path className="local-map__actor-direction" d="M0-2.55.85-1.65H-.85z"/>{active || camera.zoom >= 4.6 ? <text transform={`rotate(${-pedestrian.headingDeg})`} x="2.35" y=".55">{Math.round(actor.distanceToPlayerM)}м</text> : null}</g>;
        }) : null}

        {showDynamicCars ? (traffic.length ? traffic : vehicles.map((vehicle) => ({ id: vehicle.id, vehicleId: vehicle.id, xM: vehicle.position.xM, yM: vehicle.position.yM, headingDeg: 0, speedKph: 0, laneIndex: 0, motion: "parked" as const, brakeLights: false, updatedAt: session.timestamp }))).map((streetVehicle) => {
          const vehicle = vehicles.find((item) => item.id === streetVehicle.vehicleId) ?? session.vehicles.vehicles.find((item) => item.id === streetVehicle.vehicleId);
          if (!vehicle) return null;
          const active = selectedKey === `vehicle:${vehicle.id}`;
          return <g key={streetVehicle.id} transform={`translate(${toX(streetVehicle.xM)} ${toY(streetVehicle.yM)}) rotate(${streetVehicle.headingDeg})`} className={`local-map__vehicle local-map__vehicle--${streetVehicle.motion}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); onSelect({ kind: "vehicle", vehicle }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "vehicle", vehicle })) : undefined}><rect x="-1.9" y="-.9" width="3.8" height="1.8" rx=".5"/><path className="local-map__vehicle-windshield" d="M-.65-.68H.9l.55.5H-1.2z"/><circle cx="-1.05" cy=".95" r=".3"/><circle cx="1.05" cy=".95" r=".3"/>{streetVehicle.brakeLights ? <path className="local-map__brake-lights" d="M-1.75-.55v1.1M1.75-.55v1.1"/> : null}{active || camera.zoom >= 4.8 ? <text transform={`rotate(${-streetVehicle.headingDeg})`} x="2.55" y=".55">{streetVehicle.speedKph ? `${Math.round(streetVehicle.speedKph)}км/ч` : `${Math.round(vehicle.distanceToPlayerM)}м`}</text> : null}</g>;
        }) : null}

        {incidents.filter((incident) => incident.status !== "resolved").map((incident) => {
          const active = selectedKey === `incident:${incident.id}`;
          return <g key={incident.id} transform={`translate(${toX(incident.xM)} ${toY(incident.yM)})`} className={`local-map__incident local-map__incident--${incident.type} local-map__incident--${incident.status}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); onSelect({ kind: "incident", incident }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "incident", incident })) : undefined}><circle className="local-map__incident-pulse" r="4.4"/><path d="M0-3.6 3.25-1.8 3.25 1.8 0 3.6-3.25 1.8-3.25-1.8z"/><text textAnchor="middle" y="1.05">!</text>{active || camera.zoom >= 3.65 ? <g className="local-map__incident-label"><rect x="-10.5" y="4.7" width="21" height="4.1" rx="1.1"/><text textAnchor="middle" y="7.5">{incident.title.slice(0, 21)}</text></g> : null}</g>;
        })}

        {route?.points.length ? <g className="local-map__route" aria-hidden="true"><polyline className="local-map__route-base" points={route.points.map((point) => `${toX(point.xM)},${toY(point.yM)}`).join(" ")} /><polyline className="local-map__route-remaining" points={remainingRoutePoints.map((point) => `${toX(point.xM)},${toY(point.yM)}`).join(" ")} /><circle className="local-map__route-target" cx={toX(route.target.xM)} cy={toY(route.target.yM)} r="1.9" /></g> : null}
        {selected?.kind === "point" && Math.hypot(selected.xM - player.xM, selected.yM - player.yM) > 8 ? <g transform={`translate(${toX(selected.xM)} ${toY(selected.yM)})`} className="local-map__point"><circle r="2.25" /><path d="M0-4.1 2.5-.7 0 3.2-2.5-.7z" /></g> : null}
        {playerInSector ? <g transform={`translate(${playerX} ${playerY})`} className="local-map__player" filter={`url(#map-glow-${sector.id})`}><circle className="local-map__player-ring" r="2.55" /><circle className="local-map__player-core" r=".85" /><path d="M0-2.9 1.05-1.3H-1.05z" /></g> : null}
      </svg>

      {!topology.segments.length ? <p className="local-map__empty">Уличная топология сектора недоступна.</p> : null}
      <div className="map-controls"><button type="button" aria-label="Приблизить" disabled={camera.zoom >= 7} onClick={() => applyZoom(camera.zoom + .5)}>＋</button><button type="button" aria-label="Отдалить" disabled={camera.zoom <= 1} onClick={() => applyZoom(camera.zoom - .5)}>−</button><button type="button" aria-label="Показать весь сектор" onClick={() => setCamera({ zoom: 1, centerX: 50, centerY: 50 })}>⌖</button></div>
      <div className="local-map__scale">≈ {visibleMeters} м · {camera.zoom.toFixed(1)}×</div>
    </div>
  );
}
