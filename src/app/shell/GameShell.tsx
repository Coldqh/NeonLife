import type { ReactNode } from "react";
import type { GameSession } from "../../world/state/types";
import type { GameScreen } from "../shared/types";
import { GameHeader } from "./GameHeader";
import { PrimaryNavigation } from "./PrimaryNavigation";

interface GameShellProps {
  session: GameSession;
  screen: GameScreen;
  onScreenChange: (screen: GameScreen) => void;
  onSettings: () => void;
  children: ReactNode;
  overlay?: ReactNode;
  notice?: ReactNode;
}

export function GameShell({ session, screen, onScreenChange, onSettings, children, overlay, notice }: GameShellProps) {
  return (
    <div className="game-shell">
      <GameHeader session={session} onSettings={onSettings} />
      <main className="game-shell__content">{children}</main>
      <PrimaryNavigation screen={screen} onChange={onScreenChange} />
      {notice}
      {overlay}
    </div>
  );
}
