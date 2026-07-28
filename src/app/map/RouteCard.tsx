import type { LocationState } from "../../world/state/types";
import type { TravelOption } from "../../gameplay/travel/travelSystem";
import type { LocalMovementState, LocalMovementTargetState } from "../../simulation/localMovement/types";

function travelModeLabel(mode: TravelOption["mode"]): string {
  if (mode === "walk") return "Пешком";
  if (mode === "bus") return "Автобус";
  if (mode === "metro") return "Метро";
  return "Такси";
}

export function RouteCard({
  target,
  preview,
  selectedLocation,
  currentLocationId,
  travelOption,
  balance,
  onWalk,
  onTravel
}: {
  target: LocalMovementTargetState;
  preview: LocalMovementState | null;
  selectedLocation: LocationState | null;
  currentLocationId: string;
  travelOption?: TravelOption;
  balance: number;
  onWalk: () => void;
  onTravel: () => void;
}) {
  const alreadyHere = selectedLocation?.id === currentLocationId;

  return (
    <section className="route-card">
      <header><span>Маршрут</span><strong>{target.label}</strong></header>
      {preview ? (
        <>
          <div className="route-card__line"><i>●</i><span /><b>Пешком по улицам</b><span /><i>◆</i></div>
          <dl>
            <div><dt>Время</dt><dd>{preview.estimatedMinutes} мин.</dd></div>
            <div><dt>Расстояние</dt><dd>{Math.round(preview.totalDistanceM)} м</dd></div>
            <div><dt>Улицы</dt><dd>{preview.streetNames.length}</dd></div>
          </dl>
          {preview.streetNames.length ? <p className="route-card__streets">{preview.streetNames.slice(0, 4).join("  ·  ")}</p> : null}
          <button type="button" className="primary-button" onClick={onWalk}>Начать пеший маршрут</button>
        </>
      ) : selectedLocation && !alreadyHere && travelOption ? (
        <>
          <div className="route-card__line"><i>●</i><span /><b>{travelModeLabel(travelOption.mode)}</b><span /><i>◆</i></div>
          <dl>
            <div><dt>Время</dt><dd>{travelOption.durationMinutes} мин.</dd></div>
            <div><dt>Стоимость</dt><dd>{travelOption.cost ? `₵ ${travelOption.cost}` : "Бесплатно"}</dd></div>
            <div><dt>Расстояние</dt><dd>{travelOption.distanceKm} км</dd></div>
          </dl>
          <button type="button" className="primary-button" disabled={balance < travelOption.cost} onClick={onTravel}>{balance < travelOption.cost ? "Недостаточно средств" : "Выбрать городской маршрут"}</button>
        </>
      ) : <p>{alreadyHere ? "Ты уже находишься здесь." : "Пешеходный маршрут к этой точке сейчас недоступен."}</p>}
    </section>
  );
}
