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

export function WorkScreen({ session, onOpenVenue }: { session: GameSession; onOpenVenue: (venueId: string) => void }) {
  const [role, setRole] = useState<"all" | PlayerWorkRole>("all");
  const work = session.jobs.work;
  const venueById = useMemo(() => new Map(session.urban.venueOperations.registry.map((entry) => [entry.venue.id, entry.venue] as const)), [session.urban.venueOperations.registry]);
  const buildingIds = useMemo(() => new Set(session.urban.buildings.map((building) => building.id)), [session.urban.buildings]);
  const activeContract = work.contracts.find((contract) => contract.id === work.activeContractId);
  const activeShift = work.shifts.find((shift) => shift.id === work.activeShiftId);
  const activeTasks = activeShift ? work.tasks.filter((task) => task.shiftId === activeShift.id) : [];
  const vacancies = work.vacancies
    .filter((vacancy) => vacancy.status === "open" || vacancy.status === "offered")
    .filter((vacancy) => role === "all" || vacancy.role === role)
    .sort((left, right) => Number(right.status === "offered") - Number(left.status === "offered") || left.minimumSkill - right.minimumSkill || right.wagePerHour - left.wagePerHour)
    .slice(0, 30);
  const courierContract = activeContract?.role === "courier";

  return (
    <section className="screen work-screen">
      <header className="screen-heading work-heading">
        <div><span>ГОРОДСКАЯ ЗАНЯТОСТЬ</span><h2>Работа</h2><p>Любая профессия начинается с вакансии, собеседования и подписанного контракта.</p></div>
        <div className="work-heading__income"><span>ЗАРАБОТАНО</span><strong>₵ {work.totalEarned + session.jobs.courier.totalEarnings}</strong><small>{work.totalUnpaid ? `долг работодателей ₵ ${work.totalUnpaid}` : "выплаты чистые"}</small></div>
      </header>

      <section className="work-skills" aria-label="Навыки работы">
        {Object.entries(work.skills).map(([skill, value]) => <article key={skill}><span>{skillLabel(skill as keyof typeof work.skills)}</span><strong>{value}</strong><i><b style={{ width: `${value}%` }} /></i></article>)}
      </section>

      {activeContract ? (
        <section className="work-contract-card">
          <header><div><span>АКТИВНЫЙ КОНТРАКТ</span><h2>{activeContract.title}</h2><p>{venueById.get(activeContract.venueId)?.name ?? activeContract.venueId}</p></div><strong className={activeContract.status === "warning" ? "is-warning" : ""}>{activeContract.status === "warning" ? `ПРЕДУПРЕЖДЕНИЯ ${activeContract.warningCount}/3` : "АКТИВЕН"}</strong></header>
          <div className="work-contract-grid">
            <div><span>Оплата</span><b>{courierContract ? "За заказ" : `₵ ${activeContract.wagePerHour}/ч`}</b></div>
            <div><span>График</span><b>{courierContract ? "Свободный" : dateTime(activeContract.nextShiftAt)}</b></div>
            <div><span>{courierContract ? "Доставок" : "Смен закрыто"}</span><b>{courierContract ? session.jobs.courier.completedDeliveries : activeContract.completedShifts}</b></div>
            <div><span>{courierContract ? "Рейтинг" : "Ранг"}</span><b>{courierContract ? `${Math.round(session.jobs.courier.rating)}%` : activeContract.rank}</b></div>
          </div>
          {courierContract ? <p className="work-contract-note">Заказы не выдаются сами. Они появляются только в диспетчерской MESHLINE и принимаются вручную.</p> : null}
          {activeShift ? <div className="work-shift-progress"><span>Смена идёт · {activeShift.completedTaskCount}/{activeShift.taskIds.length} задач</span><i><b style={{ width: `${activeShift.taskIds.length ? activeShift.completedTaskCount / activeShift.taskIds.length * 100 : 0}%` }} /></i><small>{activeTasks.find((task) => task.status === "pending")?.label ?? "Все задачи выполнены — закрой смену на рабочем месте"}</small></div> : null}
          <button type="button" className="work-primary" onClick={() => onOpenVenue(activeContract.venueId)}><Icon name="pin" size={18} /> Открыть рабочее место на карте</button>
        </section>
      ) : (
        <section className="work-empty-contract"><Icon name="work" size={28} /><div><strong>Контракта нет</strong><span>Выбери вакансию, приди в заведение и поговори с управляющим.</span></div></section>
      )}

      <section className="work-board">
        <header><div><span>ВАКАНСИИ</span><h2>Доступные профессии</h2></div><nav>{ROLE_FILTERS.map((item) => <button type="button" key={item.value} className={role === item.value ? "is-active" : ""} onClick={() => setRole(item.value)}>{item.label}</button>)}</nav></header>
        <div className="work-vacancy-list">
          {vacancies.map((vacancy) => {
            const venue = venueById.get(vacancy.venueId);
            const skill = work.skills[vacancy.requiredSkill];
            const materialized = buildingIds.has(vacancy.buildingId);
            const courier = vacancy.role === "courier";
            return (
              <article key={vacancy.id} className={vacancy.status === "offered" ? "is-offered" : ""}>
                <div className="work-vacancy-icon"><Icon name={courier ? "pin" : vacancy.role === "mechanic" ? "settings" : vacancy.role === "clinic-aide" ? "health" : "work"} size={22} /></div>
                <div className="work-vacancy-main"><span>{roleLabel(vacancy.role)} · {venue?.name ?? "Заведение"}</span><strong>{vacancy.title}</strong><small>{venue?.unitNumber ?? vacancy.unitId} · {courier ? "свободный график" : `начало ${vacancy.shiftStartHour.toString().padStart(2, "0")}:00 · ${vacancy.shiftDurationHours} ч.`}</small><em className={skill >= vacancy.minimumSkill ? "is-ready" : ""}>{skillLabel(vacancy.requiredSkill)} {skill}/{vacancy.minimumSkill}</em></div>
                <div className="work-vacancy-pay"><strong>{courier ? "₵ за заказ" : `₵ ${vacancy.wagePerHour}/ч`}</strong><span>{vacancy.status === "offered" ? "контракт предложен" : materialized ? "собеседование на месте" : "сектор не загружен"}</span><button type="button" disabled={!materialized} onClick={() => onOpenVenue(vacancy.venueId)}>На карте</button></div>
              </article>
            );
          })}
          {!vacancies.length ? <p className="work-board-empty">Сейчас подходящих вакансий нет.</p> : null}
        </div>
      </section>
    </section>
  );
}
