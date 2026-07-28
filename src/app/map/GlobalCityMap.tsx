import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import type { GameSession } from "../../world/state/types";
import type { MapDistrictState, MetropolitanSectorState, MetricBounds } from "../../simulation/spatial/types";

export interface MapLayers {
  districts: boolean;
  roads: boolean;
  rail: boolean;
  bus: boolean;
  traffic: boolean;
  risk: boolean;
  activity: boolean;
}

export interface MapPointSelection {
  sector: MetropolitanSectorState;
  xM: number;
  yM: number;
}

interface CameraState { zoom: number; panX: number; panY: number }
interface PointerPoint { x: number; y: number; time: number }
interface PinchState { distance: number; zoom: number; worldX: number; worldY: number }

const CAMERA_KEY = "neon-life/global-map-camera/v2";
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 8;
const DISTRICT_PALETTE = ["#ff4058", "#3f91ff", "#ff8b35", "#42d896", "#a565ff", "#23c8cb", "#ffc348", "#e76aa3", "#7b8cff", "#65d6a5", "#ff635f", "#5cc0ff", "#c46cff", "#e2b84f"];
const RAIL_PALETTE = ["#ff3854", "#a86dff", "#2fc7c0", "#ffb33e", "#4b9cff", "#e66d9d"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function loadCamera(): CameraState {
  try {
    const value = JSON.parse(localStorage.getItem(CAMERA_KEY) ?? "null") as Partial<CameraState> | null;
    if (value && [value.zoom, value.panX, value.panY].every((item) => typeof item === "number" && Number.isFinite(item))) {
      return { zoom: clamp(value.zoom ?? 1, MIN_ZOOM, MAX_ZOOM), panX: value.panX ?? 0, panY: value.panY ?? 0 };
    }
  } catch { /* ignore corrupt UI state */ }
  return { zoom: 1, panX: 0, panY: 0 };
}

function constrainedCamera(camera: CameraState, width: number, height: number, columns: number, rows: number): CameraState {
  const zoom = clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);
  const baseScale = Math.min((width - 24) / columns, (height - 24) / rows);
  const worldWidth = columns * baseScale * zoom;
  const worldHeight = rows * baseScale * zoom;
  const maxPanX = Math.max(0, (worldWidth - width) / 2 + 56);
  const maxPanY = Math.max(0, (worldHeight - height) / 2 + 56);
  return { zoom, panX: clamp(camera.panX, -maxPanX, maxPanX), panY: clamp(camera.panY, -maxPanY, maxPanY) };
}

function districtBounds(district: MapDistrictState): MetricBounds {
  return district.bounds;
}

