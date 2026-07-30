import { useMemo, useState } from "react";
import type { GameSession, LocationState } from "../../world/state/types";
import type { BuildingState, VenueState } from "../../simulation/urban/types";
import { isLocationOpen } from "../../gameplay/travel/travelSystem";
import { PLACE_ICONS, personPortrait } from "../shared/presentation";
import { buildingUseLabel, formatHours, locationTypeLabel, venueCategoryLabel, venueIsOpen } from "./mapUi";

function bars(value: number): JSX.Element[] {
  const filled = Math.round(Math.max(0, Math.min(100, value)) / 20);
  return Array.from({ length: 5 }, (_, index) => <i key={index} className={index < filled ? "is-filled" : ""} />);
}

function venueDescription(location: LocationState): string {
  if (location.type === "food") return "Городская точка питания. Доступность, цены и загрузка меняются вместе с экономикой района.";
  if (location.type === "market") return "Торговая точка с физическим запасом товаров и зависимостью от местных поставок.";
  if (location.type === "clinic") return "Медицинский объект с реальной загрузкой, персоналом и запасом расходников.";
  if (location.type === "transport") return "Транспортный узел, связанный с маршрутами, остановками и текущей работой сети.";
  if (location.type === "office" || location.type === "workshop") return "Рабочий объект организации. Доступ зависит от режима, безопасности и положения игрока.";
  return "Физический городской объект. Все действия выполняются через его входы и помещения.";
}

