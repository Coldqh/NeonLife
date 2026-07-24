import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { MetropolitanSectorState } from "../../simulation/spatial/types";
import { PLACE_ICONS } from "../shared/presentation";

interface CameraState {
  zoom: number;
  centerX: number;
  centerY: number;
}

interface PointerState {
  id: number;
  x: number;
  y: number;
}

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
  const pointer = useRef<PointerState | null>(null);
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

  const size = 100 / camera.zoom;
  const viewX = clamp(camera.centerX - size / 2, 0, 100 - size);
  const viewY = clamp(camera.centerY - size / 2, 0, 100 - size);
  const player = session.localScene.playerPosition;
  const playerInSector = player.sectorId === sector.id;
  const playerX = clamp((player.xM - sector.bounds.xM) / sector.bounds.widthM * 100, 0, 100);
  const playerY = clamp((player.yM - sector.bounds.yM) / sector.bounds.heightM * 100, 0, 100);

  function toX(xM: number): number {
    return (xM - sector.bounds.xM) / sector.bounds.widthM * 100;
  }

  function toY(yM: number): number {
    return (yM - sector.bounds.yM) / sector.bounds.heightM * 100;
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const state = pointer.current;
    if (!state || state.id !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - state.x) / Math.max(1, bounds.width) * size;
    const dy = (event.clientY - state.y) / Math.max(1, bounds.height) * size;
    state.x = event.clientX;
    state.y = event.clientY;
    setCamera((current) => ({
      ...current,
      centerX: clamp(current.centerX - dx, size / 2, 100 - size / 2),
      centerY: clamp(current.centerY - dy, size / 2, 100 - size / 2)
    }));
  }

  function zoom(delta: number): void {
    setCamera((current) => ({ ...current, zoom: clamp(current.zoom + delta, 1, 4) }));
  }

  return (
    <div className="local-map">
      <svg
        viewBox={`${viewX} ${viewY} ${size} ${size}`}
        role="img"
        aria-label={`Локальная карта сектора ${sector.code}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={() => { pointer.current = null; }}
        onPointerCancel={() => { pointer.current = null; }}
      >
        <defs>
          <pattern id={`sector-grid-${sector.id}`} width="2.5" height="2.5" patternUnits="userSpaceOnUse">
            <path d="M2.5 0H0V2.5" fill="none" stroke="rgba(147,162,189,.08)" strokeWidth=".22" />
          </pattern>
        </defs>
        <rect width="100" height="100" fill={`url(#sector-grid-${sector.id})`} />
        {roads.map(({ link, from, to }) => (
          <line
            key={link.id}
            x1={toX(from.xM)}
            y1={toY(from.yM)}
            x2={toX(to.xM)}
            y2={toY(to.yM)}
            className={`local-map__road local-map__road--${link.class}`}
          />
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
          />
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
              <circle r="3.4" />
              <text textAnchor="middle" y="1.35">{PLACE_ICONS[location.type]}</text>
            </g>
          );
        })}
        {playerInSector ? (
          <g transform={`translate(${playerX} ${playerY})`} className="local-map__player">
            <circle r="3.8" />
            <path d="M0-2.2 2 1.9 0 .9-2 1.9z" />
          </g>
        ) : null}
      </svg>
      {!buildings.length && !roads.length ? <p className="local-map__empty">Сектор ещё не материализован. Декоративные улицы не подставляются.</p> : null}
      <div className="map-controls">
        <button type="button" disabled={camera.zoom >= 4} onClick={() => zoom(.4)}>＋</button>
        <button type="button" disabled={camera.zoom <= 1} onClick={() => zoom(-.4)}>−</button>
        <button type="button" onClick={() => setCamera({ zoom: 1, centerX: 50, centerY: 50 })}>⌖</button>
      </div>
    </div>
  );
}