function districtColor(index: number): string {
  return DISTRICT_PALETTE[index % DISTRICT_PALETTE.length];
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawDistrictBoundary(
  context: CanvasRenderingContext2D,
  districtId: string,
  sectors: MetropolitanSectorState[],
  byCoordinate: Map<string, MetropolitanSectorState>,
  originX: number,
  originY: number,
  scale: number
): void {
  context.beginPath();
  for (const sector of sectors) {
    if (sector.mapDistrictId !== districtId) continue;
    const x = originX + sector.xIndex * scale;
    const y = originY + sector.yIndex * scale;
    const left = byCoordinate.get(`${sector.xIndex - 1}:${sector.yIndex}`);
    const top = byCoordinate.get(`${sector.xIndex}:${sector.yIndex - 1}`);
    const right = byCoordinate.get(`${sector.xIndex + 1}:${sector.yIndex}`);
    const bottom = byCoordinate.get(`${sector.xIndex}:${sector.yIndex + 1}`);
    if (!left || left.mapDistrictId !== districtId) { context.moveTo(x, y); context.lineTo(x, y + scale); }
    if (!top || top.mapDistrictId !== districtId) { context.moveTo(x, y); context.lineTo(x + scale, y); }
    if (!right || right.mapDistrictId !== districtId) { context.moveTo(x + scale, y); context.lineTo(x + scale, y + scale); }
    if (!bottom || bottom.mapDistrictId !== districtId) { context.moveTo(x, y + scale); context.lineTo(x + scale, y + scale); }
  }
}

export function GlobalCityMap({
  session,
  selectedSectorId,
  selectedDistrictId,
  selectedPoint,
  layers,
  focusDistrictId,
  focusSectorId,
  focusRevision,
  onSelectSector,
  onSelectDistrict
}: {
  session: GameSession;
  selectedSectorId?: string;
  selectedDistrictId?: string;
  selectedPoint?: { xM: number; yM: number } | null;
  layers: MapLayers;
  focusDistrictId?: string;
  focusSectorId?: string;
  focusRevision?: number;
  onSelectSector: (selection: MapPointSelection) => void;
  onSelectDistrict: (district: MapDistrictState) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointers = useRef(new Map<number, PointerPoint>());
  const pinch = useRef<PinchState | null>(null);
  const moved = useRef(0);
  const velocity = useRef({ x: 0, y: 0 });
  const inertiaFrame = useRef<number | null>(null);
  const [camera, setCamera] = useState<CameraState>(loadCamera);
  const [resizeTick, setResizeTick] = useState(0);

  const districtIndex = useMemo(() => new Map(session.metropolitan.mapDistricts.map((district, index) => [district.id, index])), [session.metropolitan.mapDistricts]);

  useEffect(() => {
    try { localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)); } catch { /* storage is optional */ }
  }, [camera]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setResizeTick((value) => value + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (inertiaFrame.current !== null) cancelAnimationFrame(inertiaFrame.current);
  }, []);

  function mapGeometry(width: number, height: number, value = camera) {
    const columns = session.metropolitan.config.sectorsWide;
    const rows = session.metropolitan.config.sectorsHigh;
    const actual = constrainedCamera(value, width, height, columns, rows);
    const baseScale = Math.min((width - 24) / columns, (height - 24) / rows);
    const scale = baseScale * actual.zoom;
    return {
      camera: actual,
      scale,
      originX: (width - columns * scale) / 2 + actual.panX,
      originY: (height - rows * scale) / 2 + actual.panY
    };
  }

  function focusBounds(bounds: MetricBounds, padding = 64): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const columns = session.metropolitan.config.sectorsWide;
    const rows = session.metropolitan.config.sectorsHigh;
    const baseScale = Math.min((rect.width - 24) / columns, (rect.height - 24) / rows);
    const widthInSectors = bounds.widthM / session.metropolitan.config.sectorSizeM;
    const heightInSectors = bounds.heightM / session.metropolitan.config.sectorSizeM;
    const zoom = clamp(Math.min((rect.width - padding * 2) / Math.max(1, widthInSectors * baseScale), (rect.height - padding * 2) / Math.max(1, heightInSectors * baseScale)), 1.15, MAX_ZOOM);
    const centerX = (bounds.xM + bounds.widthM / 2) / session.metropolitan.config.sectorSizeM;
    const centerY = (bounds.yM + bounds.heightM / 2) / session.metropolitan.config.sectorSizeM;
    const scale = baseScale * zoom;
    setCamera(constrainedCamera({
      zoom,
      panX: (columns / 2 - centerX) * scale,
      panY: (rows / 2 - centerY) * scale
    }, rect.width, rect.height, columns, rows));
  }

  useEffect(() => {
    if (!focusRevision) return;
    const district = session.metropolitan.mapDistricts.find((item) => item.id === focusDistrictId);
    if (district) focusBounds(districtBounds(district));
  }, [focusDistrictId, focusRevision]);

  useEffect(() => {
    if (!focusRevision) return;
    const sector = session.metropolitan.sectors.find((item) => item.id === focusSectorId);
    if (sector) focusBounds(sector.bounds, 104);
  }, [focusSectorId, focusRevision]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const background = context.createRadialGradient(bounds.width * .48, bounds.height * .44, 0, bounds.width * .48, bounds.height * .44, Math.max(bounds.width, bounds.height) * .72);
    background.addColorStop(0, "#0a1320");
    background.addColorStop(.58, "#050a12");
    background.addColorStop(1, "#02050a");
    context.fillStyle = background;
    context.fillRect(0, 0, bounds.width, bounds.height);
    context.strokeStyle = "rgba(89, 116, 148, .055)";
    context.lineWidth = 1;
    for (let x = 0; x < bounds.width; x += 38) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, bounds.height); context.stroke(); }
    for (let y = 0; y < bounds.height; y += 38) { context.beginPath(); context.moveTo(0, y); context.lineTo(bounds.width, y); context.stroke(); }

    const geometry = mapGeometry(bounds.width, bounds.height);
    const { scale, originX, originY } = geometry;
    const zoom = geometry.camera.zoom;
    const sectorSizeM = session.metropolitan.config.sectorSizeM;
    const byCoordinate = new Map(session.metropolitan.sectors.map((sector) => [`${sector.xIndex}:${sector.yIndex}`, sector]));

    for (const sector of session.metropolitan.sectors) {
      const x = originX + sector.xIndex * scale;
      const y = originY + sector.yIndex * scale;
      const mapDistrict = session.metropolitan.mapDistricts.find((district) => district.id === sector.mapDistrictId);
      const color = districtColor(districtIndex.get(sector.mapDistrictId) ?? 0);
      context.fillStyle = layers.districts ? hexToRgba(color, sector.mapDistrictId === selectedDistrictId ? .28 : .17) : "rgba(18, 31, 48, .84)";
      context.fillRect(x, y, Math.ceil(scale + .65), Math.ceil(scale + .65));
      const density = clamp(sector.densityPerKm2 / 90000, .08, .92);
      if (zoom >= 1.15) {
        context.fillStyle = `rgba(226, 235, 247, ${.025 + density * .055})`;
        const inset = Math.max(1, scale * .14);
        const unit = Math.max(.65, scale * .16);
        context.fillRect(x + inset, y + inset, Math.max(.8, scale - inset * 2), unit);
        context.fillRect(x + inset, y + inset + unit * 1.65, Math.max(.8, (scale - inset * 2) * .56), unit * .78);
        context.fillRect(x + inset + Math.max(.8, (scale - inset * 2) * .63), y + inset + unit * 1.65, Math.max(.5, (scale - inset * 2) * .27), unit * .78);
      }
      if (layers.risk && mapDistrict) {
        context.fillStyle = `rgba(255, 43, 68, ${clamp(mapDistrict.riskScore / 180, .08, .52)})`;
        context.fillRect(x, y, Math.ceil(scale + .5), Math.ceil(scale + .5));
      }
      if (layers.activity) {
        const activity = clamp((sector.crowdLoad + sector.trafficLoad) / 200, 0, 1);
        context.fillStyle = `rgba(66, 213, 162, ${activity * .42})`;
        context.fillRect(x, y, Math.ceil(scale + .5), Math.ceil(scale + .5));
      }
    }

    if (layers.districts) {
      session.metropolitan.mapDistricts.forEach((district, index) => {
        const color = districtColor(index);
        const selected = district.id === selectedDistrictId;
        drawDistrictBoundary(context, district.id, session.metropolitan.sectors, byCoordinate, originX, originY, scale);
        context.save();
        context.shadowBlur = selected ? 18 : 8;
        context.shadowColor = hexToRgba(color, selected ? .95 : .48);
        context.strokeStyle = hexToRgba(color, selected ? .98 : .72);
        context.lineWidth = selected ? Math.max(2.4, zoom * 1.35) : Math.max(1.1, zoom * .72);
        context.stroke();
        context.restore();
      });
    }

    if (zoom >= 2.05) {
      context.beginPath();
      for (const sector of session.metropolitan.sectors) {
        const x = originX + sector.xIndex * scale;
        const y = originY + sector.yIndex * scale;
        context.rect(x, y, scale, scale);
      }
      context.strokeStyle = "rgba(117, 139, 170, .16)";
      context.lineWidth = 0.55;
      context.stroke();
    }

    if (layers.roads) {
      const nodeById = new Map(session.metropolitan.roadNodes.map((node) => [node.id, node]));
      context.lineCap = "round";
      for (const link of session.metropolitan.roadLinks) {
        if (link.class === "collector" && zoom < 1.85) continue;
        if (link.class === "local" && zoom < 3.2) continue;
        const from = nodeById.get(link.fromNodeId);
        const to = nodeById.get(link.toNodeId);
        if (!from || !to) continue;
        context.beginPath();
        context.moveTo(originX + from.xM / sectorSizeM * scale, originY + from.yM / sectorSizeM * scale);
        context.lineTo(originX + to.xM / sectorSizeM * scale, originY + to.yM / sectorSizeM * scale);
        context.strokeStyle = layers.traffic && link.trafficLoad >= 55
          ? link.trafficLoad >= 78 ? "rgba(255, 57, 74, .92)" : "rgba(255, 173, 57, .82)"
          : link.class === "expressway" ? "rgba(225, 233, 246, .74)" : link.class === "arterial" ? "rgba(151, 171, 199, .54)" : "rgba(103, 124, 154, .28)";
        context.lineWidth = link.class === "expressway" ? Math.max(1.4, zoom * 0.7) : link.class === "arterial" ? Math.max(1, zoom * 0.44) : Math.max(0.65, zoom * 0.26);
        context.stroke();
      }
    }

    if (layers.rail) {
      const stationById = new Map(session.metropolitan.transitStations.map((station) => [station.id, station]));
      session.metropolitan.transitLines.forEach((line, lineIndex) => {
        if (line.mode === "freight" && zoom < 1.5) return;
        const stations = line.stationIds.map((id) => stationById.get(id)).filter((station): station is NonNullable<typeof station> => Boolean(station));
        if (stations.length < 2) return;
        context.beginPath();
        stations.forEach((station, index) => {
          const x = originX + station.xM / sectorSizeM * scale;
          const y = originY + station.yM / sectorSizeM * scale;
          if (!index) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.strokeStyle = RAIL_PALETTE[lineIndex % RAIL_PALETTE.length];
        context.lineWidth = line.mode === "metro" ? Math.max(1.8, zoom * 0.72) : Math.max(1.25, zoom * 0.5);
        context.globalAlpha = line.mode === "freight" ? 0.5 : 0.9;
        context.stroke();
        context.globalAlpha = 1;
        if (zoom >= 1.55) for (const station of stations) {
          context.beginPath();
          context.arc(originX + station.xM / sectorSizeM * scale, originY + station.yM / sectorSizeM * scale, zoom >= 3 ? 3.2 : 2.1, 0, Math.PI * 2);
          context.fillStyle = "#07101d";
          context.fill();
          context.strokeStyle = RAIL_PALETTE[lineIndex % RAIL_PALETTE.length];
          context.lineWidth = 1.4;
          context.stroke();
        }
      });
    }

    if (layers.bus && zoom >= 1.35) {
      const stopById = new Map(session.transit.stops.map((stop) => [stop.id, stop]));
      for (const route of session.transit.routes.filter((route) => route.mode === "bus" && route.status !== "suspended")) {
        const stops = route.stopIds.map((id) => stopById.get(id)).filter((stop): stop is NonNullable<typeof stop> => Boolean(stop));
        if (stops.length < 2) continue;
        context.beginPath();
        stops.forEach((stop, index) => {
          const x = originX + stop.xM / sectorSizeM * scale;
          const y = originY + stop.yM / sectorSizeM * scale;
          if (!index) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.setLineDash([Math.max(3, zoom * 2), Math.max(3, zoom * 1.6)]);
        context.strokeStyle = "rgba(255, 178, 54, .72)";
        context.lineWidth = Math.max(1, zoom * 0.4);
        context.stroke();
        context.setLineDash([]);
      }
    }

    if (layers.districts && zoom < 3.8) {
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const [index, district] of session.metropolitan.mapDistricts.entries()) {
        const x = originX + district.center.xM / sectorSizeM * scale;
        const y = originY + district.center.yM / sectorSizeM * scale;
        const selected = district.id === selectedDistrictId;
        const color = districtColor(index);
        const titleSize = Math.round(clamp(10 + zoom * 1.7, 12, 18));
        context.font = `${selected ? 800 : 700} ${titleSize}px Inter, sans-serif`;
        const titleWidth = context.measureText(district.name).width;
        context.font = `600 ${Math.round(clamp(8 + zoom, 9, 12))}px Inter, sans-serif`;
        const riskText = `${district.riskScore >= 60 ? "ВЫСОКИЙ" : district.riskScore >= 40 ? "СРЕДНИЙ" : "НИЗКИЙ"} РИСК`;
        const panelWidth = Math.max(titleWidth + 26, context.measureText(riskText).width + 26);
        context.fillStyle = "rgba(2, 7, 13, .78)";
        context.fillRect(x - panelWidth / 2, y - 22, panelWidth, 44);
        context.strokeStyle = hexToRgba(color, selected ? .95 : .42);
        context.lineWidth = selected ? 1.6 : .8;
        context.strokeRect(x - panelWidth / 2, y - 22, panelWidth, 44);
        context.font = `${selected ? 800 : 700} ${titleSize}px Inter, sans-serif`;
        context.fillStyle = selected ? "#fff" : hexToRgba(color, .96);
        context.fillText(district.name.toUpperCase(), x, y - 5);
        context.font = `600 ${Math.round(clamp(8 + zoom, 9, 12))}px Inter, sans-serif`;
        context.fillStyle = hexToRgba(color, .88);
        context.fillText(riskText, x, y + 11);
      }
    }

    const selectedSector = session.metropolitan.sectors.find((sector) => sector.id === selectedSectorId);
    if (selectedSector) {
      const x = originX + selectedSector.xIndex * scale;
      const y = originY + selectedSector.yIndex * scale;
      context.strokeStyle = "#ff304d";
      context.lineWidth = Math.max(1.8, zoom * 0.7);
      context.strokeRect(x + 1, y + 1, Math.max(1, scale - 2), Math.max(1, scale - 2));
    }
    if (selectedPoint) {
      const x = originX + selectedPoint.xM / sectorSizeM * scale;
      const y = originY + selectedPoint.yM / sectorSizeM * scale;
      context.beginPath();
      context.arc(x, y, 5.5, 0, Math.PI * 2);
      context.fillStyle = "#ff304d";
      context.fill();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.stroke();
    }
    const player = session.localScene.playerPosition;
    const playerX = originX + player.xM / sectorSizeM * scale;
    const playerY = originY + player.yM / sectorSizeM * scale;
    context.beginPath();
    context.arc(playerX, playerY, 5, 0, Math.PI * 2);
    context.fillStyle = "#ffffff";
    context.fill();
    context.strokeStyle = "#ff304d";
    context.lineWidth = 2.5;
    context.stroke();
  }, [camera, districtIndex, layers, resizeTick, selectedDistrictId, selectedPoint, selectedSectorId, session]);

  function clientPoint(event: ReactPointerEvent<HTMLCanvasElement>): PointerPoint {
    return { x: event.clientX, y: event.clientY, time: performance.now() };
  }

  function zoomAt(clientX: number, clientY: number, nextZoom: number): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const oldGeometry = mapGeometry(bounds.width, bounds.height);
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const worldX = (localX - oldGeometry.originX) / oldGeometry.scale;
    const worldY = (localY - oldGeometry.originY) / oldGeometry.scale;
    const baseScale = Math.min((bounds.width - 24) / session.metropolitan.config.sectorsWide, (bounds.height - 24) / session.metropolitan.config.sectorsHigh);
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const scale = baseScale * zoom;
    const panX = localX - (bounds.width - session.metropolitan.config.sectorsWide * scale) / 2 - worldX * scale;
    const panY = localY - (bounds.height - session.metropolitan.config.sectorsHigh * scale) / 2 - worldY * scale;
    setCamera(constrainedCamera({ zoom, panX, panY }, bounds.width, bounds.height, session.metropolitan.config.sectorsWide, session.metropolitan.config.sectorsHigh));
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (inertiaFrame.current !== null) cancelAnimationFrame(inertiaFrame.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, clientPoint(event));
    moved.current = 0;
    velocity.current = { x: 0, y: 0 };
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      const bounds = event.currentTarget.getBoundingClientRect();
      const geometry = mapGeometry(bounds.width, bounds.height);
      const midX = (first.x + second.x) / 2 - bounds.left;
      const midY = (first.y + second.y) / 2 - bounds.top;
      pinch.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: geometry.camera.zoom,
        worldX: (midX - geometry.originX) / geometry.scale,
        worldY: (midY - geometry.originY) / geometry.scale
      };
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const current = clientPoint(event);
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const dt = Math.max(8, current.time - previous.time);
    moved.current += Math.abs(dx) + Math.abs(dy);
    velocity.current = { x: dx / dt * 16, y: dy / dt * 16 };
    pointers.current.set(event.pointerId, current);
    const bounds = event.currentTarget.getBoundingClientRect();

    if (pointers.current.size >= 2 && pinch.current) {
      const [first, second] = [...pointers.current.values()];
      const state = pinch.current;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const nextZoom = clamp(state.zoom * distance / Math.max(1, state.distance), MIN_ZOOM, MAX_ZOOM);
      const midX = (first.x + second.x) / 2 - bounds.left;
      const midY = (first.y + second.y) / 2 - bounds.top;
      const baseScale = Math.min((bounds.width - 24) / session.metropolitan.config.sectorsWide, (bounds.height - 24) / session.metropolitan.config.sectorsHigh);
      const scale = baseScale * nextZoom;
      setCamera(constrainedCamera({
        zoom: nextZoom,
        panX: midX - (bounds.width - session.metropolitan.config.sectorsWide * scale) / 2 - state.worldX * scale,
        panY: midY - (bounds.height - session.metropolitan.config.sectorsHigh * scale) / 2 - state.worldY * scale
      }, bounds.width, bounds.height, session.metropolitan.config.sectorsWide, session.metropolitan.config.sectorsHigh));
      return;
    }
    setCamera((value) => constrainedCamera({ ...value, panX: value.panX + dx, panY: value.panY + dy }, bounds.width, bounds.height, session.metropolitan.config.sectorsWide, session.metropolitan.config.sectorsHigh));
  }

  function selectAt(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    const geometry = mapGeometry(bounds.width, bounds.height);
    const worldX = (event.clientX - bounds.left - geometry.originX) / geometry.scale;
    const worldY = (event.clientY - bounds.top - geometry.originY) / geometry.scale;
    const xIndex = Math.floor(worldX);
    const yIndex = Math.floor(worldY);
    const sector = session.metropolitan.sectors.find((item) => item.xIndex === xIndex && item.yIndex === yIndex);
    if (!sector) return;
    if (geometry.camera.zoom < 1.55) {
      const district = session.metropolitan.mapDistricts.find((item) => item.id === sector.mapDistrictId);
      if (district) onSelectDistrict(district);
      return;
    }
    onSelectSector({
      sector,
      xM: clamp(worldX * session.metropolitan.config.sectorSizeM, sector.bounds.xM, sector.bounds.xM + sector.bounds.widthM),
      yM: clamp(worldY * session.metropolitan.config.sectorSizeM, sector.bounds.yM, sector.bounds.yM + sector.bounds.heightM)
    });
  }

  function runInertia(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const step = () => {
      velocity.current.x *= 0.9;
      velocity.current.y *= 0.9;
      if (Math.abs(velocity.current.x) + Math.abs(velocity.current.y) < 0.25) return;
      setCamera((value) => constrainedCamera({ ...value, panX: value.panX + velocity.current.x, panY: value.panY + velocity.current.y }, bounds.width, bounds.height, session.metropolitan.config.sectorsWide, session.metropolitan.config.sectorsHigh));
      inertiaFrame.current = requestAnimationFrame(step);
    };
    inertiaFrame.current = requestAnimationFrame(step);
  }

  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    if (wasSingle && moved.current <= 8) selectAt(event);
    else if (!pointers.current.size) runInertia();
  }

  function wheel(event: ReactWheelEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, camera.zoom * (event.deltaY > 0 ? 0.84 : 1.18));
  }

  function zoomButton(factor: number): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, camera.zoom * factor);
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
        onDoubleClick={(event: ReactMouseEvent<HTMLCanvasElement>) => zoomAt(event.clientX, event.clientY, camera.zoom * 1.7)}
        onWheel={wheel}
      />
      <div className="map-scale">{camera.zoom < 1.55 ? "РАЙОНЫ" : camera.zoom < 2.8 ? "СЕКТОРА" : "УЛИЧНЫЙ МАСШТАБ"} · {camera.zoom.toFixed(1)}×</div>
      <div className="map-controls" aria-label="Управление масштабом">
        <button type="button" aria-label="Приблизить" onClick={() => zoomButton(1.35)}>＋</button>
        <button type="button" aria-label="Отдалить" onClick={() => zoomButton(0.74)}>−</button>
        <button type="button" aria-label="Показать весь город" onClick={() => setCamera({ zoom: 1, panX: 0, panY: 0 })}>⌖</button>
      </div>
    </div>
  );
}
