import type { GameSession } from "../../world/state/types";
import { formatGameDateLong, formatGameShortDateTime } from "../../core/time/gameTime";
import { getActiveCourierOrder } from "../../gameplay/jobs/courier/courierSystem";
import { activeObligations, activeRequests } from "../../gameplay/pressure/pressureSystem";
import { Icon } from "../../ui/components/Icons";
import type { GameScreen } from "../shared/types";
import { asset, currentActivity, currentLocation, districtName, playerOccupation, vehicleStateLabel } from "../shared/presentation";

const DAY_MS = 86_400_000;
type ProfileRoute = "map" | "nearby" | "work";

interface ProfilePriority {
  tone: "danger" | "warn" | "neutral" | "good";
  eyebrow: string;
  title: string;
  detail: string;
  actionLabel: string;
  route: ProfileRoute;
}

function housingTypeLabel(type: GameSession["life"]["housing"]["type"]): string {
  if (type === "capsule") return "Капсула";
  if (type === "room") return "Комната";
  return "Квартира";
}

function livedDays(session: GameSession): number {
  const createdAt = new Date(session.world.meta.createdAt).getTime();
  return Number.isFinite(createdAt) ? Math.max(1, Math.floor((session.timestamp - createdAt) / DAY_MS) + 1) : 1;
}

function percent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function meter(value: number, inverse = false): JSX.Element {
  const normalized = percent(value);
  const danger = inverse ? normalized >= 75 : normalized <= 35;
  const warn = inverse ? normalized >= 55 : normalized <= 55;
  return <i className={danger ? "is-danger" : warn ? "is-warning" : "is-good"}><b style={{ width: `${normalized}%` }} /></i>;
}

function minutesUntil(timestamp: number, target: number): number {
  return Math.floor((target - timestamp) / 60_000);
}

