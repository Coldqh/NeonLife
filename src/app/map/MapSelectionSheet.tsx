import type { GameSession } from "../../world/state/types";
import type { LocalMovementState, LocalMovementTargetState } from "../../simulation/localMovement/types";
import type { TravelOption } from "../../gameplay/travel/travelSystem";
import { isLocationOpen } from "../../gameplay/travel/travelSystem";
import { PLACE_ICONS, personPortrait, vehicleStateLabel } from "../shared/presentation";
import type { CityMapSelection } from "./mapUi";
import { activityLabel, buildingUseLabel, landUseLabel, locationTypeLabel, riskLabel, selectionTitle } from "./mapUi";

function routeCaption(preview: LocalMovementState | null, travel?: TravelOption): string {
  if (preview) return `${preview.estimatedMinutes} мин · ${Math.round(preview.totalDistanceM)} м`;
  if (travel) return `${travel.durationMinutes} мин · ${travel.distanceKm} км${travel.cost ? ` · ₵ ${travel.cost}` : ""}`;
  return "Маршрут недоступен";
}

function districtSubtitle(selection: Extract<CityMapSelection, { kind: "district" }>): string {
  return `${landUseLabel(selection.district.dominantLandUse)} · ${selection.district.sectorIds.length} секторов`;
}

