import type { ChangeEvent, MouseEvent as ReactMouseEvent } from "react";
import type { WorldSaveController } from "../providers/useWorldSave";
import type { UiSettings } from "../../ui/theme/settings";
import { APP_VERSION } from "../../core/version/versionService";

export function SettingsOverlay({
  settings,
  onSettings,
  save,
  onClose
}: {
  settings: UiSettings;
  onSettings: (settings: UiSettings) => void;
  save: WorldSaveController;
  onClose: () => void;
}) {
  return (
    <div className="overlay-backdrop" role="presentation" onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header><div><span>NEON LIFE v{APP_VERSION}</span><h2 id="settings-title">Настройки</h2></div><button type="button" onClick={onClose} aria-label="Закрыть">×</button></header>
        <div className="settings-list">
          <label><span><strong>Уменьшить движение</strong><small>Отключает длинные анимации интерфейса.</small></span><input type="checkbox" checked={settings.reducedMotion} onChange={(event: ChangeEvent<HTMLInputElement>) => onSettings({ ...settings, reducedMotion: event.target.checked })} /></label>
          <label><span><strong>Высокий контраст</strong><small>Усиливает текст и разделители.</small></span><input type="checkbox" checked={settings.highContrast} onChange={(event: ChangeEvent<HTMLInputElement>) => onSettings({ ...settings, highContrast: event.target.checked })} /></label>
          <label><span><strong>Компактный режим</strong><small>Уменьшает вертикальные отступы.</small></span><input type="checkbox" checked={settings.compactMode} onChange={(event: ChangeEvent<HTMLInputElement>) => onSettings({ ...settings, compactMode: event.target.checked })} /></label>
        </div>
        <section className="save-controls">
          <header><span>Сохранения</span><small>{save.status === "saving" ? "Сохранение..." : save.lastSavedAt ? `Сохранено ${new Date(save.lastSavedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "Автосохранение включено"}</small></header>
          <div>{save.summaries.map((summary) => <button type="button" key={summary.slotId} className={save.activeSlotId === summary.slotId ? "is-active" : ""} onClick={() => void save.switchSlot(summary.slotId)}><strong>{summary.slotId.replace("slot-", "Слот ")}</strong><span>{summary.exists ? summary.playerName ?? "Мир существует" : "Пусто"}</span></button>)}</div>
          <button type="button" className="primary-button" onClick={() => void save.saveNow()}>Сохранить сейчас</button>
        </section>
      </section>
    </div>
  );
}
