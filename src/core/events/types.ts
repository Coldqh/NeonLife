export type EventCategory =
  | "personal"
  | "contact"
  | "work"
  | "finance"
  | "health"
  | "local"
  | "system";

export interface WorldEvent {
  id: string;
  timestamp: number;
  category: EventCategory;
  title: string;
  detail?: string;
  importance: 1 | 2 | 3;
  pinned?: boolean;
}
