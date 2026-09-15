/** The "nothing here, and that's fine" state (S4) — never a blank screen. */

import type { ReactNode } from "react";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {hint ? <p className="text-sm">{hint}</p> : null}
      {action}
    </div>
  );
}
