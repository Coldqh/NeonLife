import type { GameSession } from "../../world/state/types";
import type { TransitPhoneActivity } from "../../simulation/transit/types";
import { getTransitBoardingVehicle, getTransitRoute, getTransitStop, getTransitVehicle } from "../../simulation/transit/transitOperationsSystem";
import { personPortrait } from "../shared/presentation";

const phoneActions: Array<{ id: TransitPhoneActivity; label: string; detail: string }> = [
  { id: "messages", label: "Сообщения", detail: "Разобрать переписку до следующей остановки" },
  { id: "job-board", label: "Работа", detail: "Проверить заказы и вакансии" },
  { id: "study", label: "Учёба", detail: "Потратить перегон на материалы" },
  { id: "city-feed", label: "Город", detail: "Посмотреть ленту и маршрут" }
];

export function TransitJourneyScreen({
  session,
  onBoard,
  onTakeSeat,
  onStand,
  onYield,
  onAdvance,
  onInteract,
  onPhone,
  onAlight,
  onSkip
}: {
  session: GameSession;
  onBoard: () => void;
  onTakeSeat: (seatId: string) => void;
  onStand: () => void;
  onYield: (passengerId: string) => void;
  onAdvance: () => void;
  onInteract: (passengerId: string) => void;
  onPhone: (activity: TransitPhoneActivity) => void;
  onAlight: () => void;
  onSkip: () => void;
}) {
  const journey = session.transit.player.journey;
  if (!journey) return null;
  const segment = journey.segments[journey.activeSegmentIndex];
  const route = getTransitRoute(session.transit, segment?.routeId);
  const vehicle = getTransitVehicle(session.transit, journey.vehicleId) ?? getTransitBoardingVehicle(session.transit);
  const currentStop = getTransitStop(session.transit, journey.currentStopId);
  const nextStop = getTransitStop(session.transit, journey.nextStopId);
  const destination = session.world.locations.find((location) => location.id === journey.destinationLocationId);
  const cabin = session.transit.cabin;
  const progress = segment ? Math.round(journey.currentStopOffset / Math.max(1, segment.stopIds.length - 1) * 100) : 0;

  return (
    <div className="transit-scene" role="dialog" aria-modal="true" aria-label="Поездка в общественном транспорте">
      <header className="transit-scene__header">
        <div><span>{route?.mode === "metro" ? "Метро" : "Автобус"}</span><h1>{route?.code ?? "Маршрут"}</h1><p>{route?.name ?? "Городской транспорт"}</p></div>
        <div><span>Назначение</span><strong>{destination?.name ?? "Город"}</strong><small>{journey.activeSegmentIndex + 1} / {journey.segments.length} сегмент</small></div>
      </header>

      <section className="transit-progress">
        <div className="transit-progress__line"><i style={{ width: `${progress}%` }} /></div>
        <div><span><small>Сейчас</small><strong>{currentStop?.name ?? "Остановка"}</strong></span><span><small>Дальше</small><strong>{nextStop?.name ?? (journey.phase === "arrived" ? "Прибытие" : "Маршрут")}</strong></span></div>
        <ol>
          {segment?.stopIds.map((stopId, index) => {
            const stop = getTransitStop(session.transit, stopId);
            return <li key={stopId} className={index < journey.currentStopOffset ? "is-passed" : index === journey.currentStopOffset ? "is-current" : ""}><i /><span>{stop?.name ?? stopId}</span></li>;
          })}
        </ol>
      </section>

      {journey.phase === "waiting" ? (
        <section className="transit-waiting">
          <article><span>Подходит транспорт</span><strong>{vehicle ? `${vehicle.fleetNumber} · ${vehicle.crew.name}` : "Рейс ожидается"}</strong><p>{route?.status ?? "operational"} · задержка {route?.averageDelayMinutes ?? 0} мин. · заполнение {route?.crowdingPercent ?? 0}%</p></article>
          <div><button type="button" className="primary-button" disabled={!vehicle} onClick={onBoard}>Сесть в транспорт</button><button type="button" className="secondary-button" onClick={onSkip}>Промотать всю поездку</button></div>
        </section>
      ) : null}

      {journey.phase === "onboard" && cabin ? (
        <div className="transit-cabin-layout">
          <section className="transit-cabin">
            <header><div><span>Салон</span><h2>{vehicle?.fleetNumber ?? "Транспорт"}</h2></div><strong>{cabin.totalPassengerCount} пассажиров · {cabin.crowdingPercent}%</strong></header>
            <div className="seat-grid" aria-label="Места в салоне">
              {cabin.seats.map((seat) => (
                <button
                  type="button"
                  key={seat.id}
                  className={`${seat.kind === "priority" ? "is-priority" : ""} ${seat.occupiedBy === "player" ? "is-player" : ""} ${seat.occupiedBy && seat.occupiedBy !== "player" ? "is-occupied" : ""}`}
                  disabled={seat.occupiedBy !== null}
                  onClick={() => onTakeSeat(seat.id)}
                  aria-label={`Место ${seat.index + 1}`}
                >{seat.occupiedBy === "player" ? "Ты" : seat.occupiedBy ? "●" : seat.index + 1}</button>
              ))}
            </div>
            <div className="cabin-actions">
              {journey.seatId ? <button type="button" onClick={onStand}>Встать</button> : <span>Ты стоишь</span>}
              <button type="button" className="primary-button" onClick={onAdvance}>До следующей остановки</button>
              <button type="button" onClick={onSkip}>Промотать поездку</button>
            </div>
          </section>

          <section className="transit-passengers">
            <header><span>Пассажиры рядом</span><strong>{cabin.lastInteraction ?? "Можно заговорить"}</strong></header>
            <div>
              {cabin.passengers.slice(0, 10).map((passenger) => (
                <article key={passenger.id}>
                  <img src={personPortrait(passenger.id)} alt={`Портрет ${passenger.name}`} />
                  <span><strong>{passenger.name}</strong><small>{passenger.roleLabel} · {passenger.mood}</small><em>{passenger.standing ? "Стоит" : "Сидит"}{passenger.priorityNeed !== "none" ? ` · ${passenger.priorityNeed}` : ""}</em></span>
                  <div><button type="button" onClick={() => onInteract(passenger.id)}>Поговорить</button>{journey.seatId && passenger.standing && passenger.priorityNeed !== "none" ? <button type="button" onClick={() => onYield(passenger.id)}>Уступить</button> : null}</div>
                </article>
              ))}
            </div>
          </section>

          <section className="transit-phone">
            <header><span>Телефон</span><strong>Действие займёт перегон до следующей остановки</strong></header>
            <div>{phoneActions.map((action) => <button type="button" key={action.id} onClick={() => onPhone(action.id)}><strong>{action.label}</strong><span>{action.detail}</span></button>)}</div>
          </section>
        </div>
      ) : null}

      {journey.phase === "arrived" ? (
        <section className="transit-arrived"><span>Маршрут завершён</span><h2>{destination?.name ?? "Точка назначения"}</h2><p>{journey.interactions} разговоров · {journey.phoneMinutes} мин. в телефоне · ₵ {journey.farePaid}</p><button type="button" className="primary-button" onClick={onAlight}>Выйти</button></section>
      ) : null}
    </div>
  );
}
