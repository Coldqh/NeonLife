import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { MetropolitanSectorState } from "../../simulation/spatial/types";
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
  const nodeById = useMemo(() => new Map(session.metropolitan.roadNodes.map((node) => [node.id, node])), [session.metropolitan.roadNodes]);
  const roads = useMemo(() => session.metropolitan.roadLinks.flatMap((link) => {
    const from = nodeById.get(link.fromNodeId);
    const to = nodeById.get(link.toNodeId);
    if (!from || !to || (from.sectorId !== sector.id && to.sectorId !== sector.id)) return [];
    return [{ link, from, to }];
  }), [nodeById, sector.id, session.metropolitan.roadLinks]);
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
        {roads.map(({ link, from, to }) => (
          <line key={link.id} x1={toX(from.xM)} y1={toY(from.yM)} x2={toX(to.xM)} y2={toY(to.yM)} className={`local-map__road local-map__road--${link.class}`} />
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
      {!buildings.length && !roads.length ? <p className="local-map__empty">Сектор ещё не материализован. Отладочные кварталы не подставляются.</p> : null}
      <div className="map-controls">
        <button type="button" disabled={camera.zoom >= 5} onClick={() => applyZoom(camera.zoom + .4)}>＋</button>
        <button type="button" disabled={camera.zoom <= 1} onClick={() => applyZoom(camera.zoom - .4)}>−</button>
        <button type="button" onClick={() => setCamera({ zoom: 1, centerX: 50, centerY: 50 })}>⌖</button>
      </div>
    </div>
  );
}
