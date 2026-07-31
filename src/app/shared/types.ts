export type GameScreen = "profile" | "map" | "life" | "work" | "crime" | "nearby";
export type MapMode = "global" | "local";
export type NearbyMode = "actions" | "people" | "places" | "cars" | "events";
export type NoticeTone = "neutral" | "good" | "warn";

export interface NoticeState {
  text: string;
  tone: NoticeTone;
}
