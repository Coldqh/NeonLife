import type { GameSession } from "../../world/state/types";
import type { LocalMovementState, LocalMovementTargetState } from "../../simulation/localMovement/types";
import type { TravelOption } from "../../gameplay/travel/travelSystem";
import { isLocationOpen } from "../../gameplay/travel/travelSystem";
import { PLACE_ICONS, personPortrait, vehicleStateLabel } from "../shared/presentation";
import type { CityMapSelection } from "./mapUi";
import type { StreetIncidentAction } from "../../simulation/streetScene/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { activityLabel, buildingUseLabel, landUseLabel, locationTypeLabel, riskLabel, selectionTitle, venueCategoryLabel, venueIsOpen } from "./mapUi";

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
  onLeaveVehicle,
  onStreetIncidentAction,
  onLifeAction
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
  onStreetIncidentAction: (incidentId: string, action: StreetIncidentAction) => void;
  onLifeAction: (action: LocalLifeAction) => void;
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

  if (selection.kind === "venue") {
    const venue = selection.venue;
    const building = session.urban.buildings.find((item) => item.id === venue.buildingId);
    const open = venueIsOpen(venue, session.timestamp);
    const operation = session.urban.venueOperations.operations.find((item) => item.venueId === venue.id);
    const inside = building && session.localScene.playerPosition.buildingId === building.id;
    const access = building ? session.buildingAccess.buildingEntries.find((item) => item.buildingId === building.id) : undefined;
    const occupants = session.localScene.actors.filter((actor) => actor.visible && actor.position.buildingId === venue.buildingId && (!actor.position.unitId || actor.position.unitId === venue.unitId)).length;
    return (
      <aside className="map-selection-sheet map-selection-sheet--venue map-selection-sheet--generated-venue" data-no-swipe>
        <div className={`map-selection-sheet__thumb venue-thumb venue-thumb--${venue.category}`}><i>{venue.category === "food" ? "♨" : venue.category === "clinic" || venue.category === "pharmacy" ? "+" : venue.category === "repair" ? "⚒" : "▤"}</i><span>{venue.code}</span></div>
        <div className="map-selection-sheet__body">
          <header><div><span>{venueCategoryLabel(venue.category)} · {building?.addressCode ?? venue.unitNumber}</span><h2>{venue.name}</h2><p className={open ? "status-good" : "status-bad"}>{open ? "ОТКРЫТО" : venue.operatingStatus === "insolvent" ? "БАНКРОТ" : venue.operatingStatus === "seized" ? "ОПЕЧАТАНО" : venue.operatingStatus === "renovation" ? "РЕМОНТ" : venue.operatingStatus === "vacant" ? "ПУСТУЕТ" : "ЗАКРЫТО"} · {String(venue.openHour).padStart(2, "0")}:00—{venue.closeHour === 24 ? "24:00" : `${String(venue.closeHour).padStart(2, "0")}:00`}</p></div><div className="sheet-icon-row"><button type="button" className={favorite ? "is-active" : ""} onClick={onFavorite} aria-label="Избранное">♡</button><button type="button" onClick={onShare} aria-label="Поделиться">↗</button><button type="button" onClick={onClose} aria-label="Закрыть">×</button></div></header>
          <div className="venue-sheet__metrics"><span>Качество <strong>{venue.quality}%</strong></span><span>Очередь <strong>{operation?.queue.waitingCount ?? 0} · ~{operation?.queue.estimatedWaitMinutes ?? 0} мин.</strong></span><span>Сейчас внутри <strong>{occupants}</strong></span><span>Цена <strong>{"₵".repeat(venue.priceTier)}</strong></span></div>
          <div className="generated-venue__tags">{venue.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          <p className="map-selection-sheet__route">{routeCaption(preview, travel)}</p>
          <div className="map-selection-sheet__actions"><button type="button" className="map-action map-action--primary" disabled={!target} onClick={onBuildRoute}>Проложить маршрут</button><button type="button" className="map-action" onClick={onDetails}>Профиль</button>{inside ? <button type="button" className="map-action" onClick={onLeaveBuilding}>Выйти</button> : building && access && access.distanceToPlayerM <= 12 ? <button type="button" className="map-action" onClick={() => onEnterBuilding(building.id)}>Войти</button> : null}</div>
          {preview ? <button type="button" className="map-route-start" onClick={onStartRoute}>Начать · {routeCaption(preview)}</button> : null}
        </div>
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

  if (selection.kind === "incident") {
    const incident = selection.incident;
    const distance = Math.round(Math.hypot(incident.xM - session.localScene.playerPosition.xM, incident.yM - session.localScene.playerPosition.yM));
    const inRange = session.localScene.playerPosition.state === "outside" && distance <= 24;
    const status = incident.status === "active" ? "ИДЁТ СЕЙЧАС" : incident.status === "reported" ? "ПОМОЩЬ ВЫЗВАНА" : incident.status === "responding" ? "СЛУЖБЫ НА МЕСТЕ" : "ЗАВЕРШЕНО";
    return (
      <aside className={`map-selection-sheet map-selection-sheet--incident incident-sheet--${incident.severity}`} data-no-swipe>
        <div className="incident-sheet__signal"><i>!</i><span>{incident.type.toUpperCase()}</span></div>
        <div className="map-selection-sheet__body">
          <header><div><span>{status}</span><h2>{incident.title}</h2><p>{incident.detail}</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></header>
          <div className="venue-sheet__metrics"><span>Расстояние <strong>{distance} м</strong></span><span>Опасность <strong>{incident.severity}/3</strong></span><span>Участников <strong>{incident.participantActorIds.length}</strong></span><span>Служба <strong>{incident.responder ?? "нет"}</strong></span></div>
          {!inRange ? <p className="map-selection-sheet__route">Подойди ближе: действие доступно в радиусе 24 м. · {routeCaption(preview)}</p> : null}
          <div className="map-selection-sheet__actions">
            {!inRange ? <button type="button" className="map-action map-action--primary" disabled={!target} onClick={onBuildRoute}>Маршрут к месту</button> : null}
            <button type="button" className="map-action" disabled={!inRange} onClick={() => onStreetIncidentAction(incident.id, "observe")}>Осмотреть · 2 мин</button>
            <button type="button" className="map-action map-action--primary" disabled={!inRange || incident.status !== "active" || !incident.responder} onClick={() => onStreetIncidentAction(incident.id, "call-help")}>Вызвать помощь</button>
            <button type="button" className="map-action map-action--danger" disabled={!inRange || incident.status === "resolved"} onClick={() => onStreetIncidentAction(incident.id, "intervene")}>Вмешаться · 6 мин</button>
            <button type="button" className="map-action" onClick={() => { onStreetIncidentAction(incident.id, "move-on"); onClose(); }}>Пройти мимо</button>
          </div>
          {!inRange && preview ? <button type="button" className="map-route-start" onClick={onStartRoute}>Идти · {routeCaption(preview)}</button> : null}
          {incident.outcome ? <p className="incident-sheet__outcome">{incident.outcome}</p> : null}
        </div>
      </aside>
    );
  }

  if (selection.kind === "actor") {
    const assaultRange = selection.actor.visible && selection.actor.distanceToPlayerM <= 4.5 && session.playerCrime.custody?.status !== "detained";
    return (
      <aside className="map-selection-sheet map-selection-sheet--person" data-no-swipe>
        <img src={personPortrait(selection.actor.id)} alt="" />
        <div className="map-selection-sheet__body"><header><div><span>{selection.actor.roleLabel}</span><h2>{selection.actor.name}</h2><p>{selection.actor.activityLabel} · {Math.round(selection.actor.distanceToPlayerM)} м</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></header><div className="map-selection-sheet__actions"><button type="button" className="map-action map-action--primary" disabled={!target} onClick={onBuildRoute}>Идти к человеку</button><button type="button" className="map-action" onClick={onDetails}>Подробнее</button><button type="button" className="map-action map-action--danger" disabled={!assaultRange} onClick={() => onLifeAction({ kind: "assault-actor", actorId: selection.actor.id })}>Напасть</button></div>{!assaultRange ? <p className="map-selection-sheet__route">Для нападения нужно находиться рядом. Свидетели и камеры создадут улики.</p> : null}{preview ? <button type="button" className="map-route-start" onClick={onStartRoute}>Начать · {routeCaption(preview)}</button> : null}</div>
      </aside>
    );
  }

  if (selection.kind === "vehicle") {
    const inside = session.vehicles.player.currentVehicleId === selection.vehicle.id;
    const close = session.localScene.playerPosition.state === "outside" && selection.vehicle.distanceToPlayerM <= 6;
    const inspection = session.vehicleCrime.inspections.find((item) => item.vehicleId === selection.vehicle.id);
    const crimeAllowed = close && selection.vehicle.access !== "owned" && selection.vehicle.state !== "moving" && session.playerCrime.custody?.status !== "detained";
    return (
      <aside className="map-selection-sheet" data-no-swipe>
        <div className="map-selection-sheet__handle" /><header><div><span>{vehicleStateLabel(selection.vehicle)}</span><h2>{selection.vehicle.modelName}</h2><p>{selection.vehicle.plate} · {Math.round(selection.vehicle.distanceToPlayerM)} м</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></header><div className="map-selection-sheet__actions"><button type="button" className="map-action map-action--primary" disabled={!target} onClick={onBuildRoute}>Идти к машине</button>{inside ? <button type="button" className="map-action" onClick={onLeaveVehicle}>Выйти</button> : selection.vehicle.playerCanEnter && selection.vehicle.distanceToPlayerM <= 12 ? <button type="button" className="map-action" onClick={() => onEnterVehicle(selection.vehicle.id)}>Сесть</button> : null}{crimeAllowed ? <button type="button" className="map-action map-action--danger" onClick={() => onLifeAction({ kind: "inspect-vehicle-crime", vehicleId: selection.vehicle.id })}>Осмотреть защиту</button> : null}{crimeAllowed && inspection && selection.vehicle.locked ? <button type="button" className="map-action map-action--danger" onClick={() => onLifeAction({ kind: "break-in-vehicle", vehicleId: selection.vehicle.id })}>Вскрыть машину</button> : null}{crimeAllowed && inspection && !selection.vehicle.locked ? <button type="button" className="map-action map-action--danger" onClick={() => onLifeAction({ kind: "hotwire-vehicle", vehicleId: selection.vehicle.id })}>Угнать</button> : null}</div>{inspection ? <p className="map-selection-sheet__route">Замок {inspection.lockDifficulty}% · зажигание {inspection.ignitionDifficulty}% · камеры {inspection.cameraRisk}% · свидетели {inspection.witnessRisk}%</p> : null}{preview ? <button type="button" className="map-route-start" onClick={onStartRoute}>Начать · {routeCaption(preview)}</button> : null}
      </aside>
    );
  }

  return (
    <aside className="map-selection-sheet" data-no-swipe>
      <div className="map-selection-sheet__handle" /><header><div><span>{selection.kind === "stop" ? "ОСТАНОВКА" : "ТОЧКА"}</span><h2>{selectionTitle(selection)}</h2><p>{routeCaption(preview, travel)}</p></div><button type="button" className="icon-button" onClick={onClose}>×</button></header><div className="map-selection-sheet__actions"><button type="button" className="map-action map-action--primary" disabled={!target && !travel} onClick={onBuildRoute}>Проложить маршрут</button></div>{(preview || travel) ? <button type="button" className="map-route-start" onClick={onStartRoute}>Начать · {routeCaption(preview, travel)}</button> : null}
    </aside>
  );
}
