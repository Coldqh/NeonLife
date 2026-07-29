import { useEffect, useMemo, useState } from "react";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { personPortrait } from "../shared/presentation";
import type { BuildingRoomAccessState, BuildingUnitAccessState } from "../../simulation/access/types";
import type { InteriorRoomKind } from "../../simulation/urban/types";
import type { GameSession } from "../../world/state/types";
import { getPlayerHomeUnit } from "../../gameplay/life/playerPresence";
import { buildingUseLabel, locationTypeLabel } from "./mapUi";
import { BuildingServicePanel } from "./BuildingServicePanel";

function roomLabel(kind: InteriorRoomKind): string {
  const labels: Record<InteriorRoomKind, string> = {
    entry: "Вход",
    living: "Жилая зона",
    kitchen: "Кухня",
    bedroom: "Спальня",
    bathroom: "Санузел",
    storage: "Хранение",
    workroom: "Рабочая зона",
    office: "Офис",
    "retail-floor": "Торговый зал",
    "clinic-room": "Кабинет",
    corridor: "Коридор",
    "service-room": "Служебная зона"
  };
  return labels[kind];
}

function unitLabel(unit: BuildingUnitAccessState): string {
  if (unit.use === "apartment") return `Квартира ${unit.unitNumber}`;
  if (unit.use === "dorm-room") return `Капсула ${unit.unitNumber}`;
  if (unit.use === "shop") return `Магазин ${unit.unitNumber}`;
  if (unit.use === "clinic") return `Клиника ${unit.unitNumber}`;
  if (unit.use === "office") return `Офис ${unit.unitNumber}`;
  if (unit.use === "workshop") return `Мастерская ${unit.unitNumber}`;
  return `Помещение ${unit.unitNumber}`;
}

function accessLabel(unit: BuildingUnitAccessState): string {
  if (unit.playerAuthorized) return "Доступ подтверждён";
  if (unit.decision === "open") return "Открыто";
  if (unit.decision === "locked") return "Закрыто";
  return unit.reason;
}

function FloorRail({ floors, current, selected, onSelect }: { floors: number[]; current: number; selected: number; onSelect: (floor: number) => void }) {
  return <nav className="interior-floor-rail" aria-label="Этажи">{floors.map((floor) => <button type="button" key={floor} className={`${selected === floor ? "is-selected" : ""}${current === floor ? " is-current" : ""}`} onClick={() => onSelect(floor)}><span>{floor < 0 ? `B${Math.abs(floor)}` : floor}</span>{current === floor ? <b>ВЫ</b> : null}</button>)}</nav>;
}

