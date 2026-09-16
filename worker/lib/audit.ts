/**
 * The admin audit trail.
 *
 * Every admin mutation writes exactly one row: who did it (`actorId` — always
 * the admin), what they did (`action`, a closed union so a typo is a compile
 * error rather than an unqueryable string), and to what (`targetType` +
 * `targetId`). Anything else the reader would want — the fields that changed,
 * the suspension reason, the player removed — goes in `metadata` as JSON.
 *
 * Unlike `reportError`, this one is allowed to throw: if the audit row cannot
 * be written, the operator should hear about it.
 */

import type { AuditAction } from "../../shared/api-types";

export interface AuditInput {
  actorId: string;
  action: AuditAction;
  targetType: "user" | "event" | "error";
  targetId: string;
  metadata?: Record<string, unknown>;
}

export async function audit(db: D1Database, entry: AuditInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, metadata)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      `aud_${crypto.randomUUID()}`,
      entry.actorId,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    )
    .run();
}
