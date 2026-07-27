import type { GameSession } from "../../world/state/types";
import { asset, currentActivity, currentLocation, districtName, playerOccupation } from "../shared/presentation";

function housingTypeLabel(type: GameSession["life"]["housing"]["type"]): string {
  if (type === "capsule") return "Капсула";
  if (type === "room") return "Комната";
  return "Квартира";
}

function positionLabel(session: GameSession): string {
  const position = session.localScene.playerPosition;
  if (position.state === "inside") return "Внутри здания";
  if (position.state === "vehicle") return "В машине";
  if (position.state === "in-transit") return "В общественном транспорте";
  return "На улице";
}

export function ProfileScreen({ session, onLeaveBuilding, onLeaveVehicle }: { session: GameSession; onLeaveBuilding: () => void; onLeaveVehicle: () => void }) {
  const player = session.player;
  const location = currentLocation(session);
  const home = session.world.locations.find((item) => item.id === session.life.housing.locationId);
  const ownedVehicle = session.vehicles.vehicles.find((item) => item.id === session.vehicles.player.ownedVehicleIds[0]);
  const currentVehicle = session.vehicles.vehicles.find((item) => item.id === session.vehicles.player.currentVehicleId);
  const position = session.localScene.playerPosition;
  const sector = session.metropolitan.sectors.find((item) => item.id === position.sectorId);
  const building = position.buildingId ? session.urban.buildings.find((item) => item.id === position.buildingId) : undefined;

  return (
    <section className="screen profile-screen" aria-labelledby="profile-title">
      <header className="screen-heading profile-screen__heading">
        <div><span>Персонаж</span><h1 id="profile-title">Профиль</h1><p>Только реальные данные текущего мира.</p></div>
      </header>

      <article className="profile-hero">
        <img src={asset("player-portrait.webp")} alt={`Портрет ${player.name}`} />
        <div className="profile-hero__identity">
          <span>{playerOccupation(session)}</span>
          <h2>{player.name}</h2>
          <p>{player.age} лет · {player.origin}</p>
          <strong><i />{currentActivity(session)}</strong>
        </div>
        <div className="profile-hero__place">
          <span>Сейчас</span>
          <strong>{location?.name ?? sector?.code ?? player.sector}</strong>
          <p>{districtName(session)} · {sector?.code ?? "сектор не определён"}</p>
        </div>
      </article>

      <section className="profile-grid" aria-label="Факты персонажа">
        <article className="profile-card">
          <header><span>Текущее положение</span><strong>{positionLabel(session)}</strong></header>
          <dl>
            <div><dt>Место</dt><dd>{building?.addressCode ?? location?.name ?? "Улица"}</dd></div>
            {building ? <div><dt>Этаж</dt><dd>{position.floor ?? 1}</dd></div> : null}
            {currentVehicle ? <div><dt>Машина</dt><dd>{currentVehicle.modelName} · {currentVehicle.plate}</dd></div> : null}
          </dl>
          {building ? <button type="button" onClick={onLeaveBuilding}>Выйти из здания</button> : null}
          {currentVehicle ? <button type="button" onClick={onLeaveVehicle}>Выйти из машины</button> : null}
        </article>

        <article className="profile-card">
          <header><span>Жильё</span><strong>{home?.name ?? "Нет постоянного адреса"}</strong></header>
          <dl>
            <div><dt>Тип</dt><dd>{housingTypeLabel(session.life.housing.type)}</dd></div>
            <div><dt>Оплачено</dt><dd>{player.housingDaysLeft} дн.</dd></div>
            <div><dt>Район</dt><dd>{home ? districtName(session, home.districtId) : "—"}</dd></div>
          </dl>
        </article>

        <article className="profile-card profile-card--wide">
          <header><span>Личный транспорт</span><strong>{ownedVehicle?.modelName ?? "Нет машины"}</strong></header>
          <dl>
            <div><dt>Номер</dt><dd>{ownedVehicle?.plate ?? "—"}</dd></div>
            <div><dt>Ключи</dt><dd>{session.vehicles.player.keyVehicleIds.length}</dd></div>
            <div><dt>Статус</dt><dd>{ownedVehicle ? (ownedVehicle.state === "parked" ? "Припаркована" : ownedVehicle.state === "moving" ? "В движении" : "Недоступна") : "—"}</dd></div>
          </dl>
        </article>
      </section>
    </section>
  );
}
