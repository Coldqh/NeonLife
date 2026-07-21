import type { ReactNode } from "react";

interface SystemPanelProps {
  title: string;
  code?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "default" | "warning" | "danger" | "purple";
}

export function SystemPanel({
  title,
  code,
  action,
  children,
  className = "",
  tone = "default"
}: SystemPanelProps) {
  return (
    <section className={`system-panel system-panel--${tone} ${className}`}>
      <header className="system-panel__header">
        <div>
          <span className="system-panel__eyebrow">{code ?? "SYS/MODULE"}</span>
          <h2>{title}</h2>
        </div>
        {action ? <div className="system-panel__action">{action}</div> : null}
      </header>
      <div className="system-panel__body">{children}</div>
    </section>
  );
}
