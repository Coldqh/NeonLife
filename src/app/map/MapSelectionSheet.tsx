import { useEffect, useState, type ReactNode } from "react";
import type { GameSession } from "../../world/state/types";
import type { LocalMovementState, LocalMovementTargetState } from "../../simulation/localMovement/types";
import type { TravelOption } from "../../gameplay/travel/travelSystem";
import { isLocationOpen } from "../../gameplay/travel/travelSystem";
import { PLACE_ICONS, personPortrait, vehicleStateLabel } from "../shared/presentation";
import type { CityMapSelection } from "./mapUi";
import type { StreetIncidentAction } from "../../simulation/streetScene/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import {
  activityLabel,
  buildingUseLabel,
  landUseLabel,
  locationTypeLabel,
  riskLabel,
  selectionKey,
  selectionTitle,
  venueCategoryLabel,
  venueIsOpen
} from "./mapUi";

interface MapSelectionSheetProps {
  session: GameSession;
  selection: CityMapSelection;
  target: LocalMovementTargetState | null;
  preview: LocalMovementState | null;
  travel?: TravelOption;
  routeReady: boolean;
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
}

function routeCaption(preview: LocalMovementState | null, travel?: TravelOption): string {
  if (preview) return `${preview.estimatedMinutes} мин · ${Math.round(preview.totalDistanceM)} м`;
  if (travel) return `${travel.durationMinutes} мин · ${travel.distanceKm} км${travel.cost ? ` · ₵ ${travel.cost}` : ""}`;
  return "Маршрут недоступен";
}

function priceTierLabel(tier: number): string {
  if (tier <= 1) return "Низкие цены";
  if (tier === 2) return "Средние цены";
  if (tier === 3) return "Высокие цены";
  return "Премиальные цены";
}

function accessLabel(value?: "open" | "authorized" | "locked" | "closed" | "unavailable"): string {
  if (value === "open") return "Свободный";
  if (value === "authorized") return "По допуску";
  if (value === "locked") return "Закрыт";
  if (value === "closed") return "Не работает";
  return "Нет данных";
}

function SheetTools({ favorite, onFavorite, onShare, onClose }: Pick<MapSelectionSheetProps, "favorite" | "onFavorite" | "onShare" | "onClose">) {
  return (
    <div className="sheet-icon-row">
      <button type="button" className={favorite ? "is-active" : ""} onClick={onFavorite} aria-label={favorite ? "Убрать из избранного" : "Добавить в избранное"}>♡</button>
      <button type="button" onClick={onShare} aria-label="Поделиться">↗</button>
      <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
    </div>
  );
}

function RouteAction({ preview, travel, routeReady, label = "Маршрут", onBuildRoute, onStartRoute }: {
  preview: LocalMovementState | null;
  travel?: TravelOption;
  routeReady: boolean;
  label?: string;
  onBuildRoute: () => void;
  onStartRoute: () => void;
}) {
  if (!preview && !travel) return <p className="map-selection-sheet__unavailable">Сюда сейчас нельзя построить маршрут.</p>;
  const caption = routeCaption(preview, travel);
  return (
    <button type="button" className="map-action map-action--primary map-action--route" onClick={routeReady ? onStartRoute : onBuildRoute}>
      <span>{routeReady ? "Начать" : label}</span><strong>{caption}</strong>
    </button>
  );
}

function DetailsToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return <button type="button" className="map-action map-action--quiet" onClick={onToggle}>{expanded ? "Скрыть данные" : "Данные"}</button>;
}

function SheetFrame({ className = "", icon, eyebrow, title, subtitle, status, favorite, onFavorite, onShare, onClose, expanded, onToggle, details, actions }: {
  className?: string;
  icon?: ReactNode;
  eyebrow: string;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  favorite: boolean;
  onFavorite: () => void;
  onShare: () => void;
  onClose: () => void;
  expanded: boolean;
  onToggle?: () => void;
  details?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <aside className={`map-selection-sheet map-selection-sheet--compact ${expanded ? "is-expanded" : ""} ${className}`.trim()} data-no-swipe>
      <div className="map-selection-sheet__handle" />
      <div className="map-selection-sheet__top">
        {icon ? <div className="map-selection-sheet__icon">{icon}</div> : null}
        <header><div><span>{eyebrow}</span><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></header>
        <SheetTools favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose} />
      </div>
      {status ? <div className="map-selection-sheet__status">{status}</div> : null}
      {expanded && details ? <div className="map-selection-sheet__details">{details}</div> : null}
      <div className="map-selection-sheet__actions map-selection-sheet__actions--main">
        {actions}
        {details && onToggle ? <DetailsToggle expanded={expanded} onToggle={onToggle} /> : null}
      </div>
    </aside>
  );
}

