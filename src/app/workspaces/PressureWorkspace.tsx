import { useMemo, useState } from "react";
import { formatGameDateTime, formatGameTime } from "../../core/time/gameTime";
import {
  activeObligations,
  activeRequests,
  committedAmount
} from "../../gameplay/pressure/pressureSystem";
import type { GameSession } from "../../world/state/types";
import { getPerson } from "../../people/network/humanNetwork";
import { Icon } from "../../ui/components/Icons";

interface PressureWorkspaceProps {
  session: GameSession;
  onAcceptRequest: (requestId: string) => void;
  onDeclineRequest: (requestId: string) => void;
  onCompleteRequest: (requestId: string) => void;
  onTravel: (locationId: string) => void;
  onPayObligation: (obligationId: string) => void;
  onRequestExtension: () => void;
  onBorrow: (personId: string) => void;
}

type PressureTab = "deadlines" | "requests" | "days";

function hoursLeft(timestamp: number, dueAt: number): number {
  return Math.ceil((dueAt - timestamp) / 60 / 60_000);
}

function dueLabel(timestamp: number, dueAt: number): string {
  const hours = hoursLeft(timestamp, dueAt);
  if (hours < 0) return `${Math.abs(hours)} ч просрочено`;
  if (hours < 24) return `${hours} ч осталось`;
  return `${Math.ceil(hours / 24)} дн. осталось`;
}

