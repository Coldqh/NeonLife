import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { MapDistrictState, MetropolitanSectorState } from "../../simulation/spatial/types";
import { getTravelOptions, isLocationOpen } from "../../gameplay/travel/travelSystem";
import { getSectorStreetTopology } from "../../simulation/streets/streetTopologySystem";
import { GlobalCityMap, type MapLayers, type MapPointSelection } from "../map/GlobalCityMap";
import { LocalSectorMap, type LocalMapSelection } from "../map/LocalSectorMap";
import { RouteCard } from "../map/RouteCard";
import { compactNumber } from "../shared/presentation";
import type { LocalMovementTargetState } from "../../simulation/localMovement/types";
import {
  localMovementTargetForBuilding,
  localMovementTargetForLocation,
  localMovementTargetForPoint,
  localMovementTargetForStop,
  planLocalMovement
} from "../../simulation/localMovement/localMovementSystem";

const LAYER_ITEMS: Array<{ key: keyof MapLayers; label: string; icon: string; description: string }> = [
  { key: "districts", label: "Районы", icon: "◇", description: "Границы и названия районов" },
  { key: "roads", label: "Дороги", icon: "⌁", description: "Городская дорожная сеть" },
  { key: "rail", label: "Метро", icon: "M", description: "Линии и станции метро" },
  { key: "bus", label: "Автобусы", icon: "B", description: "Автобусные маршруты" },
  { key: "traffic", label: "Трафик", icon: "↗", description: "Загрузка конкретных дорог" },
  { key: "risk", label: "Риск", icon: "!", description: "Уровень опасности районов" },
  { key: "activity", label: "Активность", icon: "●", description: "Людность и движение" }
];

type InspectorLevel = "district" | "sector";
type SheetSize = "peek" | "half" | "full";

function landUseLabel(value: MetropolitanSectorState["landUse"]): string {
  const labels: Record<MetropolitanSectorState["landUse"], string> = {
    residential: "Жилая зона",
    mixed: "Смешанная застройка",
    commercial: "Коммерция",
    industrial: "Промышленность",
    corporate: "Корпоративная зона",
    civic: "Городская зона",
    transport: "Транспортный узел",
    utility: "Инфраструктура",
    vacant: "Незастроенная зона"
  };
  return labels[value];
}

function buildingUseLabel(use: GameSession["urban"]["buildings"][number]["use"]): string {
  const labels: Record<GameSession["urban"]["buildings"][number]["use"], string> = {
    residential: "Жилой дом",
    mixed: "Смешанное здание",
    retail: "Магазины",
    office: "Офисное здание",
    industrial: "Промышленный объект",
    warehouse: "Склад",
    medical: "Медицинский объект",
    education: "Учебное здание",
    civic: "Государственный объект",
    transport: "Транспортный объект",
    utility: "Инфраструктура",
    hotel: "Гостиница",
    entertainment: "Заведение",
    vacant: "Пустующее здание"
  };
  return labels[use];
}

function sheetCycle(value: SheetSize): SheetSize {
  if (value === "peek") return "half";
  if (value === "half") return "full";
  return "peek";
}

