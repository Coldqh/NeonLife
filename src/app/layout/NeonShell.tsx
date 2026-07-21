import type { ReactNode } from "react";

interface NeonShellProps {
  topbar: ReactNode;
  sidebar: ReactNode;
  workspace: ReactNode;
  context: ReactNode;
  mobileNav: ReactNode;
  windowDock?: ReactNode;
  className?: string;
}

export function NeonShell({
  topbar,
  sidebar,
  workspace,
  context,
  mobileNav,
  windowDock,
  className = ""
}: NeonShellProps) {
  return (
    <div className={`neon-shell ${className}`}>
      {topbar}
      {sidebar}
      <main className="workspace">{workspace}</main>
      {context}
      {windowDock}
      {mobileNav}
    </div>
  );
}
