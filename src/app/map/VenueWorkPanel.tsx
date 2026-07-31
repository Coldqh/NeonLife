import { useState } from "react";
import { roleLabel, skillLabel } from "../../gameplay/jobs/work/workSystem";
import type { GameSession } from "../../world/state/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { formatGameMonthDayTime } from "../../core/time/gameTime";

const clock = formatGameMonthDayTime;
const DAY_MS = 24 * 60 * 60_000;
const INTERVIEW_RETRY_MS = 3 * DAY_MS;

function money(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

export function VenueWorkPanel({ session, venueId, onAction }: { session: GameSession; venueId: string; onAction: (action: LocalLifeAction) => void }) {
  const [confirmResign, setConfirmResign] = useState(false);
  const work = session.jobs.work;
  const vacancy = work.vacancies.find((item) => item.venueId === venueId && (item.status === "open" || item.status === "offered"));
  const applications = vacancy
    ? work.applications.filter((item) => item.vacancyId === vacancy.id && item.status !== "withdrawn").sort((left, right) => right.interviewedAt - left.interviewedAt)
    : [];
  const application = applications[0];
  const contract = work.contracts.find((item) => item.venueId === venueId && (item.status === "active" || item.status === "warning"));
  const debtContract = work.contracts.find((item) => item.venueId === venueId && item.unpaidWages > 0);
  const shift = work.shifts.find((item) => item.id === work.activeShiftId && item.venueId === venueId && item.status === "in-progress");
  const tasks = shift ? work.tasks.filter((task) => task.shiftId === shift.id) : [];
  const pending = tasks.filter((task) => task.status === "pending");
  const operation = session.urban.venueOperations.operations.find((item) => item.venueId === venueId);
  const courier = contract?.role === "courier" || vacancy?.role === "courier";
  const minutesUntilShift = contract && !courier ? Math.ceil((contract.nextShiftAt - session.timestamp) / 60_000) : 0;
  const canStart = Boolean(contract && !courier && !shift && operation?.status === "operating" && session.timestamp >= contract.nextShiftAt - 60 * 60_000 && session.timestamp <= contract.nextShiftAt + 3 * 60 * 60_000);
  const canWait = Boolean(contract && !courier && !shift && minutesUntilShift > 0 && minutesUntilShift <= 4 * 60);
  const retryAt = application?.status === "rejected" ? application.interviewedAt + INTERVIEW_RETRY_MS : 0;
  const canRetryInterview = !application || (application.status === "rejected" && session.timestamp >= retryAt);

  if (!vacancy && !contract && !shift && !debtContract) return null;

  return (
    <section className="venue-work-panel">
      <header>
        <div><span>РАБОТОДАТЕЛЬ</span><h3>{contract?.title ?? vacancy?.title ?? debtContract?.title}</h3></div>
        {contract ? <strong className={contract.status === "warning" ? "is-warning" : ""}>{contract.status === "warning" ? `${contract.warningCount}/3 предупреждений` : "контракт активен"}</strong> : vacancy ? <strong>вакансия</strong> : <strong className="is-warning">долг</strong>}
      </header>

      {!contract && vacancy ? (
        <div className="venue-work-offer">
          <div><span>Должность</span><b>{roleLabel(vacancy.role)}</b></div>
          <div><span>Оплата</span><b>{vacancy.role === "courier" ? "За выполненный заказ" : `₵ ${money(vacancy.wagePerHour)}/ч`}</b></div>
          <div><span>Требование</span><b>{skillLabel(vacancy.requiredSkill)} {work.skills[vacancy.requiredSkill]}/{vacancy.minimumSkill}</b></div>
          <div><span>График</span><b>{vacancy.role === "courier" ? "Свободный" : `${vacancy.shiftStartHour.toString().padStart(2, "0")}:00 · ${vacancy.shiftDurationHours} ч.`}</b></div>

          {vacancy.status === "offered" && application?.status === "accepted" ? (
            <>
              <p className="is-accepted">{application.decisionText}</p>
              <button type="button" onClick={() => onAction({ kind: "sign-work-contract", vacancyId: vacancy.id })}>Подписать контракт</button>
            </>
          ) : application?.status === "rejected" && !canRetryInterview ? (
            <p className="is-rejected">{application.decisionText}<small>Повторное собеседование: {clock(retryAt)}</small></p>
          ) : (
            <button type="button" disabled={operation?.status !== "operating"} onClick={() => onAction({ kind: "interview-work", vacancyId: vacancy.id })}>
              {application?.status === "rejected" ? "Пройти собеседование снова · 20 мин." : "Поговорить с управляющим · 20 мин."}
            </button>
          )}
        </div>
      ) : null}

      {contract?.role === "courier" ? (
        <div className="venue-work-contract venue-work-contract--courier">
          <div><span>График</span><b>Свободный</b></div>
          <div><span>Оплата</span><b>За каждый заказ</b></div>
          <div><span>Рейтинг</span><b>{Math.round(session.jobs.courier.rating)}%</b></div>
          <div><span>Выполнено</span><b>{session.jobs.courier.completedDeliveries}</b></div>
          <p>Контракт открывает диспетчерскую. Каждый заказ принимается вручную.</p>
        </div>
      ) : null}

      {contract && contract.role !== "courier" && !shift ? (
        <div className="venue-work-contract">
          <div><span>Следующая смена</span><b>{clock(contract.nextShiftAt)}</b></div>
          <div><span>Оплата</span><b>₵ {money(contract.wagePerHour)}/ч</b></div>
          <div><span>Испытательный срок</span><b>{Math.min(contract.completedShifts, contract.probationShifts)}/{contract.probationShifts}</b></div>
          <div><span>Долг работодателя</span><b className={contract.unpaidWages > 0 ? "is-warning" : ""}>₵ {money(contract.unpaidWages)}</b></div>
          {operation?.status !== "operating" ? <p className="venue-work-warning">Рабочая точка сейчас не работает. Отметка на смену закрыта.</p> : null}
          {canWait ? <button type="button" onClick={() => onAction({ kind: "wait-work-shift", contractId: contract.id })}>Дождаться смены · {minutesUntilShift} мин.</button> : null}
          <button type="button" disabled={!canStart} onClick={() => onAction({ kind: "start-work-shift", contractId: contract.id })}>
            {canStart ? "Отметиться и начать смену" : session.timestamp < contract.nextShiftAt - 60 * 60_000 ? "Смена ещё не началась" : "Окно отметки закрыто"}
          </button>
        </div>
      ) : null}

      {shift ? (
        <div className="venue-work-shift">
          <div className="venue-work-shift__summary"><span>СМЕНА ИДЁТ</span><strong>{shift.completedTaskCount}/{shift.taskIds.length}</strong><small>{shift.lateMinutes ? `опоздание ${shift.lateMinutes} мин.` : "отметка вовремя"}</small></div>
          <div className="venue-work-task-list">
            {tasks.map((task) => <article key={task.id} className={task.status === "completed" ? "is-completed" : ""}><div><strong>{task.label}</strong><span>{task.description}</span><small>{skillLabel(task.skill)} · {task.durationMinutes} мин.{task.status === "completed" ? ` · качество ${task.quality}%` : ""}</small></div><button type="button" disabled={task.status === "completed" || task.id !== pending[0]?.id} onClick={() => onAction({ kind: "perform-work-task", taskId: task.id })}>{task.status === "completed" ? "Готово" : task.id === pending[0]?.id ? "Выполнить" : "По очереди"}</button></article>)}
          </div>
          <button type="button" className="venue-work-finish" disabled={pending.length > 0} onClick={() => onAction({ kind: "finish-work-shift" })}>{pending.length ? `Осталось задач: ${pending.length}` : "Закрыть смену и получить зарплату"}</button>
        </div>
      ) : null}

      {debtContract ? (
        <div className="venue-work-debt">
          <div><span>НЕВЫПЛАЧЕННАЯ ЗАРПЛАТА</span><strong>₵ {money(debtContract.unpaidWages)}</strong><small>В кассе работодателя: ₵ {money(operation?.cash ?? 0)}</small></div>
          <button type="button" disabled={(operation?.cash ?? 0) < 1} onClick={() => onAction({ kind: "collect-work-debt", contractId: debtContract.id })}>Потребовать выплату</button>
        </div>
      ) : null}

      {contract && !shift ? (
        <div className="venue-work-resign">
          {confirmResign ? <><p>Контракт будет закрыт. Служебные действия станут недоступны{contract.role === "courier" && session.jobs.courier.activeOrderId ? ", активная доставка будет сорвана" : ""}.</p><button type="button" className="is-danger" onClick={() => onAction({ kind: "resign-work-contract", contractId: contract.id })}>Подтвердить увольнение</button><button type="button" onClick={() => setConfirmResign(false)}>Отмена</button></> : <button type="button" onClick={() => setConfirmResign(true)}>Расторгнуть контракт</button>}
        </div>
      ) : null}
    </section>
  );
}
