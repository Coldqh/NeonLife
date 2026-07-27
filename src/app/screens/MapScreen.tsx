import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GameSession } from "../../world/state/types";
import type { MapDistrictState, MetropolitanSectorState } from "../../simulation/spatial/types";
import { getTravelOptions } from "../../gameplay/travel/travelSystem";
import { GlobalCityMap, type MapLayers, type MapPointSelection } from "../map/GlobalCityMap";
import { LocalSectorMap } from "../map/LocalSectorMap";
import { compactNumber, PLACE_ICONS } from "../shared/presentation";
import type { MapMode } from "../shared/types";

const LAYER_ITEMS: Array<{ key: keyof MapLayers; label: string; icon: string }> = [
  { key: "districts", label: "Районы", icon: "◇" },
  { key: "roads", label: "Дороги", icon: "⌁" },
  { key: "rail", label: "Метро", icon: "M" },
  { key: "bus", label: "Автобусы", icon: "B" },
  { key: "traffic", label: "Трафик", icon: "↗" },
  { key: "risk", label: "Риск", icon: "!" },
  { key: "activity", label: "Активность", icon: "●" }
];

function landUseLabel(value: MetropolitanSectorState["landUse"]): string {
  const labels: Record<MetropolitanSectorState["landUse"], string> = {
    residential: "Жилая зона", mixed: "Смешанная застройка", commercial: "Коммерция",
    industrial: "Промышленность", corporate: "Корпоративная зона", civic: "Городская зона",
    transport: "Транспортный узел", utility: "Инфраструктура", vacant: "Незастроенная зона"
  };
  return labels[value];
}

function modeLabel(mode: ReturnType<typeof getTravelOptions>[number]["mode"]): string {
  if (mode === "walk") return "Пешком";
  if (mode === "bus") return "Автобус";
  if (mode === "metro") return "Метро";
  return "Такси";
}

interface SwipePoint { x: number; y: number }
type InspectorLevel = "district" | "sector";

