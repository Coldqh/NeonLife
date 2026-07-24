import type { GameSession } from "../../world/state/types";
import { formatGameDate, formatGameTime } from "../../core/time/gameTime";
import { Icon } from "../../ui/components/Icons";
import { currentLocation, districtName } from "../shared/presentation";

export function GameHeader({ session, onSettings }: { session: GameSession; onSettings: () => void }) {
  const location = currentLocation(session);
  return (
    <header className="game-header">
      <div className="game-header__brand">
        <strong>NEON <em>LIFE</em></strong>
        <span>⌖ {districtName(session)} · {location?.name ?? session.player.sector}</span>
      </div>
      <div className="game-header__facts" aria-label="Состояние города и игрока">
        <span><i>☁</i>{session.world.city.temperatureC}°C</span>
        <span>{formatGameDate(session.timestamp)} · <em>{formatGameTime(session.timestamp)}</em></span>
        <strong><Icon name="wallet" size={17} />₵ {session.player.balance.toLocaleString("ru-RU")}</strong>
        <button type="button" onClick={onSettings} aria-label="Открыть настройки"><Icon name="settings" size={19} /></button>
      </div>
    </header>
  );
}