function timeLeftLabel(timestamp: number, target: number): string {
  const minutes = minutesUntil(timestamp, target);
  if (minutes < 0) return `просрочено на ${Math.ceil(Math.abs(minutes) / 60)} ч.`;
  if (minutes < 60) return `${minutes} мин.`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} ч. ${minutes % 60} мин.`;
  return `${Math.floor(minutes / (24 * 60))} дн.`;
}

function priorityFor(session: GameSession): ProfilePriority {
  const condition = session.player.condition;
  const obligation = activeObligations(session.pressure)[0];
  const contract = session.jobs.work.contracts.find((item) => item.id === session.jobs.work.activeContractId && (item.status === "active" || item.status === "warning"));
  const activeOrder = contract?.role === "courier" ? getActiveCourierOrder(session.jobs.courier) : undefined;

  if (condition.health <= 35) return { tone: "danger", eyebrow: "Здоровье", title: "Нужна медицинская помощь", detail: `Состояние ${percent(condition.health)}%. Найди работающую клинику до следующей тяжёлой нагрузки.`, actionLabel: "Места рядом", route: "nearby" };
  if (condition.hunger >= 78) return { tone: "danger", eyebrow: "Голод", title: "Нужно поесть", detail: `Голод ${percent(condition.hunger)}%. Ищи открытую торговую точку или еду в сумке.`, actionLabel: "Открыть действия", route: "nearby" };
  if (condition.fatigue >= 82) return { tone: "warn", eyebrow: "Усталость", title: "Нужно добраться до сна", detail: `Усталость ${percent(condition.fatigue)}%. Ошибки и риски будут расти.`, actionLabel: "Открыть карту", route: "map" };
  if (activeOrder) return {
    tone: minutesUntil(session.timestamp, activeOrder.deadlineAt) < 60 ? "danger" : "warn",
    eyebrow: "Курьерский заказ",
    title: activeOrder.status === "accepted" ? "Забери груз" : "Доставь груз клиенту",
    detail: `${activeOrder.code} · срок ${formatGameShortDateTime(activeOrder.deadlineAt)} · осталось ${timeLeftLabel(session.timestamp, activeOrder.deadlineAt)}.`,
    actionLabel: "Продолжить маршрут",
    route: "map"
  };
  if (obligation && minutesUntil(session.timestamp, obligation.dueAt) <= 24 * 60) return {
    tone: obligation.status === "overdue" || obligation.status === "defaulted" ? "danger" : "warn",
    eyebrow: "Платёж",
    title: `${obligation.creditorName}: ₵ ${obligation.amount}`,
    detail: `${obligation.code} · ${timeLeftLabel(session.timestamp, obligation.dueAt)} · ${obligation.consequence}`,
    actionLabel: "Открыть действия",
    route: "nearby"
  };
  if (contract && contract.role !== "courier" && minutesUntil(session.timestamp, contract.nextShiftAt) <= 8 * 60) return {
    tone: minutesUntil(session.timestamp, contract.nextShiftAt) < 90 ? "warn" : "neutral",
    eyebrow: "Работа",
    title: `Смена: ${contract.title}`,
    detail: `${formatGameShortDateTime(contract.nextShiftAt)} · осталось ${timeLeftLabel(session.timestamp, contract.nextShiftAt)}.`,
    actionLabel: "Открыть контракт",
    route: "work"
  };
  if (!contract) return { tone: "neutral", eyebrow: "Доход", title: "Постоянной работы нет", detail: "Выбери профессию, пройди собеседование и подпиши контракт.", actionLabel: "Смотреть вакансии", route: "work" };
  return { tone: "good", eyebrow: "Текущая цель", title: "Срочных угроз нет", detail: contract.role === "courier" ? "Заказы не назначаются автоматически. Возьми подходящий маршрут в диспетчерской." : "Проверь ближайшую смену, запас еды и обязательства перед новым маршрутом.", actionLabel: contract.role === "courier" ? "Открыть контракт" : "Открыть карту", route: contract.role === "courier" ? "work" : "map" };
}

export function ProfileScreen({ session, onOpen }: { session: GameSession; onOpen: (screen: GameScreen) => void }) {
  const player = session.player;
  const position = session.localScene.playerPosition;
  const place = currentLocation(session);
  const building = position.buildingId ? session.urban.buildings.find((item) => item.id === position.buildingId) : undefined;
  const homeLocation = session.world.locations.find((item) => item.id === session.life.housing.locationId);
  const homeBuilding = session.urban.buildings.find((item) => item.anchorLocationId === homeLocation?.id);
  const playerHousehold = session.population.households.find((household) => household.memberIds.includes(player.id));
  const homeAddress = session.urban.householdAddresses.find((address) => address.householdId === playerHousehold?.id);
  const homeUnit = session.urban.units.find((item) => item.id === homeAddress?.unitId);
  const vehicle = session.vehicles.vehicles.find((item) => session.vehicles.player.ownedVehicleIds.includes(item.id));
  const contract = session.jobs.work.contracts.find((item) => item.id === session.jobs.work.activeContractId && (item.status === "active" || item.status === "warning"));
  const activeShift = session.jobs.work.shifts.find((item) => item.id === session.jobs.work.activeShiftId);
  const activeOrder = contract?.role === "courier" ? getActiveCourierOrder(session.jobs.courier) : undefined;
  const warrants = session.playerCrime.warrants.filter((item) => item.status !== "closed" && item.status !== "arrested");
  const priority = priorityFor(session);
  const obligations = activeObligations(session.pressure);
  const requests = activeRequests(session.pressure);
  const latestEvents = session.events.filter((event) => event.importance >= 2).slice().sort((left, right) => right.timestamp - left.timestamp).slice(0, 5);
  const occupation = playerOccupation(session);
  const metrics = [
    ["Здоровье", player.condition.health, false],
    ["Голод", player.condition.hunger, true],
    ["Усталость", player.condition.fatigue, true],
    ["Стресс", player.condition.stress, true]
  ] as const;

  function followPriority(): void {
    onOpen(priority.route);
  }

  return (
    <section className="screen profile-screen" aria-labelledby="profile-title">
      <header className="profile-heading">
        <div><span>ЛИЧНОЕ ДОСЬЕ</span><h1 id="profile-title">Профиль</h1><p>Персонаж, состояние, имущество, обязательства и последствия.</p></div>
      </header>

      <div className="profile-overview">
          <article className="profile-hero">
            <div className="profile-portrait"><img src={asset("player-portrait.webp")} alt={`Портрет ${player.name}`} /><span aria-hidden="true" /></div>
            <div className="profile-identity"><span>{occupation}</span><h2>{player.name}</h2><p>{player.age} лет · {player.origin}</p><strong>{currentActivity(session)}</strong></div>
            <div className="profile-wallet"><span>Баланс</span><strong>₵ {Math.round(player.balance).toLocaleString("ru-RU")}</strong><small>{districtName(session)} · {session.world.city.name}</small></div>
            <div className="profile-location"><span>Текущее место</span><strong>{building?.addressCode ?? place?.name ?? "Улица"}</strong><p>{position.unitId ? `Помещение ${session.urban.units.find((item) => item.id === position.unitId)?.unitNumber ?? "—"}` : building ? `${position.floor ?? 1} этаж` : place?.code ?? position.sectorId}</p></div>
          </article>

          <section className={`life-priority life-priority--${priority.tone}`}>
            <div className="life-priority__icon"><Icon name={priority.tone === "danger" || priority.tone === "warn" ? "alert" : "action"} size={25} /></div>
            <div><span>{priority.eyebrow}</span><h2>{priority.title}</h2><p>{priority.detail}</p></div>
            <button type="button" onClick={followPriority}>{priority.actionLabel}<Icon name="chevron" size={17} /></button>
          </section>

          <section className="profile-vitals" aria-label="Состояние персонажа">
            {metrics.map(([label, value, inverse]) => <article key={label}><span>{label}</span><strong>{percent(value)}%</strong>{meter(value, inverse)}</article>)}
          </section>

          <div className="profile-grid">
            <section className="profile-section"><header><div><span>ТЕКУЩАЯ ЖИЗНЬ</span><h2>Статус</h2></div></header><div className="profile-facts">
              <article><span>Работа</span><strong>{contract?.title ?? "Контракта нет"}</strong><p>{contract?.role === "courier" ? `${session.jobs.courier.completedDeliveries} доставок · рейтинг ${Math.round(session.jobs.courier.rating)}%` : contract ? `₵ ${contract.wagePerHour}/ч · смен ${contract.completedShifts}` : "Открой раздел работы и выбери профессию"}</p></article>
              <article><span>{contract?.role === "courier" ? "Активный заказ" : "Следующая смена"}</span><strong>{activeOrder?.code ?? (activeShift ? "Смена идёт" : contract?.role === "courier" ? "Не выбран" : contract ? formatGameShortDateTime(contract.nextShiftAt) : "Не назначена")}</strong><p>{activeOrder ? `₵ ${activeOrder.payout} · ${timeLeftLabel(session.timestamp, activeOrder.deadlineAt)}` : contract?.role === "courier" ? "Заказы берутся вручную в диспетчерской" : contract ? `Предупреждения ${contract.warningCount}/3` : "Автоматических заданий нет"}</p></article>
              <article><span>Правовой риск</span><strong>{warrants.length ? `${warrants.length} активн.` : "Розыска нет"}</strong><p>Розыск {percent(session.playerCrime.heat)}% · преступлений {session.playerCrime.totals.crimesCommitted}</p></article>
              <article><span>Основной контакт</span><strong>{session.primaryContact?.name ?? "Не установлен"}</strong><p>{session.primaryContact?.role ?? "Связь не сформирована"}</p></article>
            </div></section>

            <section className="profile-section"><header><div><span>СОБСТВЕННОСТЬ</span><h2>Имущество</h2></div></header><div className="property-list">
              <article><i aria-hidden="true">⌂</i><div><strong>{homeBuilding?.addressCode ?? homeLocation?.name ?? "Жильё не назначено"}</strong><span>{housingTypeLabel(session.life.housing.type)}{homeUnit ? ` · ${homeUnit.unitNumber}` : ""}</span></div><em className={player.housingDaysLeft <= 2 ? "is-danger" : ""}>{player.housingDaysLeft > 0 ? `${player.housingDaysLeft} дн.` : "Просрочено"}</em></article>
              <article><i aria-hidden="true">◇</i><div><strong>{vehicle?.modelName ?? "Личной машины нет"}</strong><span>{vehicle ? `${vehicle.plate} · ${vehicleStateLabel(vehicle)}` : "Транспорт не зарегистрирован"}</span></div><em>{vehicle ? `${percent(vehicle.condition)}%` : "—"}</em></article>
            </div></section>
          </div>

          <div className="profile-pressure-grid">
            <section className="life-panel">
              <header><div><span>СРОКИ</span><h2>Обязательства</h2></div><strong>{obligations.length}</strong></header>
              <div className="life-list">{obligations.slice(0, 4).map((obligation) => <article key={obligation.id} className={obligation.status !== "active" ? "is-danger" : ""}><div><strong>{obligation.creditorName}</strong><span>{obligation.code} · {formatGameShortDateTime(obligation.dueAt)}</span></div><em>₵ {obligation.amount}</em></article>)}{!obligations.length ? <p>Активных платежей нет.</p> : null}</div>
              {obligations.length ? <button type="button" onClick={() => onOpen("nearby")}>Открыть действия</button> : null}
            </section>

            <section className="life-panel">
              <header><div><span>ЛЮДИ</span><h2>Просьбы</h2></div><strong>{requests.length}</strong></header>
              <div className="life-list">{requests.slice(0, 4).map((request) => <article key={request.id}><div><strong>{request.title}</strong><span>{formatGameShortDateTime(request.dueAt)} · {request.status}</span></div><em>₵ {request.reward}</em></article>)}{!requests.length ? <p>Никто ничего не ждёт.</p> : null}</div>
              {requests.length ? <button type="button" onClick={() => onOpen("nearby")}>Открыть людей рядом</button> : null}
            </section>
          </div>

          <section className="profile-section profile-events"><header><div><span>ПОСЛЕДСТВИЯ</span><h2>Что изменилось</h2></div></header><div className="life-list">
            {latestEvents.map((event) => <article key={event.id}><div><strong>{event.title}</strong><span>{formatGameShortDateTime(event.timestamp)} · {event.detail}</span></div></article>)}
            {!latestEvents.length ? <p>Значимых событий пока нет.</p> : null}
          </div></section>

          <section className="profile-section"><header><div><span>ИСТОРИЯ МИРА</span><h2>След</h2></div></header><div className="profile-history">
            <article><strong>{livedDays(session)}</strong><span>дней прожито</span></article>
            <article><strong>{session.jobs.work.totalEarned + session.jobs.courier.totalEarnings}</strong><span>кредитов заработано</span></article>
            <article><strong>{session.jobs.courier.completedDeliveries}</strong><span>доставок завершено</span></article>
            <article><strong>{session.playerCrime.totals.arrests}</strong><span>арестов</span></article>
          </div><p className="profile-created">Мир создан {formatGameDateLong(new Date(session.world.meta.createdAt).getTime())}</p></section>
      </div>
    </section>
  );
}
