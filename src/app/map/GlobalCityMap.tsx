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
import {
  CAMERA_KEY, MAX_ZOOM, MIN_ZOOM, RAIL_PALETTE,
  boundaryLoops, clamp, constrainedCamera, districtBounds, districtColor,
  hexToRgba, loadCamera, rawLoopPath, riskLabel, roundedLoopPath, seededUnit, stringHash,
  type CameraState
} from "./globalMapGeometry";

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

interface PointerPoint { x: number; y: number; time: number }
interface PinchState { distance: number; zoom: number; worldX: number; worldY: number }

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
  const cityLoops = useMemo(() => boundaryLoops(session.metropolitan.sectors), [session.metropolitan.sectors]);
  const districtLoops = useMemo(() => new Map(session.metropolitan.mapDistricts.map((district) => [district.id, boundaryLoops(session.metropolitan.sectors, district.id)])), [session.metropolitan.mapDistricts, session.metropolitan.sectors]);

  useEffect(() => { try { localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)); } catch { /* optional */ } }, [camera]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setResizeTick((value) => value + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { if (inertiaFrame.current !== null) cancelAnimationFrame(inertiaFrame.current); }, []);

  function mapGeometry(width: number, height: number, value = camera) {
    const columns = session.metropolitan.config.sectorsWide;
    const rows = session.metropolitan.config.sectorsHigh;
    const actual = constrainedCamera(value, width, height, columns, rows);
    const baseScale = Math.min((width - 34) / columns, (height - 34) / rows);
    const scale = baseScale * actual.zoom;
    return { camera: actual, scale, originX: (width - columns * scale) / 2 + actual.panX, originY: (height - rows * scale) / 2 + actual.panY };
  }

  function focusBounds(bounds: MetricBounds, padding = 74): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const columns = session.metropolitan.config.sectorsWide;
    const rows = session.metropolitan.config.sectorsHigh;
    const baseScale = Math.min((rect.width - 34) / columns, (rect.height - 34) / rows);
    const widthInSectors = bounds.widthM / session.metropolitan.config.sectorSizeM;
    const heightInSectors = bounds.heightM / session.metropolitan.config.sectorSizeM;
    const zoom = clamp(Math.min((rect.width - padding * 2) / Math.max(1, widthInSectors * baseScale), (rect.height - padding * 2) / Math.max(1, heightInSectors * baseScale)), 1.08, MAX_ZOOM);
    const centerX = (bounds.xM + bounds.widthM / 2) / session.metropolitan.config.sectorSizeM;
    const centerY = (bounds.yM + bounds.heightM / 2) / session.metropolitan.config.sectorSizeM;
    const scale = baseScale * zoom;
    setCamera(constrainedCamera({ zoom, panX: (columns / 2 - centerX) * scale, panY: (rows / 2 - centerY) * scale }, rect.width, rect.height, columns, rows));
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

    const sea = context.createRadialGradient(bounds.width * .46, bounds.height * .42, 0, bounds.width * .46, bounds.height * .42, Math.max(bounds.width, bounds.height) * .78);
    sea.addColorStop(0, "#091520");
    sea.addColorStop(.55, "#040a11");
    sea.addColorStop(1, "#010407");
    context.fillStyle = sea;
    context.fillRect(0, 0, bounds.width, bounds.height);

    const geometry = mapGeometry(bounds.width, bounds.height);
    const { scale, originX, originY } = geometry;
    const zoom = geometry.camera.zoom;
    const sectorSizeM = session.metropolitan.config.sectorSizeM;
    const cityRaw = rawLoopPath(cityLoops, originX, originY, scale);
    const cityRounded = roundedLoopPath(cityLoops, originX, originY, scale, Math.max(5, scale * .2));

    context.save();
    context.globalAlpha = .28;
    context.strokeStyle = "rgba(46, 113, 151, .32)";
    context.lineWidth = 1;
    for (let y = 18; y < bounds.height; y += 24) {
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(bounds.width * .28, y - 4, bounds.width * .64, y + 5, bounds.width, y - 2);
      context.stroke();
    }
    context.restore();

    context.save();
    context.shadowColor = "rgba(0,0,0,.9)";
    context.shadowBlur = 38;
    context.fillStyle = "#07111b";
    context.fill(cityRaw, "evenodd");
    context.restore();

    for (const district of session.metropolitan.mapDistricts) {
      const index = districtIndex.get(district.id) ?? 0;
      const color = districtColor(index);
      const selected = district.id === selectedDistrictId;
      const loops = districtLoops.get(district.id) ?? [];
      const raw = rawLoopPath(loops, originX, originY, scale);
      const rounded = roundedLoopPath(loops, originX, originY, scale, Math.max(4, scale * .17));
      const dimmed = Boolean(selectedDistrictId && !selected);
      const fill = context.createLinearGradient(originX, originY, originX + bounds.width * .7, originY + bounds.height * .8);
      fill.addColorStop(0, hexToRgba(color, layers.risk ? clamp(district.riskScore / 180, .18, .58) : selected ? .38 : .22));
      fill.addColorStop(1, hexToRgba(color, layers.activity ? clamp(district.activityScore / 220, .12, .42) : selected ? .25 : .12));
      context.save();
      context.globalAlpha = dimmed ? .25 : 1;
      context.fillStyle = fill;
      context.fill(raw, "evenodd");
      context.shadowColor = hexToRgba(color, selected ? .78 : .22);
      context.shadowBlur = selected ? 24 : 9;
      context.strokeStyle = hexToRgba(color, selected ? 1 : .56);
      context.lineWidth = selected ? Math.max(2.2, zoom * 1.2) : Math.max(1, zoom * .52);
      context.stroke(rounded);
      context.restore();
    }

    context.save();
    context.strokeStyle = "rgba(86, 194, 224, .34)";
    context.lineWidth = Math.max(1.3, zoom * .58);
    context.shadowColor = "rgba(55, 164, 201, .3)";
    context.shadowBlur = 9;
    context.stroke(cityRounded);
    context.restore();

    for (const sector of session.metropolitan.sectors) {
      const districtSelected = !selectedDistrictId || sector.mapDistrictId === selectedDistrictId;
      if (!districtSelected) continue;
      const seed = stringHash(sector.id);
      const x = originX + sector.xIndex * scale;
      const y = originY + sector.yIndex * scale;
      const density = clamp(sector.densityPerKm2 / 90000, .08, .94);
      const count = zoom < 1.25 ? 2 : zoom < 2.4 ? 4 : 7;
      context.save();
      context.globalAlpha = .12 + density * .22;
      for (let index = 0; index < count; index += 1) {
        const px = x + (.12 + seededUnit(seed + index * 11) * .72) * scale;
        const py = y + (.12 + seededUnit(seed + index * 17 + 5) * .72) * scale;
        const width = Math.max(.7, scale * (.025 + seededUnit(seed + index * 31) * .04));
        const height = Math.max(.7, scale * (.02 + seededUnit(seed + index * 47) * .035));
        context.fillStyle = index % 5 === 0 ? "rgba(255,164,82,.9)" : "rgba(176,214,239,.65)";
        context.fillRect(px, py, width, height);
      }
      context.restore();
    }

    if (layers.roads) {
      const nodeById = new Map(session.metropolitan.roadNodes.map((node) => [node.id, node]));
      const drawLinks = (underlay: boolean) => {
        context.lineCap = "round";
        context.lineJoin = "round";
        for (const link of session.metropolitan.roadLinks) {
          if (link.class === "collector" && zoom < 1.75) continue;
          if (link.class === "local" && zoom < 3.2) continue;
          const from = nodeById.get(link.fromNodeId);
          const to = nodeById.get(link.toNodeId);
          if (!from || !to) continue;
          context.beginPath();
          context.moveTo(originX + from.xM / sectorSizeM * scale, originY + from.yM / sectorSizeM * scale);
          context.lineTo(originX + to.xM / sectorSizeM * scale, originY + to.yM / sectorSizeM * scale);
          if (underlay) {
            context.strokeStyle = "rgba(1, 4, 8, .72)";
            context.lineWidth = link.class === "expressway" ? Math.max(4, zoom * 2.1) : link.class === "arterial" ? Math.max(2.7, zoom * 1.35) : Math.max(1.7, zoom * .85);
          } else {
            context.strokeStyle = layers.traffic && link.trafficLoad >= 55 ? link.trafficLoad >= 78 ? "rgba(255, 62, 83, .92)" : "rgba(255, 177, 62, .84)" : link.class === "expressway" ? "rgba(229, 237, 247, .83)" : link.class === "arterial" ? "rgba(128, 166, 199, .72)" : "rgba(93, 124, 155, .45)";
            context.lineWidth = link.class === "expressway" ? Math.max(1.6, zoom * .72) : link.class === "arterial" ? Math.max(1.05, zoom * .48) : Math.max(.72, zoom * .3);
          }
          context.stroke();
        }
      };
      drawLinks(true);
      drawLinks(false);
    }

    if (layers.rail) {
      const stationById = new Map(session.metropolitan.transitStations.map((station) => [station.id, station]));
      session.metropolitan.transitLines.forEach((line, lineIndex) => {
        if (line.mode === "freight" && zoom < 1.55) return;
        const stations = line.stationIds.map((id) => stationById.get(id)).filter((station): station is NonNullable<typeof station> => Boolean(station));
        if (stations.length < 2) return;
        context.beginPath();
        stations.forEach((station, index) => {
          const x = originX + station.xM / sectorSizeM * scale;
          const y = originY + station.yM / sectorSizeM * scale;
          if (!index) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.save();
        context.shadowColor = RAIL_PALETTE[lineIndex % RAIL_PALETTE.length];
        context.shadowBlur = 7;
        context.strokeStyle = RAIL_PALETTE[lineIndex % RAIL_PALETTE.length];
        context.lineWidth = line.mode === "metro" ? Math.max(1.8, zoom * .72) : Math.max(1.2, zoom * .48);
        context.globalAlpha = line.mode === "freight" ? .45 : .92;
        context.stroke();
        context.restore();
        if (zoom >= 1.45) for (const station of stations) {
          context.beginPath();
          context.arc(originX + station.xM / sectorSizeM * scale, originY + station.yM / sectorSizeM * scale, zoom >= 3 ? 3 : 2, 0, Math.PI * 2);
          context.fillStyle = "#050b12";
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
        context.strokeStyle = "rgba(255, 181, 65, .75)";
        context.lineWidth = Math.max(1, zoom * .4);
        context.stroke();
        context.setLineDash([]);
      }
    }

    if ((layers.activity || layers.risk) && zoom < 2.35) {
      for (const district of session.metropolitan.mapDistricts) {
        const x = originX + district.center.xM / sectorSizeM * scale;
        const y = originY + district.center.yM / sectorSizeM * scale;
        const radius = Math.max(16, scale * 1.15);
        const value = layers.risk ? district.riskScore : district.activityScore;
        const glow = context.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, layers.risk ? `rgba(255,45,69,${value / 180})` : `rgba(60,223,154,${value / 210})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = glow;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    }

    if ((layers.activity || layers.risk || layers.districts) && zoom < 2.65) {
      context.textAlign = "center";
      context.textBaseline = "middle";
      for (const [index, district] of session.metropolitan.mapDistricts.entries()) {
        const selected = district.id === selectedDistrictId;
        if (selectedDistrictId && !selected && zoom > 1.5) continue;
        const x = originX + district.center.xM / sectorSizeM * scale;
        const y = originY + district.center.yM / sectorSizeM * scale;
        const color = districtColor(index);
        const size = Math.round(clamp(10 + zoom * 2.1, 12, selected ? 22 : 17));
        context.save();
        context.shadowColor = "rgba(0,0,0,.95)";
        context.shadowBlur = 12;
        context.font = `${selected ? 900 : 800} ${size}px Inter, sans-serif`;
        context.fillStyle = selected ? "#fff" : hexToRgba(color, .98);
        context.fillText(district.name.toUpperCase(), x, y - 4);
        context.font = `700 ${Math.round(clamp(8 + zoom, 9, 12))}px Inter, sans-serif`;
        context.fillStyle = selected ? hexToRgba(color, 1) : "rgba(218,226,238,.68)";
        context.fillText(`${riskLabel(district.riskScore)} РИСК`, x, y + size * .78);
        context.restore();
      }
    }

    if (layers.activity || layers.risk) {
      const wantedTypes = layers.activity ? new Set(["office", "workshop", "education", "government"]) : new Set(["clinic", "transport", "market"]);
      const points = session.metropolitan.locations.flatMap((placement) => {
        const location = session.world.locations.find((item) => item.id === placement.locationId);
        return location && wantedTypes.has(location.type) ? [{ placement, location }] : [];
      }).slice(0, zoom < 1.8 ? 18 : 34);
      for (const { placement, location } of points) {
        const x = originX + (placement.bounds.xM + placement.bounds.widthM / 2) / sectorSizeM * scale;
        const y = originY + (placement.bounds.yM + placement.bounds.heightM / 2) / sectorSizeM * scale;
        context.beginPath();
        context.arc(x, y, zoom < 2 ? 2.4 : 3.2, 0, Math.PI * 2);
        context.fillStyle = location.type === "clinic" ? "#b66cff" : location.type === "transport" ? "#41cce7" : location.type === "market" ? "#4ee291" : "#5b90ff";
        context.fill();
        context.strokeStyle = "rgba(255,255,255,.85)";
        context.lineWidth = 1;
        context.stroke();
      }
    }

    const selectedSector = session.metropolitan.sectors.find((sector) => sector.id === selectedSectorId);
    if (selectedSector && zoom >= 1.35) {
      const x = originX + selectedSector.xIndex * scale;
      const y = originY + selectedSector.yIndex * scale;
      context.save();
      context.strokeStyle = "#ff3955";
      context.lineWidth = Math.max(1.6, zoom * .65);
      context.shadowColor = "rgba(255,48,77,.72)";
      context.shadowBlur = 8;
      context.strokeRect(x + 2, y + 2, Math.max(1, scale - 4), Math.max(1, scale - 4));
      context.restore();
    }
    if (selectedPoint) {
      const x = originX + selectedPoint.xM / sectorSizeM * scale;
      const y = originY + selectedPoint.yM / sectorSizeM * scale;
      context.beginPath(); context.arc(x, y, 4.5, 0, Math.PI * 2);
      context.fillStyle = "#ff304d"; context.fill();
      context.strokeStyle = "#fff"; context.lineWidth = 1.8; context.stroke();
    }
    const player = session.localScene.playerPosition;
    const playerX = originX + player.xM / sectorSizeM * scale;
    const playerY = originY + player.yM / sectorSizeM * scale;
    context.save();
    context.beginPath(); context.arc(playerX, playerY, 5.2, 0, Math.PI * 2);
    context.fillStyle = "#06101b"; context.fill();
    context.strokeStyle = "#43e58f"; context.lineWidth = 2.2; context.shadowColor = "rgba(67,229,143,.68)"; context.shadowBlur = 8; context.stroke();
    context.beginPath(); context.arc(playerX, playerY, 1.8, 0, Math.PI * 2);
    context.fillStyle = "#bfffdc"; context.fill();
    context.restore();
  }, [camera, cityLoops, districtIndex, districtLoops, layers, resizeTick, selectedDistrictId, selectedPoint, selectedSectorId, session]);

  function clientPoint(event: ReactPointerEvent<HTMLCanvasElement>): PointerPoint { return { x: event.clientX, y: event.clientY, time: performance.now() }; }
  function zoomAt(clientX: number, clientY: number, nextZoom: number): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const oldGeometry = mapGeometry(bounds.width, bounds.height);
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const worldX = (localX - oldGeometry.originX) / oldGeometry.scale;
    const worldY = (localY - oldGeometry.originY) / oldGeometry.scale;
    const baseScale = Math.min((bounds.width - 34) / session.metropolitan.config.sectorsWide, (bounds.height - 34) / session.metropolitan.config.sectorsHigh);
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
      pinch.current = { distance: Math.hypot(second.x - first.x, second.y - first.y), zoom: geometry.camera.zoom, worldX: (midX - geometry.originX) / geometry.scale, worldY: (midY - geometry.originY) / geometry.scale };
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
      const baseScale = Math.min((bounds.width - 34) / session.metropolitan.config.sectorsWide, (bounds.height - 34) / session.metropolitan.config.sectorsHigh);
      const scale = baseScale * nextZoom;
      setCamera(constrainedCamera({ zoom: nextZoom, panX: midX - (bounds.width - session.metropolitan.config.sectorsWide * scale) / 2 - state.worldX * scale, panY: midY - (bounds.height - session.metropolitan.config.sectorsHigh * scale) / 2 - state.worldY * scale }, bounds.width, bounds.height, session.metropolitan.config.sectorsWide, session.metropolitan.config.sectorsHigh));
      return;
    }
    setCamera((value) => constrainedCamera({ ...value, panX: value.panX + dx, panY: value.panY + dy }, bounds.width, bounds.height, session.metropolitan.config.sectorsWide, session.metropolitan.config.sectorsHigh));
  }
  function selectAt(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    const geometry = mapGeometry(bounds.width, bounds.height);
    const worldX = (event.clientX - bounds.left - geometry.originX) / geometry.scale;
    const worldY = (event.clientY - bounds.top - geometry.originY) / geometry.scale;
    const sector = session.metropolitan.sectors.find((item) => item.xIndex === Math.floor(worldX) && item.yIndex === Math.floor(worldY));
    if (!sector) return;
    if (geometry.camera.zoom < 1.7) {
      const district = session.metropolitan.mapDistricts.find((item) => item.id === sector.mapDistrictId);
      if (district) onSelectDistrict(district);
      return;
    }
    onSelectSector({ sector, xM: clamp(worldX * session.metropolitan.config.sectorSizeM, sector.bounds.xM, sector.bounds.xM + sector.bounds.widthM), yM: clamp(worldY * session.metropolitan.config.sectorSizeM, sector.bounds.yM, sector.bounds.yM + sector.bounds.heightM) });
  }
  function runInertia(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const step = () => {
      velocity.current.x *= .9;
      velocity.current.y *= .9;
      if (Math.abs(velocity.current.x) + Math.abs(velocity.current.y) < .25) return;
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
  function wheel(event: ReactWheelEvent<HTMLCanvasElement>): void { event.preventDefault(); zoomAt(event.clientX, event.clientY, camera.zoom * (event.deltaY > 0 ? .84 : 1.18)); }
  function zoomButton(factor: number): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, camera.zoom * factor);
  }

  return (
    <div className="global-map global-map--city" data-no-swipe>
      <canvas ref={canvasRef} aria-label="Интерактивная глобальная карта города" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={(event) => { pointers.current.delete(event.pointerId); pinch.current = null; }} onDoubleClick={(event: ReactMouseEvent<HTMLCanvasElement>) => zoomAt(event.clientX, event.clientY, camera.zoom * 1.7)} onWheel={wheel} />
      <div className="map-scale">{camera.zoom < 1.7 ? "РАЙОНЫ" : camera.zoom < 3 ? "СЕКТОРА" : "ГОРОДСКАЯ СЕТЬ"} · {camera.zoom.toFixed(1)}×</div>
      <div className="map-controls" aria-label="Управление масштабом"><button type="button" aria-label="Приблизить" onClick={() => zoomButton(1.35)}>＋</button><button type="button" aria-label="Отдалить" onClick={() => zoomButton(.74)}>−</button><button type="button" aria-label="Показать весь город" onClick={() => setCamera({ zoom: 1, panX: 0, panY: 0 })}>⌖</button></div>
    </div>
  );
}
