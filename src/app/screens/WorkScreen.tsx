import { useMemo, useState } from "react";
import { Icon } from "../../ui/components/Icons";
import { roleLabel, skillLabel } from "../../gameplay/jobs/work/workSystem";
import type { PlayerWorkRole } from "../../gameplay/jobs/work/types";
import type { GameSession } from "../../world/state/types";
import { formatGameMonthDayTime } from "../../core/time/gameTime";

const ROLE_FILTERS: Array<{ value: "all" | PlayerWorkRole; label: string }> = [
  { value: "all", label: "Все" },
  { value: "courier", label: "Курьер" },
  { value: "cashier", label: "Касса" },
  { value: "cafe-crew", label: "Кафе" },
  { value: "clinic-aide", label: "Клиника" },
  { value: "mechanic", label: "Ремонт" }
];

const dateTime = formatGameMonthDayTime;
const INTERVIEW_RETRY_MS = 3 * 24 * 60 * 60_000;

function money(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

function contractStatus(status: string): string {
  if (status === "dismissed") return "Уволен";
  if (status === "resigned") return "Ушёл сам";
  if (status === "warning") return "Предупреждение";
  return "Активен";
}

export function WorkScreen({ session, onOpenVenue }: { session: GameSession; onOpenVenue: (venueId: string) => void }) {
  const [role, setRole] = useState<"all" | PlayerWorkRole>("all");
  const work = session.jobs.work;
  const venueById = useMemo(() => new Map(session.urban.venueOperations.registry.map((entry) => [entry.venue.id, entry.venue] as const)), [session.urban.venueOperations.registry]);
  const operationById = useMemo(() => new Map(session.urban.venueOperations.operations.map((operation) => [operation.venueId, operation] as const)), [session.urban.venueOperations.operations]);
  const buildingIds = useMemo(() => new Set(session.urban.buildings.map((building) => building.id)), [session.urban.buildings]);
  const activeContract = work.contracts.find((contract) => contract.id === work.activeContractId && (contract.status === "active" || contract.status === "warning"));
  const activeShift = work.shifts.find((shift) => shift.id === work.activeShiftId);
  const activeTasks = activeShift ? work.tasks.filter((task) => task.shiftId === activeShift.id) : [];
  const latestApplicationByVacancy = useMemo(() => {
    const result = new Map<string, typeof work.applications[number]>();
    for (const application of work.applications) {
      if (application.status === "withdrawn") continue;
      const current = result.get(application.vacancyId);
      if (!current || current.interviewedAt < application.interviewedAt) result.set(application.vacancyId, application);
    }
    return result;
  }, [work.applications]);
  const vacancies = [...work.vacancies]
    .filter((vacancy) => vacancy.status === "open" || vacancy.status === "offered")
    .filter((vacancy) => role === "all" || vacancy.role === role)
    .sort((left, right) => Number(right.status === "offered") - Number(left.status === "offered") || left.minimumSkill - right.minimumSkill || right.wagePerHour - left.wagePerHour)
    .slice(0, 30);
  const courierContract = activeContract?.role === "courier";
  const employerOperation = activeContract ? operationById.get(activeContract.venueId) : undefined;
  const contractHistory = [...work.contracts].filter((contract) => contract.status === "dismissed" || contract.status === "resigned").sort((left, right) => (right.dismissedAt ?? right.resignedAt ?? right.startedAt) - (left.dismissedAt ?? left.resignedAt ?? left.startedAt)).slice(0, 4);

  return (
    <section className="screen work-screen">
      <header className="screen-heading work-heading">
        <div><span>ГОРОДСКАЯ ЗАНЯТОСТЬ</span><h1>Работа</h1><p>Вакансия, собеседование, контракт и смена происходят в реальном заведении.</p></div>
        <div className="work-heading__income"><span>ЗАРАБОТАНО</span><strong>₵ {money(work.totalEarned + session.jobs.courier.totalEarnings)}</strong><small>{work.totalUnpaid ? `работодатели должны ₵ ${money(work.totalUnpaid)}` : "задолженности нет"}</small></div>
      </header>

      <section className="work-skills" aria-label="Навыки работы">
        {Object.entries(work.skills).map(([skill, value]) => <article key={skill}><span>{skillLabel(skill as keyof typeof work.skills)}</span><strong>{value}</strong><i><b style={{ width: `${value}%` }} /></i></article>)}
      </section>

      {activeContract ? (
        <section className="work-contract-card">
          <header><div><span>АКТИВНЫЙ КОНТРАКТ</span><h2>{activeContract.title}</h2><p>{venueById.get(activeContract.venueId)?.name ?? "Рабочая точка"}</p></div><strong className={activeContract.status === "warning" ? "is-warning" : ""}>{activeContract.status === "warning" ? `ПРЕДУПРЕЖДЕНИЯ ${activeContract.warningCount}/3` : "АКТИВЕН"}</strong></header>
          <div className="work-contract-grid">
            <div><span>Оплата</span><b>{courierContract ? "За заказ" : `₵ ${money(activeContract.wagePerHour)}/ч`}</b></div>
            <div><span>График</span><b>{courierContract ? "Свободный" : dateTime(activeContract.nextShiftAt)}</b></div>
            <div><span>{courierContract ? "Доставок" : "Смен закрыто"}</span><b>{courierContract ? session.jobs.courier.completedDeliveries : activeContract.completedShifts}</b></div>
            <div><span>Касса работодателя</span><b className={(employerOperation?.cash ?? 0) < activeContract.wagePerHour * Math.max(1, activeContract.shiftDurationHours) ? "is-warning" : ""}>₵ {money(employerOperation?.cash ?? 0)}</b></div>
          </div>
          {activeContract.unpaidWages > 0 ? <p className="work-contract-alert">Невыплаченная зарплата: ₵ {money(activeContract.unpaidWages)}. Потребовать её можно только на рабочем месте.</p> : null}
          {courierContract ? <p className="work-contract-note">Заказы выдаёт только диспетчерская MESHLINE. Активный маршрут появляется после ручного принятия.</p> : null}
          {activeShift ? <div className="work-shift-progress"><span>Смена идёт · {activeShift.completedTaskCount}/{activeShift.taskIds.length} задач</span><i><b style={{ width: `${activeShift.taskIds.length ? activeShift.completedTaskCount / activeShift.taskIds.length * 100 : 0}%` }} /></i><small>{activeTasks.find((task) => task.status === "pending")?.label ?? "Все задачи выполнены — закрой смену на рабочем месте"}</small></div> : null}
          <button type="button" className="work-primary" onClick={() => onOpenVenue(activeContract.venueId)}><Icon name="pin" size={18} /> Открыть рабочее место</button>
        </section>
      ) : (
        <section className="work-empty-contract"><Icon name="work" size={28} /><div><strong>Постоянной работы нет</strong><span>Выбери вакансию, приди в заведение и пройди собеседование.</span></div></section>
      )}

      <section className="work-board">
        <header><div><span>ВАКАНСИИ</span><h2>Реальная потребность бизнеса</h2></div><nav>{ROLE_FILTERS.map((item) => <button type="button" key={item.value} className={role === item.value ? "is-active" : ""} onClick={() => setRole(item.value)}>{item.label}</button>)}</nav></header>
        <div className="work-vacancy-list">
          {vacancies.map((vacancy) => {
            const venue = venueById.get(vacancy.venueId);
            const operation = operationById.get(vacancy.venueId);
            const skill = work.skills[vacancy.requiredSkill];
            const materialized = buildingIds.has(vacancy.buildingId);
            const courier = vacancy.role === "courier";
            const application = latestApplicationByVacancy.get(vacancy.id);
            const retryAt = application?.status === "rejected" ? application.interviewedAt + INTERVIEW_RETRY_MS : 0;
            const stateLabel = vacancy.status === "offered"
              ? "контракт ждёт подписи"
              : application?.status === "rejected" && session.timestamp < retryAt
                ? `повторно ${dateTime(retryAt)}`
                : operation?.status !== "operating"
                  ? "работодатель закрыт"
                  : materialized ? "собеседование на месте" : "сектор не загружен";
            return (
              <article key={vacancy.id} className={vacancy.status === "offered" ? "is-offered" : ""}>
                <div className="work-vacancy-icon"><Icon name={courier ? "pin" : vacancy.role === "mechanic" ? "settings" : vacancy.role === "clinic-aide" ? "health" : "work"} size={22} /></div>
                <div className="work-vacancy-main"><span>{roleLabel(vacancy.role)} · {venue?.name ?? "Заведение"}</span><strong>{vacancy.title}</strong><small>{venue ? `Этаж ${venue.floor} · помещение ${venue.unitNumber}` : "Рабочая точка"} · {courier ? "свободный график" : `${vacancy.shiftStartHour.toString().padStart(2, "0")}:00 · ${vacancy.shiftDurationHours} ч.`}</small><em className={skill >= vacancy.minimumSkill ? "is-ready" : ""}>{skillLabel(vacancy.requiredSkill)} {skill}/{vacancy.minimumSkill}</em></div>
                <div className="work-vacancy-pay"><strong>{courier ? "₵ за заказ" : `₵ ${money(vacancy.wagePerHour)}/ч`}</strong><span>{stateLabel}</span><small>персонал {operation?.staffPresent ?? 0} · очередь {operation?.queue.waitingCount ?? 0}</small><button type="button" disabled={!materialized} onClick={() => onOpenVenue(vacancy.venueId)}>На карте</button></div>
              </article>
            );
          })}
          {!vacancies.length ? <p className="work-board-empty">Подходящих вакансий сейчас нет. Они появляются, когда бизнесу реально не хватает людей.</p> : null}
        </div>
      </section>

      {contractHistory.length ? <section className="work-history"><header><span>ИСТОРИЯ</span><h2>Предыдущие контракты</h2></header>{contractHistory.map((contract) => <article key={contract.id}><div><strong>{contract.title}</strong><span>{venueById.get(contract.venueId)?.name ?? "Работодатель"} · {contract.completedShifts} смен</span></div><em className={contract.status === "dismissed" ? "is-danger" : ""}>{contractStatus(contract.status)}</em></article>)}</section> : null}
    </section>
  );
}
