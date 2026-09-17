/**
 * WCAG contrast audit for the design tokens. Zero deps: `node tools/contrast-audit.mjs`.
 *
 * Parses the light `:root` block and the dark `prefers-color-scheme` override
 * out of `src/theme/tokens.css` and prints the ratio for every pair the UI
 * actually paints text with. Normal text must clear 4.5:1; the focus ring is a
 * non-text indicator, so 3:1.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../src/theme/tokens.css", import.meta.url)), "utf8");
const block = (source) => Object.fromEntries([...source.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));

const light = block(css.slice(css.indexOf(":root"), css.indexOf("@media")));
const dark = { ...light, ...block(css.slice(css.indexOf("@media"))) };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => ((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05));

const PAIRS = [
  ["--color-text", "--color-bg"],
  ["--color-text", "--color-surface"],
  ["--color-muted", "--color-surface"],
  ["--color-accent-text", "--color-accent"],
  ["--color-accent", "--color-surface"],
  ["--color-accent-strong", "--color-accent-soft"],
  ["--color-danger", "--color-danger-soft"],
  ["--color-success", "--color-success-soft"],
  ["--brand-text", "--brand-bg"],
  ["--brand-muted", "--brand-bg"],
  // The operator bar is one fixed orange in both themes; audit it in both anyway,
  // so a future theme edit that redefines it gets caught here rather than in prod.
  ["--admin-bar-text", "--admin-bar-bg"],
  // A past card drops to the page background; its muted meta text has to survive
  // the move, and the "Past" badge has to out-read everything around it.
  ["--color-muted", "--color-bg"],
  ["--color-text", "--color-surface-alt"],
  // Role accents ride on the brand band as indicators, not as text, so 3:1.
  ["--role-player", "--brand-bg", 3],
  ["--role-organizer", "--brand-bg", 3],
  ["--admin-bar-bg", "--brand-bg", 3],
  ["--color-focus", "--color-bg", 3],
  ["--color-focus", "--color-surface", 3],
];

let failures = 0;
for (const [name, theme] of [["light", light], ["dark", dark]]) {
  console.log(`\n${name}`);
  for (const [fg, bg, min = 4.5] of PAIRS) {
    const r = ratio(theme[fg], theme[bg]);
    const ok = r >= min;
    if (!ok) failures++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}:1 (need ${min})  ${fg} on ${bg}  ${theme[fg]} / ${theme[bg]}`);
  }
}
console.log(failures ? `\n${failures} pair(s) below threshold` : "\nall pairs pass");
process.exit(failures ? 1 : 0);
