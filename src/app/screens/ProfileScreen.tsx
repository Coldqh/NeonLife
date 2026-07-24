import type { GameSession } from "../../world/state/types";
import { asset, currentActivity, currentLocation, districtName, playerOccupation } from "../shared/presentation";

function housingTypeLabel(type: GameSession["life"]["housing"]["type"]): string {
  if (type === "capsule") return "Капсула";
  if (type === "room") return "Комната";
  return "Квартира";
}

export function ProfileScreen({ session, onLeaveBuilding, onLeaveVehicle }: { session: GameSession; onLeaveBuilding: () => void; onLeaveVehicle: () => void }) {
  const player = session.player;
  const location = currentLocation(session);
  const home = session.world.locations.find((item) => item.id === session.life.housing.locationId);
  const currentVehicle = session.vehicles.vehicles.find((item) => item.id === session.vehicles.player.currentVehicleId);
  const position = session.localScene.playerPosition;
  const building = position.buildingId ? session.urban.buildings.find((item) => item.id === position.buildingId) : undefined;

  return (
    <section className="screen profile-screen" aria-labelledby="profile-title">
      <header className="screen-heading">
        <div>
          <span>Личный профиль</span>
          <h1 id="profile-title">{player.name}</h1>
          <p>{playerOccupation(session)} · {currentActivity(session)}</p>
        </div>
      </header>

      <article className="profile-identity">
        <img src={asset("player-portrait.webp")} alt={`Портрет ${player.name}`} />
        <div className="profile-identity__copy">
          <strong>{player.name}</strong>
          <span>{player.age} лет · {player.origin}</span>
          <p>⌖ {districtName(session)} · сектор {session.metropolitan.sectors.find((item) => item.id === position.sectorId)?.code ?? player.sector}</p>
        </div>
      </article>

      <div className="profile-facts">
        <article>
          <span>Сейчас</span>
          <strong>{location?.name ?? player.sector}</strong>
          <p>{building ? `${building.addressCode} · этаж ${position.floor ?? 1}` : position.state === "vehicle" ? currentVehicle?.modelName ?? "В машине" : "Улица"}</p>
          {building ? <button type="button" onClick={onLeaveBuilding}>Выйти из здания</button> : null}
          {currentVehicle ? <button type="button" onClick={onLeaveVehicle}>Выйти из машины</button> : null}
        </article>
        <article>
          <span>Жильё</span>
          <strong>{home?.name ?? "Адрес не найден"}</strong>
          <p>{housingTypeLabel(session.life.housing.type)} · оплачено ещё {player.housingDaysLeft} дн.</p>
        </article>
        <article>
          <span>Личный транспорт</span>
          <strong>{session.vehicles.vehicles.find((item) => item.id === session.vehicles.player.ownedVehicleIds[0])?.modelName ?? "Нет"}</strong>
          <p>{currentVehicle ? `Сейчас внутри · ${currentVehicle.plate}` : `${session.vehicles.player.keyVehicleIds.length} доступных ключей`}</p>
        </article>
        <article>
          <span>Положение</span>
          <strong>{position.state === "inside" ? "В здании" : position.state === "vehicle" ? "В машине" : position.state === "in-transit" ? "В транспорте" : "На улице"}</strong>
          <p>{Math.round(position.xM)} м · {Math.round(position.yM)} м</p>
        </article>
      </div>
    </section>
  );
}