export function MapSelectionSheet(props: MapSelectionSheetProps) {
  const { session, selection, target, preview, travel, routeReady, favorite, onClose, onDetails, onFavorite, onShare, onBuildRoute, onStartRoute, onOpenDistrict, onSelectLocation, onEnterBuilding, onLeaveBuilding, onEnterVehicle, onLeaveVehicle, onStreetIncidentAction, onLifeAction } = props;
  const [expanded, setExpanded] = useState(false);
  const identity = selectionKey(selection);
  useEffect(() => setExpanded(false), [identity]);
  const toggle = () => setExpanded((value) => !value);

  if (selection.kind === "district") {
    const sectorIds = new Set(selection.district.sectorIds);
    const keyLocations = session.metropolitan.locations
      .filter((placement) => sectorIds.has(placement.sectorId))
      .map((placement) => session.world.locations.find((location) => location.id === placement.locationId))
      .filter((location): location is GameSession["world"]["locations"][number] => Boolean(location))
      .sort((left, right) => right.security - left.security)
      .slice(0, 4);
    return (
      <SheetFrame
        className="map-selection-sheet--district"
        icon={<span>▦</span>}
        eyebrow="Район"
        title={selection.district.name}
        subtitle={`${landUseLabel(selection.district.dominantLandUse)} · ${selection.district.sectorIds.length} секторов`}
        favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose}
        expanded={expanded} onToggle={toggle}
        details={<><div className="venue-sheet__metrics"><span>Население<strong>{selection.district.representedPopulation.toLocaleString("ru-RU")}</strong></span><span>Транспорт<strong>{selection.district.transitScore}/100</strong></span><span>Активность<strong>{activityLabel(selection.district.activityScore)}</strong></span><span>Риск<strong>{riskLabel(selection.district.riskScore)}</strong></span></div>{keyLocations.length ? <div className="district-sheet__places"><span>Ключевые места</span><div>{keyLocations.map((location) => <button type="button" key={location.id} onClick={() => onSelectLocation(location.id)}><i>{PLACE_ICONS[location.type]}</i><span><strong>{location.name}</strong><small>{locationTypeLabel(location.type)}</small></span><b>›</b></button>)}</div></div> : null}</>}
        actions={<button type="button" className="map-action map-action--primary" onClick={onOpenDistrict}>Открыть район</button>}
      />
    );
  }

  if (selection.kind === "sector") {
    return (
      <SheetFrame className="map-selection-sheet--sector" icon={<span>⌗</span>} eyebrow="Сектор" title={selection.sector.code} subtitle={`${landUseLabel(selection.sector.landUse)} · ${selection.sector.representedPopulation.toLocaleString("ru-RU")} жителей`} favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose} expanded={false} actions={<button type="button" className="map-action map-action--primary" onClick={onOpenDistrict}>Открыть сектор</button>} />
    );
  }

  if (selection.kind === "venue") {
    const venue = selection.venue;
    const building = session.urban.buildings.find((item) => item.id === venue.buildingId);
    const open = venueIsOpen(venue, session.timestamp);
    const operation = session.urban.venueOperations.operations.find((item) => item.venueId === venue.id);
    const inside = Boolean(building && session.localScene.playerPosition.buildingId === building.id);
    const access = building ? session.buildingAccess.buildingEntries.find((item) => item.buildingId === building.id) : undefined;
    const atEntrance = Boolean(building && session.localScene.playerPosition.state === "outside" && access && access.distanceToPlayerM <= 12 && !["locked", "closed", "unavailable"].includes(access.publicDecision));
    const occupants = session.localScene.actors.filter((actor) => actor.visible && actor.position.buildingId === venue.buildingId && (!actor.position.unitId || actor.position.unitId === venue.unitId)).length;
    const statusText = open ? "Открыто" : venue.operatingStatus === "insolvent" ? "Банкрот" : venue.operatingStatus === "seized" ? "Опечатано" : venue.operatingStatus === "renovation" ? "Ремонт" : venue.operatingStatus === "vacant" ? "Пустует" : "Закрыто";
    const route = routeCaption(preview, travel);
    return (
      <SheetFrame
        className={`map-selection-sheet--venue map-selection-sheet--generated-venue venue-sheet--${venue.category}`}
        icon={<span>{venue.category === "food" ? "♨" : venue.category === "clinic" || venue.category === "pharmacy" ? "+" : venue.category === "repair" ? "⚒" : "▤"}</span>}
        eyebrow={`${venueCategoryLabel(venue.category)} · ${building?.addressCode ?? venue.unitNumber}`}
        title={venue.name}
        subtitle={`${String(venue.openHour).padStart(2, "0")}:00—${venue.closeHour === 24 ? "24:00" : `${String(venue.closeHour).padStart(2, "0")}:00`}`}
        status={<><span className={open ? "status-good" : "status-bad"}>{statusText}</span><strong>{route}</strong></>}
        favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose}
        expanded={expanded} onToggle={toggle}
        details={<><div className="venue-sheet__metrics"><span>Качество<strong>{venue.quality}%</strong></span><span>Очередь<strong>{operation ? `${operation.queue.waitingCount} · ~${operation.queue.estimatedWaitMinutes} мин.` : "Нет данных"}</strong></span><span>Внутри<strong>{occupants}</strong></span><span>Цена<strong>{priceTierLabel(venue.priceTier)}</strong></span></div>{venue.tags.length ? <div className="generated-venue__tags">{venue.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}</>}
        actions={<>{inside ? <button type="button" className="map-action map-action--primary" onClick={onLeaveBuilding}>Выйти из здания</button> : atEntrance && building ? <button type="button" className="map-action map-action--primary" onClick={() => onEnterBuilding(building.id)}>Войти</button> : <RouteAction preview={preview} travel={travel} routeReady={routeReady} onBuildRoute={onBuildRoute} onStartRoute={onStartRoute} />}<button type="button" className="map-action" onClick={onDetails}>Профиль</button></>}
      />
    );
  }

  if (selection.kind === "location") {
    const open = isLocationOpen(selection.location, session.timestamp);
    const business = session.economy.businesses.find((item) => item.locationId === selection.location.id);
    const building = session.urban.buildings.find((item) => item.anchorLocationId === selection.location.id);
    const access = building ? session.buildingAccess.buildingEntries.find((item) => item.buildingId === building.id) : undefined;
    const atEntrance = Boolean(building && session.localScene.playerPosition.state === "outside" && access && access.distanceToPlayerM <= 12 && !["locked", "closed", "unavailable"].includes(access.publicDecision));
    const inside = Boolean(building && session.localScene.playerPosition.buildingId === building.id);
    const present = building ? session.localScene.actors.filter((actor) => actor.visible && actor.position.buildingId === building.id).length : 0;
    return (
      <SheetFrame
        className={`map-selection-sheet--venue location-sheet--${selection.location.type}`}
        icon={<span>{PLACE_ICONS[selection.location.type]}</span>}
        eyebrow={locationTypeLabel(selection.location.type)} title={selection.location.name}
        status={<><span className={open ? "status-good" : "status-bad"}>{open ? "Открыто" : "Закрыто"}</span><strong>{routeCaption(preview, travel)}</strong></>}
        favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose}
        expanded={expanded} onToggle={toggle}
        details={<div className="venue-sheet__metrics"><span>Безопасность<strong>{selection.location.security}%</strong></span><span>Спрос<strong>{business ? `${Math.round(business.demand)}%` : "Нет данных"}</strong></span><span>Внутри<strong>{present}</strong></span><span>Цены<strong>{business ? `${Math.round(business.priceIndex)}% рынка` : "Нет данных"}</strong></span></div>}
        actions={<>{inside ? <button type="button" className="map-action map-action--primary" onClick={onLeaveBuilding}>Выйти из здания</button> : atEntrance && building ? <button type="button" className="map-action map-action--primary" onClick={() => onEnterBuilding(building.id)}>Войти</button> : <RouteAction preview={preview} travel={travel} routeReady={routeReady} onBuildRoute={onBuildRoute} onStartRoute={onStartRoute} />}<button type="button" className="map-action" onClick={onDetails}>Профиль</button></>}
      />
    );
  }

  if (selection.kind === "building") {
    const inside = session.localScene.playerPosition.buildingId === selection.building.id;
    const access = session.buildingAccess.buildingEntries.find((item) => item.buildingId === selection.building.id);
    const atEntrance = Boolean(session.localScene.playerPosition.state === "outside" && access && access.distanceToPlayerM <= 12 && !["locked", "closed", "unavailable"].includes(access.publicDecision));
    return (
      <SheetFrame
        className={`map-selection-sheet--venue building-sheet--${selection.building.use}`}
        icon={<span>▥</span>} eyebrow={buildingUseLabel(selection.building.use)} title={selection.building.addressCode} subtitle={selection.building.streetName ?? undefined}
        status={<><span>{accessLabel(access?.publicDecision)}</span><strong>{routeCaption(preview, travel)}</strong></>}
        favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose}
        expanded={expanded} onToggle={toggle}
        details={<div className="venue-sheet__metrics"><span>Этажей<strong>{selection.building.floors}</strong></span><span>Жильцов<strong>{selection.building.representedResidents}</strong></span><span>Безопасность<strong>{selection.building.security}%</strong></span><span>До входа<strong>{access ? `${Math.round(access.distanceToPlayerM)} м` : "Нет данных"}</strong></span></div>}
        actions={<>{inside ? <button type="button" className="map-action map-action--primary" onClick={onLeaveBuilding}>Выйти</button> : atEntrance ? <button type="button" className="map-action map-action--primary" onClick={() => onEnterBuilding(selection.building.id)}>Войти</button> : <RouteAction preview={preview} travel={travel} routeReady={routeReady} label="Ко входу" onBuildRoute={onBuildRoute} onStartRoute={onStartRoute} />}<button type="button" className="map-action" onClick={onDetails}>Профиль дома</button></>}
      />
    );
  }

  if (selection.kind === "incident") {
    const incident = selection.incident;
    const distance = Math.round(Math.hypot(incident.xM - session.localScene.playerPosition.xM, incident.yM - session.localScene.playerPosition.yM));
    const inRange = session.localScene.playerPosition.state === "outside" && distance <= 24;
    const status = incident.status === "active" ? "Идёт сейчас" : incident.status === "reported" ? "Помощь вызвана" : incident.status === "responding" ? "Службы на месте" : "Завершено";
    return (
      <SheetFrame
        className={`map-selection-sheet--incident incident-sheet--${incident.severity}`}
        icon={<span>!</span>} eyebrow={status} title={incident.title} subtitle={incident.detail}
        status={<><span className="status-bad">Опасность {incident.severity}/3</span><strong>{distance} м</strong></>}
        favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose}
        expanded={expanded} onToggle={toggle}
        details={<div className="venue-sheet__metrics"><span>Участников<strong>{incident.participantActorIds.length}</strong></span><span>Служба<strong>{incident.responder ?? "Не вызвана"}</strong></span><span>Дистанция<strong>{distance} м</strong></span><span>Статус<strong>{status}</strong></span></div>}
        actions={<>{!inRange ? <RouteAction preview={preview} routeReady={routeReady} label="Маршрут к месту" onBuildRoute={onBuildRoute} onStartRoute={onStartRoute} /> : <><button type="button" className="map-action" onClick={() => onStreetIncidentAction(incident.id, "observe")}>Осмотреть · 2 мин</button>{incident.status === "active" && incident.responder ? <button type="button" className="map-action" onClick={() => onStreetIncidentAction(incident.id, "call-help")}>Вызвать помощь</button> : null}{incident.status !== "resolved" ? <button type="button" className="map-action map-action--danger" onClick={() => onStreetIncidentAction(incident.id, "intervene")}>Вмешаться · 6 мин</button> : null}</>}<button type="button" className="map-action map-action--quiet" onClick={() => { onStreetIncidentAction(incident.id, "move-on"); onClose(); }}>Пройти мимо</button></>}
      />
    );
  }

  if (selection.kind === "actor") {
    const assaultRange = selection.actor.visible && selection.actor.distanceToPlayerM <= 4.5 && session.playerCrime.custody?.status !== "detained";
    const close = selection.actor.distanceToPlayerM <= 5;
    return (
      <SheetFrame
        className="map-selection-sheet--person" icon={<img src={personPortrait(selection.actor.id)} alt="" />} eyebrow={selection.actor.roleLabel} title={selection.actor.name} subtitle={selection.actor.activityLabel}
        status={<><span>{Math.round(selection.actor.distanceToPlayerM)} м</span><strong>{close ? "Рядом" : routeCaption(preview)}</strong></>}
        favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose} expanded={false}
        actions={<>{!close ? <RouteAction preview={preview} routeReady={routeReady} label="Подойти" onBuildRoute={onBuildRoute} onStartRoute={onStartRoute} /> : null}{assaultRange ? <button type="button" className="map-action map-action--danger" onClick={() => onLifeAction({ kind: "assault-actor", actorId: selection.actor.id })}>Напасть</button> : null}</>}
      />
    );
  }

  if (selection.kind === "vehicle") {
    const inside = session.vehicles.player.currentVehicleId === selection.vehicle.id;
    const close = session.localScene.playerPosition.state === "outside" && selection.vehicle.distanceToPlayerM <= 6;
    const inspection = session.vehicleCrime.inspections.find((item) => item.vehicleId === selection.vehicle.id);
    const crimeAllowed = close && selection.vehicle.access !== "owned" && selection.vehicle.state !== "moving" && session.playerCrime.custody?.status !== "detained";
    return (
      <SheetFrame
        className="map-selection-sheet--vehicle" icon={<span>◇</span>} eyebrow={vehicleStateLabel(selection.vehicle)} title={selection.vehicle.modelName} subtitle={selection.vehicle.plate}
        status={<><span>{Math.round(selection.vehicle.distanceToPlayerM)} м</span><strong>{inside ? "Ты внутри" : close ? "Рядом" : routeCaption(preview)}</strong></>}
        favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose}
        expanded={expanded} onToggle={inspection ? toggle : undefined}
        details={inspection ? <div className="venue-sheet__metrics"><span>Замок<strong>{inspection.lockDifficulty}%</strong></span><span>Зажигание<strong>{inspection.ignitionDifficulty}%</strong></span><span>Камеры<strong>{inspection.cameraRisk}%</strong></span><span>Свидетели<strong>{inspection.witnessRisk}%</strong></span></div> : undefined}
        actions={<>{inside ? <button type="button" className="map-action map-action--primary" onClick={onLeaveVehicle}>Выйти</button> : selection.vehicle.playerCanEnter && selection.vehicle.distanceToPlayerM <= 12 ? <button type="button" className="map-action map-action--primary" onClick={() => onEnterVehicle(selection.vehicle.id)}>Сесть</button> : !close ? <RouteAction preview={preview} routeReady={routeReady} label="Подойти" onBuildRoute={onBuildRoute} onStartRoute={onStartRoute} /> : null}{crimeAllowed && !inspection ? <button type="button" className="map-action map-action--danger" onClick={() => onLifeAction({ kind: "inspect-vehicle-crime", vehicleId: selection.vehicle.id })}>Осмотреть защиту</button> : null}{crimeAllowed && inspection && selection.vehicle.locked ? <button type="button" className="map-action map-action--danger" onClick={() => onLifeAction({ kind: "break-in-vehicle", vehicleId: selection.vehicle.id })}>Вскрыть машину</button> : null}{crimeAllowed && inspection && !selection.vehicle.locked ? <button type="button" className="map-action map-action--danger" onClick={() => onLifeAction({ kind: "hotwire-vehicle", vehicleId: selection.vehicle.id })}>Угнать</button> : null}</>}
      />
    );
  }

  return (
    <SheetFrame
      className="map-selection-sheet--point" icon={<span>{selection.kind === "stop" ? "B" : "⌖"}</span>} eyebrow={selection.kind === "stop" ? "Остановка" : "Точка"} title={selectionTitle(selection)}
      status={<strong>{routeCaption(preview, travel)}</strong>}
      favorite={favorite} onFavorite={onFavorite} onShare={onShare} onClose={onClose} expanded={false}
      actions={<RouteAction preview={preview} travel={travel} routeReady={routeReady} onBuildRoute={onBuildRoute} onStartRoute={onStartRoute} />}
    />
  );
}
