import type { ChangeEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameSession } from "../../world/state/types";
import type { LocalActorState, LocalBuildingPresenceState } from "../../simulation/localScene/types";
import type { PhysicalVehicleEntityState, VehicleLegalStatus } from "../../simulation/vehicles/types";
import { activeRequests } from "../../gameplay/pressure/pressureSystem";
import { actorActivityIcon, buildingUseLabel, personPortrait, vehicleStateLabel } from "../shared/presentation";
import type { NearbyMode, NoticeTone } from "../shared/types";
import type { LocalMovementTargetState } from "../../simulation/localMovement/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { LocalActionsPanel } from "./LocalActionsPanel";
import { localMovementTargetForActor, localMovementTargetForBuilding, localMovementTargetForVehicle } from "../../simulation/localMovement/localMovementSystem";
import { ConversationPanel } from "../social/ConversationPanel";
import type { ConversationAction } from "../../simulation/social/types";
import { getConversationAvailability } from "../../gameplay/social/socialCommands";
import { formatGameShortDateTime, formatGameTime } from "../../core/time/gameTime";

interface SelectedEntity {
  type: "person" | "building" | "vehicle";
  id: string;
}

interface SwipeState {
  pointerId: number;
  x: number;
  y: number;
}

const tabs: Array<{ id: NearbyMode; label: string; icon: string }> = [
  { id: "actions", label: "Действия", icon: "◆" },
  { id: "people", label: "Люди", icon: "♙" },
  { id: "places", label: "Здания", icon: "▦" },
  { id: "cars", label: "Машины", icon: "▰" },
  { id: "events", label: "События", icon: "◉" }
];
const TAB_ORDER = tabs.map((tab) => tab.id);

function healthLabel(value: LocalActorState["health"]): string {
  if (value === "healthy") return "Стабильно";
  if (value === "strained") return "Истощён";
  if (value === "ill") return "Болен";
  return "Ограничен";
}

function legalStatusLabel(value: VehicleLegalStatus): string {
  if (value === "registered") return "Зарегистрирована";
  if (value === "stolen") return "Числится украденной";
  if (value === "wanted") return "В розыске";
  if (value === "replated") return "Номера заменены";
  return "Разобрана";
}

function requestStatusLabel(status: string): string {
  return status === "accepted" ? "Принято" : "Ждёт ответа";
}