function FloorGrid({ building, session, selectedFloor, onSelectFloor, onMoveFloor }: {
  building: BuildingState;
  session: GameSession;
  selectedFloor: number;
  onSelectFloor: (floor: number) => void;
  onMoveFloor: (floor: number, method: "stairs" | "elevator") => void;
}) {
  const units = session.urban.units.filter((unit) => unit.buildingId === building.id);
  const playerInside = session.localScene.playerPosition.buildingId === building.id;
  const floorRows = useMemo(() => Array.from({ length: building.floors }, (_, index) => building.floors - index), [building.floors]);
  const floorUnits = units.filter((unit) => unit.floor === selectedFloor);
  const selectedAccess = session.buildingAccess.floors.find((floor) => floor.floor === selectedFloor);
  const occupied = floorUnits.filter((unit) => unit.occupied).length;
  const capacity = floorUnits.length || Math.max(2, Math.round(building.residentialUnits / Math.max(1, building.floors)));

  return (
    <section className="building-profile__floors">
      <header><div><span>ЭТАЖИ</span><h3>{building.floors} этажей</h3></div><strong>{playerInside ? `Вы внутри · ${session.localScene.playerPosition.floor ?? 1}F` : "Вы снаружи"}</strong></header>
      <div className="building-profile__floor-layout">
        <div className="building-profile__floor-rail" role="listbox" aria-label="Этажи здания">
          {floorRows.map((floor) => (
            <button type="button" role="option" aria-selected={floor === selectedFloor} className={floor === selectedFloor ? "is-active" : ""} key={floor} onClick={() => onSelectFloor(floor)}>
              <span>{floor}</span><i />
            </button>
          ))}
        </div>
        <div className="building-profile__floor-detail">
          <div className="building-profile__unit-grid">
            {Array.from({ length: Math.max(4, capacity) }, (_, index) => {
              const unit = floorUnits[index];
              const active = unit?.id === session.localScene.playerPosition.unitId;
              return <div key={unit?.id ?? index} className={`${unit?.occupied ? "is-occupied" : ""}${active ? " is-player" : ""}`}><span>{unit?.unitNumber ?? `${selectedFloor}${String(index + 1).padStart(2, "0")}`}</span>{active ? <b>ВЫ</b> : null}</div>;
            })}
          </div>
          <dl>
            <div><dt>Назначение</dt><dd>{selectedFloor === 1 ? "Лобби и помещения" : "Квартиры и сервис"}</dd></div>
            <div><dt>Занято</dt><dd>{occupied}/{capacity}</dd></div>
            <div><dt>Лестницы</dt><dd>{selectedAccess?.stairsAvailable === false ? "Нет" : "Доступны"}</dd></div>
            <div><dt>Лифт</dt><dd>{building.elevatorCount > 0 && selectedAccess?.elevatorAvailable !== false ? "Работает" : "Недоступен"}</dd></div>
          </dl>
          <div className="building-profile__floor-actions">
            <button type="button" disabled={!playerInside || selectedFloor === session.localScene.playerPosition.floor} onClick={() => onMoveFloor(selectedFloor, "stairs")}>Лестница</button>
            <button type="button" disabled={!playerInside || building.elevatorCount <= 0 || selectedFloor === session.localScene.playerPosition.floor} onClick={() => onMoveFloor(selectedFloor, "elevator")}>Лифт</button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MapProfileOverlay({
  session,
  location,
  venue,
  building,
  favorite,
  routeCaption,
  onClose,
  onFavorite,
  onShare,
  onBuildRoute,
  onStartRoute,
  onEnterBuilding,
  onLeaveBuilding,
  onEnterUnit,
  onLeaveUnit,
  onMoveFloor,
  onSelectVenue,
  onNotice
}: {
  session: GameSession;
  location?: LocationState;
  venue?: VenueState;
  building?: BuildingState;
  favorite: boolean;
  routeCaption: string;
  onClose: () => void;
  onFavorite: () => void;
  onShare: () => void;
  onBuildRoute: () => void;
  onStartRoute: () => void;
  onEnterBuilding: (buildingId: string) => void;
  onLeaveBuilding: () => void;
  onEnterUnit: (unitId: string) => void;
  onLeaveUnit: () => void;
  onMoveFloor: (floor: number, method: "stairs" | "elevator") => void;
  onSelectVenue: (venueId: string) => void;
  onNotice: (message: string) => void;
}) {
  const targetBuilding = building ?? (venue ? session.urban.buildings.find((item) => item.id === venue.buildingId) : location ? session.urban.buildings.find((item) => item.anchorLocationId === location.id) : undefined);
  const [selectedFloor, setSelectedFloor] = useState(() => Math.max(1, session.localScene.playerPosition.buildingId === targetBuilding?.id ? session.localScene.playerPosition.floor ?? 1 : 1));

  if (venue && targetBuilding) {
    const open = venueIsOpen(venue, session.timestamp);
    const access = session.buildingAccess.buildingEntries.find((item) => item.buildingId === targetBuilding.id);
    const unit = session.urban.units.find((item) => item.id === venue.unitId);
    const operation = session.urban.venueOperations.operations.find((item) => item.venueId === venue.id);
    const insideBuilding = session.localScene.playerPosition.buildingId === targetBuilding.id;
    const insideVenue = insideBuilding && session.localScene.playerPosition.unitId === venue.unitId;
    const actors = session.localScene.actors.filter((actor) => actor.visible && actor.position.buildingId === targetBuilding.id && (!actor.position.unitId || actor.position.unitId === venue.unitId));
    return (
      <div className="map-profile-overlay" data-no-swipe>
        <article className={`map-profile map-profile--venue map-profile--generated-venue map-profile--${venue.category}`}>
          <header className={`map-profile__hero map-profile__hero--venue-${venue.category}`}>
            <div className="map-profile__hero-city generated-venue-hero" aria-hidden="true"><i/><i/><i/><i/><b>{venue.code}</b><em>{venue.unitNumber}</em></div>
            <div className="map-profile__hero-actions"><button type="button" onClick={onClose}>‹</button><span className={open ? "is-open" : "is-closed"}>{open ? "● ОТКРЫТО" : operation?.status === "insolvent" ? "● БАНКРОТ" : operation?.status === "seized" ? "● ОПЕЧАТАНО" : "● ЗАКРЫТО"}</span><button type="button" className={favorite ? "is-active" : ""} onClick={onFavorite}>♡</button><button type="button" onClick={onShare}>↗</button></div>
            <div className="map-profile__hero-copy"><span>{venueCategoryLabel(venue.category)}</span><h2>{venue.name}</h2><p>{targetBuilding.addressCode} · {venue.floor} этаж · {String(venue.openHour).padStart(2, "0")}:00—{venue.closeHour === 24 ? "24:00" : `${String(venue.closeHour).padStart(2, "0")}:00`}</p></div>
          </header>
          <div className="map-profile__content">
            <section className="profile-stat-grid">
              <div><span>Качество</span><strong>{venue.quality}%</strong><em>{bars(venue.quality)}</em></div>
              <div><span>Безопасность</span><strong>{venue.security}%</strong><em>{bars(venue.security)}</em></div>
              <div><span>Спрос</span><strong>{venue.demand}%</strong><em>{bars(venue.demand)}</em></div>
              <div><span>Персонал</span><strong>{operation?.staffPresent ?? 0} на смене</strong><em>{bars(venue.staffing)}</em></div>
              <div><span>Запасы</span><strong>{operation?.offers.reduce((sum, offer) => sum + offer.stock, 0) ?? 0} ед.</strong><em>{bars(venue.stock)}</em></div>
              <div><span>Цена</span><strong>{"₵".repeat(venue.priceTier)}</strong></div>
            </section>
            <section className="map-profile__description"><span>ЗАВЕДЕНИЕ</span><p>{venue.tags.join(" · ")}. Реальное помещение {unit?.unitNumber ?? venue.unitNumber} внутри здания {targetBuilding.addressCode}.</p></section>
            <section className="generated-venue__address"><div><span>Адрес</span><strong>{targetBuilding.streetName ?? targetBuilding.addressCode} {targetBuilding.streetNumber ?? ""}</strong></div><div><span>Помещение</span><strong>{venue.floor}F · {venue.unitNumber}</strong></div><div><span>Популярность</span><strong>{venue.popularity}%</strong></div><div><span>Сейчас внутри</span><strong>{actors.length}</strong></div></section>
            {operation ? <section className="venue-profile__operations"><header><span>РАБОТА ЗАВЕДЕНИЯ</span><strong className={open ? "status-good" : "status-bad"}>{operation.status === "operating" ? (open ? "ОТКРЫТО" : "ВНЕ ГРАФИКА") : operation.status === "insolvent" ? "БАНКРОТ" : operation.status === "seized" ? "ОПЕЧАТАНО" : operation.status === "renovation" ? "РЕМОНТ" : operation.status === "vacant" ? "ПУСТУЕТ" : "ЗАКРЫТО"}</strong></header><div><span>Очередь <b>{operation.queue.waitingCount} чел. · ~{operation.queue.estimatedWaitMinutes} мин.</b></span><span>Выручка сегодня <b>₵ {operation.revenueToday}</b></span><span>Обслужено <b>{operation.queue.servedToday}</b></span></div></section> : null}
            {operation ? <section className="venue-profile__offers"><header><span>АССОРТИМЕНТ И УСЛУГИ</span><strong>{operation.offers.filter((offer) => offer.active).length}</strong></header><div>{operation.offers.filter((offer) => offer.active).map((offer) => <article key={offer.id}><div><strong>{offer.name}</strong><small>{offer.description}</small></div><span>₵ {offer.currentPrice}</span><em>{offer.stock} шт.</em></article>)}</div></section> : null}
            <section className="map-profile__inside"><header><span>СЕЙЧАС ВНУТРИ</span><strong>{actors.length}</strong></header><div>{actors.slice(0, 6).map((actor) => <div key={actor.id}><img src={personPortrait(actor.id)} alt=""/><span>{actor.name}</span><small>{actor.activityLabel}</small></div>)}{!actors.length ? <p>Видимых посетителей нет.</p> : null}</div></section>
            <section className="map-profile__route"><div><span>МАРШРУТ</span><strong>{routeCaption}</strong></div><button type="button" onClick={onBuildRoute}>Построить</button></section>
          </div>
          <footer className="map-profile__footer">
            <button type="button" className="map-profile__primary" onClick={onStartRoute}>Пойти ко входу</button>
            {!insideBuilding && access && access.distanceToPlayerM <= 12 ? <button type="button" onClick={() => onEnterBuilding(targetBuilding.id)}>Войти в здание</button> : null}
            {insideBuilding && !insideVenue && session.localScene.playerPosition.floor === venue.floor ? <button type="button" disabled={!open} onClick={() => onEnterUnit(venue.unitId)}>Войти в заведение</button> : null}
            {insideBuilding && !insideVenue && session.localScene.playerPosition.floor !== venue.floor ? <button type="button" onClick={() => onNotice(`Заведение находится на ${venue.floor} этаже`)}>Этаж {venue.floor}</button> : null}
            {insideVenue ? <button type="button" onClick={onLeaveUnit}>Выйти в коридор</button> : null}
            {!insideBuilding && (!access || access.distanceToPlayerM > 12) ? <button type="button" onClick={() => onNotice("Сначала подойди ко входу")}>Войти</button> : null}
          </footer>
        </article>
      </div>
    );
  }

  if (location) {
    const open = isLocationOpen(location, session.timestamp);
    const business = session.economy.businesses.find((item) => item.locationId === location.id);
    const actors = targetBuilding ? session.localScene.actors.filter((actor) => actor.visible && actor.position.buildingId === targetBuilding.id) : [];
    const access = targetBuilding ? session.buildingAccess.buildingEntries.find((item) => item.buildingId === targetBuilding.id) : undefined;
    const inside = targetBuilding && session.localScene.playerPosition.buildingId === targetBuilding.id;
    return (
      <div className="map-profile-overlay" data-no-swipe>
        <article className="map-profile map-profile--venue">
          <header className={`map-profile__hero map-profile__hero--${location.type}`}>
            <div className="map-profile__hero-city" aria-hidden="true"><i /><i /><i /><i /><b>{location.code}</b></div>
            <div className="map-profile__hero-actions"><button type="button" onClick={onClose}>‹</button><span className={open ? "is-open" : "is-closed"}>{open ? "● ОТКРЫТО" : "● ЗАКРЫТО"}</span><button type="button" className={favorite ? "is-active" : ""} onClick={onFavorite}>♡</button><button type="button" onClick={onShare}>↗</button></div>
            <div className="map-profile__hero-copy"><span>{locationTypeLabel(location.type)}</span><h2>{location.name}</h2><p>{location.code} · {formatHours(location)}</p></div>
          </header>

          <div className="map-profile__content">
            <section className="profile-stat-grid">
              <div><span>Безопасность</span><strong>{location.security}%</strong><em>{bars(location.security)}</em></div>
              <div><span>Доступ</span><strong>{access?.publicReason ?? (open ? "Проверяется у входа" : "Закрыто")}</strong></div>
              <div><span>Спрос</span><strong>{business?.demand ?? 0}%</strong><em>{bars(business?.demand ?? 0)}</em></div>
              <div><span>Персонал</span><strong>{business?.staffing ?? 0}%</strong><em>{bars(business?.staffing ?? 0)}</em></div>
              <div><span>Запас</span><strong>{business?.stock ?? 0}</strong><em>{bars(business?.stock ?? 0)}</em></div>
              <div><span>Цена</span><strong>{business ? `${business.priceIndex}% рынка` : "Нет данных"}</strong></div>
            </section>

            <section className="map-profile__description"><span>ОБ ОБЪЕКТЕ</span><p>{venueDescription(location)}</p></section>

            <section className="map-profile__inside">
              <header><span>СЕЙЧАС ВНУТРИ</span><strong>{actors.length}</strong></header>
              <div>{actors.slice(0, 6).map((actor) => <div key={actor.id}><img src={personPortrait(actor.id)} alt="" /><span>{actor.name}</span><small>{actor.activityLabel}</small></div>)}{!actors.length ? <p>Видимых людей нет.</p> : null}</div>
            </section>

            <section className="map-profile__route"><div><span>МАРШРУТ</span><strong>{routeCaption}</strong></div><button type="button" onClick={onBuildRoute}>Построить</button></section>
          </div>

          <footer className="map-profile__footer">
            <button type="button" className="map-profile__primary" onClick={onStartRoute}>Идти сюда</button>
            {targetBuilding && inside ? <button type="button" onClick={onLeaveBuilding}>Выйти</button> : targetBuilding && access && access.distanceToPlayerM <= 12 ? <button type="button" onClick={() => onEnterBuilding(targetBuilding.id)}>Войти</button> : <button type="button" onClick={() => onNotice("Сначала подойди ко входу")}>Войти</button>}
            <button type="button" onClick={() => onNotice("Мероприятия появятся в следующем блоке")}>Мероприятия</button>
          </footer>
        </article>
      </div>
    );
  }

  if (targetBuilding) {
    const access = session.buildingAccess.buildingEntries.find((item) => item.buildingId === targetBuilding.id);
    const inside = session.localScene.playerPosition.buildingId === targetBuilding.id;
    const residents = session.localScene.actors.filter((actor) => actor.visible && actor.position.buildingId === targetBuilding.id);
    const buildingVenues = session.urban.venues.filter((venue) => venue.buildingId === targetBuilding.id && venue.active).sort((left, right) => left.floor - right.floor || right.mapPriority - left.mapPriority);
    return (
      <div className="map-profile-overlay" data-no-swipe>
        <article className="map-profile map-profile--building">
          <header className="map-profile__hero map-profile__hero--building">
            <div className="building-hero" aria-hidden="true">{Array.from({ length: Math.min(18, targetBuilding.floors) }, (_, index) => <i key={index} className={(index + targetBuilding.id.length) % 4 === 0 ? "is-lit" : ""} />)}<b>{targetBuilding.addressCode}</b></div>
            <div className="map-profile__hero-actions"><button type="button" onClick={onClose}>‹</button><span className={access && ["open", "authorized"].includes(access.publicDecision) ? "is-open" : "is-closed"}>● {access?.publicDecision === "authorized" ? "ДОСТУП ЕСТЬ" : access?.publicDecision === "open" ? "ОТКРЫТО" : "ДОСТУП ОГРАНИЧЕН"}</span><button type="button" className={favorite ? "is-active" : ""} onClick={onFavorite}>♡</button><button type="button" onClick={onShare}>↗</button></div>
            <div className="map-profile__hero-copy"><span>{buildingUseLabel(targetBuilding.use)}</span><h2>{targetBuilding.addressCode}</h2><p>{targetBuilding.streetName ?? targetBuilding.parcelCode} · {targetBuilding.floors} этажей</p></div>
          </header>

          <div className="map-profile__content">
            <section className="profile-stat-grid profile-stat-grid--building">
              <div><span>Безопасность</span><strong>{targetBuilding.security}%</strong><em>{bars(targetBuilding.security)}</em></div>
              <div><span>Состояние</span><strong>{targetBuilding.condition}%</strong><em>{bars(targetBuilding.condition)}</em></div>
              <div><span>Жильцов</span><strong>{targetBuilding.representedResidents}/{targetBuilding.residentCapacity}</strong></div>
              <div><span>Входы</span><strong>{targetBuilding.publicEntrances + targetBuilding.serviceEntrances}</strong></div>
              <div><span>Лифты</span><strong>{targetBuilding.elevatorCount}</strong></div>
              <div><span>Лестницы</span><strong>{targetBuilding.stairwellCount}</strong></div>
            </section>

            <FloorGrid building={targetBuilding} session={session} selectedFloor={selectedFloor} onSelectFloor={setSelectedFloor} onMoveFloor={onMoveFloor} />

            {buildingVenues.length ? <section className="building-profile__venues"><header><span>ЗАВЕДЕНИЯ ВНУТРИ</span><strong>{buildingVenues.length}</strong></header><div>{buildingVenues.slice(0, 12).map((venue) => <button type="button" key={venue.id} onClick={() => onSelectVenue(venue.id)}><strong>{venue.name}</strong><small>{venueCategoryLabel(venue.category)} · {venue.floor}F · {venue.unitNumber}</small><b>›</b></button>)}</div></section> : null}

            <section className="map-profile__inside"><header><span>РЯДОМ СЕЙЧАС</span><strong>{residents.length}</strong></header><div>{residents.slice(0, 7).map((actor) => <div key={actor.id}><img src={personPortrait(actor.id)} alt="" /><span>{actor.name}</span><small>{actor.position.floor ? `${actor.position.floor} этаж` : actor.activityLabel}</small></div>)}{!residents.length ? <p>Видимых жильцов нет.</p> : null}</div></section>
          </div>

          <footer className="map-profile__footer">
            <button type="button" className="map-profile__primary" onClick={onStartRoute}>Пойти ко входу</button>
            {inside ? <button type="button" onClick={onLeaveBuilding}>Выйти</button> : access && access.distanceToPlayerM <= 12 ? <button type="button" onClick={() => onEnterBuilding(targetBuilding.id)}>Войти</button> : <button type="button" onClick={() => onNotice("Сначала подойди ко входу")}>Войти</button>}
            <button type="button" onClick={() => onNotice("Список жильцов откроется после системы знакомств")}>Жильцы</button>
          </footer>
        </article>
      </div>
    );
  }

  return null;
}
