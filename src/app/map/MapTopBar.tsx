import { formatGameTime } from "../../core/time/gameTime";
import type { GameSession } from "../../world/state/types";
import type { GlobalLayerId, LocalLayerId, MapMode } from "./mapUi";
import { GLOBAL_LAYERS, LOCAL_LAYERS } from "./mapUi";

export function MapTopBar({
  session,
  mode,
  globalLayer,
  localLayer,
  districtName,
  sectorCode,
  onMode,
  onGlobalLayer,
  onLocalLayer,
  onSettings,
  onPlayer
}: {
  session: GameSession;
  mode: MapMode;
  globalLayer: GlobalLayerId;
  localLayer: LocalLayerId;
  districtName: string;
  sectorCode: string;
  onMode: (mode: MapMode) => void;
  onGlobalLayer: (layer: GlobalLayerId) => void;
  onLocalLayer: (layer: LocalLayerId) => void;
  onSettings: () => void;
  onPlayer: () => void;
}) {
  const layers = mode === "global" ? GLOBAL_LAYERS : LOCAL_LAYERS;
  return (
    <>
      <header className="map-hud" data-no-swipe>
        <div className="map-hud__identity">
          <strong>КАРТА ГОРОДА</strong>
          <span>{mode === "global" ? "УРОВЕНЬ: ГОРОД" : `${districtName} · ${sectorCode}`}</span>
        </div>
        <div className="map-hud__tabs" role="tablist" aria-label="Уровень карты">
          <button type="button" role="tab" aria-selected={mode === "global"} className={mode === "global" ? "is-active" : ""} onClick={() => onMode("global")}><i>▦</i><span>Город</span></button>
          <button type="button" role="tab" aria-selected={mode === "local"} className={mode === "local" ? "is-active" : ""} onClick={() => onMode("local")}><i>⌖</i><span>Сектор</span></button>
        </div>
        <div className="map-hud__status">
          <span>{formatGameTime(session.timestamp)}</span>
          <strong>₵ {session.player.balance.toLocaleString("ru-RU")}</strong>
          <button type="button" aria-label="Показать игрока" onClick={onPlayer}>◎</button>
          <button type="button" aria-label="Настройки карты" onClick={onSettings}>☰</button>
        </div>
      </header>

      <div className="map-layer-strip" data-no-swipe>
        {layers.map((layer) => (
          <button
            type="button"
            key={layer.id}
            className={(mode === "global" ? globalLayer === layer.id : localLayer === layer.id) ? "is-active" : ""}
            onClick={() => mode === "global" ? onGlobalLayer(layer.id as GlobalLayerId) : onLocalLayer(layer.id as LocalLayerId)}
          >
            <i>{layer.icon}</i><span>{layer.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
