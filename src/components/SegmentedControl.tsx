/**
 * The shape four switches share: a few options in one pill, one always on.
 *
 * The markup was written twice — the board's View switch and its Sort switch —
 * and the week agenda wanted it a third time. Copying it again is how two
 * controls that ask the same kind of question end up looking like two different
 * controls, so the markup lives here and the *meaning* stays with each switch:
 * what the options are, what they're called, who owns the wire value. This
 * component only knows how many there are and which one is pressed.
 *
 * `options: readonly [T, T, ...T[]]` is two-or-more, and the "or more" was
 * bought deliberately. It began as a strict pair, so that the claim in
 * `base.css` above `.who__tabs, .segmented` — the pill flexes its halves to
 * equal width, and with two, seeing the alternative is the whole reason neither
 * collapses into a dropdown — could not be broken by accident. When the board
 * genuinely wanted a third view (Week / Month / List) the type failed the build,
 * which is exactly what it was for: the rule got re-read, the CSS was checked
 * at 390px (three options still clear the 44px target), and the constraint was
 * widened on purpose rather than discovered in production. Fewer than two is
 * still a build error — a segmented control with one option is a label.
 *
 * `aria-pressed` rather than a tablist: these toggle a rendering, they don't
 * switch panels. The identity picker wears the same pill with `aria-selected`
 * because it really is a tablist — same appearance, different promise.
 *
 * The caption is **there but not drawn**. "Week | Month | List" says what it is
 * without a word above it telling you, and the row it was taking is a row of
 * board. It stays in the DOM because the group still needs a name: a screen
 * reader announcing three unlabelled buttons in a row has to guess what they
 * switch, and `visually-hidden` is the difference between not showing a label
 * and not having one.
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
  options: readonly [T, T, ...T[]];
  labels: Record<T, string>;
  value: T;
  onChange: (next: T) => void;
}) {
  const labelId = useId();
  return (
    <div className="field">
      <span className="field__label visually-hidden" id={labelId}>
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
