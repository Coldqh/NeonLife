import { roleLabel, skillLabel } from "../../gameplay/jobs/work/workSystem";
import type { GameSession } from "../../world/state/types";
import type { LocalLifeAction } from "../actions/localLifeActions";
import { formatGameMonthDayTime } from "../../core/time/gameTime";

const clock = formatGameMonthDayTime;

export function VenueWorkPanel({ session, venueId, onAction }: { session: GameSession; venueId: string; onAction: (action: LocalLifeAction) => void }) {
  const work = session.jobs.work;
  const vacancy = work.vacancies.find((item) => item.venueId === venueId && (item.status === "open" || item.status === "offered"));
  const application = vacancy ? work.applications.find((item) => item.vacancyId === vacancy.id && item.status !== "withdrawn") : undefined;
  const contract = work.contracts.find((item) => item.venueId === venueId && (item.status === "active" || item.status === "warning"));
  const shift = work.shifts.find((item) => item.id === work.activeShiftId && item.venueId === venueId && item.status === "in-progress");
  const tasks = shift ? work.tasks.filter((task) => task.shiftId === shift.id) : [];
  const pending = tasks.filter((task) => task.status === "pending");
  const minutesUntilShift = contract ? Math.ceil((contract.nextShiftAt - session.timestamp) / 60_000) : 0;
  const canStart = Boolean(contract && !shift && session.timestamp >= contract.nextShiftAt - 60 * 60_000 && session.timestamp <= contract.nextShiftAt + 3 * 60 * 60_000);
  const canWait = Boolean(contract && !shift && minutesUntilShift > 0 && minutesUntilShift <= 18 * 60);

  if (!vacancy && !contract && !shift) return null;

  return (
    <section className="venue-work-panel">
      <header><div><span>РАБОТОДАТЕЛЬ</span><h3>{contract ? contract.title : vacancy?.title}</h3></div>{contract ? <strong className={contract.status === "warning" ? "is-warning" : ""}>{contract.status === "warning" ? `${contract.warningCount}/3 предупреждений` : "контракт активен"}</strong> : <strong>вакансия</strong>}</header>

      {!contract && vacancy ? (
        <div className="venue-work-offer">
          <div><span>Должность</span><b>{roleLabel(vacancy.role)}</b></div>
          <div><span>Ставка</span><b>₵ {vacancy.wagePerHour}/ч</b></div>
          <div><span>Требование</span><b>{skillLabel(vacancy.requiredSkill)} {work.skills[vacancy.requiredSkill]}/{vacancy.minimumSkill}</b></div>
          <div><span>Смена</span><b>{vacancy.shiftStartHour.toString().padStart(2, "0")}:00 · {vacancy.shiftDurationHours} ч.</b></div>
          {!application ? <button type="button" onClick={() => onAction({ kind: "interview-work", vacancyId: vacancy.id })}>Поговорить с управляющим · 20 мин.</button> : application.status === "accepted" && vacancy.status === "offered" ? <><p className="is-accepted">{application.decisionText}</p><button type="button" onClick={() => onAction({ kind: "sign-work-contract", vacancyId: vacancy.id })}>Подписать контракт</button></> : <p className="is-rejected">{application.decisionText}</p>}
        </div>
      ) : null}

      {contract && !shift ? (
        <div className="venue-work-contract">
          <div><span>Следующая смена</span><b>{clock(contract.nextShiftAt)}</b></div>
          <div><span>Оплата</span><b>₵ {contract.wagePerHour}/ч</b></div>
          <div><span>Испытательный срок</span><b>{Math.min(contract.completedShifts, contract.probationShifts)}/{contract.probationShifts}</b></div>
          <div><span>Долг работодателя</span><b>₵ {contract.unpaidWages}</b></div>
          {canWait ? <button type="button" onClick={() => onAction({ kind: "wait-work-shift", contractId: contract.id })}>Дождаться смены · {minutesUntilShift} мин.</button> : null}
          <button type="button" disabled={!canStart} onClick={() => onAction({ kind: "start-work-shift", contractId: contract.id })}>{canStart ? "Отметиться и начать смену" : session.timestamp < contract.nextShiftAt - 60 * 60_000 ? "Смена ещё не началась" : "Окно отметки закрыто"}</button>
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
    </section>
  );
}
