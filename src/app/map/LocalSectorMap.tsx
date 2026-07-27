import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { MetropolitanSectorState } from "../../simulation/spatial/types";
import { getSectorStreetTopology } from "../../simulation/streets/streetTopologySystem";
import { PLACE_ICONS } from "../shared/presentation";

interface CameraState {
  zoom: number;
  centerX: number;
  centerY: number;
}

interface Point { x: number; y: number }
interface PinchState { distance: number; zoom: number; centerX: number; centerY: number }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function LocalSectorMap({
  session,
  sector,
  onLocation
}: {
  session: GameSession;
  sector: MetropolitanSectorState;
  onLocation: (location: LocationState) => void;
}) {
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<PinchState | null>(null);
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

  const size = 100 / camera.zoom;
  const viewX = clamp(camera.centerX - size / 2, 0, 100 - size);
  const viewY = clamp(camera.centerY - size / 2, 0, 100 - size);
  const player = session.localScene.playerPosition;
  const playerInSector = player.sectorId === sector.id;
  const playerX = clamp((player.xM - sector.bounds.xM) / sector.bounds.widthM * 100, 0, 100);
  const playerY = clamp((player.yM - sector.bounds.yM) / sector.bounds.heightM * 100, 0, 100);

  function toX(xM: number): number { return (xM - sector.bounds.xM) / sector.bounds.widthM * 100; }
  function toY(yM: number): number { return (yM - sector.bounds.yM) / sector.bounds.heightM * 100; }

  function applyZoom(nextZoom: number): void {
    setCamera((current) => {
      const zoom = clamp(nextZoom, 1, 5);
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
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      const state = pinch.current;
      if (!state) return;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const zoom = clamp(state.zoom * distance / Math.max(1, state.distance), 1, 5);
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
    applyZoom(camera.zoom + (event.deltaY > 0 ? -.3 : .3));
  }

  return (
    <div className="local-map" data-no-swipe>
      <svg
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
            <path d="M2.5 0H0V2.5" fill="none" stroke="rgba(147,162,189,.08)" strokeWidth=".22" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill={`url(#sector-grid-${sector.id})`} />
        {topology.blocks.map((block) => (
          <rect key={block.id} x={toX(block.bounds.xM)} y={toY(block.bounds.yM)} width={block.bounds.widthM / sector.bounds.widthM * 100} height={block.bounds.heightM / sector.bounds.heightM * 100} rx=".55" className={`local-map__block local-map__block--${block.landUse}`}><title>{block.code}</title></rect>
        ))}
        {topology.parkingZones.map((zone) => (
          <rect key={zone.id} x={toX(zone.bounds.xM)} y={toY(zone.bounds.yM)} width={Math.max(.25, zone.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.25, zone.bounds.heightM / sector.bounds.heightM * 100)} className="local-map__parking"><title>Парковка · {zone.occupiedEstimate}/{zone.capacity}</title></rect>
        ))}
        {roads.map(({ segment, from, to }) => (
          <g key={segment.id} className={`local-map__street local-map__street--${segment.class}`}>
            <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__sidewalk" />
            <line x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className="local-map__road" />
            <title>{segment.name} · {segment.lanes} полосы · {segment.speedLimitKph} км/ч</title>
          </g>
        ))}
        {topology.parcels.map((parcel) => (
          <rect key={parcel.id} x={toX(parcel.bounds.xM)} y={toY(parcel.bounds.yM)} width={Math.max(.5, parcel.bounds.widthM / sector.bounds.widthM * 100)} height={Math.max(.5, parcel.bounds.heightM / sector.bounds.heightM * 100)} rx=".35" className={`local-map__parcel local-map__parcel--${parcel.kind}`}><title>{parcel.addressCode}</title></rect>
        ))}
        {buildings.map((building) => (
          <rect
            key={building.id}
            x={toX(building.bounds.xM)}
            y={toY(building.bounds.yM)}
            width={Math.max(1, building.bounds.widthM / sector.bounds.widthM * 100)}
            height={Math.max(1, building.bounds.heightM / sector.bounds.heightM * 100)}
            rx=".65"
            className={`local-map__building local-map__building--${building.use}`}
          ><title>{building.addressCode}</title></rect>
        ))}
        {topology.buildingEntrances.map((entrance) => (
          <g key={entrance.id} className={`local-map__entrance local-map__entrance--${entrance.kind}`}>
            <line x1={toX(entrance.xM)} y1={toY(entrance.yM)} x2={toX(entrance.walkwayTo.xM)} y2={toY(entrance.walkwayTo.yM)} />
            <circle cx={toX(entrance.xM)} cy={toY(entrance.yM)} r=".7"><title>{entrance.kind === "public" ? "Главный вход" : "Служебный вход"}</title></circle>
          </g>
        ))}
        {stops.map((stop) => (
          <g key={stop.id} transform={`translate(${toX(stop.xM)} ${toY(stop.yM)})`} className={`local-map__stop local-map__stop--${stop.mode}`}>
            <circle r="2.4" /><text textAnchor="middle" y=".85">{stop.mode === "metro" ? "M" : "B"}</text><title>{stop.name}</title>
          </g>
        ))}
        {locations.map(({ location, placement }) => {
          const x = toX(placement.bounds.xM + placement.bounds.widthM / 2);
          const y = toY(placement.bounds.yM + placement.bounds.heightM / 2);
          return (
            <g
              key={location.id}
              className="local-map__poi"
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              onClick={(event: ReactMouseEvent<SVGGElement>) => { event.stopPropagation(); onLocation(location); }}
              onKeyDown={(event: ReactKeyboardEvent<SVGGElement>) => { if (event.key === "Enter" || event.key === " ") onLocation(location); }}
            >
              <circle r="3.4" /><text textAnchor="middle" y="1.35">{PLACE_ICONS[location.type]}</text><title>{location.name}</title>
            </g>
          );
        })}
        {playerInSector ? (
          <g transform={`translate(${playerX} ${playerY})`} className="local-map__player"><circle r="3.8" /><path d="M0-2.2 2 1.9 0 .9-2 1.9z" /></g>
        ) : null}
      </svg>
      {!topology.segments.length ? <p className="local-map__empty">Уличная топология сектора недоступна.</p> : null}
      <div className="map-controls">
        <button type="button" disabled={camera.zoom >= 5} onClick={() => applyZoom(camera.zoom + .4)}>＋</button>
        <button type="button" disabled={camera.zoom <= 1} onClick={() => applyZoom(camera.zoom - .4)}>−</button>
        <button type="button" onClick={() => setCamera({ zoom: 1, centerX: 50, centerY: 50 })}>⌖</button>
      </div>
    </div>
  );
}
