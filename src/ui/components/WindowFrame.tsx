import type { ReactNode } from "react";
import { Icon } from "./Icons";

interface WindowFrameProps {
  title: string;
  code: string;
  children: ReactNode;
  onClose: () => void;
}

export function WindowFrame({ title, code, children, onClose }: WindowFrameProps) {
  return (
    <div className="window-backdrop" onMouseDown={onClose}>
      <section className="window-frame" onMouseDown={(event) => event.stopPropagation()}>
        <header className="window-frame__header">
          <div>
            <span>{code}</span>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть окно">
            <Icon name="close" />
          </button>
        </header>
        <div className="window-frame__content">{children}</div>
      </section>
    </div>
  );
}