export function MapScreen({
  session,
  requestedLocationId,
  onRequestedLocationHandled,
  onTravel
}: {
  session: GameSession;
  requestedLocationId?: string;
  onRequestedLocationHandled: () => void;
  onTravel: (locationId: string) => void;
}) {
  const focusSector = session.metropolitan.sectors.find((sector) => sector.id === session.metropolitan.streaming.focusSectorId)
    ?? session.metropolitan.sectors[0];
  const [mode, setMode] = useState<MapMode>("global");
  const [inspectorLevel, setInspectorLevel] = useState<InspectorLevel>("sector");
  const [selectedSectorId, setSelectedSectorId] = useState(focusSector.id);
  const [selectedDistrictId, setSelectedDistrictId] = useState(focusSector.mapDistrictId);
  const [selectedPoint, setSelectedPoint] = useState<{ xM: number; yM: number } | null>({
    xM: session.localScene.playerPosition.xM,
    yM: session.localScene.playerPosition.yM
  });
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [layers, setLayers] = useState<MapLayers>({ districts: true, roads: true, rail: true, bus: false, traffic: false, risk: false, activity: false });
  const [focusRevision, setFocusRevision] = useState(0);
  const swipe = useRef<SwipePoint | null>(null);

  useEffect(() => {
    if (!requestedLocationId) return;
    const placement = session.metropolitan.locations.find((item) => item.locationId === requestedLocationId);
    if (placement) {
      const sector = session.metropolitan.sectors.find((item) => item.id === placement.sectorId);
      setSelectedSectorId(placement.sectorId);
      if (sector) setSelectedDistrictId(sector.mapDistrictId);
      setSelectedLocationId(requestedLocationId);
      setInspectorLevel("sector");
      setMode("local");
    }
    onRequestedLocationHandled();
  }, [onRequestedLocationHandled, requestedLocationId, session.metropolitan.locations, session.metropolitan.sectors]);

  const selectedSector = session.metropolitan.sectors.find((sector) => sector.id === selectedSectorId) ?? focusSector;
  const selectedDistrict = session.metropolitan.mapDistricts.find((district) => district.id === selectedDistrictId)
    ?? session.metropolitan.mapDistricts.find((district) => district.id === selectedSector.mapDistrictId)
    ?? session.metropolitan.mapDistricts[0];
  const administrativeDistrict = session.world.districts.find((district) => district.id === selectedDistrict?.administrativeDistrictId);

  const sectorLocations = useMemo(() => session.metropolitan.locations
    .filter((placement) => placement.sectorId === selectedSector.id)
    .flatMap((placement) => {
      const location = session.world.locations.find((item) => item.id === placement.locationId);
      return location ? [location] : [];
    }), [selectedSector.id, session.metropolitan.locations, session.world.locations]);
  const sectorStops = useMemo(() => session.transit.stops.filter((stop) => stop.sectorId === selectedSector.id), [selectedSector.id, session.transit.stops]);
  const districtSectors = useMemo(() => selectedDistrict
    ? selectedDistrict.sectorIds.map((id) => session.metropolitan.sectors.find((sector) => sector.id === id)).filter((sector): sector is MetropolitanSectorState => Boolean(sector))
    : [], [selectedDistrict, session.metropolitan.sectors]);
  const selectedLocation = session.world.locations.find((location) => location.id === selectedLocationId) ?? null;
  const travelOption = selectedLocation ? getTravelOptions(session).find((option) => option.location.id === selectedLocation.id) : undefined;

  function selectSector(selection: MapPointSelection): void {
    setSelectedSectorId(selection.sector.id);
    setSelectedDistrictId(selection.sector.mapDistrictId);
    setSelectedPoint({ xM: Math.round(selection.xM), yM: Math.round(selection.yM) });
    setSelectedLocationId(null);
    setInspectorLevel("sector");
  }

  function selectDistrict(district: MapDistrictState): void {
    setSelectedDistrictId(district.id);
    setSelectedLocationId(null);
    setInspectorLevel("district");
  }

  function selectDistrictSector(sector: MetropolitanSectorState): void {
    setSelectedSectorId(sector.id);
    setSelectedDistrictId(sector.mapDistrictId);
    setSelectedPoint({ xM: sector.bounds.xM + sector.bounds.widthM / 2, yM: sector.bounds.yM + sector.bounds.heightM / 2 });
    setInspectorLevel("sector");
    setFocusRevision((value) => value + 1);
  }

  function beginTravel(): void {
    if (!selectedLocation || selectedLocation.id === session.life.currentLocationId) return;
    onTravel(selectedLocation.id);
  }

  function swipeStart(event: ReactPointerEvent<HTMLElement>): void {
    if (event.target instanceof Element && event.target.closest("button, canvas, svg, input, [role='button'], [data-no-swipe]")) return;
    swipe.current = { x: event.clientX, y: event.clientY };
  }

  function swipeEnd(event: ReactPointerEvent<HTMLElement>): void {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    setMode(dx < 0 ? "local" : "global");
  }

  return (
    <section className="screen map-screen" aria-labelledby="map-title" onPointerDown={swipeStart} onPointerUp={swipeEnd}>
      <header className="screen-heading map-screen__heading">
        <div>
          <span>{session.world.city.name}</span>
          <h1 id="map-title">Карта города</h1>
          <p>{session.metropolitan.mapDistricts.length} районов · {session.metropolitan.totals.sectors} секторов · {compactNumber(session.metropolitan.totals.representedPopulation)} жителей</p>
        </div>
        <div className="segmented-control" aria-label="Уровень карты">
          <button type="button" className={mode === "global" ? "is-active" : ""} onClick={() => setMode("global")}>Город</button>
          <button type="button" className={mode === "local" ? "is-active" : ""} onClick={() => setMode("local")}>Сектор</button>
        </div>
      </header>

      <div className="map-layout">
        <div className="map-layout__canvas">
          {mode === "global" ? (
            <>
              <GlobalCityMap
                session={session}
                selectedSectorId={inspectorLevel === "sector" ? selectedSector.id : undefined}
                selectedDistrictId={selectedDistrict?.id}
                selectedPoint={inspectorLevel === "sector" ? selectedPoint : null}
                layers={layers}
                focusDistrictId={inspectorLevel === "district" ? selectedDistrict?.id : undefined}
                focusSectorId={inspectorLevel === "sector" ? selectedSector.id : undefined}
                focusRevision={focusRevision}
                onSelectSector={selectSector}
                onSelectDistrict={selectDistrict}
              />
              <div className="map-layers" aria-label="Слои карты" data-no-swipe>
                {LAYER_ITEMS.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className={layers[item.key] ? "is-active" : ""}
                    aria-pressed={layers[item.key]}
                    onClick={() => setLayers((value) => ({ ...value, [item.key]: !value[item.key] }))}
                  ><i>{item.icon}</i>{item.label}</button>
                ))}
              </div>
            </>
          ) : (
            <LocalSectorMap session={session} sector={selectedSector} onLocation={(location) => setSelectedLocationId(location.id)} />
          )}
        </div>

        <aside className="map-inspector">
          {inspectorLevel === "district" && selectedDistrict ? (
            <section className="district-inspector">
              <header>
                <div><span>{administrativeDistrict?.name ?? "Городской пояс"}</span><h2>{selectedDistrict.name}</h2><small>{selectedDistrict.code}</small></div>
                <button type="button" onClick={() => setFocusRevision((value) => value + 1)}>Показать</button>
              </header>
              <p>{landUseLabel(selectedDistrict.dominantLandUse)} · {selectedDistrict.sectorIds.length} секторов</p>
              <dl className="sector-metrics sector-metrics--district">
                <div><dt>Жители</dt><dd>{compactNumber(selectedDistrict.representedPopulation)}</dd></div>
                <div><dt>Транспорт</dt><dd>{selectedDistrict.transitScore}%</dd></div>
                <div><dt>Активность</dt><dd>{selectedDistrict.activityScore}%</dd></div>
                <div><dt>Риск</dt><dd>{selectedDistrict.riskScore}%</dd></div>
              </dl>
              <div className="district-sector-strip" data-no-swipe>
                {districtSectors
                  .sort((left, right) => right.crowdLoad + right.trafficLoad - left.crowdLoad - left.trafficLoad)
                  .slice(0, 8)
                  .map((sector) => <button type="button" key={sector.id} onClick={() => selectDistrictSector(sector)}><strong>{sector.code}</strong><span>{landUseLabel(sector.landUse)}</span></button>)}
              </div>
            </section>
          ) : (
            <section className="sector-inspector">
              <header>
                <div><span>{selectedDistrict?.name ?? administrativeDistrict?.name}</span><h2>{selectedSector.code}</h2></div>
                <button type="button" onClick={() => setMode(mode === "global" ? "local" : "global")}>{mode === "global" ? "Открыть сектор" : "Весь город"}</button>
              </header>
              <p>{landUseLabel(selectedSector.landUse)} · {selectedSector.detailLevel === "active" ? "активная детализация" : selectedSector.detailLevel === "warm" ? "тёплый сектор" : "фоновая симуляция"}</p>
              {selectedPoint ? <div className="map-point"><span>Выбранная точка</span><strong>{Math.round(selectedPoint.xM / 10) * 10} · {Math.round(selectedPoint.yM / 10) * 10} м</strong></div> : null}
              <dl className="sector-metrics">
                <div><dt>Жители</dt><dd>{compactNumber(selectedSector.representedPopulation)}</dd></div>
                <div><dt>Здания</dt><dd>{compactNumber(selectedSector.buildingEstimate)}</dd></div>
                <div><dt>Трафик</dt><dd>{selectedSector.trafficLoad}%</dd></div>
                <div><dt>Остановки</dt><dd>{sectorStops.length}</dd></div>
              </dl>

              <section className="sector-places">
                <header><h3>Точки сектора</h3><span>{sectorLocations.length + sectorStops.length}</span></header>
                {sectorLocations.map((location) => (
                  <button type="button" key={location.id} className={selectedLocation?.id === location.id ? "is-selected" : ""} onClick={() => setSelectedLocationId(location.id)}>
                    <i>{PLACE_ICONS[location.type]}</i>
                    <span><strong>{location.name}</strong><small>{location.open ? "Открыто" : "Закрыто"} · безопасность {location.security}%</small></span>
                  </button>
                ))}
                {sectorStops.slice(0, 6).map((stop) => (
                  <div className="sector-stop" key={stop.id}><i>{stop.mode === "metro" ? "M" : "B"}</i><span><strong>{stop.name}</strong><small>{stop.routeIds.length} маршрута · {compactNumber(stop.dailyBoardings)} посадок</small></span></div>
                ))}
                {!sectorLocations.length && !sectorStops.length ? <p className="empty-copy">В секторе нет крупных именованных точек. Здания и дороги видны на локальной карте.</p> : null}
              </section>

              {selectedLocation ? (
                <section className="route-panel">
                  <header><div><span>Маршрут</span><h3>{selectedLocation.name}</h3></div><button type="button" onClick={() => setSelectedLocationId(null)} aria-label="Закрыть маршрут">×</button></header>
                  {selectedLocation.id === session.life.currentLocationId ? <p>Ты уже находишься здесь.</p> : travelOption ? (
                    <>
                      <dl>
                        <div><dt>Способ</dt><dd>{modeLabel(travelOption.mode)}</dd></div>
                        <div><dt>Время</dt><dd>{travelOption.durationMinutes} мин.</dd></div>
                        <div><dt>Стоимость</dt><dd>{travelOption.cost ? `₵ ${travelOption.cost}` : "Бесплатно"}</dd></div>
                        <div><dt>Расстояние</dt><dd>{travelOption.distanceKm} км</dd></div>
                      </dl>
                      <button type="button" className="primary-button" disabled={session.player.balance < travelOption.cost} onClick={beginTravel}>{session.player.balance < travelOption.cost ? "Недостаточно средств" : "Начать маршрут"}</button>
                    </>
                  ) : <p>Маршрут к этой точке сейчас недоступен.</p>}
                </section>
              ) : null}
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}