export function PressureWorkspace({
  session,
  onAcceptRequest,
  onDeclineRequest,
  onCompleteRequest,
  onTravel,
  onPayObligation,
  onRequestExtension,
  onBorrow
}: PressureWorkspaceProps) {
  const [tab, setTab] = useState<PressureTab>("deadlines");
  const obligations = useMemo(() => activeObligations(session.pressure), [session.pressure]);
  const requests = useMemo(() => activeRequests(session.pressure), [session.pressure]);
  const committed = committedAmount(session.pressure);
  const freeBalance = session.player.balance - committed;
  const eligibleLenders = session.people.people
    .filter((person) => person.trustToPlayer >= 25 && person.money >= 180)
    .sort((left, right) => right.trustToPlayer - left.trustToPlayer)
    .slice(0, 3);
  const locationName = (id: string) => session.world.locations.find((location) => location.id === id)?.name ?? "UNKNOWN NODE";

  return (
    <div className="pressure-workspace">
      <header className="module-heading pressure-heading">
        <div>
          <span>LIFE / PRESSURE WEEK</span>
          <h1>ОБЯЗАТЕЛЬСТВА</h1>
          <p>{formatGameDateTime(session.timestamp)} · неделя заканчивается {formatGameDateTime(session.pressure.weekEndsAt)}</p>
        </div>
        <div className="pressure-stats">
          <div><span>BALANCE</span><strong>₵ {session.player.balance}</strong></div>
          <div><span>COMMITTED</span><strong>₵ {committed}</strong></div>
          <div><span>FREE</span><strong className={freeBalance < 0 ? "warning-text" : ""}>₵ {freeBalance}</strong></div>
          <div><span>HOME</span><strong>{session.pressure.housingStatus.toUpperCase()}</strong></div>
        </div>
      </header>

      <nav className="terminal-tabs pressure-tabs">
        <button type="button" className={tab === "deadlines" ? "is-active" : ""} onClick={() => setTab("deadlines")}>ПЛАТЕЖИ · {obligations.length}</button>
        <button type="button" className={tab === "requests" ? "is-active" : ""} onClick={() => setTab("requests")}>ПРОСЬБЫ · {requests.length}</button>
        <button type="button" className={tab === "days" ? "is-active" : ""} onClick={() => setTab("days")}>ДНИ · {session.pressure.summaries.length}</button>
      </nav>

      {tab === "deadlines" ? (
        <div className="pressure-deadlines">
          <section className="obligation-list">
            {obligations.map((obligation) => {
              const urgent = obligation.dueAt - session.timestamp < 24 * 60 * 60_000;
              return (
                <article className={`obligation-card obligation-card--${obligation.status} ${urgent ? "is-urgent" : ""}`} key={obligation.id}>
                  <header>
                    <span>{obligation.code}</span>
                    <strong>{obligation.creditorName}</strong>
                    <em>{dueLabel(session.timestamp, obligation.dueAt)}</em>
                  </header>
                  <div className="obligation-card__main">
                    <div><span>AMOUNT</span><strong>₵ {obligation.amount}</strong></div>
                    <div><span>DEADLINE</span><strong>{formatGameTime(obligation.dueAt)}</strong></div>
                    <p>{obligation.consequence}</p>
                  </div>
                  <footer>
                    <button type="button" disabled={session.player.balance < obligation.amount} onClick={() => onPayObligation(obligation.id)}>ОПЛАТИТЬ</button>
                    {obligation.type === "rent" && obligation.extensionCount < 1 ? <button type="button" className="button--ghost" onClick={onRequestExtension}>ПРОСИТЬ 24 Ч</button> : null}
                  </footer>
                </article>
              );
            })}
            {!obligations.length ? <div className="empty-terminal">Активных платежей нет.</div> : null}
          </section>

          <section className="emergency-credit">
            <header><span>PERSONAL CREDIT</span><strong>ПОПРОСИТЬ ВЗАЙМ</strong></header>
            <p>Деньги создают личный долг на три дня. Отказ зависит от доверия и средств человека.</p>
            <div>
              {eligibleLenders.map((person) => (
                <button type="button" key={person.id} onClick={() => onBorrow(person.id)}>
                  <span><strong>{person.name}</strong><small>TRUST {person.trustToPlayer} · FUNDS ₵ {person.money}</small></span>
                  <Icon name="chevron" size={15} />
                </button>
              ))}
              {!eligibleLenders.length ? <small>Сейчас никто не готов одолжить деньги.</small> : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "requests" ? (
        <div className="request-list">
          {requests.map((request) => {
            const person = getPerson(session.people, request.personId);
            const atTarget = session.life.currentLocationId === request.targetLocationId;
            const accepted = request.status === "accepted";
            return (
              <article className={`request-card request-card--${request.status}`} key={request.id}>
                <header>
                  <span>{request.code}</span>
                  <strong>{person?.name ?? "UNKNOWN CONTACT"}</strong>
                  <em>{dueLabel(session.timestamp, request.dueAt)}</em>
                </header>
                <h3>{request.title}</h3>
                <p>{request.detail}</p>
                <div className="request-card__meta">
                  <span>{request.durationMinutes} MIN</span>
                  <span>{request.upfrontCost ? `COST ₵ ${request.upfrontCost}` : "NO COST"}</span>
                  <span>{request.reward ? `REWARD ₵ ${request.reward}` : "PERSONAL"}</span>
                  <span>{locationName(request.targetLocationId)}</span>
                </div>
                <footer>
                  {!accepted ? <button type="button" onClick={() => onAcceptRequest(request.id)}>ПРИНЯТЬ</button> : null}
                  {accepted && !atTarget ? <button type="button" onClick={() => onTravel(request.targetLocationId)}>ЕХАТЬ</button> : null}
                  {accepted && atTarget ? <button type="button" disabled={session.player.balance < request.upfrontCost} onClick={() => onCompleteRequest(request.id)}>ВЫПОЛНИТЬ</button> : null}
                  <button type="button" className="button--ghost" onClick={() => onDeclineRequest(request.id)}>ОТКАЗАТЬ</button>
                </footer>
              </article>
            );
          })}
          {!requests.length ? <div className="empty-terminal">Активных просьб нет. Люди продолжат жить и обращаться позже.</div> : null}
        </div>
      ) : null}

      {tab === "days" ? (
        <div className="day-summary-list">
          {session.pressure.summaries.map((summary) => (
            <article className="day-summary-card" key={summary.id}>
              <header><span>DAY {summary.dayIndex} CLOSED</span><strong>₵ {summary.balanceAfter}</strong></header>
              <div>
                <span>EARNED<strong>₵ {summary.earned}</strong></span>
                <span>SPENT<strong>₵ {summary.spent}</strong></span>
                <span>SLEEP<strong>{Math.floor(summary.sleepMinutes / 60)}H {summary.sleepMinutes % 60}M</strong></span>
                <span>DELIVERIES<strong>{summary.deliveries}</strong></span>
                <span>REQUESTS<strong>{summary.requestsCompleted}/{summary.requestsMissed}</strong></span>
                <span>RELATIONS<strong>{summary.relationChanges}</strong></span>
              </div>
              <small>{formatGameDateTime(summary.startedAt)} → {formatGameDateTime(summary.closedAt)} · world events {summary.worldEvents}</small>
            </article>
          ))}
          {!session.pressure.summaries.length ? <div className="empty-terminal">Первый итог появится после сна.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
