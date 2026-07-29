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
    setCamera((current) => ({ ...current, zoom: Math.max(current.zoom, 2.2), centerX: clamp(x, 12, 88), centerY: clamp(y, 12, 88) }));
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
    }), [locationFilter, sector.id, session.metropolitan.locations, session.world.locations]);
  const stops = useMemo(() => showStops ? session.transit.stops.filter((stop) => stop.sectorId === sector.id) : [], [sector.id, session.transit.stops, showStops]);
  const selectedKey = selectionKey(selected);

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
    <div className="local-map" data-no-swipe>
      <svg ref={svgRef} viewBox={`${viewX} ${viewY} ${size} ${size}`} role="img" aria-label={`Локальная карта сектора ${sector.code}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheel}>
        <defs>
          <pattern id={`sector-grid-${sector.id}`} width="2.5" height="2.5" patternUnits="userSpaceOnUse"><path d="M2.5 0H0V2.5" fill="none" stroke="rgba(147,162,189,.055)" strokeWidth=".18" /></pattern>
          <pattern id={`roof-grid-${sector.id}`} width="1.6" height="1.6" patternUnits="userSpaceOnUse"><path d="M0 .8H1.6M.8 0V1.6" stroke="rgba(255,255,255,.055)" strokeWidth=".08" /></pattern>
          <filter id={`map-glow-${sector.id}`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation=".75" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id={`building-shadow-${sector.id}`} x="-40%" y="-40%" width="200%" height="200%"><feDropShadow dx=".8" dy="1.1" stdDeviation=".65" floodColor="#000" floodOpacity=".72"/></filter>
        </defs>
        <rect className="local-map__hit" width="100" height="100" fill={`url(#sector-grid-${sector.id})`} onClick={onSelect ? selectPoint : undefined} />

        {topology.blocks.map((block) => <rect key={block.id} x={toX(block.bounds.xM)} y={toY(block.bounds.yM)} width={block.bounds.widthM / sector.bounds.widthM * 100} height={block.bounds.heightM / sector.bounds.heightM * 100} rx=".7" className={`local-map__block local-map__block--${block.landUse}`} />)}
        {topology.parkingZones.map((zone) => <rect key={zone.id} x={toX(zone.bounds.xM)} y={toY(zone.bounds.yM)} width={Math.max(.25, zone.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.25, zone.bounds.heightM / sector.bounds.heightM * 100)} className="local-map__parking" />)}

        {roads.map(({ segment, from, to }) => {
          const active = selectedKey === `street:${segment.id}`;
          const midpointX = (toX(from.xM) + toX(to.xM)) / 2;
          const midpointY = (toY(from.yM) + toY(to.yM)) / 2;
          const vertical = Math.abs(from.xM - to.xM) < Math.abs(from.yM - to.yM);
          return (
            <g key={segment.id} className={`local-map__street local-map__street--${segment.class}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "street", segment }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "street", segment })) : undefined}>
              <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__road-glow" />
              <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__sidewalk" />
              <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__road" />
              {camera.zoom >= 2.2 && (segment.class === "arterial" || segment.class === "collector") ? <text className="local-map__street-label" x={midpointX} y={midpointY} textAnchor="middle" transform={vertical ? `rotate(-90 ${midpointX} ${midpointY})` : undefined}>{segment.name}</text> : null}
            </g>
          );
        })}

        {crossings.map((crossing) => <g key={crossing.id} transform={`translate(${toX(crossing.xM)} ${toY(crossing.yM)})`} className={`local-map__crossing local-map__crossing--${crossing.signal}`} aria-hidden="true"><rect x="-2.8" y="-1.25" width="5.6" height="2.5" rx=".4"/><path d="M-2.1-1v2M-1.05-1v2M0-1v2M1.05-1v2M2.1-1v2"/></g>)}

        {topology.parcels.map((parcel) => <rect key={parcel.id} x={toX(parcel.bounds.xM)} y={toY(parcel.bounds.yM)} width={Math.max(.5, parcel.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.5, parcel.bounds.heightM / sector.bounds.heightM * 100)} rx=".35" className={`local-map__parcel local-map__parcel--${parcel.kind}`} />)}

        {buildings.map((building) => {
          const active = selectedKey === `building:${building.id}`;
          const x = toX(building.bounds.xM); const y = toY(building.bounds.yM);
          const width = Math.max(1, building.bounds.widthM / sector.bounds.widthM * 100);
          const height = Math.max(1, building.bounds.heightM / sector.bounds.heightM * 100);
          return (
            <g key={building.id} className={`local-map__building-wrap${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "building", building }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "building", building })) : undefined}>
              <rect x={x + .75} y={y + .85} width={width} height={height} rx=".7" className="local-map__building-shadow" />
              <rect x={x} y={y} width={width} height={height} rx=".7" className={`local-map__building local-map__building--${building.use}`} filter={`url(#building-shadow-${sector.id})`} />
              <rect x={x + .35} y={y + .35} width={Math.max(.3, width - .7)} height={Math.max(.3, height - .7)} rx=".45" fill={`url(#roof-grid-${sector.id})`} className="local-map__roof-grid" />
              {camera.zoom >= 2.7 ? <text className="local-map__building-label" x={x + width / 2} y={y + height / 2} textAnchor="middle">{building.streetNumber ?? `${building.floors}F`}</text> : null}
            </g>
          );
        })}

        {topology.buildingEntrances.map((entrance) => <g key={entrance.id} className={`local-map__entrance local-map__entrance--${entrance.kind}`}><line x1={toX(entrance.xM)} y1={toY(entrance.yM)} x2={toX(entrance.walkwayTo.xM)} y2={toY(entrance.walkwayTo.yM)} /><circle cx={toX(entrance.xM)} cy={toY(entrance.yM)} r=".72" /></g>)}

        {stops.map((stop) => {
          const active = selectedKey === `stop:${stop.id}`;
          return <g key={stop.id} transform={`translate(${toX(stop.xM)} ${toY(stop.yM)})`} className={`local-map__stop local-map__stop--${stop.mode}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "stop", stop }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "stop", stop })) : undefined}><circle r="2.5" /><text textAnchor="middle" y=".85">{stop.mode === "metro" ? "M" : "B"}</text></g>;
        })}

        {locations.map(({ location, placement }) => {
          const x = toX(placement.bounds.xM + placement.bounds.widthM / 2); const y = toY(placement.bounds.yM + placement.bounds.heightM / 2);
          const active = selectedKey === `location:${location.id}`;
          return (
            <g key={location.id} className={`local-map__poi local-map__poi--${location.type}${active ? " is-selected" : ""}`} transform={`translate(${x} ${y})`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "location", location }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "location", location })) : undefined}>
              <path d="M0-4.5 3.8-2.2 3.8 2.2 0 4.5-3.8 2.2-3.8-2.2z" filter={`url(#map-glow-${sector.id})`} /><text textAnchor="middle" y="1.25">{PLACE_ICONS[location.type]}</text>{active || camera.zoom >= 3.2 ? <g className="local-map__poi-label"><rect x="-9" y="5.5" width="18" height="4" rx="1.2"/><text textAnchor="middle" y="8.25">{location.name.slice(0, 18)}</text></g> : null}
            </g>
          );
        })}

        {(pedestrians.length ? pedestrians : actors.map((actor) => ({ id: actor.id, actorId: actor.id, segmentId: "", xM: actor.position.xM, yM: actor.position.yM, headingDeg: 0, speedMPerMinute: 0, motion: "waiting" as const, sidewalkSide: "left" as const, updatedAt: session.timestamp }))).map((pedestrian) => {
          const actor = actors.find((item) => item.id === pedestrian.actorId) ?? session.localScene.actors.find((item) => item.id === pedestrian.actorId);
          if (!actor) return null;
          const active = selectedKey === `actor:${actor.id}`;
          return <g key={pedestrian.id} transform={`translate(${toX(pedestrian.xM)} ${toY(pedestrian.yM)}) rotate(${pedestrian.headingDeg})`} className={`local-map__actor local-map__actor--${pedestrian.motion}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); onSelect({ kind: "actor", actor }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "actor", actor })) : undefined}><circle r="1.7"/><path d="M0-1v2M-1 .15 0-.55 1 .15M-.7 1.7 0 .9.7 1.7"/><path className="local-map__actor-direction" d="M0-3 1.1-1.9H-1.1z"/>{active || camera.zoom >= 3.8 ? <text transform={`rotate(${-pedestrian.headingDeg})`} x="2.7" y=".7">{Math.round(actor.distanceToPlayerM)}м</text> : null}</g>;
        })}

        {(traffic.length ? traffic : vehicles.map((vehicle) => ({ id: vehicle.id, vehicleId: vehicle.id, xM: vehicle.position.xM, yM: vehicle.position.yM, headingDeg: 0, speedKph: 0, laneIndex: 0, motion: "parked" as const, brakeLights: false, updatedAt: session.timestamp }))).map((streetVehicle) => {
          const vehicle = vehicles.find((item) => item.id === streetVehicle.vehicleId) ?? session.vehicles.vehicles.find((item) => item.id === streetVehicle.vehicleId);
          if (!vehicle) return null;
          const active = selectedKey === `vehicle:${vehicle.id}`;
          return <g key={streetVehicle.id} transform={`translate(${toX(streetVehicle.xM)} ${toY(streetVehicle.yM)}) rotate(${streetVehicle.headingDeg})`} className={`local-map__vehicle local-map__vehicle--${streetVehicle.motion}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); onSelect({ kind: "vehicle", vehicle }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "vehicle", vehicle })) : undefined}><rect x="-2.4" y="-1.15" width="4.8" height="2.3" rx=".65"/><path className="local-map__vehicle-windshield" d="M-.8-.85H1.1l.7.65H-1.5z"/><circle cx="-1.35" cy="1.2" r=".4"/><circle cx="1.35" cy="1.2" r=".4"/>{streetVehicle.brakeLights ? <path className="local-map__brake-lights" d="M-2.25-.72v1.44M2.25-.72v1.44"/> : null}{active || camera.zoom >= 4 ? <text transform={`rotate(${-streetVehicle.headingDeg})`} x="3.1" y=".7">{streetVehicle.speedKph ? `${Math.round(streetVehicle.speedKph)}км/ч` : `${Math.round(vehicle.distanceToPlayerM)}м`}</text> : null}</g>;
        })}

        {incidents.filter((incident) => incident.status !== "resolved").map((incident) => {
          const active = selectedKey === `incident:${incident.id}`;
          return <g key={incident.id} transform={`translate(${toX(incident.xM)} ${toY(incident.yM)})`} className={`local-map__incident local-map__incident--${incident.type} local-map__incident--${incident.status}${active ? " is-selected" : ""}`} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onClick={onSelect ? (event) => { event.stopPropagation(); onSelect({ kind: "incident", incident }); } : undefined} onKeyDown={onSelect ? (event) => interactiveKey(event, () => onSelect({ kind: "incident", incident })) : undefined}><circle className="local-map__incident-pulse" r="5"/><path d="M0-4 3.7-2 3.7 2 0 4-3.7 2-3.7-2z"/><text textAnchor="middle" y="1.2">!</text>{active || camera.zoom >= 2.8 ? <g className="local-map__incident-label"><rect x="-11" y="5.2" width="22" height="4.4" rx="1.2"/><text textAnchor="middle" y="8.2">{incident.title.slice(0, 21)}</text></g> : null}</g>;
        })}

        {route?.points.length ? <g className="local-map__route" aria-hidden="true"><polyline className="local-map__route-base" points={route.points.map((point) => `${toX(point.xM)},${toY(point.yM)}`).join(" ")} /><polyline className="local-map__route-remaining" points={remainingRoutePoints.map((point) => `${toX(point.xM)},${toY(point.yM)}`).join(" ")} /><circle className="local-map__route-start" cx={toX(route.points[0].xM)} cy={toY(route.points[0].yM)} r="1.5" /><circle className="local-map__route-target" cx={toX(route.target.xM)} cy={toY(route.target.yM)} r="2.2" /></g> : null}

        {selected?.kind === "point" ? <g transform={`translate(${toX(selected.xM)} ${toY(selected.yM)})`} className="local-map__point"><circle r="2.8" /><path d="M0-5 3.2-.8 0 4-3.2-.8z" /></g> : null}
        {playerInSector ? <g transform={`translate(${playerX} ${playerY})`} className="local-map__player" filter={`url(#map-glow-${sector.id})`}><circle r="3.8" /><path d="M0-2.2 2 1.9 0 .9-2 1.9z" /></g> : null}
      </svg>

      {!topology.segments.length ? <p className="local-map__empty">Уличная топология сектора недоступна.</p> : null}
      <div className="map-controls"><button type="button" aria-label="Приблизить" disabled={camera.zoom >= 7} onClick={() => applyZoom(camera.zoom + .5)}>＋</button><button type="button" aria-label="Отдалить" disabled={camera.zoom <= 1} onClick={() => applyZoom(camera.zoom - .5)}>−</button><button type="button" aria-label="Показать весь сектор" onClick={() => setCamera({ zoom: 1, centerX: 50, centerY: 50 })}>⌖</button></div>
      <div className="local-map__scale">{camera.zoom.toFixed(1)}× · {topology.segments.length} улиц</div>
    </div>
  );
}
