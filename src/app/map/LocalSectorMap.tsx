import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { MetropolitanSectorState, MetricBounds } from "../../simulation/spatial/types";
import type { LocalActorState } from "../../simulation/localScene/types";
import type { BuildingState, VenueState } from "../../simulation/urban/types";
import type { PhysicalVehicleEntityState } from "../../simulation/vehicles/types";
import type { StreetSegmentState } from "../../simulation/streets/types";
import type { LocalMovementState } from "../../simulation/localMovement/types";
import type { StreetCrossingState, StreetIncidentState, StreetPedestrianState, StreetTrafficState } from "../../simulation/streetScene/types";
import { getSectorStreetTopology } from "../../simulation/streets/streetTopologySystem";
import { PLACE_ICONS } from "../shared/presentation";

interface CameraState { zoom: number; centerX: number; centerY: number }
interface Point { x: number; y: number }
interface PinchState { distance: number; zoom: number; centerX: number; centerY: number }
interface PositionedVenue { venue: VenueState; building: BuildingState; xM: number; yM: number }

export type LocalMapSelection =
  | { kind: "location"; location: LocationState }
  | { kind: "venue"; venue: VenueState }
  | { kind: "building"; building: BuildingState }
  | { kind: "stop"; stop: GameSession["transit"]["stops"][number] }
  | { kind: "street"; segment: StreetSegmentState }
  | { kind: "actor"; actor: LocalActorState }
  | { kind: "vehicle"; vehicle: PhysicalVehicleEntityState }
  | { kind: "incident"; incident: StreetIncidentState }
  | { kind: "point"; xM: number; yM: number };

const VENUE_ICONS: Record<VenueState["category"], string> = {
  convenience: "▤",
  food: "♨",
  bar: "◆",
  pharmacy: "+",
  clinic: "✚",
  repair: "⚒",
  cyberware: "◈",
  clothing: "◇",
  entertainment: "✦",
  hotel: "▥",
  "office-service": "▣",
  market: "▤"
};

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function pointDistance(left: Point, right: Point): number { return Math.hypot(left.x - right.x, left.y - right.y); }
function distanceToBounds(point: Point, bounds: MetricBounds): number {
  const x = clamp(point.x, bounds.xM, bounds.xM + bounds.widthM);
  const y = clamp(point.y, bounds.yM, bounds.yM + bounds.heightM);
  return Math.hypot(point.x - x, point.y - y);
}
function pointSegmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= .0001) return pointDistance(point, from);
  const ratio = clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared, 0, 1);
  return pointDistance(point, { x: from.x + dx * ratio, y: from.y + dy * ratio });
}
function selectionKey(selection: LocalMapSelection | null): string | null {
  if (!selection) return null;
  if (selection.kind === "point") return `point:${Math.round(selection.xM)}:${Math.round(selection.yM)}`;
  if (selection.kind === "location") return `location:${selection.location.id}`;
  if (selection.kind === "venue") return `venue:${selection.venue.id}`;
  if (selection.kind === "building") return `building:${selection.building.id}`;
  if (selection.kind === "stop") return `stop:${selection.stop.id}`;
  if (selection.kind === "actor") return `actor:${selection.actor.id}`;
  if (selection.kind === "vehicle") return `vehicle:${selection.vehicle.id}`;
  if (selection.kind === "incident") return `incident:${selection.incident.id}`;
  return `street:${selection.segment.id}`;
}