export function MapScreen({
  session,
  requestedLocationId,
  onRequestedLocationHandled,
  onTravel,
  onWalk
}: {
  session: GameSession;
  requestedLocationId?: string;
  onRequestedLocationHandled: () => void;
  onTravel: (locationId: string) => void;
  onWalk: (target: LocalMovementTargetState) => void;
}) {
  const focusSector = session.metropolitan.sectors.find((sector) => sector.id === session.metropolitan.streaming.focusSectorId)
    ?? session.metropolitan.sectors[0];
  const [mode, setMode] = useState<"global" | "local">("global");
  const [inspectorLevel, setInspectorLevel] = useState<InspectorLevel>("sector");
  const [selectedSectorId, setSelectedSectorId] = useState(focusSector.id);
  const [selectedDistrictId, setSelectedDistrictId] = useState(focusSector.mapDistrictId);
  const [selectedPoint, setSelectedPoint] = useState<{ xM: number; yM: number } | null>({
    xM: session.localScene.playerPosition.xM,
    yM: session.localScene.playerPosition.yM
  });
  const [localSelection, setLocalSelection] = useState<LocalMapSelection | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [layers, setLayers] = useState<MapLayers>({ districts: true, roads: true, rail: true, bus: false, traffic: false, risk: false, activity: false });
  const [layersOpen, setLayersOpen] = useState(false);
  const [sheetSize, setSheetSize] = useState<SheetSize>("peek");
  const [focusRevision, setFocusRevision] = useState(0);

  useEffect(() => {
    if (!requestedLocationId) return;
    const placement = session.metropolitan.locations.find((item) => item.locationId === requestedLocationId);
    if (placement) {
      const sector = session.metropolitan.sectors.find((item) => item.id === placement.sectorId);
      setSelectedSectorId(placement.sectorId);
      if (sector) setSelectedDistrictId(sector.mapDistrictId);
      const location = session.world.locations.find((item) => item.id === requestedLocationId);
      if (location) setLocalSelection({ kind: "location", location });
      setSelectedLocationId(requestedLocationId);
      setInspectorLevel("sector");
      setMode("local");
      setSheetSize("half");
    }
    onRequestedLocationHandled();
  }, [onRequestedLocationHandled, requestedLocationId, session.metropolitan.locations, session.metropolitan.sectors, session.world.locations]);

  const selectedSector = session.metropolitan.sectors.find((sector) => sector.id === selectedSectorId) ?? focusSector;
  const selectedDistrict = session.metropolitan.mapDistricts.find((district) => district.id === selectedDistrictId)
    ?? session.metropolitan.mapDistricts.find((district) => district.id === selectedSector.mapDistrictId)
    ?? session.metropolitan.mapDistricts[0];
  const administrativeDistrict = session.world.districts.find((district) => district.id === selectedDistrict?.administrativeDistrictId);
  const selectedLocation = session.world.locations.find((location) => location.id === selectedLocationId) ?? null;
  const travelOption = selectedLocation ? getTravelOptions(session).find((option) => option.location.id === selectedLocation.id) : undefined;

  const sectorLocations = useMemo(() => session.metropolitan.locations
    .filter((placement) => placement.sectorId === selectedSector.id)
    .flatMap((placement) => {
      const location = session.world.locations.find((item) => item.id === placement.locationId);
      return location ? [location] : [];
    }), [selectedSector.id, session.metropolitan.locations, session.world.locations]);
  const sectorStops = useMemo(() => session.transit.stops.filter((stop) => stop.sectorId === selectedSector.id), [selectedSector.id, session.transit.stops]);
  const selectedTopology = useMemo(() => getSectorStreetTopology(session.streets, {
    timestamp: session.timestamp,
    seed: session.world.meta.seed,
    metropolitan: session.metropolitan,
    urban: session.urban,
    preferredSectorId: selectedSector.id
  }, selectedSector.id), [selectedSector.id, session.metropolitan, session.streets, session.timestamp, session.urban, session.world.meta.seed]);

  const movementTarget = useMemo<LocalMovementTargetState | null>(() => {
    if (!localSelection || mode !== "local") return null;
    if (localSelection.kind === "location") return localMovementTargetForLocation(session, localSelection.location.id);
    if (localSelection.kind === "building") return localMovementTargetForBuilding(session, localSelection.building.id);
    if (localSelection.kind === "stop") return localMovementTargetForStop(session, localSelection.stop.id);
    if (localSelection.kind === "point") return localMovementTargetForPoint(session, selectedSector.id, localSelection.xM, localSelection.yM);
    const nodes = new Map(selectedTopology.intersections.map((node) => [node.id, node]));
    const from = nodes.get(localSelection.segment.fromIntersectionId);
    const to = nodes.get(localSelection.segment.toIntersectionId);
    if (!from || !to) return null;
    return localMovementTargetForPoint(
      session,
      selectedSector.id,
      (from.xM + to.xM) / 2,
      (from.yM + to.yM) / 2,
      localSelection.segment.name,
      localSelection.segment
    );
  }, [localSelection, mode, selectedSector.id, selectedTopology.intersections, session]);

  const movementPreview = useMemo(
    () => movementTarget && !session.localMovement ? planLocalMovement(session, movementTarget) : null,
    [movementTarget, session]
  );

  function selectSector(selection: MapPointSelection): void {
    setSelectedSectorId(selection.sector.id);
    setSelectedDistrictId(selection.sector.mapDistrictId);
    setSelectedPoint({ xM: Math.round(selection.xM), yM: Math.round(selection.yM) });
    setLocalSelection({ kind: "point", xM: Math.round(selection.xM), yM: Math.round(selection.yM) });
    setSelectedLocationId(null);
    setInspectorLevel("sector");
    setSheetSize("half");
  }

  function selectDistrict(district: MapDistrictState): void {
    setSelectedDistrictId(district.id);
    setSelectedLocationId(null);
    setLocalSelection(null);
    setInspectorLevel("district");
    setSheetSize("half");
  }

  function openDistrict(): void {
    setMode("global");
    setInspectorLevel("district");
    setLocalSelection(null);
    setSelectedLocationId(null);
    setFocusRevision((value) => value + 1);
    setSheetSize("peek");
  }

  function openSector(): void {
    setMode("local");
    setInspectorLevel("sector");
    setFocusRevision((value) => value + 1);
    setSheetSize("peek");
  }

  function selectLocal(selection: LocalMapSelection): void {
    setLocalSelection(selection);
    setInspectorLevel("sector");
    if (selection.kind === "location") {
      setSelectedLocationId(selection.location.id);
      const placement = session.metropolitan.locations.find((item) => item.locationId === selection.location.id);
      if (placement) setSelectedPoint({ xM: placement.bounds.xM + placement.bounds.widthM / 2, yM: placement.bounds.yM + placement.bounds.heightM / 2 });
    } else if (selection.kind === "building") {
      setSelectedLocationId(selection.building.anchorLocationId ?? null);
      setSelectedPoint({ xM: selection.building.bounds.xM + selection.building.bounds.widthM / 2, yM: selection.building.bounds.yM + selection.building.bounds.heightM / 2 });
    } else if (selection.kind === "stop") {
      setSelectedLocationId(null);
      setSelectedPoint({ xM: selection.stop.xM, yM: selection.stop.yM });
    } else if (selection.kind === "street") {
      setSelectedLocationId(null);
    } else {
      setSelectedLocationId(null);
      setSelectedPoint({ xM: selection.xM, yM: selection.yM });
    }
    setSheetSize("half");
  }

  function beginTravel(): void {
    if (!selectedLocation || selectedLocation.id === session.life.currentLocationId) return;
    onTravel(selectedLocation.id);
  }

  function beginWalk(): void {
    if (!movementTarget || !movementPreview) return;
    onWalk(movementTarget);
  }

  let selectionTitle = selectedSector.code;
  let selectionEyebrow = selectedDistrict?.name ?? administrativeDistrict?.name ?? session.world.city.name;
  let selectionDescription = landUseLabel(selectedSector.landUse);
  let selectionFacts: Array<[string, string]> = [
    ["Жители", compactNumber(selectedSector.representedPopulation)],
    ["Здания", compactNumber(selectedSector.buildingEstimate)],
    ["Улицы", `${selectedTopology.segments.length}`],
    ["Остановки", `${sectorStops.length}`]
  ];

  if (inspectorLevel === "district" && selectedDistrict) {
    selectionTitle = selectedDistrict.name;
    selectionEyebrow = administrativeDistrict?.name ?? "Городской район";
    selectionDescription = `${landUseLabel(selectedDistrict.dominantLandUse)} · ${selectedDistrict.sectorIds.length} секторов`;
    selectionFacts = [
      ["Жители", compactNumber(selectedDistrict.representedPopulation)],
      ["Транспорт", `${selectedDistrict.transitScore}%`],
      ["Активность", `${selectedDistrict.activityScore}%`],
      ["Риск", `${selectedDistrict.riskScore}%`]
    ];
  } else if (localSelection?.kind === "location") {
    const open = isLocationOpen(localSelection.location, session.timestamp);
    selectionTitle = localSelection.location.name;
    selectionEyebrow = "Точка города";
    selectionDescription = `${open ? "Открыто" : "Закрыто"} · безопасность ${localSelection.location.security}%`;
    selectionFacts = [["Район", selectedDistrict?.name ?? "—"], ["Сектор", selectedSector.code]];
  } else if (localSelection?.kind === "building") {
    selectionTitle = localSelection.building.addressCode;
    selectionEyebrow = buildingUseLabel(localSelection.building.use);
    selectionDescription = `${localSelection.building.floors} эт. · состояние ${localSelection.building.condition}% · безопасность ${localSelection.building.security}%`;
    selectionFacts = [["Жильцов", compactNumber(localSelection.building.representedResidents)], ["Входов", `${localSelection.building.publicEntrances + localSelection.building.serviceEntrances}`]];
  } else if (localSelection?.kind === "stop") {
    selectionTitle = localSelection.stop.name;
    selectionEyebrow = localSelection.stop.mode === "metro" ? "Станция метро" : "Автобусная остановка";
    selectionDescription = `${localSelection.stop.routeIds.length} маршрута · ${compactNumber(localSelection.stop.dailyBoardings)} посадок в день`;
    selectionFacts = [["Сектор", selectedSector.code], ["Маршруты", `${localSelection.stop.routeIds.length}`]];
  } else if (localSelection?.kind === "street") {
    selectionTitle = localSelection.segment.name;
    selectionEyebrow = "Улица";
    selectionDescription = `${localSelection.segment.lanes} полосы · ${localSelection.segment.speedLimitKph} км/ч`;
    selectionFacts = [["Длина", `${Math.round(localSelection.segment.lengthM)} м`], ["Трафик", `${localSelection.segment.trafficLoad}%`]];
  } else if (localSelection?.kind === "point") {
    selectionTitle = `${Math.round(localSelection.xM)} · ${Math.round(localSelection.yM)} м`;
    selectionEyebrow = "Выбранная точка";
    selectionDescription = `${landUseLabel(selectedSector.landUse)} · ${selectedSector.code}`;
  }

  return (
    <section className="map-screen" aria-label="Карта города">
      <div className="map-stage">
        {mode === "global" ? (
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
        ) : (
          <LocalSectorMap session={session} sector={selectedSector} selected={localSelection} route={movementPreview ?? session.localMovement ?? null} onSelect={selectLocal} />
        )}

        <nav className="map-breadcrumb" aria-label="Уровни карты" data-no-swipe>
          <button type="button" className={mode === "global" && inspectorLevel === "district" ? "is-active" : ""} onClick={() => { setMode("global"); setInspectorLevel("district"); setSheetSize("peek"); }}>Город</button>
          <span>›</span>
          <button type="button" className={mode === "global" && inspectorLevel === "sector" ? "is-active" : ""} onClick={openDistrict}>{selectedDistrict?.name ?? "Район"}</button>
          <span>›</span>
          <button type="button" className={mode === "local" ? "is-active" : ""} onClick={openSector}>{selectedSector.code}</button>
        </nav>

        <div className="map-toolbar" data-no-swipe>
          {mode === "global" ? <button type="button" onClick={() => setLayersOpen(true)}><i>☷</i><span>Слои</span></button> : null}
          <button type="button" onClick={() => { setSelectedSectorId(focusSector.id); setSelectedDistrictId(focusSector.mapDistrictId); setSelectedPoint({ xM: session.localScene.playerPosition.xM, yM: session.localScene.playerPosition.yM }); setLocalSelection(null); setFocusRevision((value) => value + 1); }}><i>⌖</i><span>Я</span></button>
        </div>

        <aside className={`map-sheet map-sheet--${sheetSize}`} data-no-swipe>
          <button type="button" className="map-sheet__handle" aria-label="Изменить размер панели" onClick={() => setSheetSize((value) => sheetCycle(value))}><span /></button>
          <header className="map-sheet__header">
            <div>
              <span>{selectionEyebrow}</span>
              <h1>{selectionTitle}</h1>
              <p>{selectionDescription}</p>
            </div>
            <div className="map-sheet__actions">
              {mode === "global" && inspectorLevel === "sector" ? <button type="button" onClick={openSector}>Открыть сектор</button> : null}
              {mode === "local" ? <button type="button" onClick={() => setMode("global")}>Весь город</button> : null}
            </div>
          </header>

          <div className="map-sheet__body">
            <dl className="map-sheet__facts">
              {selectionFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>

            {sheetSize === "full" && inspectorLevel === "sector" && !localSelection ? (
              <section className="map-sheet__list">
                <header><h2>Места сектора</h2><span>{sectorLocations.length + sectorStops.length}</span></header>
                {sectorLocations.map((location) => (
                  <button type="button" key={location.id} onClick={() => { setSelectedLocationId(location.id); setLocalSelection({ kind: "location", location }); setMode("local"); setSheetSize("half"); }}>
                    <span><strong>{location.name}</strong><small>{isLocationOpen(location, session.timestamp) ? "Открыто" : "Закрыто"}</small></span><em>›</em>
                  </button>
                ))}
                {sectorStops.slice(0, 8).map((stop) => (
                  <button type="button" key={stop.id} onClick={() => { setLocalSelection({ kind: "stop", stop }); setMode("local"); setSheetSize("half"); }}>
                    <span><strong>{stop.name}</strong><small>{stop.mode === "metro" ? "Метро" : "Автобус"} · {stop.routeIds.length} маршрута</small></span><em>›</em>
                  </button>
                ))}
              </section>
            ) : null}

            {movementTarget ? (
              <RouteCard
                target={movementTarget}
                preview={movementPreview}
                selectedLocation={selectedLocation}
                currentLocationId={session.life.currentLocationId}
                travelOption={travelOption}
                balance={session.player.balance}
                onWalk={beginWalk}
                onTravel={beginTravel}
              />
            ) : null}
          </div>
        </aside>

        {layersOpen ? (
          <div className="map-layer-overlay" role="presentation" onClick={() => setLayersOpen(false)}>
            <section className="map-layer-sheet" role="dialog" aria-modal="true" aria-label="Слои карты" onClick={(event: ReactMouseEvent<HTMLElement>) => event.stopPropagation()}>
              <header><div><span>Отображение</span><h2>Слои карты</h2></div><button type="button" onClick={() => setLayersOpen(false)}>×</button></header>
              <div>
                {LAYER_ITEMS.map((item) => (
                  <button type="button" key={item.key} className={layers[item.key] ? "is-active" : ""} aria-pressed={layers[item.key]} onClick={() => setLayers((value) => ({ ...value, [item.key]: !value[item.key] }))}>
                    <i>{item.icon}</i><span><strong>{item.label}</strong><small>{item.description}</small></span><em>{layers[item.key] ? "Вкл" : "Выкл"}</em>
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
