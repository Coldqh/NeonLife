import type { GameSession } from "../../world/state/types";
import { getActiveCourierOrder } from "../../gameplay/jobs/courier/courierSystem";
import { activeObligations, activeRequests } from "../../gameplay/pressure/pressureSystem";
import { formatGameShortDateTime } from "../../core/time/gameTime";
import type { GameScreen } from "../shared/types";
import { Icon } from "../../ui/components/Icons";

interface LifePriority {
  tone: "danger" | "warn" | "neutral" | "good";
  eyebrow: string;
  title: string;
  detail: string;
  actionLabel: string;
  screen: GameScreen;
}

function percent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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

function priorityFor(session: GameSession): LifePriority {
  const condition = session.player.condition;
  const obligation = activeObligations(session.pressure)[0];
  const activeOrder = getActiveCourierOrder(session.jobs.courier);
  const contract = session.jobs.work.contracts.find((item) => item.id === session.jobs.work.activeContractId);

  if (condition.health <= 35) {
    return { tone: "danger", eyebrow: "Здоровье", title: "Нужна медицинская помощь", detail: `Состояние ${percent(condition.health)}%. Найди работающую клинику до следующей тяжёлой нагрузки.`, actionLabel: "Открыть места рядом", screen: "nearby" };
  }
  if (condition.hunger >= 78) {
    return { tone: "danger", eyebrow: "Голод", title: "Нужно поесть", detail: `Голод ${percent(condition.hunger)}%. Ищи открытую торговую точку или еду в сумке.`, actionLabel: "Открыть действия", screen: "nearby" };
  }
  if (condition.fatigue >= 82) {
    return { tone: "warn", eyebrow: "Усталость", title: "Нужно добраться до сна", detail: `Усталость ${percent(condition.fatigue)}%. Ошибки и риски будут расти.`, actionLabel: "Открыть карту", screen: "map" };
  }
  if (activeOrder) {
    return {
      tone: minutesUntil(session.timestamp, activeOrder.deadlineAt) < 60 ? "danger" : "warn",
      eyebrow: "Курьерский заказ",
      title: activeOrder.status === "accepted" ? "Забери груз" : "Доставь груз клиенту",
      detail: `${activeOrder.code} · срок ${formatGameShortDateTime(activeOrder.deadlineAt)} · осталось ${timeLeftLabel(session.timestamp, activeOrder.deadlineAt)}.`,
      actionLabel: "Открыть карту",
      screen: "map"
    };
  }
  if (obligation && minutesUntil(session.timestamp, obligation.dueAt) <= 24 * 60) {
    return {
      tone: obligation.status === "overdue" || obligation.status === "defaulted" ? "danger" : "warn",
      eyebrow: "Платёж",
      title: `${obligation.creditorName}: ₵ ${obligation.amount}`,
      detail: `${obligation.code} · ${timeLeftLabel(session.timestamp, obligation.dueAt)} · ${obligation.consequence}`,
      actionLabel: "Открыть действия",
      screen: "nearby"
    };
  }
  if (contract && minutesUntil(session.timestamp, contract.nextShiftAt) <= 8 * 60) {
    return {
      tone: minutesUntil(session.timestamp, contract.nextShiftAt) < 90 ? "warn" : "neutral",
      eyebrow: "Работа",
      title: `Смена: ${contract.title}`,
      detail: `${formatGameShortDateTime(contract.nextShiftAt)} · осталось ${timeLeftLabel(session.timestamp, contract.nextShiftAt)}.`,
      actionLabel: "Открыть работу",
      screen: "work"
    };
  }
  if (!contract) {
    return { tone: "neutral", eyebrow: "Доход", title: "Постоянной работы нет", detail: "Деньги закончатся быстрее, чем обязательства. Найди вакансию или возьми курьерский заказ.", actionLabel: "Смотреть вакансии", screen: "work" };
  }
  return { tone: "good", eyebrow: "Текущая цель", title: "Срочных угроз нет", detail: "Проверь ближайшую смену, запас еды и обязательства перед новым маршрутом.", actionLabel: "Открыть карту", screen: "map" };
}

function conditionTone(kind: "health" | "hunger" | "fatigue" | "stress", value: number): string {
  const dangerous = kind === "health" ? value <= 35 : value >= 78;
  const warning = kind === "health" ? value <= 55 : value >= 62;
  return dangerous ? "is-danger" : warning ? "is-warning" : "is-good";
}

