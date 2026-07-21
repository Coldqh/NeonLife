import type { SVGProps } from "react";

export type IconName =
  | "life"
  | "city"
  | "people"
  | "work"
  | "network"
  | "inventory"
  | "health"
  | "home"
  | "messages"
  | "archive"
  | "action"
  | "clock"
  | "wallet"
  | "signal"
  | "alert"
  | "close"
  | "pin"
  | "settings"
  | "chevron";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, React.ReactNode> = {
  life: <><path d="M4 12h3l2-5 4 10 2-5h5"/><path d="M3 5v14h18"/></>,
  city: <><path d="M3 21V9l6-4v16"/><path d="M9 21V3l6 3v15"/><path d="M15 21V8l6 3v10"/><path d="M6 12h.01M12 8h.01M18 14h.01"/></>,
  people: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2"/><path d="M16 3.4a3 3 0 0 1 0 5.2M17 14a5 5 0 0 1 4 5v2"/></>,
  work: <><rect x="3" y="7" width="18" height="13" rx="1"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/></>,
  network: <><circle cx="12" cy="12" r="2"/><path d="M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14M8 16a6 6 0 0 1 0-8M16 8a6 6 0 0 1 0 8"/></>,
  inventory: <><path d="M4 7h16v14H4z"/><path d="M8 7V4h8v3M4 11h16"/></>,
  health: <><path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 5.65-7 10-7 10z"/><path d="M9 12h2l1-2 2 4 1-2h2"/></>,
  home: <><path d="M3 11 12 3l9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/></>,
  messages: <><path d="M4 4h16v12H8l-4 4z"/><path d="M8 8h8M8 12h5"/></>,
  archive: <><path d="M4 7h16v14H4zM3 3h18v4H3z"/><path d="M9 11h6"/></>,
  action: <><path d="m13 2-8 11h6l-1 9 9-12h-6z"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  wallet: <><path d="M3 6h16v13H3z"/><path d="M16 10h5v5h-5zM6 6V4h10v2"/></>,
  signal: <><path d="M4 18h2v2H4zM9 14h2v6H9zM14 9h2v11h-2zM19 4h2v16h-2z"/></>,
  alert: <><path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17h.01"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  pin: <><path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.36.36.7.6 1 .3.3.7.45 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15z"/></>,
  chevron: <><path d="m9 18 6-6-6-6"/></>
};

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
