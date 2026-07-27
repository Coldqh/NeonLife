import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import type { GameSession } from "../../world/state/types";
import type { MetropolitanSectorState } from "../../simulation/spatial/types";

export interface MapLayers {
  transit: boolean;
  traffic: boolean;
  districts: boolean;
}

interface CameraState {
  zoom: number;
  panX: number;
  panY: number;
}

interface PointerPoint {
  x: number;
  y: number;
}

interface PinchState {
  distance: number;
  zoom: number;
  panX: number;
  panY: number;
  midX: number;
  midY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function districtColor(index: number): string {
  return ["#162338", "#1b2638", "#172b34", "#22243a", "#172536"][index % 5];
}

function landColor(landUse: MetropolitanSectorState["landUse"]): string {
  const colors: Record<MetropolitanSectorState["landUse"], string> = {
    residential: "#14243a",
    mixed: "#18283a",
    commercial: "#1b2637",
    industrial: "#202535",
    corporate: "#182238",
    civic: "#172b35",
    transport: "#142a38",
    utility: "#202632",
    vacant: "#0b121d"
  };
  return colors[landUse];
}

function constrainedCamera(camera: CameraState, width: number, height: number, columns: number, rows: number): CameraState {
  const baseScale = Math.min((width - 32) / columns, (height - 32) / rows);
  const worldWidth = columns * baseScale * camera.zoom;
  const worldHeight = rows * baseScale * camera.zoom;
  const maxPanX = Math.max(0, (worldWidth - width) / 2 + 36);
  const maxPanY = Math.max(0, (worldHeight - height) / 2 + 36);
  return {
    zoom: clamp(camera.zoom, 0.9, 8),
    panX: clamp(camera.panX, -maxPanX, maxPanX),
    panY: clamp(camera.panY, -maxPanY, maxPanY)
  };
}

export function GlobalCityMap({
  session,
  selectedId,
  layers,
  onSelect
}: {
  session: GameSession;
  selectedId: string;
  layers: MapLayers;
  onSelect: (sector: MetropolitanSectorState) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointers = useRef(new Map<number, PointerPoint>());
  const pinch = useRef<PinchState | null>(null);
  const gestureMoved = useRef(0);
  const [camera, setCamera] = useState<CameraState>({ zoom: 1, panX: 0, panY: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      context.fillStyle = "#050a13";
      context.fillRect(0, 0, bounds.width, bounds.height);

      const columns = session.metropolitan.config.sectorsWide;
      const rows = session.metropolitan.config.sectorsHigh;
      const actualCamera = constrainedCamera(camera, bounds.width, bounds.height, columns, rows);
      const baseScale = Math.min((bounds.width - 32) / columns, (bounds.height - 32) / rows);
      const scale = baseScale * actualCamera.zoom;
      const originX = (bounds.width - columns * scale) / 2 + actualCamera.panX;
      const originY = (bounds.height - rows * scale) / 2 + actualCamera.panY;
      const byCoordinate = new Map<string, MetropolitanSectorState>();
      const districtIndex = new Map(session.world.districts.map((district, index) => [district.id, index]));

      for (const sector of session.metropolitan.sectors) {
        byCoordinate.set(`${sector.xIndex}:${sector.yIndex}`, sector);
        const x = originX + sector.xIndex * scale;
        const y = originY + sector.yIndex * scale;
        const selected = sector.id === selectedId;
        context.fillStyle = selected
          ? "#51202d"
          : layers.districts
            ? districtColor(districtIndex.get(sector.districtId) ?? 0)
            : landColor(sector.landUse);
        context.fillRect(x + .35, y + .35, Math.max(1, scale - .7), Math.max(1, scale - .7));
        if (layers.traffic && sector.trafficLoad > 22) {
          const alpha = clamp((sector.trafficLoad - 20) / 150, .05, .48);
          context.fillStyle = `rgba(255, 116, 58, ${alpha})`;
          context.fillRect(x + .55, y + .55, Math.max(1, scale - 1.1), Math.max(1, scale - 1.1));
        }
        if (selected) {
          context.strokeStyle = "#ff334d";
          context.lineWidth = Math.max(1.4, Math.min(2.4, actualCamera.zoom));
          context.strokeRect(x + .7, y + .7, Math.max(1, scale - 1.4), Math.max(1, scale - 1.4));
        }
      }

      if (layers.districts) {
        context.beginPath();
        for (const sector of session.metropolitan.sectors) {
          const x = originX + sector.xIndex * scale;
          const y = originY + sector.yIndex * scale;
          const left = byCoordinate.get(`${sector.xIndex - 1}:${sector.yIndex}`);
          const top = byCoordinate.get(`${sector.xIndex}:${sector.yIndex - 1}`);
          if (!left || left.districtId !== sector.districtId) { context.moveTo(x, y); context.lineTo(x, y + scale); }
          if (!top || top.districtId !== sector.districtId) { context.moveTo(x, y); context.lineTo(x + scale, y); }
        }
        context.strokeStyle = "rgba(221, 228, 241, .58)";
        context.lineWidth = Math.max(1, Math.min(2, actualCamera.zoom));
        context.stroke();
      }

      const nodeById = new Map(session.metropolitan.roadNodes.map((node) => [node.id, node]));
      const sectorById = new Map(session.metropolitan.sectors.map((sector) => [sector.id, sector]));
      context.lineCap = "round";
      for (const link of session.metropolitan.roadLinks) {
        if (link.class === "local" && actualCamera.zoom < 2.35) continue;
        if (link.class === "collector" && actualCamera.zoom < 1.55) continue;
        if (link.class === "arterial" && actualCamera.zoom < 1.18) continue;
        const from = nodeById.get(link.fromNodeId);
        const to = nodeById.get(link.toNodeId);
        if (!from || !to) continue;
        const traffic = ((sectorById.get(from.sectorId)?.trafficLoad ?? 0) + (sectorById.get(to.sectorId)?.trafficLoad ?? 0)) / 2;
        context.beginPath();
        context.moveTo(originX + from.xM / session.metropolitan.config.sectorSizeM * scale, originY + from.yM / session.metropolitan.config.sectorSizeM * scale);
        context.lineTo(originX + to.xM / session.metropolitan.config.sectorSizeM * scale, originY + to.yM / session.metropolitan.config.sectorSizeM * scale);
        context.strokeStyle = layers.traffic && traffic >= 55
          ? traffic >= 80 ? "rgba(255, 70, 78, .78)" : "rgba(255, 174, 62, .66)"
          : link.class === "expressway" ? "rgba(220, 228, 241, .62)" : "rgba(132, 153, 183, .34)";
        context.lineWidth = link.class === "expressway" ? Math.max(1.5, actualCamera.zoom * .55) : link.class === "arterial" ? Math.max(1, actualCamera.zoom * .38) : .8;
        context.stroke();
      }

      if (layers.transit) {
        const stopById = new Map(session.transit.stops.map((stop) => [stop.id, stop]));
        const palette = ["#35aaf7", "#9b70ff", "#2fc6bb", "#ffb43a", "#ff6b58"];
        for (const [index, route] of session.transit.routes.entries()) {
          if (route.status === "suspended") continue;
          const stops = route.stopIds.map((id) => stopById.get(id)).filter((stop): stop is NonNullable<typeof stop> => Boolean(stop));
          if (stops.length < 2) continue;
          const color = route.mode === "bus" ? "rgba(255, 180, 58, .72)" : palette[index % palette.length];
          context.beginPath();
          stops.forEach((stop, stopIndex) => {
            const x = originX + stop.xM / session.metropolitan.config.sectorSizeM * scale;
            const y = originY + stop.yM / session.metropolitan.config.sectorSizeM * scale;
            if (stopIndex === 0) context.moveTo(x, y); else context.lineTo(x, y);
          });
          context.setLineDash(route.mode === "bus" ? [Math.max(2, actualCamera.zoom), Math.max(2, actualCamera.zoom)] : []);
          context.strokeStyle = color;
          context.lineWidth = route.mode === "bus" ? Math.max(1.1, actualCamera.zoom * .42) : Math.max(1.7, Math.min(4, actualCamera.zoom * .75));
          context.stroke();
          context.setLineDash([]);
          for (const stop of stops) {
            const x = originX + stop.xM / session.metropolitan.config.sectorSizeM * scale;
            const y = originY + stop.yM / session.metropolitan.config.sectorSizeM * scale;
            context.beginPath();
            context.arc(x, y, actualCamera.zoom >= 2 ? 2.8 : 1.9, 0, Math.PI * 2);
            context.fillStyle = "#06101d";
            context.fill();
            context.strokeStyle = color;
            context.lineWidth = 1.25;
            context.stroke();
          }
        }
      }

      if (layers.districts && actualCamera.zoom >= 1.05) {
        context.font = `${Math.round(clamp(10 + actualCamera.zoom, 11, 15))}px Inter, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        for (const district of session.metropolitan.districts) {
          const name = session.world.districts.find((item) => item.id === district.districtId)?.name;
          if (!name) continue;
          const x = originX + district.center.xM / session.metropolitan.config.sectorSizeM * scale;
          const y = originY + district.center.yM / session.metropolitan.config.sectorSizeM * scale;
          const width = context.measureText(name).width + 16;
          context.fillStyle = "rgba(4, 8, 15, .82)";
          context.fillRect(x - width / 2, y - 11, width, 22);
          context.fillStyle = "rgba(244, 246, 251, .94)";
          context.fillText(name, x, y);
        }
      }

      const playerSector = session.metropolitan.sectors.find((sector) => sector.id === session.localScene.playerPosition.sectorId);
      if (playerSector) {
        const x = originX + (playerSector.xIndex + .5) * scale;
        const y = originY + (playerSector.yIndex + .5) * scale;
        context.beginPath();
        context.arc(x, y, Math.max(4, Math.min(7, scale * .42)), 0, Math.PI * 2);
        context.fillStyle = "#f5f7fb";
        context.fill();
        context.strokeStyle = "#ff334d";
        context.lineWidth = 2.2;
        context.stroke();
      }
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [camera, layers, selectedId, session]);

  function updatePointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePointer(event);
    gestureMoved.current = 0;
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      pinch.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: camera.zoom,
        panX: camera.panX,
        panY: camera.panY,
        midX: (first.x + second.x) / 2,
        midY: (first.y + second.y) / 2
      };
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    gestureMoved.current += Math.abs(dx) + Math.abs(dy);
    updatePointer(event);
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const columns = session.metropolitan.config.sectorsWide;
    const rows = session.metropolitan.config.sectorsHigh;

    if (pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      const state = pinch.current;
      if (!state) return;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;
      setCamera(constrainedCamera({
        zoom: state.zoom * distance / Math.max(1, state.distance),
        panX: state.panX + midX - state.midX,
        panY: state.panY + midY - state.midY
      }, bounds.width, bounds.height, columns, rows));
      return;
    }

    setCamera((current) => constrainedCamera({ ...current, panX: current.panX + dx, panY: current.panY + dy }, bounds.width, bounds.height, columns, rows));
  }

  function selectAt(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const columns = session.metropolitan.config.sectorsWide;
    const rows = session.metropolitan.config.sectorsHigh;
    const actualCamera = constrainedCamera(camera, bounds.width, bounds.height, columns, rows);
    const baseScale = Math.min((bounds.width - 32) / columns, (bounds.height - 32) / rows);
    const scale = baseScale * actualCamera.zoom;
    const originX = (bounds.width - columns * scale) / 2 + actualCamera.panX;
    const originY = (bounds.height - rows * scale) / 2 + actualCamera.panY;
    const xIndex = Math.floor((event.clientX - bounds.left - originX) / scale);
    const yIndex = Math.floor((event.clientY - bounds.top - originY) / scale);
    const sector = session.metropolitan.sectors.find((item) => item.xIndex === xIndex && item.yIndex === yIndex);
    if (sector) onSelect(sector);
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    if (wasSingle && gestureMoved.current <= 8) selectAt(event);
  }

  function wheel(event: ReactWheelEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const direction = event.deltaY > 0 ? -.22 : .22;
    setCamera((current) => constrainedCamera({ ...current, zoom: current.zoom + direction }, bounds.width, bounds.height, session.metropolitan.config.sectorsWide, session.metropolitan.config.sectorsHigh));
  }

  function zoom(delta: number): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    setCamera((current) => constrainedCamera({ ...current, zoom: current.zoom + delta }, bounds.width, bounds.height, session.metropolitan.config.sectorsWide, session.metropolitan.config.sectorsHigh));
  }

  return (
    <div className="global-map" data-no-swipe>
      <canvas
        ref={canvasRef}
        aria-label="Интерактивная глобальная карта города"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={(event: ReactPointerEvent<HTMLCanvasElement>) => { pointers.current.delete(event.pointerId); pinch.current = null; }}
        onWheel={wheel}
      />
      <div className="map-controls" aria-label="Управление масштабом">
        <button type="button" aria-label="Приблизить" onClick={() => zoom(.4)}>＋</button>
        <button type="button" aria-label="Отдалить" onClick={() => zoom(-.4)}>−</button>
        <button type="button" aria-label="Показать весь город" onClick={() => setCamera({ zoom: 1, panX: 0, panY: 0 })}>⌖</button>
      </div>
    </div>
  );
}
