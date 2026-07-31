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
  targetLocationId?: string;
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

function credits(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
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
  if (minutes < 60) return `${Math.max(0, minutes)} мин.`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} ч. ${minutes % 60} мин.`;
  return `${Math.floor(minutes / (24 * 60))} дн.`;
}

function priorityFor(session: GameSession): ProfilePriority {
  const condition = session.player.condition;
  const obligation = activeObligations(session.pressure)[0];
  const contract = session.jobs.work.contracts.find((item) => item.id === session.jobs.work.activeContractId && (item.status === "active" || item.status === "warning"));
  const activeOrder = contract?.role === "courier" ? getActiveCourierOrder(session.jobs.courier) : undefined;

  if (condition.health <= 35) return { tone: "danger", eyebrow: "Здоровье", title: "Нужна медицинская помощь", detail: `Состояние ${percent(condition.health)}%. Найди открытую клинику.`, actionLabel: "Места рядом", route: "nearby" };
  if (condition.hunger >= 78) return { tone: "danger", eyebrow: "Голод", title: "Нужно поесть", detail: `Голод ${percent(condition.hunger)}%. Проверь еду в сумке или торговые точки.`, actionLabel: "Открыть действия", route: "nearby" };
  if (condition.fatigue >= 82) return { tone: "warn", eyebrow: "Усталость", title: "Нужно добраться до сна", detail: `Усталость ${percent(condition.fatigue)}%. Ошибки и риски уже растут.`, actionLabel: "Маршрут домой", route: "map", targetLocationId: session.life.housing.locationId };
  if (activeOrder) return { tone: minutesUntil(session.timestamp, activeOrder.deadlineAt) < 60 ? "danger" : "warn", eyebrow: "Курьерский заказ", title: activeOrder.status === "accepted" ? "Забери груз" : "Доставь груз клиенту", detail: `${activeOrder.code} · осталось ${timeLeftLabel(session.timestamp, activeOrder.deadlineAt)}.`, actionLabel: "Продолжить маршрут", route: "map" };
  if (obligation && minutesUntil(session.timestamp, obligation.dueAt) <= 24 * 60) return { tone: obligation.status === "overdue" || obligation.status === "defaulted" ? "danger" : "warn", eyebrow: "Платёж", title: `${obligation.creditorName}: ₵ ${credits(obligation.amount)}`, detail: `${obligation.code} · ${timeLeftLabel(session.timestamp, obligation.dueAt)} · ${obligation.consequence}`, actionLabel: "Домашний терминал", route: "map", targetLocationId: session.life.housing.locationId };
  if (contract && contract.role !== "courier" && minutesUntil(session.timestamp, contract.nextShiftAt) <= 8 * 60) return { tone: minutesUntil(session.timestamp, contract.nextShiftAt) < 90 ? "warn" : "neutral", eyebrow: "Работа", title: `Смена: ${contract.title}`, detail: `${formatGameShortDateTime(contract.nextShiftAt)} · осталось ${timeLeftLabel(session.timestamp, contract.nextShiftAt)}.`, actionLabel: "Открыть контракт", route: "work" };
  if (!contract) return { tone: "neutral", eyebrow: "Доход", title: "Постоянной работы нет", detail: "Выбери профессию, пройди собеседование и подпиши контракт.", actionLabel: "Смотреть вакансии", route: "work" };
  return { tone: "good", eyebrow: "Текущая цель", title: "Срочных угроз нет", detail: contract.role === "courier" ? "Выбери заказ вручную в диспетчерской." : "Можно заняться маршрутом, запасами или связями.", actionLabel: contract.role === "courier" ? "Открыть работу" : "Открыть карту", route: contract.role === "courier" ? "work" : "map" };
}

export function ProfileScreen({ session, onOpen, onRouteTo }: { session: GameSession; onOpen: (screen: GameScreen) => void; onRouteTo: (locationId: string) => void }) {
  const player = session.player;
  const position = session.localScene.playerPosition;
  const place = currentLocation(session);
  const building = position.buildingId ? session.urban.buildings.find((item) => item.id === position.buildingId) : undefined;
  const currentUnit = position.unitId ? session.urban.units.find((item) => item.id === position.unitId) : undefined;
  const currentVehicle = position.state === "vehicle" ? session.vehicles.vehicles.find((item) => item.id === session.vehicles.player.currentVehicleId) : undefined;
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
  const completedRequests = session.pressure.summaries.reduce((sum, item) => sum + item.requestsCompleted, 0) + session.pressure.currentDay.requestsCompleted;
  const completedShifts = session.jobs.work.contracts.reduce((sum, item) => sum + item.completedShifts, 0);
  const firstRequest = requests[0];
  const firstRequestPerson = firstRequest ? session.people.people.find((person) => person.id === firstRequest.personId) : undefined;
  const firstRequestTargetId = firstRequestPerson?.currentLocationId ?? firstRequest?.targetLocationId;
  const requestPersonNearby = firstRequest ? session.localScene.actors.some((actor) => actor.activePersonId === firstRequest.personId && actor.interactable) : false;
  const positionTitle = currentVehicle?.modelName ?? building?.addressCode ?? place?.name ?? districtName(session);
  const positionDetail = currentVehicle ? `${currentVehicle.plate} · ${session.vehicles.player.seat === "driver" ? "за рулём" : "пассажир"}` : currentUnit ? `Помещение ${currentUnit.unitNumber} · этаж ${position.floor ?? currentUnit.floor}` : building ? `Этаж ${position.floor ?? 1}` : "На улице";
  const metrics = [["Здоровье", player.condition.health, false], ["Голод", player.condition.hunger, true], ["Усталость", player.condition.fatigue, true], ["Стресс", player.condition.stress, true]] as const;
  const historyStats = [
    { value: livedDays(session), label: "дней прожито" },
    { value: credits(session.jobs.work.totalEarned + session.jobs.courier.totalEarnings), label: "кредитов заработано" },
    contract?.role === "courier" ? { value: session.jobs.courier.completedDeliveries, label: "доставок завершено" } : { value: completedShifts, label: "смен завершено" },
    { value: completedRequests, label: "просьб выполнено" }
  ];

  return (
    <section className="screen profile-screen" aria-labelledby="profile-title">
      <header className="profile-heading"><div><span>ЛИЧНОЕ ДОСЬЕ</span><h1 id="profile-title">Профиль</h1><p>Текущее состояние и последствия решений.</p></div></header>

      <div className="profile-overview">
        <article className="profile-hero">
          <div className="profile-portrait"><img src={asset("player-portrait.webp")} alt={`Портрет ${player.name}`} /><span aria-hidden="true" /></div>
          <div className="profile-identity"><span>{playerOccupation(session)}</span><h2>{player.name}</h2><p>{player.age} лет · {player.origin}</p><strong>{currentActivity(session)}</strong></div>
          <div className="profile-wallet"><span>Баланс</span><strong>₵ {credits(player.balance)}</strong><small>{districtName(session)} · {session.world.city.name}</small></div>
          <div className="profile-location"><span>Текущее место</span><strong>{positionTitle}</strong><p>{positionDetail}</p></div>
        </article>

        <section className={`life-priority life-priority--${priority.tone}`}>
          <div className="life-priority__icon"><Icon name={priority.tone === "danger" || priority.tone === "warn" ? "alert" : "action"} size={25} /></div>
          <div><span>{priority.eyebrow}</span><h2>{priority.title}</h2><p>{priority.detail}</p></div>
          <button type="button" onClick={() => priority.targetLocationId ? onRouteTo(priority.targetLocationId) : onOpen(priority.route)}>{priority.actionLabel}<Icon name="chevron" size={17} /></button>
        </section>

        <section className="profile-vitals" aria-label="Состояние персонажа">{metrics.map(([label, value, inverse]) => <article key={label}><span>{label}</span><strong>{percent(value)}%</strong>{meter(value, inverse)}</article>)}</section>

        <div className="profile-grid">
          <section className="profile-section"><header><div><span>ТЕКУЩАЯ ЖИЗНЬ</span><h2>Статус</h2></div><button type="button" className="profile-section__link" onClick={() => onOpen("work")}>Работа</button></header><div className="profile-facts">
            <article><span>Профессия</span><strong>{contract?.title ?? "Безработный"}</strong><p>{contract?.role === "courier" ? `${session.jobs.courier.completedDeliveries} доставок · рейтинг ${Math.round(session.jobs.courier.rating)}%` : contract ? `₵ ${credits(contract.wagePerHour)}/ч · смен ${contract.completedShifts}` : "Активного контракта нет"}</p></article>
            <article><span>{contract?.role === "courier" ? "Заказ" : "Смена"}</span><strong>{activeOrder?.code ?? (activeShift ? "Идёт сейчас" : contract?.role === "courier" ? "Не выбран" : contract ? formatGameShortDateTime(contract.nextShiftAt) : "Не назначена")}</strong><p>{activeOrder ? `₵ ${credits(activeOrder.payout)} · ${timeLeftLabel(session.timestamp, activeOrder.deadlineAt)}` : contract?.role === "courier" ? "Заказы принимаются вручную" : contract ? `Предупреждения ${contract.warningCount}/3` : "Открой вакансии"}</p></article>
            <article><span>Правовой риск</span><strong>{warrants.length ? `${warrants.length} активн.` : "Розыска нет"}</strong><p>Розыск {percent(session.playerCrime.heat)}% · преступлений {session.playerCrime.totals.crimesCommitted}</p></article>
            <article><span>Основной контакт</span><strong>{session.primaryContact?.name ?? "Не установлен"}</strong><p>{session.primaryContact?.role ?? "Связь не сформирована"}</p></article>
          </div></section>

          <section className="profile-section"><header><div><span>СОБСТВЕННОСТЬ</span><h2>Имущество</h2></div></header><div className="property-list">
            <article><i aria-hidden="true">⌂</i><div><strong>{homeBuilding?.addressCode ?? homeLocation?.name ?? "Жильё не назначено"}</strong><span>{housingTypeLabel(session.life.housing.type)}{homeUnit ? ` · ${homeUnit.unitNumber}` : ""}</span></div><em className={player.housingDaysLeft <= 2 ? "is-danger" : ""}>{player.housingDaysLeft > 0 ? `${player.housingDaysLeft} дн.` : "Просрочено"}</em></article>
            <article><i aria-hidden="true">◇</i><div><strong>{vehicle?.modelName ?? "Личной машины нет"}</strong><span>{vehicle ? `${vehicle.plate} · ${vehicleStateLabel(vehicle)}` : "Транспорт не зарегистрирован"}</span></div><em>{vehicle ? `${percent(vehicle.condition)}%` : "—"}</em></article>
          </div></section>
        </div>

        <div className="profile-pressure-grid">
          <section className="life-panel"><header><div><span>СРОКИ</span><h2>Обязательства</h2></div><strong>{obligations.length}</strong></header><div className="life-list">{obligations.slice(0, 4).map((obligation) => <article key={obligation.id} className={obligation.status !== "active" ? "is-danger" : ""}><div><strong>{obligation.creditorName}</strong><span>{obligation.code} · {timeLeftLabel(session.timestamp, obligation.dueAt)}</span></div><em>₵ {credits(obligation.amount)}</em></article>)}{!obligations.length ? <p>Активных платежей нет.</p> : null}</div>{obligations.length ? <button type="button" onClick={() => homeLocation ? onRouteTo(homeLocation.id) : onOpen("map")}>Домашний терминал</button> : null}</section>
          <section className="life-panel"><header><div><span>ЛЮДИ</span><h2>Просьбы</h2></div><strong>{requests.length}</strong></header><div className="life-list">{requests.slice(0, 4).map((request) => <article key={request.id}><div><strong>{request.title}</strong><span>{request.code} · {timeLeftLabel(session.timestamp, request.dueAt)} · {request.status === "accepted" ? "принято" : "ожидает ответа"}</span></div><em>₵ {credits(request.reward)}</em></article>)}{!requests.length ? <p>Никто ничего не ждёт.</p> : null}</div>{firstRequest ? <button type="button" onClick={() => requestPersonNearby ? onOpen("nearby") : firstRequestTargetId && onRouteTo(firstRequestTargetId)}>{requestPersonNearby ? "Открыть человека рядом" : "Маршрут к просьбе"}</button> : null}</section>
        </div>

        <section className="profile-section profile-events"><header><div><span>ПОСЛЕДСТВИЯ</span><h2>Что изменилось</h2></div></header><div className="life-list">{latestEvents.map((event) => <article key={event.id}><div><strong>{event.title}</strong><span>{formatGameShortDateTime(event.timestamp)} · {event.detail}</span></div></article>)}{!latestEvents.length ? <p>Значимых событий пока нет.</p> : null}</div></section>

        <section className="profile-section"><header><div><span>ИСТОРИЯ МИРА</span><h2>След</h2></div></header><div className="profile-history">{historyStats.map((metric) => <article key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div><p className="profile-created">Мир создан {formatGameDateLong(new Date(session.world.meta.createdAt).getTime())}</p></section>
      </div>
    </section>
  );
}
