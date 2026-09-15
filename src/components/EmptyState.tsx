/** The "nothing here, and that's fine" state (S4) — never a blank screen. */

import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name="empty" size={40} />
      <p className="empty__title">{title}</p>
      {hint ? <p className="text-sm">{hint}</p> : null}
      {action}
    </div>
  );
}
