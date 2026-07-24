import { useEffect, useMemo, useState } from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { MetropolitanSectorState } from "../../simulation/spatial/types";
import { getTravelOptions } from "../../gameplay/travel/travelSystem";
import { GlobalCityMap, type MapLayers } from "../map/GlobalCityMap";
import { LocalSectorMap } from "../map/LocalSectorMap";
import { compactNumber, districtName, PLACE_ICONS } from "../shared/presentation";
import type { MapMode } from "../shared/types";

function landUseLabel(value: MetropolitanSectorState["landUse"]): string {
  const labels: Record<MetropolitanSectorState["landUse"], string> = {
    residential: "Жилая зона",
    mixed: "Смешанная застройка",
    commercial: "Коммерческая зона",
    industrial: "Промышленная зона",
    corporate: "Корпоративная зона",
    civic: "Городская зона",
    transport: "Транспортный узел",
    utility: "Инфраструктура",
    vacant: "Незастроенная зона"
  };
  return labels[value];
}

function modeLabel(mode: ReturnType<typeof getTravelOptions>[number]["mode"]): string {
  if (mode === "walk") return "Пешком";
  if (mode === "bus") return "Автобус";
  if (mode === "metro") return "Метро";
  return "Такси";
}

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
  const [mode, setMode] = useState<MapMode>("global");
  const [selectedSectorId, setSelectedSectorId] = useState(session.metropolitan.streaming.focusSectorId);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [layers, setLayers] = useState<MapLayers>({ transit: true, traffic: true, districts: true });

  useEffect(() => {
    if (!requestedLocationId) return;
    const placement = session.metropolitan.locations.find((item) => item.locationId === requestedLocationId);
    if (placement) {
      setSelectedSectorId(placement.sectorId);
      setSelectedLocationId(requestedLocationId);
      setMode("local");
    }
    onRequestedLocationHandled();
  }, [onRequestedLocationHandled, requestedLocationId, session.metropolitan.locations]);

  useEffect(() => {
    if (!session.metropolitan.sectors.some((sector) => sector.id === selectedSectorId)) {
      setSelectedSectorId(session.metropolitan.streaming.focusSectorId);
    }
  }, [selectedSectorId, session.metropolitan.sectors, session.metropolitan.streaming.focusSectorId]);

  const selectedSector = session.metropolitan.sectors.find((sector) => sector.id === selectedSectorId)
    ?? session.metropolitan.sectors[0];
  const selectedDistrict = session.world.districts.find((district) => district.id === selectedSector.districtId);
  const sectorLocations = useMemo(() => session.metropolitan.locations
    .filter((placement) => placement.sectorId === selectedSector.id)
    .flatMap((placement) => {
      const location = session.world.locations.find((item) => item.id === placement.locationId);
      return location ? [location] : [];
    }), [selectedSector.id, session.metropolitan.locations, session.world.locations]);
  const selectedLocation = session.world.locations.find((location) => location.id === selectedLocationId) ?? null;
  const travelOption = selectedLocation
    ? getTravelOptions(session).find((option) => option.location.id === selectedLocation.id)
    : undefined;

  function selectSector(sector: MetropolitanSectorState): void {
    setSelectedSectorId(sector.id);
    setSelectedLocationId(null);
  }

  function chooseLocation(location: LocationState): void {
    setSelectedLocationId(location.id);
  }

  function beginTravel(): void {
    if (!selectedLocation || selectedLocation.id === session.life.currentLocationId) return;
    onTravel(selectedLocation.id);
  }

  return (
    <section className="screen map-screen" aria-labelledby="map-title">
      <header className="screen-heading map-screen__heading">
        <div>
          <span>{session.world.city.name}</span>
          <h1 id="map-title">Карта города</h1>
          <p>{session.world.districts.length} района · {session.metropolitan.totals.sectors} секторов · {compactNumber(session.metropolitan.totals.representedPopulation)} жителей</p>
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
              <GlobalCityMap session={session} selectedId={selectedSector.id} layers={layers} onSelect={selectSector} />
              <div className="map-layers">
                <button type="button" className={layers.districts ? "is-active" : ""} onClick={() => setLayers((value) => ({ ...value, districts: !value.districts }))}>Районы</button>
                <button type="button" className={layers.transit ? "is-active" : ""} onClick={() => setLayers((value) => ({ ...value, transit: !value.transit }))}>Транспорт</button>
                <button type="button" className={layers.traffic ? "is-active" : ""} onClick={() => setLayers((value) => ({ ...value, traffic: !value.traffic }))}>Трафик</button>
              </div>
            </>
          ) : (
            <LocalSectorMap session={session} sector={selectedSector} onLocation={chooseLocation} />
          )}
        </div>

        <aside className="map-inspector">
          <header>
            <div><span>{selectedDistrict?.name ?? districtName(session)}</span><h2>{selectedSector.code}</h2></div>
            <button type="button" onClick={() => setMode(mode === "global" ? "local" : "global")}>{mode === "global" ? "Открыть сектор" : "Весь город"}</button>
          </header>
          <p>{landUseLabel(selectedSector.landUse)} · {selectedSector.detailLevel === "active" ? "активная детализация" : selectedSector.detailLevel === "warm" ? "тёплый сектор" : "фоновая симуляция"}</p>
          <dl>
            <div><dt>Жители</dt><dd>{compactNumber(selectedSector.representedPopulation)}</dd></div>
            <div><dt>Здания</dt><dd>{compactNumber(selectedSector.buildingEstimate)}</dd></div>
            <div><dt>Трафик</dt><dd>{selectedSector.trafficLoad}%</dd></div>
            <div><dt>Люди на улице</dt><dd>{selectedSector.crowdLoad}%</dd></div>
          </dl>

          <section className="sector-places">
            <h3>Точки сектора</h3>
            {sectorLocations.map((location) => (
              <button
                type="button"
                key={location.id}
                className={selectedLocation?.id === location.id ? "is-selected" : ""}
                onClick={() => chooseLocation(location)}
              >
                <i>{PLACE_ICONS[location.type]}</i>
                <span><strong>{location.name}</strong><small>{location.open ? "Открыто" : "Закрыто"} · безопасность {location.security}%</small></span>
              </button>
            ))}
            {!sectorLocations.length ? <p className="empty-copy">В секторе нет крупных именованных точек. Физические здания появятся после материализации.</p> : null}
          </section>

          {selectedLocation ? (
            <section className="route-panel">
              <header><div><span>Маршрут</span><h3>{selectedLocation.name}</h3></div><button type="button" onClick={() => setSelectedLocationId(null)}>×</button></header>
              {selectedLocation.id === session.life.currentLocationId ? (
                <p>Ты уже находишься здесь.</p>
              ) : travelOption ? (
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
        </aside>
      </div>
    </section>
  );
}
