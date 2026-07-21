export interface UiSettings {
  scanlines: boolean;
  reducedMotion: boolean;
  compactMode: boolean;
  highContrast: boolean;
}

export const defaultUiSettings: UiSettings = {
  scanlines: true,
  reducedMotion: false,
  compactMode: false,
  highContrast: false
};