export function LifeScreen({ session, onOpen }: { session: GameSession; onOpen: (screen: GameScreen) => void }) {
  const priority = priorityFor(session);
  const condition = session.player.condition;
  const allObligations = activeObligations(session.pressure);
  const allRequests = activeRequests(session.pressure);
  const obligations = allObligations.slice(0, 4);
  const requests = allRequests.slice(0, 3);
  const activeOrder = getActiveCourierOrder(session.jobs.courier);
  const contract = session.jobs.work.contracts.find((item) => item.id === session.jobs.work.activeContractId);
  const latestEvents = session.events.filter((event) => event.importance >= 2).slice().sort((left, right) => right.timestamp - left.timestamp).slice(0, 4);

  const metrics = [
    { key: "health" as const, label: "Здоровье", value: condition.health, display: `${percent(condition.health)}%` },
    { key: "hunger" as const, label: "Голод", value: condition.hunger, display: `${percent(condition.hunger)}%` },
    { key: "fatigue" as const, label: "Усталость", value: condition.fatigue, display: `${percent(condition.fatigue)}%` },
    { key: "stress" as const, label: "Стресс", value: condition.stress, display: `${percent(condition.stress)}%` }
  ];

  return (
    <section className="screen life-screen" aria-labelledby="life-title">
      <header className="screen-heading life-heading">
        <div><span>ТЕКУЩЕЕ ПОЛОЖЕНИЕ</span><h1 id="life-title">Жизнь</h1><p>Состояние, сроки и последствия в одном месте.</p></div>
        <div className="life-balance"><span>ДОСТУПНО</span><strong>₵ {session.player.balance.toLocaleString("ru-RU")}</strong><small>жильё оплачено на {session.player.housingDaysLeft} дн.</small></div>
      </header>

      <section className={`life-priority life-priority--${priority.tone}`}>
        <div className="life-priority__icon"><Icon name={priority.tone === "danger" || priority.tone === "warn" ? "alert" : "action"} size={25} /></div>
        <div><span>{priority.eyebrow}</span><h2>{priority.title}</h2><p>{priority.detail}</p></div>
        <button type="button" onClick={() => onOpen(priority.screen)}>{priority.actionLabel}<Icon name="chevron" size={17} /></button>
      </section>

      <section className="life-condition" aria-label="Состояние игрока">
        {metrics.map((metric) => (
          <article key={metric.key} className={conditionTone(metric.key, metric.value)}>
            <span>{metric.label}</span><strong>{metric.display}</strong>
            <i><b style={{ width: `${percent(metric.value)}%` }} /></i>
          </article>
        ))}
      </section>

      <div className="life-grid">
        <section className="life-panel">
          <header><div><span>СРОКИ</span><h2>Обязательства</h2></div><strong>{allObligations.length}</strong></header>
          <div className="life-list">
            {obligations.map((obligation) => (
              <article key={obligation.id} className={obligation.status !== "active" ? "is-danger" : ""}>
                <div><strong>{obligation.creditorName}</strong><span>{obligation.code} · {formatGameShortDateTime(obligation.dueAt)}</span></div>
                <em>₵ {obligation.amount}</em>
              </article>
            ))}
            {!obligations.length ? <p>Активных платежей нет.</p> : null}
          </div>
          {obligations.length && priority.screen !== "nearby" ? <button type="button" onClick={() => onOpen("nearby")}>Открыть оплату</button> : obligations.length ? <p className="life-panel__current">Открыто в главной цели</p> : null}
        </section>

        <section className="life-panel">
          <header><div><span>ДОХОД</span><h2>Работа</h2></div><strong>{contract ? "контракт" : "нет"}</strong></header>
          {contract ? (
            <div className="life-focus">
              <strong>{contract.title}</strong>
              <span>Следующая смена {formatGameShortDateTime(contract.nextShiftAt)}</span>
              <p>₵ {contract.wagePerHour}/ч · предупреждения {contract.warningCount}/3</p>
            </div>
          ) : <p className="life-empty">Постоянного работодателя нет.</p>}
          {priority.screen !== "work" ? <button type="button" onClick={() => onOpen("work")}>{contract ? "Открыть контракт" : "Найти работу"}</button> : <p className="life-panel__current">Открыто в главной цели</p>}
        </section>

        <section className="life-panel">
          <header><div><span>ЗАДАЧА</span><h2>Курьер</h2></div><strong>{Math.round(session.jobs.courier.rating)}%</strong></header>
          {activeOrder ? (
            <div className="life-focus">
              <strong>{activeOrder.code}</strong>
              <span>{activeOrder.status === "accepted" ? "Груз ещё не получен" : "Груз на руках"}</span>
              <p>₵ {activeOrder.payout} · срок {formatGameShortDateTime(activeOrder.deadlineAt)}</p>
            </div>
          ) : <p className="life-empty">Активного заказа нет.</p>}
          {priority.screen !== (activeOrder ? "map" : "nearby") ? <button type="button" onClick={() => onOpen(activeOrder ? "map" : "nearby")}>{activeOrder ? "Продолжить маршрут" : "Открыть диспетчерскую"}</button> : <p className="life-panel__current">Открыто в главной цели</p>}
        </section>

        <section className="life-panel">
          <header><div><span>ЛЮДИ</span><h2>Просьбы</h2></div><strong>{allRequests.length}</strong></header>
          <div className="life-list">
            {requests.map((request) => <article key={request.id}><div><strong>{request.title}</strong><span>{formatGameShortDateTime(request.dueAt)} · {request.status}</span></div><em>₵ {request.reward}</em></article>)}
            {!requests.length ? <p>Никто ничего не ждёт.</p> : null}
          </div>
          {priority.screen !== "nearby" ? <button type="button" onClick={() => onOpen("nearby")}>Открыть людей рядом</button> : <p className="life-panel__current">Открыто в главной цели</p>}
        </section>
      </div>

      <section className="life-panel life-events">
        <header><div><span>ПОСЛЕДСТВИЯ</span><h2>Что изменилось</h2></div></header>
        <div className="life-list">
          {latestEvents.map((event) => <article key={event.id}><div><strong>{event.title}</strong><span>{formatGameShortDateTime(event.timestamp)} · {event.detail}</span></div></article>)}
          {!latestEvents.length ? <p>Значимых событий пока нет.</p> : null}
        </div>
      </section>
    </section>
  );
}
