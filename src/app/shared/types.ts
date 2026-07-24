export type GameScreen = "profile" | "map" | "nearby";
export type MapMode = "global" | "local";
export type NearbyMode = "people" | "places" | "cars" | "events";
export type NoticeTone = "neutral" | "good" | "warn";

export interface NoticeState {
  text: string;
  tone: NoticeTone;
}
