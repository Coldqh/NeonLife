import type { GameSession } from "../../world/state/types";
import { formatGameDateLong, formatGameShortDateTime } from "../../core/time/gameTime";
import { asset, currentActivity, currentLocation, districtName, playerOccupation, vehicleStateLabel } from "../shared/presentation";

const DAY_MS = 86_400_000;

function housingTypeLabel(type: GameSession["life"]["housing"]["type"]): string {
  if (type === "capsule") return "Капсула";
  if (type === "room") return "Комната";
  return "Квартира";
}

function livedDays(session: GameSession): number {
  const createdAt = new Date(session.world.meta.createdAt).getTime();
  return Number.isFinite(createdAt) ? Math.max(1, Math.floor((session.timestamp - createdAt) / DAY_MS) + 1) : 1;
}

function meter(value: number, inverse = false): JSX.Element {
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  const danger = inverse ? normalized >= 75 : normalized <= 35;
  const warn = inverse ? normalized >= 55 : normalized <= 55;
  return <i className={danger ? "is-danger" : warn ? "is-warning" : "is-good"}><b style={{ width: `${normalized}%` }} /></i>;
}

export function ProfileScreen({ session }: { session: GameSession }) {
  const player = session.player;
  const position = session.localScene.playerPosition;
  const place = currentLocation(session);
  const building = position.buildingId ? session.urban.buildings.find((item) => item.id === position.buildingId) : undefined;
  const homeLocation = session.world.locations.find((item) => item.id === session.life.housing.locationId);
  const homeBuilding = session.urban.buildings.find((item) => item.anchorLocationId === homeLocation?.id);
  const homeUnit = session.urban.units.find((item) => item.id === session.urban.householdAddresses.find((address) => address.householdId === session.population.households.find((household) => household.memberIds.includes(player.id))?.id)?.unitId);
  const vehicle = session.vehicles.vehicles.find((item) => session.vehicles.player.ownedVehicleIds.includes(item.id));
  const contract = session.jobs.work.contracts.find((item) => item.id === session.jobs.work.activeContractId);
  const activeShift = session.jobs.work.shifts.find((item) => item.id === session.jobs.work.activeShiftId);
  const warrants = session.playerCrime.warrants.filter((item) => item.status !== "closed" && item.status !== "arrested");
  const contact = session.primaryContact;
  const occupation = playerOccupation(session);
  const metrics = [
    ["Здоровье", player.condition.health, false],
    ["Голод", player.condition.hunger, true],
    ["Усталость", player.condition.fatigue, true],
    ["Стресс", player.condition.stress, true]
  ] as const;

  return (
    <section className="screen profile-screen" aria-labelledby="profile-title">
      <header className="profile-heading">
        <div><span>Личное досье</span><h1 id="profile-title">Профиль</h1></div>
        <p>Только факты текущего персонажа и его след в мире.</p>
      </header>

      <article className="profile-hero">
        <div className="profile-portrait"><img src={asset("player-portrait.webp")} alt={`Портрет ${player.name}`} /><span aria-hidden="true" /></div>
        <div className="profile-identity"><span>{occupation}</span><h2>{player.name}</h2><p>{player.age} лет · {player.origin}</p><strong>{currentActivity(session)}</strong></div>
        <div className="profile-wallet"><span>Баланс</span><strong>₵ {Math.round(player.balance).toLocaleString("ru-RU")}</strong><small>{districtName(session)} · {session.world.city.name}</small></div>
        <div className="profile-location"><span>Текущее место</span><strong>{building?.addressCode ?? place?.name ?? "Улица"}</strong><p>{position.unitId ? `Помещение ${session.urban.units.find((item) => item.id === position.unitId)?.unitNumber ?? "—"}` : building ? `${position.floor ?? 1} этаж` : place?.code ?? position.sectorId}</p></div>
      </article>

      <section className="profile-vitals" aria-label="Состояние персонажа">
        {metrics.map(([label, value, inverse]) => <article key={label}><span>{label}</span><strong>{Math.round(value)}%</strong>{meter(value, inverse)}</article>)}
      </section>

      <div className="profile-grid">
        <section className="profile-section"><header><div><span>ТЕКУЩАЯ ЖИЗНЬ</span><h2>Статус</h2></div></header><div className="profile-facts">
          <article><span>Работа</span><strong>{contract?.title ?? occupation}</strong><p>{contract ? `₵ ${contract.wagePerHour}/ч · смен ${contract.completedShifts}` : "Активного контракта нет"}</p></article>
          <article><span>Следующая смена</span><strong>{activeShift ? "Смена идёт" : contract ? formatGameShortDateTime(contract.nextShiftAt) : "Не назначена"}</strong><p>{contract ? `Предупреждения ${contract.warningCount}/3` : "Нужно искать доход"}</p></article>
          <article><span>Правовой риск</span><strong>{warrants.length ? `${warrants.length} активн.` : "Розыска нет"}</strong><p>Розыск {Math.round(session.playerCrime.heat)}% · преступлений {session.playerCrime.totals.crimesCommitted}</p></article>
          <article><span>Основной контакт</span><strong>{contact?.name ?? "Не установлен"}</strong><p>{contact?.role ?? "Связь не сформирована"}</p></article>
        </div></section>

        <section className="profile-section"><header><div><span>Собственность</span><h2>Имущество</h2></div></header><div className="property-list">
          <article><i aria-hidden="true">⌂</i><div><strong>{homeBuilding?.addressCode ?? homeLocation?.name ?? "Жильё не назначено"}</strong><span>{housingTypeLabel(session.life.housing.type)}{homeUnit ? ` · ${homeUnit.unitNumber}` : ""}</span></div><em className={player.housingDaysLeft <= 2 ? "is-danger" : ""}>{player.housingDaysLeft > 0 ? `${player.housingDaysLeft} дн.` : "Просрочено"}</em></article>
          <article><i aria-hidden="true">◇</i><div><strong>{vehicle?.modelName ?? "Личной машины нет"}</strong><span>{vehicle ? `${vehicle.plate} · ${vehicleStateLabel(vehicle)}` : "Транспорт не зарегистрирован"}</span></div><em>{vehicle ? `${Math.round(vehicle.condition)}%` : "—"}</em></article>
        </div></section>
      </div>

      <section className="profile-section"><header><div><span>История мира</span><h2>След</h2></div></header><div className="profile-history">
        <article><strong>{livedDays(session)}</strong><span>дней прожито</span></article>
        <article><strong>{session.jobs.work.totalEarned + session.jobs.courier.totalEarnings}</strong><span>кредитов заработано</span></article>
        <article><strong>{session.jobs.courier.completedDeliveries}</strong><span>доставок завершено</span></article>
        <article><strong>{session.playerCrime.totals.arrests}</strong><span>арестов</span></article>
      </div><p className="profile-created">Мир создан {formatGameDateLong(new Date(session.world.meta.createdAt).getTime())}</p></section>
    </section>
  );
}