export function BuildingInteriorMap({
  session,
  onMoveFloor,
  onEnterUnit,
  onLeaveUnit,
  onEnterRoom,
  onLeaveRoom,
  onLeaveBuilding,
  onLifeAction,
  onNotice
}: {
  session: GameSession;
  onMoveFloor: (floor: number, method: "stairs" | "elevator") => void;
  onEnterUnit: (unitId: string) => void;
  onLeaveUnit: () => void;
  onEnterRoom: (roomId: string) => void;
  onLeaveRoom: () => void;
  onLeaveBuilding: () => void;
  onLifeAction: (action: LocalLifeAction) => void;
  onNotice: (message: string) => void;
}) {
  const position = session.localScene.playerPosition;
  const building = session.urban.buildings.find((item) => item.id === position.buildingId);
  const currentFloor = position.floor ?? 1;
  const [selectedFloor, setSelectedFloor] = useState(currentFloor);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(position.unitId ?? null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(position.roomId ?? null);
  const [serviceOpen, setServiceOpen] = useState(false);

  useEffect(() => { setSelectedFloor(currentFloor); }, [currentFloor, building?.id]);
  useEffect(() => { setSelectedUnitId(position.unitId ?? null); setSelectedRoomId(position.roomId ?? null); }, [position.roomId, position.unitId]);

  const floors = useMemo(() => session.buildingAccess.floors.map((item) => item.floor).sort((a, b) => b - a), [session.buildingAccess.floors]);
  const floorState = session.buildingAccess.floors.find((item) => item.floor === selectedFloor);
  const floorUnits = session.buildingAccess.units.filter((unit) => unit.floor === selectedFloor);
  const selectedUnit = session.buildingAccess.units.find((unit) => unit.unitId === selectedUnitId);
  const currentUnit = session.buildingAccess.units.find((unit) => unit.unitId === position.unitId);
  const currentInterior = position.unitId ? session.urban.interiors.find((item) => item.unitId === position.unitId) : session.urban.interiors.find((item) => item.buildingId === building?.id && !item.unitId);
  const roomAccess = session.buildingAccess.rooms.filter((room) => room.interiorId === currentInterior?.id);
  const visibleActors = session.localScene.actors.filter((actor) => actor.visible && actor.position.buildingId === building?.id);
  const floorActors = session.localScene.actors.filter((actor) => actor.position.buildingId === building?.id && (actor.position.floor ?? 1) === selectedFloor);
  const location = building?.anchorLocationId ? session.world.locations.find((item) => item.id === building.anchorLocationId) : undefined;
  const homeUnit = getPlayerHomeUnit(session);
  const isHomeUnit = Boolean(homeUnit && position.unitId === homeUnit.id);
  const serviceAvailable = Boolean(location && selectedFloor === 1 && !position.unitId);

  if (!building) return <div className="interior-map interior-map--missing"><strong>Здание не загружено</strong><button type="button" onClick={onLeaveBuilding}>Выйти наружу</button></div>;

  const selectedUnitActors = selectedUnit ? floorActors.filter((actor) => actor.position.unitId === selectedUnit.unitId) : [];
  const onSelectedFloor = selectedFloor === currentFloor;
  const canUseElevator = building.elevatorCount > 0 && building.utilityService >= 25 && floorState?.elevatorAvailable !== false;
  const canUseStairs = building.stairwellCount > 0 && floorState?.stairsAvailable !== false;

  return (
    <div className="interior-map" data-building={building.use}>
      <header className="interior-map__header" data-no-swipe>
        <div><span>{buildingUseLabel(building.use)}</span><h1>{building.addressCode}</h1><p>{location ? `${locationTypeLabel(location.type)} · ${location.name}` : `${building.streetName ?? building.parcelCode} · ${building.floors} этажей`}</p></div>
        <div className="interior-map__presence"><strong>{visibleActors.length}</strong><span>видно сейчас</span></div>
      </header>

      <FloorRail floors={floors} current={currentFloor} selected={selectedFloor} onSelect={(floor) => { setSelectedFloor(floor); setSelectedUnitId(null); }} />

      {position.unitId && currentInterior && selectedFloor === currentFloor ? (
        <section className="unit-interior-view">
          <header><div><span>ПОМЕЩЕНИЕ</span><h2>{currentUnit ? unitLabel(currentUnit) : "Внутренняя зона"}</h2></div><button type="button" onClick={onLeaveUnit}>Выйти в коридор</button></header>
          <div className="unit-plan" style={{ aspectRatio: `${Math.max(...currentInterior.rooms.map((room) => room.bounds.xM + room.bounds.widthM), 12)} / ${Math.max(...currentInterior.rooms.map((room) => room.bounds.yM + room.bounds.heightM), 8)}` }}>
            {currentInterior.rooms.map((room) => {
              const maxX = Math.max(...currentInterior.rooms.map((item) => item.bounds.xM + item.bounds.widthM));
              const maxY = Math.max(...currentInterior.rooms.map((item) => item.bounds.yM + item.bounds.heightM));
              const access = roomAccess.find((item) => item.roomId === room.id);
              const active = position.roomId === room.id;
              const selected = selectedRoomId === room.id;
              const actors = floorActors.filter((actor) => actor.position.roomId === room.id);
              return (
                <button
                  type="button"
                  key={room.id}
                  className={`${active ? "is-player" : ""}${selected ? " is-selected" : ""}`}
                  style={{ left: `${room.bounds.xM / maxX * 100}%`, top: `${room.bounds.yM / maxY * 100}%`, width: `${room.bounds.widthM / maxX * 100}%`, height: `${room.bounds.heightM / maxY * 100}%` }}
                  onClick={() => setSelectedRoomId(room.id)}
                >
                  <i>{room.kind === "kitchen" ? "♨" : room.kind === "bathroom" ? "◫" : room.kind === "storage" ? "▤" : room.kind === "entry" ? "⇥" : "□"}</i>
                  <strong>{roomLabel(room.kind)}</strong>
                  <span>{access?.occupiedActorCount ?? actors.length} чел.</span>
                  {active ? <b>ВЫ ЗДЕСЬ</b> : null}
                </button>
              );
            })}
            {visibleActors.filter((actor) => actor.position.unitId === position.unitId).slice(0, 6).map((actor, index) => <button type="button" className="interior-actor" key={actor.id} style={{ left: `${18 + index * 12}%`, top: `${70 - (index % 2) * 12}%` }} onClick={() => onNotice(`${actor.name} · ${actor.activityLabel}`)}><img src={personPortrait(actor.id)} alt="" /><span>{actor.name}</span></button>)}
          </div>
          <footer className="unit-interior-actions">
            {position.roomId ? <button type="button" className="primary" onClick={onLeaveRoom}>Выйти из комнаты</button> : selectedRoomId ? <button type="button" className="primary" onClick={() => onEnterRoom(selectedRoomId)}>Войти: {roomLabel(currentInterior.rooms.find((room) => room.id === selectedRoomId)?.kind ?? "entry")}</button> : <span>Выбери комнату на плане</span>}
            {isHomeUnit ? <button type="button" onClick={() => setServiceOpen(true)}>Капсула</button> : null}
          </footer>
        </section>
      ) : (
        <section className="building-floor-view">
          <div className="building-floor-plan">
            <div className="building-floor-plan__core">
              <button type="button" className="vertical-node vertical-node--stairs" disabled={Boolean(position.unitId) || selectedFloor === currentFloor || !canUseStairs} onClick={() => onMoveFloor(selectedFloor, "stairs")}><i>↟</i><span>Лестница</span><b>{building.stairwellCount}</b></button>
              <div className="floor-corridor"><span>КОРИДОР · ЭТАЖ {selectedFloor}</span>{currentFloor === selectedFloor && !position.unitId ? <b>ВЫ ЗДЕСЬ</b> : null}</div>
              <button type="button" className="vertical-node vertical-node--elevator" disabled={Boolean(position.unitId) || selectedFloor === currentFloor || !canUseElevator} onClick={() => onMoveFloor(selectedFloor, "elevator")}><i>⇅</i><span>Лифт</span><b>{canUseElevator ? "работает" : "недоступен"}</b></button>
            </div>

            <div className="floor-unit-grid">
              {floorUnits.map((unit) => {
                const active = position.unitId === unit.unitId;
                const actors = floorActors.filter((actor) => actor.position.unitId === unit.unitId);
                return (
                  <button type="button" key={unit.unitId} className={`${selectedUnitId === unit.unitId ? "is-selected" : ""}${active ? " is-player" : ""}${unit.occupied ? " is-occupied" : ""}`} onClick={() => setSelectedUnitId(unit.unitId)}>
                    <i>{unit.use === "apartment" ? "⌂" : unit.use === "shop" ? "▤" : unit.use === "clinic" ? "+" : unit.use === "office" ? "▣" : "□"}</i>
                    <strong>{unit.unitNumber}</strong>
                    <span>{unit.use.replace(/-/g, " ")}</span>
                    <em>{actors.length || unit.residentCount} внутри</em>
                    {active ? <b>ВЫ</b> : null}
                  </button>
                );
              })}
              {!floorUnits.length ? <div className="floor-unit-empty">На этаже нет материализованных помещений.</div> : null}
            </div>

            {serviceAvailable ? <button type="button" className="building-service-node" onClick={() => setServiceOpen(true)}><i>{location?.type === "clinic" ? "+" : location?.type === "food" ? "♨" : location?.type === "market" ? "▤" : location?.type === "transport" ? "▰" : "◉"}</i><span>{location?.name}</span><b>Взаимодействовать</b></button> : null}

            <div className="corridor-actors">
              {floorActors.filter((actor) => actor.visible && !actor.position.unitId).slice(0, 8).map((actor) => <button type="button" key={actor.id} onClick={() => onNotice(`${actor.name} · ${actor.activityLabel}`)}><img src={personPortrait(actor.id)} alt="" /><span>{actor.name}</span><small>{actor.roleLabel}</small></button>)}
            </div>
          </div>

          <aside className="floor-inspector" data-no-swipe>
            <header><span>ЭТАЖ {selectedFloor}</span><strong>{floorActors.length} человек</strong></header>
            {selectedUnit ? (
              <>
                <h2>{unitLabel(selectedUnit)}</h2>
                <p>{accessLabel(selectedUnit)} · безопасность {selectedUnit.security}% · {selectedUnit.occupied ? "занято" : "свободно"}</p>
                <dl><div><dt>Жильцов</dt><dd>{selectedUnit.residentCount}</dd></div><div><dt>Состояние</dt><dd>{session.urban.units.find((unit) => unit.id === selectedUnit.unitId)?.condition ?? 0}%</dd></div><div><dt>Людей сейчас</dt><dd>{selectedUnitActors.length}</dd></div></dl>
                <button type="button" className="primary" disabled={!onSelectedFloor || !["open", "authorized"].includes(selectedUnit.decision)} onClick={() => onEnterUnit(selectedUnit.unitId)}>Войти в помещение</button>
              </>
            ) : selectedFloor !== currentFloor ? position.unitId ? (
              <><h2>Сначала выйди</h2><p>Лестница и лифт находятся в коридоре. Нельзя перейти на другой этаж сквозь дверь помещения.</p><button type="button" className="primary" onClick={onLeaveUnit}>Выйти в коридор</button></>
            ) : (
              <>
                <h2>Перейти на этаж</h2><p>Выбери лестницу или лифт. Перемещение займёт игровое время.</p>
                <div className="floor-inspector__actions"><button type="button" disabled={!canUseStairs} onClick={() => onMoveFloor(selectedFloor, "stairs")}>Лестница</button><button type="button" disabled={!canUseElevator} onClick={() => onMoveFloor(selectedFloor, "elevator")}>Лифт</button></div>
              </>
            ) : <><h2>Коридор</h2><p>Выбери помещение, сервисную точку или другой этаж.</p></>}
            <button type="button" className="floor-inspector__exit" onClick={onLeaveBuilding}>Выйти из здания</button>
          </aside>
        </section>
      )}

      {serviceOpen ? <BuildingServicePanel session={session} onAction={onLifeAction} onClose={() => setServiceOpen(false)} /> : null}
    </div>
  );
}
