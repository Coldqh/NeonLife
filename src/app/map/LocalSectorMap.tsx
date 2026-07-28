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
import type { StreetSegmentState } from "../../simulation/streets/types";
import type { LocalMovementState } from "../../simulation/localMovement/types";
import { getSectorStreetTopology } from "../../simulation/streets/streetTopologySystem";
import { PLACE_ICONS } from "../shared/presentation";

interface CameraState {
  zoom: number;
  centerX: number;
  centerY: number;
}

interface Point { x: number; y: number }
interface PinchState { distance: number; zoom: number; centerX: number; centerY: number }

export type LocalMapSelection =
  | { kind: "location"; location: LocationState }
  | { kind: "building"; building: GameSession["urban"]["buildings"][number] }
  | { kind: "stop"; stop: GameSession["transit"]["stops"][number] }
  | { kind: "street"; segment: StreetSegmentState }
  | { kind: "point"; xM: number; yM: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function selectionKey(selection: LocalMapSelection | null): string | null {
  if (!selection) return null;
  if (selection.kind === "point") return `point:${Math.round(selection.xM)}:${Math.round(selection.yM)}`;
  if (selection.kind === "location") return `location:${selection.location.id}`;
  if (selection.kind === "building") return `building:${selection.building.id}`;
  if (selection.kind === "stop") return `stop:${selection.stop.id}`;
  return `street:${selection.segment.id}`;
}

export function LocalSectorMap({
  session,
  sector,
  selected,
  route,
  onSelect
}: {
  session: GameSession;
  sector: MetropolitanSectorState;
  selected: LocalMapSelection | null;
  route?: LocalMovementState | null;
  onSelect?: (selection: LocalMapSelection) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<PinchState | null>(null);
  const moved = useRef(0);
  const [camera, setCamera] = useState<CameraState>({ zoom: 1, centerX: 50, centerY: 50 });

  useEffect(() => {
    setCamera({ zoom: 1, centerX: 50, centerY: 50 });
  }, [sector.id]);

  const buildings = useMemo(
    () => session.urban.buildings.filter((building) => building.sectorId === sector.id),
    [sector.id, session.urban.buildings]
  );
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
      return location ? [{ location, placement }] : [];
    }), [sector.id, session.metropolitan.locations, session.world.locations]);
  const stops = useMemo(() => session.transit.stops.filter((stop) => stop.sectorId === sector.id), [sector.id, session.transit.stops]);
  const selectedKey = selectionKey(selected);

  const size = 100 / camera.zoom;
  const viewX = clamp(camera.centerX - size / 2, 0, 100 - size);
  const viewY = clamp(camera.centerY - size / 2, 0, 100 - size);
  const player = session.localScene.playerPosition;
  const playerInSector = player.sectorId === sector.id;
  const playerX = clamp((player.xM - sector.bounds.xM) / sector.bounds.widthM * 100, 0, 100);
  const playerY = clamp((player.yM - sector.bounds.yM) / sector.bounds.heightM * 100, 0, 100);
  const remainingRoutePoints = route ? [
    { xM: player.xM, yM: player.yM },
    ...route.points.slice(Math.min(route.currentLegIndex + 1, route.points.length))
  ] : [];

  function toX(xM: number): number { return (xM - sector.bounds.xM) / sector.bounds.widthM * 100; }
  function toY(yM: number): number { return (yM - sector.bounds.yM) / sector.bounds.heightM * 100; }

  function applyZoom(nextZoom: number): void {
    setCamera((current) => {
      const zoom = clamp(nextZoom, 1, 6);
      const nextSize = 100 / zoom;
      return {
        zoom,
        centerX: clamp(current.centerX, nextSize / 2, 100 - nextSize / 2),
        centerY: clamp(current.centerY, nextSize / 2, 100 - nextSize / 2)
      };
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
      const zoom = clamp(state.zoom * distance / Math.max(1, state.distance), 1, 6);
      const nextSize = 100 / zoom;
      setCamera({
        zoom,
        centerX: clamp(state.centerX, nextSize / 2, 100 - nextSize / 2),
        centerY: clamp(state.centerY, nextSize / 2, 100 - nextSize / 2)
      });
      return;
    }

    setCamera((current) => {
      const currentSize = 100 / current.zoom;
      return {
        ...current,
        centerX: clamp(current.centerX - dx / Math.max(1, bounds.width) * currentSize, currentSize / 2, 100 - currentSize / 2),
        centerY: clamp(current.centerY - dy / Math.max(1, bounds.height) * currentSize, currentSize / 2, 100 - currentSize / 2)
      };
    });
  }

  function pointerUp(event: ReactPointerEvent<SVGSVGElement>): void {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
  }

  function wheel(event: ReactWheelEvent<SVGSVGElement>): void {
    event.preventDefault();
    applyZoom(camera.zoom + (event.deltaY > 0 ? -.35 : .35));
  }

  function localCoordinates(clientX: number, clientY: number): { xM: number; yM: number } | null {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return {
      xM: Math.round(sector.bounds.xM + local.x / 100 * sector.bounds.widthM),
      yM: Math.round(sector.bounds.yM + local.y / 100 * sector.bounds.heightM)
    };
  }

  function selectPoint(event: ReactMouseEvent<SVGRectElement>): void {
    if (!onSelect || moved.current > 8) return;
    const point = localCoordinates(event.clientX, event.clientY);
    if (point) onSelect({ kind: "point", ...point });
  }

  function interactiveKey(event: ReactKeyboardEvent<SVGGElement>, action: () => void): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  }

  return (
    <div className="local-map" data-no-swipe>
      <svg
        ref={svgRef}
        viewBox={`${viewX} ${viewY} ${size} ${size}`}
        role="img"
        aria-label={`Локальная карта сектора ${sector.code}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onWheel={wheel}
      >
        <defs>
          <pattern id={`sector-grid-${sector.id}`} width="2.5" height="2.5" patternUnits="userSpaceOnUse">
            <path d="M2.5 0H0V2.5" fill="none" stroke="rgba(147,162,189,.07)" strokeWidth=".18" />
          </pattern>
        </defs>
        <rect className="local-map__hit" width="100" height="100" fill={`url(#sector-grid-${sector.id})`} onClick={onSelect ? selectPoint : undefined} />

        {topology.blocks.map((block) => (
          <rect key={block.id} x={toX(block.bounds.xM)} y={toY(block.bounds.yM)} width={block.bounds.widthM / sector.bounds.widthM * 100} height={block.bounds.heightM / sector.bounds.heightM * 100} rx=".55" className={`local-map__block local-map__block--${block.landUse}`} />
        ))}
        {topology.parkingZones.map((zone) => (
          <rect key={zone.id} x={toX(zone.bounds.xM)} y={toY(zone.bounds.yM)} width={Math.max(.25, zone.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.25, zone.bounds.heightM / sector.bounds.heightM * 100)} className="local-map__parking" />
        ))}

        {roads.map(({ segment, from, to }) => {
          const active = selectedKey === `street:${segment.id}`;
          const midpointX = (toX(from.xM) + toX(to.xM)) / 2;
          const midpointY = (toY(from.yM) + toY(to.yM)) / 2;
          const vertical = Math.abs(from.xM - to.xM) < Math.abs(from.yM - to.yM);
          return (
            <g
              key={segment.id}
              className={`local-map__street local-map__street--${segment.class}${active ? " is-selected" : ""}`}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={onSelect ? (event: ReactMouseEvent<SVGGElement>) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "street", segment }); } : undefined}
              onKeyDown={onSelect ? (event: ReactKeyboardEvent<SVGGElement>) => interactiveKey(event, () => onSelect({ kind: "street", segment })) : undefined}
            >
              <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__sidewalk" />
              <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__road" />
              {camera.zoom >= 2 && (segment.class === "arterial" || segment.class === "collector") ? (
                <text className="local-map__street-label" x={midpointX} y={midpointY} textAnchor="middle" transform={vertical ? `rotate(-90 ${midpointX} ${midpointY})` : undefined}>{segment.name}</text>
              ) : null}
            </g>
          );
        })}

        {topology.parcels.map((parcel) => (
          <rect key={parcel.id} x={toX(parcel.bounds.xM)} y={toY(parcel.bounds.yM)} width={Math.max(.5, parcel.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.5, parcel.bounds.heightM / sector.bounds.heightM * 100)} rx=".35" className={`local-map__parcel local-map__parcel--${parcel.kind}`} />
        ))}

        {buildings.map((building) => {
          const active = selectedKey === `building:${building.id}`;
          return (
            <g
              key={building.id}
              className={`local-map__building-wrap${active ? " is-selected" : ""}`}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={onSelect ? (event: ReactMouseEvent<SVGGElement>) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "building", building }); } : undefined}
              onKeyDown={onSelect ? (event: ReactKeyboardEvent<SVGGElement>) => interactiveKey(event, () => onSelect({ kind: "building", building })) : undefined}
            >
              <rect
                x={toX(building.bounds.xM)}
                y={toY(building.bounds.yM)}
                width={Math.max(1, building.bounds.widthM / sector.bounds.widthM * 100)}
                height={Math.max(1, building.bounds.heightM / sector.bounds.heightM * 100)}
                rx=".65"
                className={`local-map__building local-map__building--${building.use}`}
              />
              {camera.zoom >= 2.5 ? <text className="local-map__building-label" x={toX(building.bounds.xM + building.bounds.widthM / 2)} y={toY(building.bounds.yM + building.bounds.heightM / 2)} textAnchor="middle">{building.streetNumber ?? building.floors}</text> : null}
            </g>
          );
        })}

        {topology.buildingEntrances.map((entrance) => (
          <g key={entrance.id} className={`local-map__entrance local-map__entrance--${entrance.kind}`}>
            <line x1={toX(entrance.xM)} y1={toY(entrance.yM)} x2={toX(entrance.walkwayTo.xM)} y2={toY(entrance.walkwayTo.yM)} />
            <circle cx={toX(entrance.xM)} cy={toY(entrance.yM)} r=".7" />
          </g>
        ))}

        {stops.map((stop) => {
          const active = selectedKey === `stop:${stop.id}`;
          return (
            <g
              key={stop.id}
              transform={`translate(${toX(stop.xM)} ${toY(stop.yM)})`}
              className={`local-map__stop local-map__stop--${stop.mode}${active ? " is-selected" : ""}`}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={onSelect ? (event: ReactMouseEvent<SVGGElement>) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "stop", stop }); } : undefined}
              onKeyDown={onSelect ? (event: ReactKeyboardEvent<SVGGElement>) => interactiveKey(event, () => onSelect({ kind: "stop", stop })) : undefined}
            >
              <circle r="2.4" /><text textAnchor="middle" y=".85">{stop.mode === "metro" ? "M" : "B"}</text>
            </g>
          );
        })}

        {locations.map(({ location, placement }) => {
          const x = toX(placement.bounds.xM + placement.bounds.widthM / 2);
          const y = toY(placement.bounds.yM + placement.bounds.heightM / 2);
          const active = selectedKey === `location:${location.id}`;
          return (
            <g
              key={location.id}
              className={`local-map__poi${active ? " is-selected" : ""}`}
              transform={`translate(${x} ${y})`}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={onSelect ? (event: ReactMouseEvent<SVGGElement>) => { event.stopPropagation(); if (moved.current <= 8) onSelect({ kind: "location", location }); } : undefined}
              onKeyDown={onSelect ? (event: ReactKeyboardEvent<SVGGElement>) => interactiveKey(event, () => onSelect({ kind: "location", location })) : undefined}
            >
              <circle r="3.4" /><text textAnchor="middle" y="1.35">{PLACE_ICONS[location.type]}</text>
            </g>
          );
        })}

        {route?.points.length ? (
          <g className="local-map__route" aria-hidden="true">
            <polyline className="local-map__route-base" points={route.points.map((point) => `${toX(point.xM)},${toY(point.yM)}`).join(" ")} />
            <polyline className="local-map__route-remaining" points={remainingRoutePoints.map((point) => `${toX(point.xM)},${toY(point.yM)}`).join(" ")} />
            <circle className="local-map__route-start" cx={toX(route.points[0].xM)} cy={toY(route.points[0].yM)} r="1.5" />
            <circle className="local-map__route-target" cx={toX(route.target.xM)} cy={toY(route.target.yM)} r="2.2" />
          </g>
        ) : null}

        {selected?.kind === "point" ? (
          <g transform={`translate(${toX(selected.xM)} ${toY(selected.yM)})`} className="local-map__point"><circle r="2.8" /><path d="M0-5 3.2-.8 0 4-3.2-.8z" /></g>
        ) : null}
        {playerInSector ? (
          <g transform={`translate(${playerX} ${playerY})`} className="local-map__player"><circle r="3.8" /><path d="M0-2.2 2 1.9 0 .9-2 1.9z" /></g>
        ) : null}
      </svg>

      {!topology.segments.length ? <p className="local-map__empty">Уличная топология сектора недоступна.</p> : null}
      <div className="map-controls">
        <button type="button" aria-label="Приблизить" disabled={camera.zoom >= 6} onClick={() => applyZoom(camera.zoom + .45)}>＋</button>
        <button type="button" aria-label="Отдалить" disabled={camera.zoom <= 1} onClick={() => applyZoom(camera.zoom - .45)}>−</button>
        <button type="button" aria-label="Показать весь сектор" onClick={() => setCamera({ zoom: 1, centerX: 50, centerY: 50 })}>⌖</button>
      </div>
      <div className="local-map__scale">{camera.zoom.toFixed(1)}× · {topology.segments.length} улиц</div>
    </div>
  );
}
