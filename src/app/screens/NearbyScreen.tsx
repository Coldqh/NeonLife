import type { ChangeEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { GameSession } from "../../world/state/types";
import type { LocalActorState, LocalBuildingPresenceState } from "../../simulation/localScene/types";
import type { PhysicalVehicleEntityState } from "../../simulation/vehicles/types";
import { actorActivityIcon, buildingUseLabel, personPortrait, vehicleStateLabel } from "../shared/presentation";
import type { NearbyMode, NoticeTone } from "../shared/types";

interface SelectedEntity {
  type: "person" | "building" | "vehicle";
  id: string;
}

const tabs: Array<{ id: NearbyMode; label: string; icon: string }> = [
  { id: "people", label: "Люди", icon: "♙" },
  { id: "places", label: "Здания", icon: "▦" },
  { id: "cars", label: "Машины", icon: "▰" },
  { id: "events", label: "События", icon: "◉" }
];

export function NearbyScreen({
  session,
  onSelectPerson,
  onApproachBuilding,
  onEnterBuilding,
  onApproachVehicle,
  onEnterVehicle,
  onRouteTo,
  onAdvance,
  notify
}: {
  session: GameSession;
  onSelectPerson: (personId: string) => void;
  onApproachBuilding: (buildingId: string) => void;
  onEnterBuilding: (buildingId: string) => void;
  onApproachVehicle: (vehicleId: string) => void;
  onEnterVehicle: (vehicleId: string) => void;
  onRouteTo: (locationId: string) => void;
  onAdvance: (minutes: number, source: string) => void;
  notify: (text: string, tone?: NoticeTone) => void;
}) {
  const [mode, setMode] = useState<NearbyMode>("people");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SelectedEntity | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");

  const actors = useMemo(() => [...session.localScene.actors]
    .filter((actor) => actor.visible)
    .filter((actor) => !normalizedQuery || `${actor.name} ${actor.roleLabel} ${actor.activityLabel}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery))
    .sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM), [normalizedQuery, session.localScene.actors]);
  const buildings = useMemo(() => [...session.localScene.buildings]
    .filter((building) => !normalizedQuery || `${building.addressCode} ${building.use}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery))
    .sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM), [normalizedQuery, session.localScene.buildings]);
  const vehicles = useMemo(() => [...session.vehicles.vehicles]
    .filter((vehicle) => vehicle.visible)
    .filter((vehicle) => !normalizedQuery || `${vehicle.modelName} ${vehicle.plate} ${vehicle.vehicleClass}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery))
    .sort((left, right) => left.distanceToPlayerM - right.distanceToPlayerM), [normalizedQuery, session.vehicles.vehicles]);
  const events = useMemo(() => session.events
    .filter((event) => event.category === "local" || event.category === "contact")
    .slice(0, 30), [session.events]);

  const selectedActor = selected?.type === "person" ? actors.find((actor) => actor.id === selected.id) : undefined;
  const selectedBuilding = selected?.type === "building" ? buildings.find((building) => building.buildingId === selected.id) : undefined;
  const selectedVehicle = selected?.type === "vehicle" ? vehicles.find((vehicle) => vehicle.id === selected.id) : undefined;
  const selectionExists = Boolean(selectedActor || selectedBuilding || selectedVehicle);
  useEffect(() => {
    if (selected && !selectionExists) setSelected(null);
  }, [selected, selectionExists]);
  const buildingAccess = selectedBuilding
    ? session.buildingAccess.buildingEntries.find((entry) => entry.buildingId === selectedBuilding.buildingId)
    : undefined;

  function choosePerson(actor: LocalActorState): void {
    setSelected({ type: "person", id: actor.id });
    if (actor.activePersonId) onSelectPerson(actor.activePersonId);
  }

  function chooseBuilding(building: LocalBuildingPresenceState): void {
    setSelected({ type: "building", id: building.buildingId });
  }

  function chooseVehicle(vehicle: PhysicalVehicleEntityState): void {
    setSelected({ type: "vehicle", id: vehicle.id });
  }

  function approachBuilding(building: LocalBuildingPresenceState): void {
    onApproachBuilding(building.buildingId);
    notify(`Ты подошёл к ${building.addressCode}`, "good");
  }

  function enterBuilding(building: LocalBuildingPresenceState): void {
    onEnterBuilding(building.buildingId);
    notify(`Вход: ${building.addressCode}`);
  }

  function approachVehicle(vehicle: PhysicalVehicleEntityState): void {
    onApproachVehicle(vehicle.id);
    notify(`Ты подошёл к ${vehicle.modelName}`, "good");
  }

  function enterVehicle(vehicle: PhysicalVehicleEntityState): void {
    onEnterVehicle(vehicle.id);
    notify(`Посадка: ${vehicle.modelName}`);
  }

  return (
    <section className="screen nearby-screen" aria-labelledby="nearby-title">
      <header className="screen-heading nearby-screen__heading">
        <div><span>Активный сектор</span><h1 id="nearby-title">Рядом</h1><p>Физические люди, здания, машины и события вокруг игрока.</p></div>
        <label className="nearby-search"><span>Поиск</span><input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Имя, адрес, номер..." /></label>
      </header>

      <div className="nearby-tabs">
        {tabs.map((tab) => {
          const count = tab.id === "people" ? actors.length : tab.id === "places" ? buildings.length : tab.id === "cars" ? vehicles.length : events.length;
          return <button type="button" key={tab.id} className={mode === tab.id ? "is-active" : ""} onClick={() => { setMode(tab.id); setSelected(null); }}><i>{tab.icon}</i><span>{tab.label}</span><b>{count}</b></button>;
        })}
      </div>

      <div className={`nearby-layout ${selected ? "has-selection" : ""}`}>
        <div className="nearby-list">
          {mode === "people" ? actors.map((actor) => (
            <button type="button" key={actor.id} className={selectedActor?.id === actor.id ? "is-selected" : ""} onClick={() => choosePerson(actor)}>
              <img src={personPortrait(actor.id)} alt={`Портрет ${actor.name}`} />
              <span><strong>{actor.name}</strong><small>{actor.roleLabel}</small><em>{actorActivityIcon(actor)} {actor.activityLabel}</em></span>
              <aside><strong>{Math.round(actor.distanceToPlayerM)} м</strong><small>{actor.interactable ? "доступен" : "далеко"}</small></aside>
            </button>
          )) : null}
          {mode === "places" ? buildings.map((building) => (
            <button type="button" key={building.buildingId} className={selectedBuilding?.buildingId === building.buildingId ? "is-selected" : ""} onClick={() => chooseBuilding(building)}>
              <i className="entity-icon">▦</i>
              <span><strong>{building.addressCode}</strong><small>{buildingUseLabel(building)}</small><em>{building.occupiedActorCount} внутри · безопасность {building.security}%</em></span>
              <aside><strong>{Math.round(building.distanceToPlayerM)} м</strong><small>{building.publicEntrances} входа</small></aside>
            </button>
          )) : null}
          {mode === "cars" ? vehicles.map((vehicle) => (
            <button type="button" key={vehicle.id} className={selectedVehicle?.id === vehicle.id ? "is-selected" : ""} onClick={() => chooseVehicle(vehicle)}>
              <i className="entity-icon">▰</i>
              <span><strong>{vehicle.modelName}</strong><small>{vehicle.plate} · {vehicleStateLabel(vehicle)}</small><em>Топливо {Math.round(vehicle.fuelL / Math.max(1, vehicle.fuelCapacityL) * 100)}% · состояние {vehicle.condition}%</em></span>
              <aside><strong>{Math.round(vehicle.distanceToPlayerM)} м</strong><small>{vehicle.locked ? "закрыта" : "доступна"}</small></aside>
            </button>
          )) : null}
          {mode === "events" ? events.map((event) => (
            <article className="event-row" key={event.id}><i>◉</i><span><strong>{event.title}</strong><small>{event.detail ?? "Без подробностей"}</small></span><time>{new Date(event.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></article>
          )) : null}
          {((mode === "people" && !actors.length) || (mode === "places" && !buildings.length) || (mode === "cars" && !vehicles.length) || (mode === "events" && !events.length)) ? (
            <p className="empty-copy">Подходящих объектов нет.</p>
          ) : null}
        </div>

        {selected ? (
          <aside className="entity-inspector">
            <button type="button" className="entity-inspector__close" onClick={() => setSelected(null)} aria-label="Закрыть">×</button>
            {selectedActor ? (
              <>
                <header><img src={personPortrait(selectedActor.id)} alt={`Портрет ${selectedActor.name}`} /><div><h2>{selectedActor.name}</h2><strong>{selectedActor.roleLabel}</strong><span>{actorActivityIcon(selectedActor)} {selectedActor.activityLabel}</span></div></header>
                <dl>
                  <div><dt>Расстояние</dt><dd>{Math.round(selectedActor.distanceToPlayerM)} м</dd></div>
                  <div><dt>Возраст</dt><dd>{selectedActor.age}</dd></div>
                  <div><dt>Здоровье</dt><dd>{selectedActor.health}</dd></div>
                  <div><dt>Знакомство</dt><dd>{selectedActor.knownToPlayer ? "Известен" : "Незнакомец"}</dd></div>
                </dl>
                <div className="entity-actions">
                  <button type="button" onClick={() => { onAdvance(2, `Наблюдение: ${selectedActor.name}`); notify(`Ты наблюдал за ${selectedActor.name}`); }}>Наблюдать · 2 мин.</button>
                  {selectedActor.destinationLocationId ? <button type="button" onClick={() => onRouteTo(selectedActor.destinationLocationId!)}>Показать цель на карте</button> : null}
                </div>
              </>
            ) : null}
            {selectedBuilding ? (
              <>
                <header><i className="entity-icon">▦</i><div><h2>{selectedBuilding.addressCode}</h2><strong>{buildingUseLabel(selectedBuilding)}</strong><span>{selectedBuilding.occupiedActorCount} внутри</span></div></header>
                <dl>
                  <div><dt>Расстояние</dt><dd>{Math.round(selectedBuilding.distanceToPlayerM)} м</dd></div>
                  <div><dt>Безопасность</dt><dd>{selectedBuilding.security}%</dd></div>
                  <div><dt>Вход</dt><dd>{buildingAccess?.publicReason ?? "Не проверен"}</dd></div>
                  <div><dt>Статус</dt><dd>{selectedBuilding.playerInside ? "Игрок внутри" : "Снаружи"}</dd></div>
                </dl>
                <div className="entity-actions">
                  <button type="button" onClick={() => approachBuilding(selectedBuilding)}>Подойти</button>
                  {selectedBuilding.distanceToPlayerM <= 12 && buildingAccess && !["locked", "closed", "unavailable"].includes(buildingAccess.publicDecision) ? <button type="button" onClick={() => enterBuilding(selectedBuilding)}>Войти</button> : null}
                </div>
              </>
            ) : null}
            {selectedVehicle ? (
              <>
                <header><i className="entity-icon">▰</i><div><h2>{selectedVehicle.modelName}</h2><strong>{selectedVehicle.plate}</strong><span>{vehicleStateLabel(selectedVehicle)}</span></div></header>
                <dl>
                  <div><dt>Расстояние</dt><dd>{Math.round(selectedVehicle.distanceToPlayerM)} м</dd></div>
                  <div><dt>Доступ</dt><dd>{selectedVehicle.playerCanEnter ? "Разрешён" : "Нет доступа"}</dd></div>
                  <div><dt>Топливо</dt><dd>{Math.round(selectedVehicle.fuelL / Math.max(1, selectedVehicle.fuelCapacityL) * 100)}%</dd></div>
                  <div><dt>Законность</dt><dd>{selectedVehicle.legalStatus}</dd></div>
                </dl>
                <div className="entity-actions">
                  <button type="button" onClick={() => approachVehicle(selectedVehicle)}>Подойти</button>
                  {selectedVehicle.playerCanEnter && selectedVehicle.distanceToPlayerM <= 12 ? <button type="button" onClick={() => enterVehicle(selectedVehicle)}>Сесть</button> : null}
                </div>
              </>
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
