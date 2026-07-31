import type { GameSession } from "../../world/state/types";
import { asset, currentActivity, currentLocation, districtName, playerOccupation } from "../shared/presentation";
import { formatGameDateLong } from "../../core/time/gameTime";

function housingTypeLabel(type: GameSession["life"]["housing"]["type"]): string {
  if (type === "capsule") return "Капсула";
  if (type === "room") return "Комната";
  return "Квартира";
}

function livedDays(session: GameSession): number {
  const createdAt = new Date(session.world.meta.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return 1;
  return Math.max(1, Math.floor((session.timestamp - createdAt) / 86_400_000) + 1);
}

export function ProfileScreen({ session }: { session: GameSession }) {
  const player = session.player;
  const homeLocation = session.world.locations.find((item) => item.id === session.life.housing.locationId);
  const homeBuilding = session.urban.buildings.find((building) => building.anchorLocationId === homeLocation?.id);
  const activeLocation = currentLocation(session);
  const activeBuilding = session.localScene.playerPosition.buildingId
    ? session.urban.buildings.find((building) => building.id === session.localScene.playerPosition.buildingId)
    : undefined;
  const activeSector = session.metropolitan.sectors.find((sector) => sector.id === session.localScene.playerPosition.sectorId);
  const ownedVehicle = session.vehicles.vehicles.find((item) => item.id === session.vehicles.player.ownedVehicleIds[0]);
  const occupation = playerOccupation(session);
  const playerCases = session.government.cases.filter((item) => item.suspectResidentIds?.includes(player.id));
  const completedWork = session.jobs.courier.completedDeliveries;
  const failedWork = session.jobs.courier.failedDeliveries;
  const days = livedDays(session);

  return (
    <section className="screen profile-screen" aria-labelledby="profile-title">
      <header className="profile-heading">
        <div>
          <span>Личное досье</span>
          <h1 id="profile-title">Профиль</h1>
        </div>
        <p>Факты, имущество и история текущего персонажа.</p>
      </header>

      <article className="profile-hero">
        <div className="profile-portrait">
          <img src={asset("player-portrait.webp")} alt={`Портрет ${player.name}`} />
          <span aria-hidden="true" />
        </div>
        <div className="profile-identity">
          <span>{occupation}</span>
          <h2>{player.name}</h2>
          <p>{player.age} лет · {player.origin}</p>
          <strong>{currentActivity(session)}</strong>
        </div>
        <div className="profile-location">
          <span>Район</span>
          <strong>{districtName(session)}</strong>
          <p>{activeBuilding?.addressCode ?? activeLocation?.name ?? activeSector?.code ?? "Текущее место не определено"}</p>
        </div>
      </article>

      <section className="profile-section" aria-labelledby="profile-life-title">
        <header>
          <div>
            <span>Текущая жизнь</span>
            <h2 id="profile-life-title">Основа</h2>
          </div>
        </header>
        <div className="profile-facts">
          <article>
            <span>Работа</span>
            <strong>{occupation}</strong>
            <p>{occupation === "Без постоянной работы" ? "Постоянный работодатель отсутствует" : "Текущая занятость персонажа"}</p>
          </article>
          <article>
            <span>Жильё</span>
            <strong>{homeBuilding?.addressCode ?? homeLocation?.name ?? "Нет адреса"}</strong>
            <p>{housingTypeLabel(session.life.housing.type)} · оплачено ещё {player.housingDaysLeft} дн.</p>
          </article>
          <article>
            <span>Статус</span>
            <strong>{currentActivity(session)}</strong>
            <p>{districtName(session)} · {session.world.city.name}</p>
          </article>
        </div>
      </section>

      <section className="profile-section" aria-labelledby="profile-property-title">
        <header>
          <div>
            <span>Собственность</span>
            <h2 id="profile-property-title">Имущество</h2>
          </div>
        </header>
        <div className="property-list">
          <article>
            <i aria-hidden="true">⌂</i>
            <div>
              <strong>{homeLocation?.name ?? "Жильё не назначено"}</strong>
              <span>{homeBuilding?.addressCode ?? housingTypeLabel(session.life.housing.type)}</span>
            </div>
            <em>{player.housingDaysLeft > 0 ? "Активно" : "Просрочено"}</em>
          </article>
          <article>
            <i aria-hidden="true">◇</i>
            <div>
              <strong>{ownedVehicle?.modelName ?? "Личной машины нет"}</strong>
              <span>{ownedVehicle ? `${ownedVehicle.plate} · ${ownedVehicle.state === "parked" ? "припаркована" : ownedVehicle.state === "moving" ? "в движении" : "недоступна"}` : "Транспорт не зарегистрирован"}</span>
            </div>
            <em>{ownedVehicle ? `${Math.round(ownedVehicle.condition)}%` : "—"}</em>
          </article>
        </div>
      </section>

      <section className="profile-section" aria-labelledby="profile-history-title">
        <header>
          <div>
            <span>История мира</span>
            <h2 id="profile-history-title">След</h2>
          </div>
        </header>
        <div className="profile-history">
          <article><strong>{days}</strong><span>дней прожито</span></article>
          <article><strong>{completedWork}</strong><span>работ завершено</span></article>
          <article><strong>{failedWork}</strong><span>работ сорвано</span></article>
          <article><strong>{playerCases.length}</strong><span>дел связано</span></article>
        </div>
        <p className="profile-created">Мир создан {formatGameDateLong(new Date(session.world.meta.createdAt).getTime())}</p>
      </section>
    </section>
  );
}