export function MapSelectionSheet({
  session,
  selection,
  target,
  preview,
  travel,
  favorite,
  onClose,
  onDetails,
  onFavorite,
  onShare,
  onBuildRoute,
  onStartRoute,
  onOpenDistrict,
  onSelectLocation,
  onEnterBuilding,
  onLeaveBuilding,
  onEnterVehicle,
  onLeaveVehicle
}: {
  session: GameSession;
  selection: CityMapSelection;
  target: LocalMovementTargetState | null;
  preview: LocalMovementState | null;
  travel?: TravelOption;
  favorite: boolean;
  onClose: () => void;
  onDetails: () => void;
  onFavorite: () => void;
  onShare: () => void;
  onBuildRoute: () => void;
  onStartRoute: () => void;
  onOpenDistrict: () => void;
  onSelectLocation: (locationId: string) => void;
  onEnterBuilding: (buildingId: string) => void;
  onLeaveBuilding: () => void;
  onEnterVehicle: (vehicleId: string) => void;
  onLeaveVehicle: () => void;
}) {
  if (selection.kind === "district") {
    const sectorIds = new Set(selection.district.sectorIds);
    const keyLocations = session.metropolitan.locations
      .filter((placement) => sectorIds.has(placement.sectorId))
      .map((placement) => session.world.locations.find((location) => location.id === placement.locationId))
      .filter((location): location is GameSession["world"]["locations"][number] => Boolean(location))
      .sort((left, right) => right.security - left.security)
      .slice(0, 4);
    return (
      <aside className="map-selection-sheet map-selection-sheet--district" data-no-swipe>
        <div className="map-selection-sheet__handle" />
        <header>
          <div><span>ВЫБРАННЫЙ РАЙОН</span><h2>{selection.district.name}</h2><p>{districtSubtitle(selection)}</p></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>
        <div className="district-sheet__stats">
          <div><span>Население</span><strong>{selection.district.representedPopulation.toLocaleString("ru-RU")}</strong></div>
          <div><span>Транспорт</span><strong>{selection.district.transitScore}/100</strong></div>
          <div><span>Активность</span><strong>{activityLabel(selection.district.activityScore)}</strong></div>
          <div><span>Риск</span><strong>{riskLabel(selection.district.riskScore)}</strong></div>
        </div>
        {keyLocations.length ? <section className="district-sheet__places"><span>КЛЮЧЕВЫЕ МЕСТА</span><div>{keyLocations.map((location) => <button type="button" key={location.id} onClick={() => onSelectLocation(location.id)}><i>{PLACE_ICONS[location.type]}</i><span><strong>{location.name}</strong><small>{locationTypeLabel(location.type)}</small></span><b>›</b></button>)}</div></section> : null}
        <button type="button" className="map-action map-action--primary" onClick={onOpenDistrict}>Открыть район</button>
      </aside>
    );
  }

  if (selection.kind === "sector") {
    return (
      <aside className="map-selection-sheet" data-no-swipe>
        <div className="map-selection-sheet__handle" />
        <header><div><span>СЕКТОР</span><h2>{selection.sector.code}</h2><p>{landUseLabel(selection.sector.landUse)} · {selection.sector.representedPopulation.toLocaleString("ru-RU")} жителей</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></header>
        <button type="button" className="map-action map-action--primary" onClick={onOpenDistrict}>Открыть сектор</button>
      </aside>
    );
  }

  if (selection.kind === "location") {
    const open = isLocationOpen(selection.location, session.timestamp);
    const business = session.economy.businesses.find((item) => item.locationId === selection.location.id);
    const building = session.urban.buildings.find((item) => item.anchorLocationId === selection.location.id);
    const present = building ? session.localScene.actors.filter((actor) => actor.visible && actor.position.buildingId === building.id).length : 0;
    const buildingPresence = building ? session.localScene.buildings.find((item) => item.buildingId === building.id) : undefined;
    return (
      <aside className="map-selection-sheet map-selection-sheet--venue" data-no-swipe>
        <div className={`map-selection-sheet__thumb venue-thumb venue-thumb--${selection.location.type}`}><i>{PLACE_ICONS[selection.location.type]}</i><span>{selection.location.code}</span></div>
        <div className="map-selection-sheet__body">
          <header><div><span>{locationTypeLabel(selection.location.type)}</span><h2>{selection.location.name}</h2><p className={open ? "status-good" : "status-bad"}>{open ? "ОТКРЫТО" : "ЗАКРЫТО"}</p></div><div className="sheet-icon-row"><button type="button" className={favorite ? "is-active" : ""} onClick={onFavorite} aria-label="Избранное">♡</button><button type="button" onClick={onShare} aria-label="Поделиться">↗</button><button type="button" onClick={onClose} aria-label="Закрыть">×</button></div></header>
          <div className="venue-sheet__metrics">
            <span>Безопасность <strong>{selection.location.security}%</strong></span>
            <span>Спрос <strong>{business?.demand ?? 0}%</strong></span>
            <span>Сейчас внутри <strong>{present}</strong></span>
            <span>Цена <strong>{business ? `${business.priceIndex}%` : "—"}</strong></span>
          </div>
          <p className="map-selection-sheet__route">{routeCaption(preview, travel)}</p>
          <div className="map-selection-sheet__actions">
            <button type="button" className="map-action map-action--primary" disabled={!target && !travel} onClick={onBuildRoute}>Проложить маршрут</button>
            <button type="button" className="map-action" onClick={onDetails}>Осмотреть</button>
            {building && session.localScene.playerPosition.buildingId === building.id ? <button type="button" className="map-action" onClick={onLeaveBuilding}>Выйти</button> : null}
            {building && session.localScene.playerPosition.buildingId !== building.id && (buildingPresence?.distanceToPlayerM ?? Number.POSITIVE_INFINITY) <= 12 ? <button type="button" className="map-action" onClick={() => onEnterBuilding(building.id)}>Войти</button> : null}
          </div>
          {(preview || travel) ? <button type="button" className="map-route-start" onClick={onStartRoute}>Начать · {routeCaption(preview, travel)}</button> : null}
        </div>
      </aside>
    );
  }

  if (selection.kind === "building") {
    const inside = session.localScene.playerPosition.buildingId === selection.building.id;
    const access = session.buildingAccess.buildingEntries.find((item) => item.buildingId === selection.building.id);
    return (
      <aside className="map-selection-sheet map-selection-sheet--venue" data-no-swipe>
        <div className={`map-selection-sheet__thumb building-thumb building-thumb--${selection.building.use}`}><i>▥</i><span>{selection.building.floors}F</span></div>
        <div className="map-selection-sheet__body">
          <header><div><span>{buildingUseLabel(selection.building.use)}</span><h2>{selection.building.addressCode}</h2><p>{selection.building.streetName ?? selection.building.parcelCode}</p></div><div className="sheet-icon-row"><button type="button" className={favorite ? "is-active" : ""} onClick={onFavorite}>♡</button><button type="button" onClick={onShare}>↗</button><button type="button" onClick={onClose}>×</button></div></header>
          <div className="venue-sheet__metrics"><span>Этажей <strong>{selection.building.floors}</strong></span><span>Жильцов <strong>{selection.building.representedResidents}</strong></span><span>Безопасность <strong>{selection.building.security}%</strong></span><span>Доступ <strong>{access?.publicDecision ?? "—"}</strong></span></div>
          <p className="map-selection-sheet__route">{routeCaption(preview, travel)}</p>
          <div className="map-selection-sheet__actions"><button type="button" className="map-action map-action--primary" disabled={!target} onClick={onBuildRoute}>Ко входу</button><button type="button" className="map-action" onClick={onDetails}>Профиль дома</button>{inside ? <button type="button" className="map-action" onClick={onLeaveBuilding}>Выйти</button> : access && access.distanceToPlayerM <= 12 ? <button type="button" className="map-action" onClick={() => onEnterBuilding(selection.building.id)}>Войти</button> : null}</div>
          {preview ? <button type="button" className="map-route-start" onClick={onStartRoute}>Начать · {routeCaption(preview)}</button> : null}
        </div>
      </aside>
    );
  }

  if (selection.kind === "actor") {
    return (
      <aside className="map-selection-sheet map-selection-sheet--person" data-no-swipe>
        <img src={personPortrait(selection.actor.id)} alt="" />
        <div className="map-selection-sheet__body"><header><div><span>{selection.actor.roleLabel}</span><h2>{selection.actor.name}</h2><p>{selection.actor.activityLabel} · {Math.round(selection.actor.distanceToPlayerM)} м</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></header><div className="map-selection-sheet__actions"><button type="button" className="map-action map-action--primary" disabled={!target} onClick={onBuildRoute}>Идти к человеку</button><button type="button" className="map-action" onClick={onDetails}>Подробнее</button></div>{preview ? <button type="button" className="map-route-start" onClick={onStartRoute}>Начать · {routeCaption(preview)}</button> : null}</div>
      </aside>
    );
  }

  if (selection.kind === "vehicle") {
    const inside = session.vehicles.player.currentVehicleId === selection.vehicle.id;
    return (
      <aside className="map-selection-sheet" data-no-swipe>
        <div className="map-selection-sheet__handle" /><header><div><span>{vehicleStateLabel(selection.vehicle)}</span><h2>{selection.vehicle.modelName}</h2><p>{selection.vehicle.plate} · {Math.round(selection.vehicle.distanceToPlayerM)} м</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></header><div className="map-selection-sheet__actions"><button type="button" className="map-action map-action--primary" disabled={!target} onClick={onBuildRoute}>Идти к машине</button>{inside ? <button type="button" className="map-action" onClick={onLeaveVehicle}>Выйти</button> : selection.vehicle.playerCanEnter && selection.vehicle.distanceToPlayerM <= 12 ? <button type="button" className="map-action" onClick={() => onEnterVehicle(selection.vehicle.id)}>Сесть</button> : null}</div>{preview ? <button type="button" className="map-route-start" onClick={onStartRoute}>Начать · {routeCaption(preview)}</button> : null}
      </aside>
    );
  }

  return (
    <aside className="map-selection-sheet" data-no-swipe>
      <div className="map-selection-sheet__handle" /><header><div><span>{selection.kind === "stop" ? "ОСТАНОВКА" : "ТОЧКА"}</span><h2>{selectionTitle(selection)}</h2><p>{routeCaption(preview, travel)}</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></header><div className="map-selection-sheet__actions"><button type="button" className="map-action map-action--primary" disabled={!target && !travel} onClick={onBuildRoute}>Проложить маршрут</button></div>{(preview || travel) ? <button type="button" className="map-route-start" onClick={onStartRoute}>Начать · {routeCaption(preview, travel)}</button> : null}
    </aside>
  );
}