export function LocalSectorMap({
  session,
  sector,
  selected,
  route,
  locationFilter,
  showStops = true,
  venues = [],
  actors = [],
  vehicles = [],
  pedestrians = [],
  traffic = [],
  incidents = [],
  policeResponses = [],
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
  venues?: VenueState[];
  actors?: LocalActorState[];
  vehicles?: PhysicalVehicleEntityState[];
  pedestrians?: StreetPedestrianState[];
  traffic?: StreetTrafficState[];
  incidents?: StreetIncidentState[];
  policeResponses?: GameSession["playerCrime"]["policeResponses"];
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

  const buildings = useMemo(() => session.urban.buildings.filter((building) => building.sectorId === sector.id), [sector.id, session.urban.buildings]);
  const buildingById = useMemo(() => new Map(buildings.map((building) => [building.id, building])), [buildings]);
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
  const anchorVenueLocationIds = useMemo(() => new Set(venues.flatMap((venue) => venue.anchorLocationId ? [venue.anchorLocationId] : [])), [venues]);
  const locations = useMemo(() => session.metropolitan.locations
    .filter((placement) => placement.sectorId === sector.id && !anchorVenueLocationIds.has(placement.locationId))
    .flatMap((placement) => {
      const location = session.world.locations.find((item) => item.id === placement.locationId);
      return location && (!locationFilter || locationFilter(location)) ? [{ location, placement }] : [];
    }), [anchorVenueLocationIds, locationFilter, sector.id, session.metropolitan.locations, session.world.locations]);
  const stops = useMemo(() => showStops ? session.transit.stops.filter((stop) => stop.sectorId === sector.id) : [], [sector.id, session.transit.stops, showStops]);
  const selectedKey = selectionKey(selected);

  const positionedVenues = useMemo<PositionedVenue[]>(() => {
    const grouped = new Map<string, VenueState[]>();
    for (const venue of venues.filter((item) => item.sectorId === sector.id && item.active)) {
      const local = grouped.get(venue.buildingId) ?? [];
      local.push(venue);
      grouped.set(venue.buildingId, local);
    }
    return [...grouped.entries()].flatMap(([buildingId, local]) => {
      const building = buildingById.get(buildingId);
      if (!building) return [];
      return local.sort((left, right) => right.mapPriority - left.mapPriority).map((venue, index) => {
        const columns = Math.min(3, local.length);
        const column = index % columns;
        const row = Math.floor(index / columns);
        const spacing = Math.min(16, Math.max(7, building.bounds.widthM / Math.max(2, columns + 1)));
        return {
          venue,
          building,
          xM: building.bounds.xM + building.bounds.widthM / 2 + (column - (columns - 1) / 2) * spacing,
          yM: building.bounds.yM + Math.min(building.bounds.heightM * .72, 12 + row * 11)
        };
      });
    });
  }, [buildingById, sector.id, venues]);
  const venueLimit = camera.zoom < 1.35 ? 14 : camera.zoom < 2.4 ? 30 : 60;
  const renderedVenues = useMemo(() => positionedVenues
    .sort((left, right) => Number(selectedKey === `venue:${right.venue.id}`) - Number(selectedKey === `venue:${left.venue.id}`) || right.venue.mapPriority - left.venue.mapPriority)
    .slice(0, venueLimit), [positionedVenues, selectedKey, venueLimit]);

  useEffect(() => {
    if (!focusRevision) return;
    let point: { xM: number; yM: number } | null = null;
    if (selected?.kind === "venue") {
      const positioned = positionedVenues.find((item) => item.venue.id === selected.venue.id);
      const building = buildingById.get(selected.venue.buildingId);
      point = positioned ? { xM: positioned.xM, yM: positioned.yM } : building ? { xM: building.bounds.xM + building.bounds.widthM / 2, yM: building.bounds.yM + building.bounds.heightM / 2 } : null;
    } else if (selected?.kind === "building") point = { xM: selected.building.bounds.xM + selected.building.bounds.widthM / 2, yM: selected.building.bounds.yM + selected.building.bounds.heightM / 2 };
    else if (selected?.kind === "location") {
      const placement = session.metropolitan.locations.find((item) => item.locationId === selected.location.id);
      if (placement) point = { xM: placement.bounds.xM + placement.bounds.widthM / 2, yM: placement.bounds.yM + placement.bounds.heightM / 2 };
    } else if (selected?.kind === "stop") point = { xM: selected.stop.xM, yM: selected.stop.yM };
    else if (selected?.kind === "actor") point = { xM: selected.actor.position.xM, yM: selected.actor.position.yM };
    else if (selected?.kind === "vehicle") point = { xM: selected.vehicle.position.xM, yM: selected.vehicle.position.yM };
    else if (selected?.kind === "incident") point = { xM: selected.incident.xM, yM: selected.incident.yM };
    else if (selected?.kind === "point") point = { xM: selected.xM, yM: selected.yM };
    if (!point && session.localScene.playerPosition.sectorId === sector.id) point = { xM: session.localScene.playerPosition.xM, yM: session.localScene.playerPosition.yM };
    if (!point) return;
    const x = (point.xM - sector.bounds.xM) / sector.bounds.widthM * 100;
    const y = (point.yM - sector.bounds.yM) / sector.bounds.heightM * 100;
    setCamera((current) => ({ ...current, zoom: Math.max(current.zoom, 2.2), centerX: clamp(x, 12, 88), centerY: clamp(y, 12, 88) }));
  }, [focusRevision, sector.id, selectedKey]);

  const size = 100 / camera.zoom;
  const viewX = clamp(camera.centerX - size / 2, 0, 100 - size);
  const viewY = clamp(camera.centerY - size / 2, 0, 100 - size);
  const player = session.localScene.playerPosition;
  const playerInSector = player.sectorId === sector.id;
  const playerX = clamp((player.xM - sector.bounds.xM) / sector.bounds.widthM * 100, 0, 100);
  const playerY = clamp((player.yM - sector.bounds.yM) / sector.bounds.heightM * 100, 0, 100);
  const remainingRoutePoints = route ? [{ xM: player.xM, yM: player.yM }, ...route.points.slice(Math.min(route.currentLegIndex + 1, route.points.length))] : [];

  function toX(xM: number): number { return (xM - sector.bounds.xM) / sector.bounds.widthM * 100; }
  function toY(yM: number): number { return (yM - sector.bounds.yM) / sector.bounds.heightM * 100; }
  function applyZoom(nextZoom: number): void {
    setCamera((current) => {
      const zoom = clamp(nextZoom, 1, 7);
      const nextSize = 100 / zoom;
      return { zoom, centerX: clamp(current.centerX, nextSize / 2, 100 - nextSize / 2), centerY: clamp(current.centerY, nextSize / 2, 100 - nextSize / 2) };
    });
  }
  function localCoordinates(clientX: number, clientY: number): { xM: number; yM: number } | null {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX; point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { xM: sector.bounds.xM + local.x / 100 * sector.bounds.widthM, yM: sector.bounds.yM + local.y / 100 * sector.bounds.heightM };
  }
  function hitRadiusM(): number {
    const width = svgRef.current?.getBoundingClientRect().width ?? 600;
    return clamp(sector.bounds.widthM / camera.zoom / Math.max(1, width) * 22, 10, 42);
  }
  function hitTest(point: { xM: number; yM: number }): LocalMapSelection {
    const radius = hitRadiusM();
    const closestIncident = incidents.filter((incident) => incident.status !== "resolved")
      .map((incident) => ({ incident, distance: Math.hypot(point.xM - incident.xM, point.yM - incident.yM) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (closestIncident && closestIncident.distance <= radius * .9) return { kind: "incident", incident: closestIncident.incident };

    const venueHit = renderedVenues.map((item) => ({ item, distance: Math.hypot(point.xM - item.xM, point.yM - item.yM) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (venueHit && venueHit.distance <= radius) return { kind: "venue", venue: venueHit.item.venue };

    const actorHits = actors.map((actor) => ({ actor, distance: Math.hypot(point.xM - actor.position.xM, point.yM - actor.position.yM) })).sort((left, right) => left.distance - right.distance);
    if (actorHits[0] && actorHits[0].distance <= radius * .7) return { kind: "actor", actor: actorHits[0].actor };
    const vehicleHits = vehicles.map((vehicle) => ({ vehicle, distance: Math.hypot(point.xM - vehicle.position.xM, point.yM - vehicle.position.yM) })).sort((left, right) => left.distance - right.distance);
    if (vehicleHits[0] && vehicleHits[0].distance <= radius * .85) return { kind: "vehicle", vehicle: vehicleHits[0].vehicle };
    const stopHits = stops.map((stop) => ({ stop, distance: Math.hypot(point.xM - stop.xM, point.yM - stop.yM) })).sort((left, right) => left.distance - right.distance);
    if (stopHits[0] && stopHits[0].distance <= radius) return { kind: "stop", stop: stopHits[0].stop };

    const buildingHits = buildings.map((building) => ({ building, distance: distanceToBounds({ x: point.xM, y: point.yM }, building.bounds), area: building.bounds.widthM * building.bounds.heightM }))
      .filter((item) => item.distance <= radius)
      .sort((left, right) => left.distance - right.distance || left.area - right.area);
    if (buildingHits[0]) return { kind: "building", building: buildingHits[0].building };

    const streetHits = roads.map(({ segment, from, to }) => ({
      segment,
      distance: pointSegmentDistance({ x: point.xM, y: point.yM }, { x: from.xM, y: from.yM }, { x: to.xM, y: to.yM })
    })).sort((left, right) => left.distance - right.distance);
    if (streetHits[0] && streetHits[0].distance <= radius * .8) return { kind: "street", segment: streetHits[0].segment };
    return { kind: "point", xM: Math.round(point.xM), yM: Math.round(point.yM) };
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
  function pointerUp(event: ReactPointerEvent<SVGSVGElement>): void {
    const wasPinch = pointers.current.size > 1;
    if (!wasPinch && moved.current <= 9 && onSelect) {
      const point = localCoordinates(event.clientX, event.clientY);
      if (point) onSelect(hitTest(point));
    }
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }
  function wheel(event: ReactWheelEvent<SVGSVGElement>): void { event.preventDefault(); applyZoom(camera.zoom + (event.deltaY > 0 ? -.4 : .4)); }

  return (
    <div className="local-map" data-no-swipe>
      <svg ref={svgRef} viewBox={`${viewX} ${viewY} ${size} ${size}`} role="img" aria-label={`Локальная карта сектора ${sector.code}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheel}>
        <defs>
          <pattern id={`sector-grid-${sector.id}`} width="2.5" height="2.5" patternUnits="userSpaceOnUse"><path d="M2.5 0H0V2.5" fill="none" stroke="rgba(147,162,189,.035)" strokeWidth=".12" /></pattern>
          <pattern id={`roof-grid-${sector.id}`} width="1.6" height="1.6" patternUnits="userSpaceOnUse"><path d="M0 .8H1.6M.8 0V1.6" stroke="rgba(255,255,255,.055)" strokeWidth=".08" /></pattern>
          <filter id={`map-glow-${sector.id}`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation=".75" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id={`building-shadow-${sector.id}`} x="-40%" y="-40%" width="200%" height="200%"><feDropShadow dx=".8" dy="1.1" stdDeviation=".65" floodColor="#000" floodOpacity=".72"/></filter>
        </defs>
        <rect className="local-map__hit" width="100" height="100" fill={`url(#sector-grid-${sector.id})`} />
        {topology.blocks.map((block) => <rect key={block.id} x={toX(block.bounds.xM)} y={toY(block.bounds.yM)} width={block.bounds.widthM / sector.bounds.widthM * 100} height={block.bounds.heightM / sector.bounds.heightM * 100} rx=".7" className={`local-map__block local-map__block--${block.landUse}`} />)}
        {camera.zoom >= 2.2 ? topology.parkingZones.map((zone) => <rect key={zone.id} x={toX(zone.bounds.xM)} y={toY(zone.bounds.yM)} width={Math.max(.25, zone.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.25, zone.bounds.heightM / sector.bounds.heightM * 100)} className="local-map__parking" />) : null}
        {roads.map(({ segment, from, to }) => {
          if (segment.class === "lane" && camera.zoom < 1.8) return null;
          const active = selectedKey === `street:${segment.id}`;
          const midpointX = (toX(from.xM) + toX(to.xM)) / 2;
          const midpointY = (toY(from.yM) + toY(to.yM)) / 2;
          const vertical = Math.abs(from.xM - to.xM) < Math.abs(from.yM - to.yM);
          return <g key={segment.id} className={`local-map__street local-map__street--${segment.class}${active ? " is-selected" : ""}`}><line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__road-glow"/><line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__sidewalk"/><line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__road"/>{camera.zoom >= 2.5 && (segment.class === "arterial" || segment.class === "collector") ? <text className="local-map__street-label" x={midpointX} y={midpointY} textAnchor="middle" transform={vertical ? `rotate(-90 ${midpointX} ${midpointY})` : undefined}>{segment.name}</text> : null}</g>;
        })}
        {camera.zoom >= 3 ? crossings.map((crossing) => <g key={crossing.id} transform={`translate(${toX(crossing.xM)} ${toY(crossing.yM)})`} className={`local-map__crossing local-map__crossing--${crossing.signal}`} aria-hidden="true"><rect x="-2.8" y="-1.25" width="5.6" height="2.5" rx=".4"/><path d="M-2.1-1v2M-1.05-1v2M0-1v2M1.05-1v2M2.1-1v2"/></g>) : null}
        {camera.zoom >= 1.55 ? topology.parcels.map((parcel) => <rect key={parcel.id} x={toX(parcel.bounds.xM)} y={toY(parcel.bounds.yM)} width={Math.max(.5, parcel.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.5, parcel.bounds.heightM / sector.bounds.heightM * 100)} rx=".35" className={`local-map__parcel local-map__parcel--${parcel.kind}`} />) : null}
        {buildings.map((building) => {
          const active = selectedKey === `building:${building.id}` || selected?.kind === "venue" && selected.venue.buildingId === building.id;
          const x = toX(building.bounds.xM); const y = toY(building.bounds.yM);
          const width = Math.max(1, building.bounds.widthM / sector.bounds.widthM * 100);
          const height = Math.max(1, building.bounds.heightM / sector.bounds.heightM * 100);
          return <g key={building.id} className={`local-map__building-wrap${active ? " is-selected" : ""}`}><rect x={x + .75} y={y + .85} width={width} height={height} rx=".7" className="local-map__building-shadow"/><rect x={x} y={y} width={width} height={height} rx=".7" className={`local-map__building local-map__building--${building.use}`} filter={`url(#building-shadow-${sector.id})`}/><rect x={x + .35} y={y + .35} width={Math.max(.3, width - .7)} height={Math.max(.3, height - .7)} rx=".45" fill={`url(#roof-grid-${sector.id})`} className="local-map__roof-grid"/>{camera.zoom >= 2.8 ? <text className="local-map__building-label" x={x + width / 2} y={y + height / 2} textAnchor="middle">{building.streetNumber ?? `${building.floors}F`}</text> : null}</g>;
        })}
        {selected && (selected.kind === "building" || selected.kind === "venue") && camera.zoom >= 1.7 ? topology.buildingEntrances.filter((entrance) => entrance.buildingId === (selected.kind === "building" ? selected.building.id : selected.venue.buildingId)).map((entrance) => <g key={entrance.id} className={`local-map__entrance local-map__entrance--${entrance.kind}`}><line x1={toX(entrance.xM)} y1={toY(entrance.yM)} x2={toX(entrance.walkwayTo.xM)} y2={toY(entrance.walkwayTo.yM)}/><circle cx={toX(entrance.xM)} cy={toY(entrance.yM)} r=".72"/></g>) : null}
        {stops.map((stop) => <g key={stop.id} transform={`translate(${toX(stop.xM)} ${toY(stop.yM)})`} className={`local-map__stop local-map__stop--${stop.mode}${selectedKey === `stop:${stop.id}` ? " is-selected" : ""}`}><circle r="2.5"/><text textAnchor="middle" y=".85">{stop.mode === "metro" ? "M" : "B"}</text></g>)}
        {locations.map(({ location, placement }) => <g key={location.id} className={`local-map__poi local-map__poi--${location.type}${selectedKey === `location:${location.id}` ? " is-selected" : ""}`} transform={`translate(${toX(placement.bounds.xM + placement.bounds.widthM / 2)} ${toY(placement.bounds.yM + placement.bounds.heightM / 2)})`}><path d="M0-4.5 3.8-2.2 3.8 2.2 0 4.5-3.8 2.2-3.8-2.2z" filter={`url(#map-glow-${sector.id})`}/><text textAnchor="middle" y="1.25">{PLACE_ICONS[location.type]}</text></g>)}
        {renderedVenues.map(({ venue, xM, yM }) => {
          const active = selectedKey === `venue:${venue.id}`;
          return <g key={venue.id} className={`local-map__venue local-map__venue--${venue.category}${active ? " is-selected" : ""}`} transform={`translate(${toX(xM)} ${toY(yM)})`}><circle className="local-map__venue-halo" r={active ? "5.2" : "4.1"}/><path d="M0-3.7 3.2-1.8 3.2 1.8 0 3.7-3.2 1.8-3.2-1.8z"/><text textAnchor="middle" y="1.1">{VENUE_ICONS[venue.category]}</text>{active || camera.zoom >= 2.2 && venue.mapPriority >= 65 ? <g className="local-map__venue-label"><rect x="-10" y="4.8" width="20" height="4.2" rx="1"/><text textAnchor="middle" y="7.7">{venue.name.slice(0, 20)}</text></g> : null}</g>;
        })}
        {camera.zoom >= 3.2 ? (pedestrians.length ? pedestrians : actors.map((actor) => ({ id: actor.id, actorId: actor.id, segmentId: "", xM: actor.position.xM, yM: actor.position.yM, headingDeg: 0, speedMPerMinute: 0, motion: "waiting" as const, sidewalkSide: "left" as const, updatedAt: session.timestamp }))).map((pedestrian) => {
          const actor = actors.find((item) => item.id === pedestrian.actorId) ?? session.localScene.actors.find((item) => item.id === pedestrian.actorId);
          return actor ? <g key={pedestrian.id} transform={`translate(${toX(pedestrian.xM)} ${toY(pedestrian.yM)}) rotate(${pedestrian.headingDeg})`} className={`local-map__actor local-map__actor--${pedestrian.motion}${selectedKey === `actor:${actor.id}` ? " is-selected" : ""}`}><circle r="1.7"/><path d="M0-1v2M-1 .15 0-.55 1 .15M-.7 1.7 0 .9.7 1.7"/></g> : null;
        }) : null}
        {camera.zoom >= 3.2 ? (traffic.length ? traffic : vehicles.map((vehicle) => ({ id: vehicle.id, vehicleId: vehicle.id, xM: vehicle.position.xM, yM: vehicle.position.yM, headingDeg: 0, speedKph: 0, laneIndex: 0, motion: "parked" as const, brakeLights: false, updatedAt: session.timestamp }))).map((streetVehicle) => {
          const vehicle = vehicles.find((item) => item.id === streetVehicle.vehicleId) ?? session.vehicles.vehicles.find((item) => item.id === streetVehicle.vehicleId);
          return vehicle ? <g key={streetVehicle.id} transform={`translate(${toX(streetVehicle.xM)} ${toY(streetVehicle.yM)}) rotate(${streetVehicle.headingDeg})`} className={`local-map__vehicle local-map__vehicle--${streetVehicle.motion}${selectedKey === `vehicle:${vehicle.id}` ? " is-selected" : ""}`}><rect x="-2.4" y="-1.15" width="4.8" height="2.3" rx=".65"/><path className="local-map__vehicle-windshield" d="M-.8-.85H1.1l.7.65H-1.5z"/><circle cx="-1.35" cy="1.2" r=".4"/><circle cx="1.35" cy="1.2" r=".4"/>{streetVehicle.brakeLights ? <path className="local-map__brake-lights" d="M-2.25-.72v1.44M2.25-.72v1.44"/> : null}</g> : null;
        }) : null}
        {policeResponses.filter((response) => response.status !== "resolved").map((response) => <g key={response.id} transform={`translate(${toX(response.currentX)} ${toY(response.currentY)})`} className={`local-map__police-response local-map__police-response--${response.status}`}><circle className="local-map__police-pulse" r="4.6"/><rect x="-2.7" y="-1.45" width="5.4" height="2.9" rx=".7"/><path d="M-1.3-.85H1.1l.8.7h-3.8z"/><text textAnchor="middle" y="4.4">{response.unitCode}</text></g>)}
        {incidents.filter((incident) => incident.status !== "resolved").map((incident) => <g key={incident.id} transform={`translate(${toX(incident.xM)} ${toY(incident.yM)})`} className={`local-map__incident local-map__incident--${incident.type}${selectedKey === `incident:${incident.id}` ? " is-selected" : ""}`}><circle className="local-map__incident-pulse" r="5"/><path d="M0-4 3.7-2 3.7 2 0 4-3.7 2-3.7-2z"/><text textAnchor="middle" y="1.2">!</text></g>)}
        {route?.points.length ? <g className="local-map__route" aria-hidden="true"><polyline className="local-map__route-base" points={route.points.map((point) => `${toX(point.xM)},${toY(point.yM)}`).join(" ")}/><polyline className="local-map__route-remaining" points={remainingRoutePoints.map((point) => `${toX(point.xM)},${toY(point.yM)}`).join(" ")}/><circle className="local-map__route-target" cx={toX(route.target.xM)} cy={toY(route.target.yM)} r="2.2"/></g> : null}
        {selected?.kind === "point" ? <g transform={`translate(${toX(selected.xM)} ${toY(selected.yM)})`} className="local-map__point"><circle r="2.8"/><path d="M0-5 3.2-.8 0 4-3.2-.8z"/></g> : null}
        {playerInSector ? <g transform={`translate(${playerX} ${playerY})`} className="local-map__player" filter={`url(#map-glow-${sector.id})`}><circle r="3.2"/><path d="M0-1.9 1.7 1.6 0 .8-1.7 1.6z"/></g> : null}
      </svg>
      {!topology.segments.length ? <p className="local-map__empty">Уличная топология сектора недоступна.</p> : null}
      <div className="map-controls"><button type="button" aria-label="Приблизить" disabled={camera.zoom >= 7} onClick={() => applyZoom(camera.zoom + .5)}>＋</button><button type="button" aria-label="Отдалить" disabled={camera.zoom <= 1} onClick={() => applyZoom(camera.zoom - .5)}>−</button><button type="button" aria-label="Показать весь сектор" onClick={() => setCamera({ zoom: 1, centerX: 50, centerY: 50 })}>⌖</button></div>
      <div className="local-map__scale">{camera.zoom.toFixed(1)}× · {buildings.length} зданий · {venues.length} заведений</div>
    </div>
  );
}
