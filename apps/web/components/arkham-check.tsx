import { X } from "lucide-react";

export function CheckDie({ value, rolling = false }: { value: number | null; rolling?: boolean }) {
  return (
    <div className={`arkham-d20 ${rolling ? "is-rolling" : ""} ${value !== null ? "has-result" : ""}`}>
      <div className="dice-aura" aria-hidden="true" />
      <svg className="dice-object" viewBox="0 0 240 240" fill="none" aria-hidden="true">
        <g className="die-faces">
          <path d="M120 18 210 70 165 95 120 18Z" />
          <path d="m120 18 0 84L75 95l45-77Z" />
          <path d="M30 70 75 95l45 7L30 170V70Z" />
          <path d="m210 70-45 25-45 7 90 68V70Z" />
          <path d="m30 170 90-68 0 120-90-52Z" />
          <path d="m210 170-90-68 0 120 90-52Z" />
          <path d="m75 95 45-77 45 77-45 7-45-7Z" className="die-cap" />
        </g>
        <path className="die-outline" d="M120 18 210 70v100l-90 52-90-52V70l90-52Z" />
        <path className="die-lines" d="m120 18 45 77 45-25M120 18 75 95l-45-25m45 25 45 7 45-7m-45 7v120m0-120L30 170m90-68 90 68M75 95l45-77 45 77" />
      </svg>
      <span>{rolling ? "…" : value ?? "d20"}</span>
    </div>
  );
}

export function CheckClose({ onClose, label = "Закрыть проверку" }: { onClose: () => void; label?: string }) {
  return (
    <button type="button" className="icon-button check-close" onClick={onClose} aria-label={label}>
      <X size={22} strokeWidth={1.35} />
    </button>
  );
}
