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

interface PointerState {
  id: number;
  x: number;
  y: number;
  moved: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const pointerRef = useRef<PointerState | null>(null);
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
      context.fillStyle = "#060b14";
      context.fillRect(0, 0, bounds.width, bounds.height);

      const columns = session.metropolitan.config.sectorsWide;
      const rows = session.metropolitan.config.sectorsHigh;
      const baseScale = Math.min((bounds.width - 32) / columns, (bounds.height - 32) / rows);
      const scale = baseScale * camera.zoom;
      const originX = (bounds.width - columns * scale) / 2 + camera.panX;
      const originY = (bounds.height - rows * scale) / 2 + camera.panY;
      const byCoordinate = new Map<string, MetropolitanSectorState>();

      for (const sector of session.metropolitan.sectors) {
        byCoordinate.set(`${sector.xIndex}:${sector.yIndex}`, sector);
        const x = originX + sector.xIndex * scale;
        const y = originY + sector.yIndex * scale;
        const active = sector.detailLevel === "active";
        const selected = sector.id === selectedId;
        context.fillStyle = selected ? "#ff334d" : active ? "#26364b" : "#121b29";
        context.fillRect(x + 0.5, y + 0.5, Math.max(1, scale - 1), Math.max(1, scale - 1));
        if (layers.traffic && sector.trafficLoad >= 70 && scale >= 3) {
          context.fillStyle = `rgba(255,180,58,${clamp(sector.trafficLoad / 130, 0.2, 0.72)})`;
          context.fillRect(x + scale * 0.32, y + scale * 0.32, Math.max(1, scale * 0.36), Math.max(1, scale * 0.36));
        }
      }

      if (layers.districts) {
        context.beginPath();
        for (const sector of session.metropolitan.sectors) {
          const x = originX + sector.xIndex * scale;
          const y = originY + sector.yIndex * scale;
          const left = byCoordinate.get(`${sector.xIndex - 1}:${sector.yIndex}`);
          const top = byCoordinate.get(`${sector.xIndex}:${sector.yIndex - 1}`);
          if (!left || left.districtId !== sector.districtId) {
            context.moveTo(x, y);
            context.lineTo(x, y + scale);
          }
          if (!top || top.districtId !== sector.districtId) {
            context.moveTo(x, y);
            context.lineTo(x + scale, y);
          }
        }
        context.strokeStyle = "rgba(233,238,248,.55)";
        context.lineWidth = Math.max(0.8, Math.min(1.5, camera.zoom));
        context.stroke();

        if (camera.zoom >= 1.25) {
          context.font = `${Math.round(clamp(10 + camera.zoom, 11, 15))}px Inter, sans-serif`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          for (const district of session.metropolitan.districts) {
            const name = session.world.districts.find((item) => item.id === district.districtId)?.name;
            if (!name) continue;
            const x = originX + district.center.xM / session.metropolitan.config.sectorSizeM * scale;
            const y = originY + district.center.yM / session.metropolitan.config.sectorSizeM * scale;
            context.fillStyle = "rgba(5,9,16,.76)";
            const width = context.measureText(name).width + 16;
            context.fillRect(x - width / 2, y - 11, width, 22);
            context.fillStyle = "rgba(244,246,251,.92)";
            context.fillText(name, x, y);
          }
        }
      }

      const nodeById = new Map(session.metropolitan.roadNodes.map((node) => [node.id, node]));
      context.lineCap = "round";
      for (const link of session.metropolitan.roadLinks) {
        if (link.class === "local" && camera.zoom < 2.4) continue;
        const from = nodeById.get(link.fromNodeId);
        const to = nodeById.get(link.toNodeId);
        if (!from || !to) continue;
        context.beginPath();
        context.moveTo(originX + from.xM / session.metropolitan.config.sectorSizeM * scale, originY + from.yM / session.metropolitan.config.sectorSizeM * scale);
        context.lineTo(originX + to.xM / session.metropolitan.config.sectorSizeM * scale, originY + to.yM / session.metropolitan.config.sectorSizeM * scale);
        context.strokeStyle = link.class === "expressway" ? "rgba(218,225,238,.42)" : "rgba(126,149,180,.22)";
        context.lineWidth = link.class === "expressway" ? 1.5 : 0.8;
        context.stroke();
      }

      if (layers.transit) {
        for (const station of session.metropolitan.transitStations) {
          const x = originX + station.xM / session.metropolitan.config.sectorSizeM * scale;
          const y = originY + station.yM / session.metropolitan.config.sectorSizeM * scale;
          context.beginPath();
          context.arc(x, y, camera.zoom >= 2 ? 2.4 : 1.6, 0, Math.PI * 2);
          context.fillStyle = "#35aaf7";
          context.fill();
        }
      }

      const playerSector = session.metropolitan.sectors.find((sector) => sector.id === session.localScene.playerPosition.sectorId);
      if (playerSector) {
        const x = originX + (playerSector.xIndex + 0.5) * scale;
        const y = originY + (playerSector.yIndex + 0.5) * scale;
        context.beginPath();
        context.arc(x, y, Math.max(3.5, Math.min(7, scale * 0.42)), 0, Math.PI * 2);
        context.fillStyle = "#f4f6fb";
        context.fill();
        context.strokeStyle = "#ff334d";
        context.lineWidth = 2;
        context.stroke();
      }
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [camera, layers, selectedId, session]);

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.moved += Math.abs(dx) + Math.abs(dy);
    setCamera((current) => ({ ...current, panX: current.panX + dx, panY: current.panY + dy }));
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    pointerRef.current = null;
    if (pointer.moved > 8) return;
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const columns = session.metropolitan.config.sectorsWide;
    const rows = session.metropolitan.config.sectorsHigh;
    const baseScale = Math.min((bounds.width - 32) / columns, (bounds.height - 32) / rows);
    const scale = baseScale * camera.zoom;
    const originX = (bounds.width - columns * scale) / 2 + camera.panX;
    const originY = (bounds.height - rows * scale) / 2 + camera.panY;
    const xIndex = Math.floor((event.clientX - bounds.left - originX) / scale);
    const yIndex = Math.floor((event.clientY - bounds.top - originY) / scale);
    const sector = session.metropolitan.sectors.find((item) => item.xIndex === xIndex && item.yIndex === yIndex);
    if (sector) onSelect(sector);
  }

  function wheel(event: ReactWheelEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.18 : 0.18;
    setCamera((current) => ({ ...current, zoom: clamp(current.zoom + direction, 0.8, 8) }));
  }

  return (
    <div className="global-map">
      <canvas
        ref={canvasRef}
        aria-label="Интерактивная глобальная карта города"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => { pointerRef.current = null; }}
        onWheel={wheel}
      />
      <div className="map-controls" aria-label="Управление масштабом">
        <button type="button" onClick={() => setCamera((current) => ({ ...current, zoom: clamp(current.zoom + 0.35, 0.8, 8) }))}>＋</button>
        <button type="button" onClick={() => setCamera((current) => ({ ...current, zoom: clamp(current.zoom - 0.35, 0.8, 8) }))}>−</button>
        <button type="button" onClick={() => setCamera({ zoom: 1, panX: 0, panY: 0 })}>⌖</button>
      </div>
    </div>
  );
}
