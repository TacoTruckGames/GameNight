/**
 * The shape three switches share: two options in one pill, one always on.
 *
 * The markup was written twice — the board's View switch and its Sort switch —
 * and the week agenda wanted it a third time. Copying it again is how two
 * controls that ask the same kind of question end up looking like two different
 * controls, so the markup lives here and the *meaning* stays with each switch:
 * what the options are, what they're called, who owns the wire value. This
 * component only knows there are two of them and which one is pressed.
 *
 * `options: readonly [T, T]` is the point of the tuple: the rule in
 * `base.css` above `.who__tabs, .segmented` — "exactly two mutually exclusive
 * options in one pill" — is a claim about the CSS (the pill flexes both halves
 * to equal width, and with two, seeing the alternative is the whole reason
 * neither collapses into a dropdown). A third option would quietly break that
 * rule; typed as a pair, it breaks the build instead.
 *
 * `aria-pressed` rather than a tablist: these toggle a rendering, they don't
 * switch panels. The identity picker wears the same pill with `aria-selected`
 * because it really is a tablist — same appearance, different promise.
 */

import { useId } from "react";

export function SegmentedControl<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly [T, T];
  labels: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
}) {
  const labelId = useId();
  return (
    <div className="field">
      <span className="field__label" id={labelId}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={labelId}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className="segmented__option"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {labels[option]}
          </button>
        ))}
      </div>
    </div>
  );
}
