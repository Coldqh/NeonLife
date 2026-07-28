import { useEffect, useMemo, useRef, useState } from "react";
import type { GameSession } from "../../world/state/types";
import { localMovementCurrentStreet } from "../../simulation/localMovement/localMovementSystem";
import { LocalSectorMap, type LocalMapSelection } from "../map/LocalSectorMap";

export function LocalMovementScreen({
  session,
  onAdvance,
  onSkip,
  onCancel,
  onFinish
}: {
  session: GameSession;
  onAdvance: (minutes: number) => void;
  onSkip: () => void;
  onCancel: () => void;
  onFinish: () => void;
}) {
  const route = session.localMovement;
  const [playing, setPlaying] = useState(false);
  const advanceRef = useRef(onAdvance);
  const sector = route
    ? session.metropolitan.sectors.find((item) => item.id === session.localScene.playerPosition.sectorId)
      ?? session.metropolitan.sectors.find((item) => item.id === route.target.sectorId)
      ?? session.metropolitan.sectors[0]
    : session.metropolitan.sectors[0];

  useEffect(() => {
    advanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    if (!playing || !route || route.status !== "walking") return;
    const timer = window.setInterval(() => advanceRef.current(1), 650);
    return () => window.clearInterval(timer);
  }, [playing, route?.status]);

  useEffect(() => {
    if (route?.status === "arrived") setPlaying(false);
  }, [route?.status]);

  const nextStreets = useMemo(() => {
    if (!route) return [];
    const names: string[] = [];
    for (const point of route.points.slice(route.currentLegIndex + 1)) {
      if (!point.streetName || names[names.length - 1] === point.streetName) continue;
      names.push(point.streetName);
      if (names.length === 4) break;
    }
    return names;
  }, [route]);

  if (!route || !sector) return null;
  const progress = route.totalDistanceM > 0 ? Math.min(100, route.travelledM / route.totalDistanceM * 100) : 100;
  const selected: LocalMapSelection = { kind: "point", xM: route.target.xM, yM: route.target.yM };

  return (
    <section className="local-movement-overlay" role="dialog" aria-modal="true" aria-label="Пеший маршрут">
      <header className="local-movement-header">
        <div>
          <span>{route.status === "arrived" ? "Маршрут завершён" : "Пешком"}</span>
          <h1>{route.target.label}</h1>
          <p>{route.status === "arrived" ? "Ты находишься у выбранной точки." : `${localMovementCurrentStreet(route)} · ${Math.ceil(route.remainingDistanceM)} м осталось`}</p>
        </div>
        {route.status === "walking" ? <button type="button" onClick={onCancel}>Остановиться</button> : <button type="button" onClick={onFinish}>Закрыть</button>}
      </header>

      <div className="local-movement-map">
        <LocalSectorMap session={session} sector={sector} selected={selected} route={route} />
        <div className="local-movement-progress" aria-label={`Пройдено ${Math.round(progress)} процентов`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>

      <footer className="local-movement-panel">
        <div className="local-movement-stats">
          <div><span>Пройдено</span><strong>{Math.round(route.travelledM)} м</strong></div>
          <div><span>Осталось</span><strong>{Math.round(route.remainingDistanceM)} м</strong></div>
          <div><span>Время</span><strong>{route.estimatedMinutes} мин.</strong></div>
        </div>
        {nextStreets.length ? <div className="local-movement-streets"><span>Дальше</span><p>{nextStreets.join("  ·  ")}</p></div> : null}
        {route.status === "walking" ? (
          <div className="local-movement-actions">
            <button type="button" className={playing ? "is-active" : ""} onClick={() => setPlaying((value) => !value)}>{playing ? "Пауза" : "Идти"}</button>
            <button type="button" onClick={() => onAdvance(1)}>1 мин.</button>
            <button type="button" onClick={() => onAdvance(5)}>5 мин.</button>
            <button type="button" className="primary-button" onClick={onSkip}>До конца</button>
          </div>
        ) : <button type="button" className="primary-button local-movement-finish" onClick={onFinish}>Вернуться к карте</button>}
      </footer>
    </section>
  );
}
