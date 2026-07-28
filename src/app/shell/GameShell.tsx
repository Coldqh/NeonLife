import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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

const SCREEN_ORDER: GameScreen[] = ["profile", "map", "nearby"];

interface SwipeStart {
  pointerId: number;
  x: number;
  y: number;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, canvas, svg, [role='button'], [data-no-swipe]"));
}

export function GameShell({ session, screen, onScreenChange, onSettings, children, overlay, notice }: GameShellProps) {
  const contentRef = useRef<HTMLElement | null>(null);
  const swipeRef = useRef<SwipeStart | null>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [screen]);

  function pointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (overlay || isInteractiveTarget(event.target)) return;
    swipeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function pointerUp(event: ReactPointerEvent<HTMLElement>): void {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.pointerId !== event.pointerId || overlay) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    const currentIndex = SCREEN_ORDER.indexOf(screen);
    const nextIndex = dx < 0 ? currentIndex + 1 : currentIndex - 1;
    const next = SCREEN_ORDER[nextIndex];
    if (next) onScreenChange(next);
  }

  return (
    <div className="game-shell" data-screen={screen}>
      {screen === "map" ? null : <GameHeader session={session} onSettings={onSettings} />}
      <main
        ref={contentRef}
        className="game-shell__content"
        onPointerDown={pointerDown}
        onPointerUp={pointerUp}
        onPointerCancel={() => { swipeRef.current = null; }}
      >{children}</main>
      <PrimaryNavigation screen={screen} onChange={onScreenChange} />
      {notice}
      {overlay}
    </div>
  );
}
