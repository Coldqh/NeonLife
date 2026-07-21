interface MeterProps {
  label: string;
  value: number;
  hint?: string;
  invert?: boolean;
}

export function Meter({ label, value, hint, invert = false }: MeterProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const severity = invert
    ? clamped >= 75 ? "danger" : clamped >= 50 ? "warning" : "ok"
    : clamped <= 25 ? "danger" : clamped <= 50 ? "warning" : "ok";

  return (
    <div className={`meter meter--${severity}`}>
      <div className="meter__head">
        <span>{label}</span>
        <strong>{clamped}%</strong>
      </div>
      <div className="meter__track" aria-label={`${label}: ${clamped}%`}>
        <span style={{ width: `${clamped}%` }} />
      </div>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}