export function NearbyScreen({
  session,
  onSelectPerson,
  onWalkTo,
  onEnterBuilding,
  onEnterVehicle,
  onLeaveBuilding,
  onLeaveBuildingUnit,
  onLeaveInteriorRoom,
  onLeaveVehicle,
  onRouteTo,
  onLifeAction,
  onStartConversation,
  onConversationAction,
  onEndConversation,
  onAdvance,
  notify
}: {
  session: GameSession;
  onSelectPerson: (personId: string) => void;
  onWalkTo: (target: LocalMovementTargetState) => void;
  onEnterBuilding: (buildingId: string) => void;
  onEnterVehicle: (vehicleId: string) => void;
  onLeaveBuilding: () => void;
  onLeaveBuildingUnit: () => void;
  onLeaveInteriorRoom: () => void;
  onLeaveVehicle: () => void;
  onRouteTo: (locationId: string) => void;
  onLifeAction: (action: LocalLifeAction) => void;
  onStartConversation: (personId: string) => void;
  onConversationAction: (action: ConversationAction) => void;
  onEndConversation: () => void;
  onAdvance: (minutes: number, source: string) => void;
  notify: (text: string, tone?: NoticeTone) => void;
}) {
  const [mode, setMode] = useState<NearbyMode>("actions");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedEntity | null>(null);
  const swipeRef = useRef<SwipeState | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const playerPosition = session.localScene.playerPosition;

  const actors = useMemo(() => [...session.localScene.actors]
    .filter((actor) => actor.visible)
    .filter((actor) => !normalizedQuery || `${actor.name} ${actor.roleLabel} ${actor.activityLabel}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery))
    .sort((left, right) => Number(right.interactable) - Number(left.interactable) || left.distanceToPlayerM - right.distanceToPlayerM), [normalizedQuery, session.localScene.actors]);
  const buildings = useMemo(() => [...session.localScene.buildings]
    .filter((building) => !normalizedQuery || `${building.addressCode} ${building.use}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery))
    .sort((left, right) => Number(right.playerInside) - Number(left.playerInside) || left.distanceToPlayerM - right.distanceToPlayerM), [normalizedQuery, session.localScene.buildings]);
  const vehicles = useMemo(() => [...session.vehicles.vehicles]
    .filter((vehicle) => vehicle.visible)
    .filter((vehicle) => !normalizedQuery || `${vehicle.modelName} ${vehicle.plate} ${vehicle.vehicleClass}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery))
    .sort((left, right) => Number(right.id === session.vehicles.player.currentVehicleId) - Number(left.id === session.vehicles.player.currentVehicleId) || left.distanceToPlayerM - right.distanceToPlayerM), [normalizedQuery, session.vehicles.player.currentVehicleId, session.vehicles.vehicles]);
  const events = useMemo(() => session.events
    .filter((event) => event.category === "local" || event.category === "contact")
    .filter((event) => !normalizedQuery || `${event.title} ${event.detail ?? ""}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery))
    .slice().sort((left, right) => right.timestamp - left.timestamp).slice(0, 30), [normalizedQuery, session.events]);

  const selectedActor = selected?.type === "person" ? actors.find((actor) => actor.id === selected.id) : undefined;
  const selectedBuilding = selected?.type === "building" ? buildings.find((building) => building.buildingId === selected.id) : undefined;
  const selectedVehicle = selected?.type === "vehicle" ? vehicles.find((vehicle) => vehicle.id === selected.id) : undefined;
  const selectionExists = Boolean(selectedActor || selectedBuilding || selectedVehicle);
  const currentBuilding = playerPosition.buildingId ? session.urban.buildings.find((building) => building.id === playerPosition.buildingId) : undefined;
  const currentVehicle = session.vehicles.player.currentVehicleId ? session.vehicles.vehicles.find((vehicle) => vehicle.id === session.vehicles.player.currentVehicleId) : undefined;

  useEffect(() => {
    if (selected && !selectionExists) setSelected(null);
  }, [selected, selectionExists]);

  const buildingAccess = selectedBuilding ? session.buildingAccess.buildingEntries.find((entry) => entry.buildingId === selectedBuilding.buildingId) : undefined;
  const actorTarget = selectedActor ? localMovementTargetForActor(session, selectedActor.id) : null;
  const buildingTarget = selectedBuilding ? localMovementTargetForBuilding(session, selectedBuilding.buildingId) : null;
  const vehicleTarget = selectedVehicle ? localMovementTargetForVehicle(session, selectedVehicle.id) : null;
  const selectedPersonId = selectedActor?.activePersonId;
  const conversationAvailability = selectedPersonId ? getConversationAvailability(session, selectedPersonId) : null;
  const personRequests = selectedPersonId ? activeRequests(session.pressure).filter((request) => request.personId === selectedPersonId) : [];
  const playerOutside = playerPosition.state === "outside";
  const canEnterBuilding = Boolean(selectedBuilding && playerOutside && selectedBuilding.distanceToPlayerM <= 12 && buildingAccess && !["locked", "closed", "unavailable"].includes(buildingAccess.publicDecision));
  const canWalkToBuilding = Boolean(selectedBuilding && playerOutside && selectedBuilding.distanceToPlayerM > 12 && buildingTarget);
  const canEnterVehicle = Boolean(selectedVehicle && playerOutside && selectedVehicle.playerCanEnter && selectedVehicle.distanceToPlayerM <= 12);
  const canWalkToVehicle = Boolean(selectedVehicle && playerOutside && selectedVehicle.distanceToPlayerM > 12 && vehicleTarget);
  const canWalkToActor = Boolean(selectedActor && !selectedActor.interactable && actorTarget);

  function changeMode(next: NearbyMode): void {
    setMode(next);
    setSelected(null);
  }

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    swipeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 58 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    const index = TAB_ORDER.indexOf(mode);
    const next = TAB_ORDER[dx < 0 ? index + 1 : index - 1];
    if (next) changeMode(next);
  }

  function choosePerson(actor: LocalActorState): void {
    setSelected({ type: "person", id: actor.id });
    if (actor.activePersonId) onSelectPerson(actor.activePersonId);
  }

  return (
    <section className="screen nearby-screen" aria-labelledby="nearby-title">
      <header className="screen-heading nearby-screen__heading">
        <div><span>Активный сектор</span><h1 id="nearby-title">Рядом</h1><p>Только то, что персонаж реально видит и может достичь.</p></div>
        <label className="nearby-search"><span className="sr-only">Поиск</span><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Имя, адрес, номер…" /></label>
      </header>

      {playerPosition.state === "inside" && currentBuilding ? <section className="nearby-player-context" aria-label="Текущее положение игрока"><div><i>▦</i><span><small>Внутри здания</small><strong>{currentBuilding.addressCode}</strong><em>Этаж {playerPosition.floor ?? 1}{playerPosition.roomId ? " · комната" : playerPosition.unitId ? " · помещение" : ""}</em></span></div><button type="button" onClick={playerPosition.roomId ? onLeaveInteriorRoom : playerPosition.unitId ? onLeaveBuildingUnit : onLeaveBuilding}>{playerPosition.roomId ? "Выйти из комнаты" : playerPosition.unitId ? "Выйти в коридор" : "Выйти на улицу"}</button></section> : null}
      {playerPosition.state === "vehicle" && currentVehicle ? <section className="nearby-player-context" aria-label="Текущее положение игрока"><div><i>▰</i><span><small>В машине</small><strong>{currentVehicle.modelName}</strong><em>{currentVehicle.plate} · {session.vehicles.player.seat === "driver" ? "водитель" : "пассажир"}</em></span></div><button type="button" onClick={onLeaveVehicle}>Выйти из машины</button></section> : null}

      <div className="nearby-tabs" role="tablist" aria-label="Категории объектов">
        {tabs.map((tab) => {
          const count = tab.id === "people" ? actors.length : tab.id === "places" ? buildings.length : tab.id === "cars" ? vehicles.length : tab.id === "events" ? events.length : null;
          return <button type="button" role="tab" aria-selected={mode === tab.id} key={tab.id} className={mode === tab.id ? "is-active" : ""} onClick={() => changeMode(tab.id)}><i>{tab.icon}</i><span>{tab.label}</span>{count !== null ? <b>{count}</b> : null}</button>;
        })}
      </div>

      <div className={`nearby-layout ${selected ? "has-selection" : ""}`} data-no-swipe onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={() => { swipeRef.current = null; }}>
        <div className="nearby-list" role="tabpanel">
          {mode === "actions" ? <LocalActionsPanel session={session} onAction={onLifeAction} onRouteTo={onRouteTo} /> : null}
          {mode === "people" ? actors.map((actor) => <button type="button" key={actor.id} className={selectedActor?.id === actor.id ? "is-selected" : ""} onClick={() => choosePerson(actor)}><img src={personPortrait(actor.id)} alt="" /><span><strong>{actor.name}</strong><small>{actor.roleLabel}</small><em>{actorActivityIcon(actor)} {actor.activityLabel}</em></span><aside><strong>{Math.round(actor.distanceToPlayerM)} м</strong><small>{actor.interactable ? "можно говорить" : "в поле зрения"}</small></aside></button>) : null}
          {mode === "places" ? buildings.map((building) => <button type="button" key={building.buildingId} className={selectedBuilding?.buildingId === building.buildingId ? "is-selected" : ""} onClick={() => setSelected({ type: "building", id: building.buildingId })}><i className="entity-icon">▦</i><span><strong>{building.addressCode}</strong><small>{buildingUseLabel(building)}</small><em>{building.occupiedActorCount} внутри · безопасность {Math.round(building.security)}%</em></span><aside><strong>{building.playerInside ? "Внутри" : `${Math.round(building.distanceToPlayerM)} м`}</strong><small>{building.publicEntrances ? `${building.publicEntrances} вход.` : "нет входа"}</small></aside></button>) : null}
          {mode === "cars" ? vehicles.map((vehicle) => <button type="button" key={vehicle.id} className={selectedVehicle?.id === vehicle.id ? "is-selected" : ""} onClick={() => setSelected({ type: "vehicle", id: vehicle.id })}><i className="entity-icon">▰</i><span><strong>{vehicle.modelName}</strong><small>{vehicle.plate} · {vehicleStateLabel(vehicle)}</small><em>Топливо {Math.round(vehicle.fuelL / Math.max(1, vehicle.fuelCapacityL) * 100)}% · состояние {Math.round(vehicle.condition)}%</em></span><aside><strong>{vehicle.id === currentVehicle?.id ? "Текущая" : `${Math.round(vehicle.distanceToPlayerM)} м`}</strong><small>{vehicle.locked ? "закрыта" : "доступна"}</small></aside></button>) : null}
          {mode === "events" ? events.map((event) => <article className="event-row" key={event.id}><i>◉</i><span><strong>{event.title}</strong><small>{event.detail ?? "Без подробностей"}</small></span><time dateTime={new Date(event.timestamp).toISOString()}>{formatGameTime(event.timestamp)}</time></article>) : null}
          {((mode === "people" && !actors.length) || (mode === "places" && !buildings.length) || (mode === "cars" && !vehicles.length) || (mode === "events" && !events.length)) ? <p className="empty-copy">В текущем физическом контексте ничего не найдено.</p> : null}
        </div>

        {selected ? <aside className="entity-inspector">
          <button type="button" className="entity-inspector__close" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
          {selectedActor ? <>
            <header><img src={personPortrait(selectedActor.id)} alt="" /><div><h2>{selectedActor.name}</h2><strong>{selectedActor.roleLabel}</strong><span>{actorActivityIcon(selectedActor)} {selectedActor.activityLabel}</span></div></header>
            <dl><div><dt>Расстояние</dt><dd>{Math.round(selectedActor.distanceToPlayerM)} м</dd></div><div><dt>Возраст</dt><dd>{selectedActor.age}</dd></div><div><dt>Состояние</dt><dd>{healthLabel(selectedActor.health)}</dd></div><div><dt>Знакомство</dt><dd>{selectedActor.knownToPlayer ? "Знаком" : "Незнакомец"}</dd></div></dl>
            {personRequests.length ? <section className="entity-requests"><header><span>Личные просьбы</span><strong>{personRequests.length}</strong></header>{personRequests.map((request) => <article key={request.id} className={request.status === "accepted" ? "is-active" : ""}><div><span>{request.code} · {requestStatusLabel(request.status)}</span><strong>{request.title}</strong><p>{request.detail}</p><small>До {formatGameShortDateTime(request.dueAt)} · затраты ₵ {request.upfrontCost} · награда ₵ {request.reward}</small></div>{selectedActor.interactable ? <footer>{request.status === "open" ? <button type="button" onClick={() => onLifeAction({ kind: "accept-personal-request", requestId: request.id })}>Принять</button> : <button type="button" disabled={session.player.balance < request.upfrontCost} onClick={() => onLifeAction({ kind: "complete-personal-request", requestId: request.id })}>Выполнить · {request.durationMinutes} мин.</button>}<button type="button" className="is-quiet" onClick={() => onLifeAction({ kind: "decline-personal-request", requestId: request.id })}>Отказать</button></footer> : <em>Подойди ближе, чтобы ответить.</em>}</article>)}</section> : null}
            <div className="entity-actions">{canWalkToActor && actorTarget ? <button type="button" onClick={() => onWalkTo(actorTarget)}>Подойти</button> : null}{selectedPersonId && selectedActor.interactable ? <button type="button" disabled={!conversationAvailability?.allowed} title={conversationAvailability?.reason} onClick={() => onStartConversation(selectedPersonId)}>{conversationAvailability?.allowed ? "Заговорить" : conversationAvailability?.reason ?? "Недоступен"}</button> : null}<button type="button" onClick={() => { onAdvance(2, `Наблюдение: ${selectedActor.name}`); notify("Наблюдение заняло 2 минуты"); }}>Наблюдать · 2 мин.</button></div>
          </> : null}
          {selectedBuilding ? <>
            <header><i className="entity-icon">▦</i><div><h2>{selectedBuilding.addressCode}</h2><strong>{buildingUseLabel(selectedBuilding)}</strong><span>{selectedBuilding.occupiedActorCount} внутри</span></div></header>
            <dl><div><dt>Расстояние</dt><dd>{selectedBuilding.playerInside ? "Ты внутри" : `${Math.round(selectedBuilding.distanceToPlayerM)} м`}</dd></div><div><dt>Безопасность</dt><dd>{Math.round(selectedBuilding.security)}%</dd></div><div><dt>Вход</dt><dd>{buildingAccess?.publicReason ?? "Нет данных"}</dd></div><div><dt>Статус</dt><dd>{selectedBuilding.playerInside ? "Текущее здание" : "Снаружи"}</dd></div></dl>
            <div className="entity-actions">{canWalkToBuilding && buildingTarget ? <button type="button" onClick={() => onWalkTo(buildingTarget)}>Идти ко входу</button> : null}{canEnterBuilding ? <button type="button" onClick={() => onEnterBuilding(selectedBuilding.buildingId)}>Войти</button> : null}{!selectedBuilding.playerInside && !playerOutside ? <p>Сначала выйди из текущего пространства.</p> : null}{playerOutside && selectedBuilding.distanceToPlayerM <= 12 && !canEnterBuilding ? <p>{buildingAccess?.publicReason ?? "Публичный вход недоступен"}</p> : null}</div>
          </> : null}
          {selectedVehicle ? <>
            <header><i className="entity-icon">▰</i><div><h2>{selectedVehicle.modelName}</h2><strong>{selectedVehicle.plate}</strong><span>{vehicleStateLabel(selectedVehicle)}</span></div></header>
            <dl><div><dt>Расстояние</dt><dd>{selectedVehicle.id === currentVehicle?.id ? "Ты внутри" : `${Math.round(selectedVehicle.distanceToPlayerM)} м`}</dd></div><div><dt>Доступ</dt><dd>{selectedVehicle.playerCanEnter ? "Разрешён" : "Нет доступа"}</dd></div><div><dt>Топливо</dt><dd>{Math.round(selectedVehicle.fuelL / Math.max(1, selectedVehicle.fuelCapacityL) * 100)}%</dd></div><div><dt>Статус</dt><dd>{legalStatusLabel(selectedVehicle.legalStatus)}</dd></div></dl>
            <div className="entity-actions">{canWalkToVehicle && vehicleTarget ? <button type="button" onClick={() => onWalkTo(vehicleTarget)}>Идти к машине</button> : null}{canEnterVehicle ? <button type="button" onClick={() => onEnterVehicle(selectedVehicle.id)}>Сесть</button> : null}{selectedVehicle.id !== currentVehicle?.id && !playerOutside ? <p>Сначала выйди из текущего пространства.</p> : null}{playerOutside && selectedVehicle.distanceToPlayerM <= 12 && !selectedVehicle.playerCanEnter ? <p>Нет ключа или разрешения на посадку.</p> : null}</div>
          </> : null}
        </aside> : null}
      </div>
      {session.social.activeConversation ? <ConversationPanel session={session} onAction={onConversationAction} onClose={onEndConversation} /> : null}
    </section>
  );
}
