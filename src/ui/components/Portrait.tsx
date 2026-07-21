interface PortraitProps {
  kind: "player" | "contact";
  label: string;
}

export function Portrait({ kind, label }: PortraitProps) {
  return (
    <div className={`portrait portrait--${kind}`} role="img" aria-label={label}>
      <div className="portrait__scan" />
      <div className="portrait__head" />
      <div className="portrait__neck" />
      <div className="portrait__body" />
      <span className="portrait__corner portrait__corner--tl" />
      <span className="portrait__corner portrait__corner--br" />
      <span className="portrait__code">BIO//{kind === "player" ? "P-ACT" : "C-PRI"}</span>
    </div>
  );
}
