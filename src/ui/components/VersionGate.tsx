import type { VersionGuardController } from "../../app/providers/useVersionGuard";
import { Icon } from "./Icons";

export function VersionGate({ guard }: { guard: VersionGuardController }) {
  if (guard.status !== "update-required" && guard.status !== "updating") return null;

  const notes = guard.manifest?.notes ?? [];

  return (
    <div className="version-gate" role="alertdialog" aria-modal="true" aria-labelledby="version-gate-title">
      <section className="version-gate__panel">
        <div className="version-gate__signal"><Icon name="alert" size={28} /></div>
        <span className="version-gate__code">SYSTEM / UPDATE REQUIRED</span>
        <h2 id="version-gate-title">Доступна новая версия</h2>
        <p>Старая сборка заблокирована, чтобы сохранение не работало на устаревшем коде.</p>

        <div className="version-gate__versions">
          <div><span>LOCAL</span><strong>v{guard.localVersion}</strong></div>
          <i />
          <div><span>REMOTE</span><strong>v{guard.remoteVersion}</strong></div>
        </div>

        {notes.length ? (
          <ul>{notes.slice(0, 4).map((note) => <li key={note}>{note}</li>)}</ul>
        ) : null}

        {guard.error ? <div className="version-gate__error">{guard.error}</div> : null}

        <button type="button" className="button button--primary" onClick={() => void guard.installUpdate()} disabled={guard.status === "updating"}>
          {guard.status === "updating" ? "ОЧИСТКА КЭША И ОБНОВЛЕНИЕ..." : "УСТАНОВИТЬ ОБНОВЛЕНИЕ"}
        </button>
        <small>Сохранение героя и настройки интерфейса не удаляются.</small>
      </section>
    </div>
  );
}
