/**
 * The admin surface, through real HTTP.
 *
 * Everything here goes through `SELF.fetch`, so the role gate, the suspension
 * check in `attachUser`, the Durable Object calls and the audit writes are the
 * production ones. The suite is organised around the five hazards the plan
 * named — each has a test that says so in its name — plus the guards, the
 * lists, and the error log's end-to-end path.
 *
 * The database is shared with every other test file, so nothing asserts a
 * global total: counts are measured as deltas around the thing under test, and
 * every fixture id is unique.
 */

import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type {
  AdminEvent,
  AdminEventDetail,
  AdminOverview,
  AdminUser,
  ApiErrorBody,
  AuditEntry,
  ErrorEntry,
  EventSummary,
  Page,
  RsvpResponse,
  User,
} from "../../shared/api-types";
import {
  addRsvpsDirectly,
  api,
  deleteRsvp,
  inDays,
  projectedCount,
  putRsvp,
  roomStub,
  rsvpCount,
  seedAdmin,
  seedEvent,
  seedUser,
  seedUsers,
} from "../helpers";

// ------------------------------------------------------------------ probes --

/** The room's own member table — the thing hazard 2 is about. */
function roomMembers(event: { id: string; roomKey: string }): Promise<string[]> {
  return runInDurableObject(roomStub(event), (_instance, state) =>
    state.storage.sql
      .exec<{ player_id: string }>("SELECT player_id FROM members ORDER BY player_id")
      .toArray()
      .map((row) => row.player_id),
  );
}

async function roomKeyOf(eventId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT room_key FROM events WHERE id = ?1")
    .bind(eventId)
    .first<{ room_key: string }>();
  return row?.room_key ?? "";
}

async function eventRow(eventId: string): Promise<{ status: string; cancelled_at: string | null; capacity: number }> {
  const row = await env.DB.prepare("SELECT status, cancelled_at, capacity FROM events WHERE id = ?1")
    .bind(eventId)
    .first<{ status: string; cancelled_at: string | null; capacity: number }>();
  return row ?? { status: "missing", cancelled_at: null, capacity: -1 };
}

/** Audit rows for one target, newest first — `rowid` breaks the second-precision tie. */
async function auditFor(targetId: string): Promise<{ actor_id: string; action: string; metadata: string | null }[]> {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, action, metadata FROM audit_log WHERE target_id = ?1 ORDER BY created_at DESC, rowid DESC",
  )
    .bind(targetId)
    .all<{ actor_id: string; action: string; metadata: string | null }>();
  return results;
}

const PROBE_SCOPE = "http.POST /api/admin/errors/probe";

async function clearProbeRows(): Promise<void> {
  await env.DB.prepare("DELETE FROM error_log WHERE scope = ?1").bind(PROBE_SCOPE).run();
}

async function probeRow(): Promise<ErrorEntry | undefined> {
  const { body } = await api<ErrorEntry[]>("/api/admin/errors?status=all", { as: (await adminId()).id });
  return body.find((entry) => entry.scope === PROBE_SCOPE);
}

/** One admin, reused by the read-only helpers above. */
let cachedAdmin: Promise<{ id: string }> | null = null;
function adminId(): Promise<{ id: string }> {
  cachedAdmin ??= seedAdmin({ name: "Probe Reader" });
  return cachedAdmin;
}

// ------------------------------------------------------------------ guards --

describe("the admin gate", () => {
  it("401s an anonymous caller on a read", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/admin/overview");
    expect(status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("403s a player on a read", async () => {
    const player = await seedUser();
    const { status, body } = await api<ApiErrorBody>("/api/admin/overview", { as: player.id });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("Admins only.");
  });

  it("403s an organizer on a read", async () => {
    const organizer = await seedUser({ role: "organizer" });
    const { status, body } = await api<ApiErrorBody>("/api/admin/overview", { as: organizer.id });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("200s an admin on a read", async () => {
    const admin = await seedAdmin();
    const { status } = await api<AdminOverview>("/api/admin/overview", { as: admin.id });
    expect(status).toBe(200);
  });

  it("guards a mutation the same way: 401 anonymous, 403 player, 200 admin", async () => {
    const admin = await seedAdmin();
    const player = await seedUser();
    const victim = await seedUser();
    const path = `/api/admin/users/${victim.id}/suspend`;

    expect((await api<ApiErrorBody>(path, { method: "POST" })).status).toBe(401);
    expect((await api<ApiErrorBody>(path, { method: "POST", as: player.id })).status).toBe(403);
    expect((await api<AdminUser>(path, { method: "POST", as: admin.id })).status).toBe(200);
  });

  it("keeps admins out of the player and organizer routes (exact-role, both ways)", async () => {
    const admin = await seedAdmin();
    const event = await seedEvent();

    expect((await putRsvp(event.id, admin.id)).status).toBe(403);
    expect(
      (
        await api("/api/events", {
          method: "POST",
          as: admin.id,
          body: { title: "Nope", gameType: "dnd", startsAt: inDays(5), location: "X", capacity: 4 },
        })
      ).status,
    ).toBe(403);
  });

  it("still refuses admin as a self-signup role (hazard 4)", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/users", {
      method: "POST",
      body: { name: "Sneaky", role: "admin" },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });
});

// -------------------------------------------------------------- suspension --

describe("suspension", () => {
  it("refuses every request from a suspended player with 403 ACCOUNT_SUSPENDED", async () => {
    const admin = await seedAdmin();
    const player = await seedUser();
    const event = await seedEvent();

    const suspended = await api<AdminUser>(`/api/admin/users/${player.id}/suspend`, {
      method: "POST",
      as: admin.id,
      body: { reason: "Spamming the board" },
    });
    expect(suspended.status).toBe(200);
    expect(suspended.body.suspendedAt).not.toBeNull();
    expect(suspended.body.suspendedReason).toBe("Spamming the board");

    const me = await api<ApiErrorBody>("/api/me", { as: player.id });
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe("ACCOUNT_SUSPENDED");
    expect(me.body.error.message).toBe("This account has been suspended.");

    const rsvp = (await putRsvp(event.id, player.id)) as { status: number; body: ApiErrorBody };
    expect(rsvp.status).toBe(403);
    expect(rsvp.body.error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("lets the account back in on unsuspend, reason cleared", async () => {
    const admin = await seedAdmin();
    const player = await seedUser();

    await api(`/api/admin/users/${player.id}/suspend`, { method: "POST", as: admin.id, body: { reason: "cooling off" } });
    expect((await api("/api/me", { as: player.id })).status).toBe(403);

    const restored = await api<AdminUser>(`/api/admin/users/${player.id}/unsuspend`, {
      method: "POST",
      as: admin.id,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.suspendedAt).toBeNull();
    expect(restored.body.suspendedReason).toBeNull();

    const me = await api<User>("/api/me", { as: player.id });
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(player.id);
  });

  it("stops a suspended organizer from posting events", async () => {
    const admin = await seedAdmin();
    const organizer = await seedUser({ role: "organizer" });

    await api(`/api/admin/users/${organizer.id}/suspend`, { method: "POST", as: admin.id });

    const { status, body } = await api<ApiErrorBody>("/api/events", {
      method: "POST",
      as: organizer.id,
      body: { title: "Should not exist", gameType: "dnd", startsAt: inDays(5), location: "Hall", capacity: 4 },
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("refuses to let an admin suspend themselves", async () => {
    const admin = await seedAdmin();

    const { status, body } = await api<ApiErrorBody>(`/api/admin/users/${admin.id}/suspend`, {
      method: "POST",
      as: admin.id,
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toBe("You can't suspend yourself");

    // …and is still able to use the dashboard.
    expect((await api("/api/admin/overview", { as: admin.id })).status).toBe(200);
  });

  it("404s an unknown user", async () => {
    const admin = await seedAdmin();
    const { status, body } = await api<ApiErrorBody>("/api/admin/users/u_nobody/suspend", {
      method: "POST",
      as: admin.id,
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("is idempotent in both directions", async () => {
    const admin = await seedAdmin();
    const player = await seedUser();

    const first = await api<AdminUser>(`/api/admin/users/${player.id}/suspend`, { method: "POST", as: admin.id });
    const second = await api<AdminUser>(`/api/admin/users/${player.id}/suspend`, { method: "POST", as: admin.id });
    expect(second.status).toBe(200);
    expect(second.body.suspendedAt).not.toBeNull();
    expect(first.body.id).toBe(second.body.id);

    await api(`/api/admin/users/${player.id}/unsuspend`, { method: "POST", as: admin.id });
    const again = await api<AdminUser>(`/api/admin/users/${player.id}/unsuspend`, { method: "POST", as: admin.id });
    expect(again.status).toBe(200);
    expect(again.body.suspendedAt).toBeNull();
  });

  it("works with no request body at all", async () => {
    const admin = await seedAdmin();
    const player = await seedUser();

    const { status, body } = await api<AdminUser>(`/api/admin/users/${player.id}/suspend`, {
      method: "POST",
      as: admin.id,
    });
    expect(status).toBe(200);
    expect(body.suspendedReason).toBeNull();
  });

  it("writes an audit row naming the admin who did it", async () => {
    const admin = await seedAdmin();
    const player = await seedUser();

    await api(`/api/admin/users/${player.id}/suspend`, { method: "POST", as: admin.id, body: { reason: "rude" } });
    await api(`/api/admin/users/${player.id}/unsuspend`, { method: "POST", as: admin.id });

    const rows = await auditFor(player.id);
    expect(rows.map((row) => row.action)).toEqual(["user.unsuspended", "user.suspended"]);
    expect(rows.every((row) => row.actor_id === admin.id)).toBe(true);
    expect(JSON.parse(rows[1]?.metadata ?? "null")).toEqual({ reason: "rude" });
  });
});

// ---------------------------------------------------------------- capacity --

describe("editing an event", () => {
  it("capacity raise reaches an already-hydrated room (hazard 1)", async () => {
    const admin = await seedAdmin();
    const [first, second] = await seedUsers(2);
    const event = await seedEvent({ capacity: 1 });

    // Hydrate the room the normal way, then fill it.
    expect((await putRsvp(event.id, first!.id)).status).toBe(201);
    const blocked = (await putRsvp(event.id, second!.id)) as { status: number; body: ApiErrorBody };
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("EVENT_FULL");

    const before = await roomKeyOf(event.id);
    const patched = await api<AdminEvent>(`/api/admin/events/${event.id}`, {
      method: "PATCH",
      as: admin.id,
      body: { capacity: 2 },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.capacity).toBe(2);

    // The room the RSVP route now addresses is a brand-new one…
    expect(await roomKeyOf(event.id)).not.toBe(before);
    // …so the second player gets the seat the raise was for.
    const taken = await putRsvp(event.id, second!.id);
    expect(taken.status).toBe(201);
    expect((taken.body as RsvpResponse).attendeeCount).toBe(2);

    const rows = await auditFor(event.id);
    expect(rows[0]?.action).toBe("event.updated");
    expect(JSON.parse(rows[0]?.metadata ?? "null")).toMatchObject({ changed: ["capacity"], roomRotated: true });
  });

  it("refuses to shrink capacity below the current attendee count (hazard 3)", async () => {
    const admin = await seedAdmin();
    const players = await seedUsers(3);
    const event = await seedEvent({ capacity: 5, rsvpPlayerIds: players.map((player) => player.id) });

    const { status, body } = await api<ApiErrorBody>(`/api/admin/events/${event.id}`, {
      method: "PATCH",
      as: admin.id,
      body: { capacity: 2 },
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toEqual([
      { path: "capacity", message: "Capacity can't be below the 3 current attendees" },
    ]);
    expect((await eventRow(event.id)).capacity).toBe(5); // nothing written
  });

  it("allows shrinking to exactly the current attendee count", async () => {
    const admin = await seedAdmin();
    const players = await seedUsers(3);
    const event = await seedEvent({ capacity: 5, rsvpPlayerIds: players.map((player) => player.id) });

    const { status, body } = await api<AdminEvent>(`/api/admin/events/${event.id}`, {
      method: "PATCH",
      as: admin.id,
      body: { capacity: 3 },
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ capacity: 3, attendeeCount: 3, seatsLeft: 0, isFull: true });
  });

  it("edits the descriptive fields without touching the room key", async () => {
    const admin = await seedAdmin();
    const event = await seedEvent({ title: "Old Title" });
    const before = await roomKeyOf(event.id);

    const { status, body } = await api<AdminEvent>(`/api/admin/events/${event.id}`, {
      method: "PATCH",
      as: admin.id,
      body: { title: "New Title", location: "New Hall", gameType: "warhammer", startsAt: inDays(9) },
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ title: "New Title", location: "New Hall", gameType: "warhammer" });
    expect(body.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // normalised
    expect(await roomKeyOf(event.id)).toBe(before);

    const rows = await auditFor(event.id);
    expect(JSON.parse(rows[0]?.metadata ?? "null").changed.sort()).toEqual(
      ["gameType", "location", "startsAt", "title"].sort(),
    );
  });

  it("rejects an empty patch and a past start time", async () => {
    const admin = await seedAdmin();
    const event = await seedEvent();

    expect(
      (await api<ApiErrorBody>(`/api/admin/events/${event.id}`, { method: "PATCH", as: admin.id, body: {} })).status,
    ).toBe(400);

    const past = await api<ApiErrorBody>(`/api/admin/events/${event.id}`, {
      method: "PATCH",
      as: admin.id,
      body: { startsAt: inDays(-2) },
    });
    expect(past.status).toBe(400);
    expect(past.body.error.details?.[0]?.path).toBe("startsAt");
  });

  it("404s an unknown event", async () => {
    const admin = await seedAdmin();
    const { status } = await api(`/api/admin/events/evt_nope`, {
      method: "PATCH",
      as: admin.id,
      body: { capacity: 3 },
    });
    expect(status).toBe(404);
  });
});

// ------------------------------------------------------------ cancellation --

describe("cancelling an event", () => {
  it("hides it from the board, refuses new RSVPs, and keeps the ones already made", async () => {
    const admin = await seedAdmin();
    const [stayer, leaver, newcomer] = await seedUsers(3);
    const event = await seedEvent({ capacity: 6, rsvpPlayerIds: [stayer!.id, leaver!.id] });

    const cancelled = await api<AdminEvent>(`/api/admin/events/${event.id}/cancel`, { method: "POST", as: admin.id });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe("cancelled");
    expect(cancelled.body.cancelledAt).not.toBeNull();

    // Gone from the public board…
    const board = await api<EventSummary[]>("/api/events");
    expect(board.body.some((summary) => summary.id === event.id)).toBe(false);

    // …but still in the attendee's own list, marked, so they find out.
    const mine = await api<EventSummary[]>("/api/me/rsvps", { as: stayer!.id });
    expect(mine.body.find((summary) => summary.id === event.id)?.status).toBe("cancelled");

    // No new seats.
    const refused = (await putRsvp(event.id, newcomer!.id)) as { status: number; body: ApiErrorBody };
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("EVENT_CANCELLED");
    expect(refused.body.error.message).toBe("This event was cancelled.");

    // Leaving still works — nobody is trapped on a cancelled event.
    const left = await deleteRsvp(event.id, leaver!.id);
    expect(left.status).toBe(200);
    expect((left.body as RsvpResponse).status).toBe("cancelled");
  });

  it("restores it, clearing cancelled_at and putting it back on the board", async () => {
    const admin = await seedAdmin();
    const player = await seedUser();
    const event = await seedEvent();

    await api(`/api/admin/events/${event.id}/cancel`, { method: "POST", as: admin.id });
    const restored = await api<AdminEvent>(`/api/admin/events/${event.id}/restore`, { method: "POST", as: admin.id });

    expect(restored.status).toBe(200);
    expect(restored.body.status).toBe("scheduled");
    expect(restored.body.cancelledAt).toBeNull();
    expect(await eventRow(event.id)).toMatchObject({ status: "scheduled", cancelled_at: null });

    const board = await api<EventSummary[]>("/api/events");
    expect(board.body.some((summary) => summary.id === event.id)).toBe(true);
    expect((await putRsvp(event.id, player.id)).status).toBe(201);
  });

  it("is idempotent and audited", async () => {
    const admin = await seedAdmin();
    const event = await seedEvent();

    await api(`/api/admin/events/${event.id}/cancel`, { method: "POST", as: admin.id });
    const twice = await api<AdminEvent>(`/api/admin/events/${event.id}/cancel`, { method: "POST", as: admin.id });
    expect(twice.status).toBe(200);
    expect(twice.body.status).toBe("cancelled");

    const rows = await auditFor(event.id);
    expect(rows.map((row) => row.action)).toEqual(["event.cancelled", "event.cancelled"]);
  });
});

// -------------------------------------------------------- attendee removal --

describe("removing an attendee", () => {
  it("goes through the room, so the freed seat is really free (hazard 2)", async () => {
    const admin = await seedAdmin();
    const [removed, other] = await seedUsers(2);
    const event = await seedEvent({ capacity: 4, rsvpPlayerIds: [removed!.id] });

    // Hydrate the room through the normal path: it now knows about `removed`.
    expect((await putRsvp(event.id, other!.id)).status).toBe(201);
    expect(await roomMembers(event)).toContain(removed!.id);

    const { status, body } = await api<{ attendeeCount: number; capacity: number }>(
      `/api/admin/events/${event.id}/attendees/${removed!.id}`,
      { method: "DELETE", as: admin.id },
    );

    expect(status).toBe(200);
    expect(body).toEqual({ attendeeCount: 1, capacity: 4 });
    expect(await rsvpCount(event.id)).toBe(1);
    expect(await projectedCount(event.id)).toBe(1);
    // The room forgot them too — otherwise their next RSVP would be answered
    // `already_confirmed` from a stale member row.
    expect(await roomMembers(event)).not.toContain(removed!.id);

    const back = await putRsvp(event.id, removed!.id);
    expect(back.status).toBe(201);
    expect((back.body as RsvpResponse).attendeeCount).toBe(2);
  });

  it("is a 200 for someone who was not attending, and is audited", async () => {
    const admin = await seedAdmin();
    const stranger = await seedUser();
    const event = await seedEvent({ capacity: 3 });

    const { status, body } = await api<{ attendeeCount: number }>(
      `/api/admin/events/${event.id}/attendees/${stranger.id}`,
      { method: "DELETE", as: admin.id },
    );
    expect(status).toBe(200);
    expect(body.attendeeCount).toBe(0);

    const rows = await auditFor(event.id);
    expect(rows[0]?.action).toBe("event.attendee_removed");
    expect(JSON.parse(rows[0]?.metadata ?? "null")).toMatchObject({ playerId: stranger.id });
  });
});

// ------------------------------------------------------------------ detail --

describe("GET /api/admin/events/:id", () => {
  it("returns the door list for an event the admin does not own", async () => {
    const admin = await seedAdmin();
    const players = await seedUsers(2);
    const event = await seedEvent({ capacity: 4, rsvpPlayerIds: players.map((player) => player.id) });

    const { status, body } = await api<AdminEventDetail>(`/api/admin/events/${event.id}`, { as: admin.id });

    expect(status).toBe(200);
    expect(body.id).toBe(event.id);
    expect(body.organizerId).toBe(event.organizerId);
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.cancelledAt).toBeNull();
    expect(body.attendees.map((attendee) => attendee.playerId).sort()).toEqual(
      players.map((player) => player.id).sort(),
    );
  });

  it("404s an unknown event", async () => {
    const admin = await seedAdmin();
    expect((await api("/api/admin/events/evt_missing", { as: admin.id })).status).toBe(404);
  });
});

// ------------------------------------------------------------------- lists --

describe("GET /api/admin/users", () => {
  it("pages, and reports the page shape", async () => {
    const admin = await seedAdmin();
    const { status, body } = await api<Page<AdminUser>>("/api/admin/users", { as: admin.id });

    expect(status).toBe(200);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(typeof body.hasNext).toBe("boolean");
    expect(body.items.length).toBeLessThanOrEqual(50);
  });

  it("filters by name, role and status", async () => {
    const admin = await seedAdmin();
    const marker = `Zz${crypto.randomUUID().slice(0, 8)}`;
    const player = await seedUser({ name: `${marker} Player` });
    const organizer = await seedUser({ role: "organizer", name: `${marker} Organizer` });
    await api(`/api/admin/users/${player.id}/suspend`, { method: "POST", as: admin.id });

    const byName = await api<Page<AdminUser>>(`/api/admin/users?q=${marker}`, { as: admin.id });
    expect(byName.body.items.map((user) => user.id).sort()).toEqual([player.id, organizer.id].sort());

    const byRole = await api<Page<AdminUser>>(`/api/admin/users?q=${marker}&role=organizer`, { as: admin.id });
    expect(byRole.body.items.map((user) => user.id)).toEqual([organizer.id]);

    const suspended = await api<Page<AdminUser>>(`/api/admin/users?q=${marker}&status=suspended`, { as: admin.id });
    expect(suspended.body.items.map((user) => user.id)).toEqual([player.id]);

    const active = await api<Page<AdminUser>>(`/api/admin/users?q=${marker}&status=active`, { as: admin.id });
    expect(active.body.items.map((user) => user.id)).toEqual([organizer.id]);
  });

  it("carries the per-user RSVP and hosted counts", async () => {
    const admin = await seedAdmin();
    const marker = `Cc${crypto.randomUUID().slice(0, 8)}`;
    const player = await seedUser({ name: `${marker} Counter` });
    const organizer = await seedUser({ role: "organizer", name: `${marker} Host` });
    const event = await seedEvent({ organizer, capacity: 4 });
    await addRsvpsDirectly(event.id, [player.id]);

    const { body } = await api<Page<AdminUser>>(`/api/admin/users?q=${marker}`, { as: admin.id });
    expect(body.items.find((user) => user.id === player.id)).toMatchObject({ rsvpCount: 1, hostedCount: 0 });
    expect(body.items.find((user) => user.id === organizer.id)).toMatchObject({ rsvpCount: 0, hostedCount: 1 });
  });
});

describe("GET /api/admin/events", () => {
  it("defaults to upcoming and honours when/status filters", async () => {
    const admin = await seedAdmin();
    const marker = `Ee${crypto.randomUUID().slice(0, 8)}`;
    const upcoming = await seedEvent({ title: `${marker} Upcoming`, startsAt: inDays(4) });
    const past = await seedEvent({ title: `${marker} Past`, startsAt: inDays(-4) });
    const cancelled = await seedEvent({ title: `${marker} Cancelled`, startsAt: inDays(5) });
    await api(`/api/admin/events/${cancelled.id}/cancel`, { method: "POST", as: admin.id });

    const byDefault = await api<Page<AdminEvent>>(`/api/admin/events?q=${marker}`, { as: admin.id });
    // Cancelled events stay visible to the admin — hiding them here is backwards.
    expect(byDefault.body.items.map((event) => event.id).sort()).toEqual([upcoming.id, cancelled.id].sort());

    const pastOnly = await api<Page<AdminEvent>>(`/api/admin/events?q=${marker}&when=past`, { as: admin.id });
    expect(pastOnly.body.items.map((event) => event.id)).toEqual([past.id]);

    const all = await api<Page<AdminEvent>>(`/api/admin/events?q=${marker}&when=all`, { as: admin.id });
    expect(all.body.items).toHaveLength(3);

    const cancelledOnly = await api<Page<AdminEvent>>(`/api/admin/events?q=${marker}&when=all&status=cancelled`, {
      as: admin.id,
    });
    expect(cancelledOnly.body.items.map((event) => event.id)).toEqual([cancelled.id]);

    const scheduledOnly = await api<Page<AdminEvent>>(`/api/admin/events?q=${marker}&when=all&status=scheduled`, {
      as: admin.id,
    });
    expect(scheduledOnly.body.items.map((event) => event.id).sort()).toEqual([upcoming.id, past.id].sort());
  });

  it("returns the admin-only fields on every row", async () => {
    const admin = await seedAdmin();
    const marker = `Ff${crypto.randomUUID().slice(0, 8)}`;
    const event = await seedEvent({ title: `${marker} Shape` });

    const { body } = await api<Page<AdminEvent>>(`/api/admin/events?q=${marker}`, { as: admin.id });
    expect(body.items[0]).toMatchObject({
      id: event.id,
      organizerId: event.organizerId,
      organizerName: event.organizerName,
      status: "scheduled",
      cancelledAt: null,
    });
    expect(body.items[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ------------------------------------------------------------- error log --

describe("the error log", () => {
  it("records a deliberate probe, and counts a repeat into the same row", async () => {
    const admin = await seedAdmin();
    await clearProbeRows();

    const first = await api<ApiErrorBody>("/api/admin/errors/probe", { method: "POST", as: admin.id });
    expect(first.status).toBe(500); // the 500 is the point
    expect(first.body.error.code).toBe("INTERNAL");

    await api("/api/admin/errors/probe", { method: "POST", as: admin.id });

    const { status, body } = await api<ErrorEntry[]>("/api/admin/errors", { as: admin.id });
    expect(status).toBe(200);
    const rows = body.filter((entry) => entry.scope === PROBE_SCOPE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: PROBE_SCOPE,
      message: "Probe error from admin dashboard",
      count: 2,
      resolvedAt: null,
    });
    expect(rows[0]?.fingerprint.startsWith(`${PROBE_SCOPE}:`)).toBe(true);
    expect(rows[0]?.metadata).toMatchObject({ path: "/api/admin/errors/probe" });
  });

  it("resolves a row out of the open list, and a recurrence re-opens it", async () => {
    const admin = await seedAdmin();
    await clearProbeRows();
    await api("/api/admin/errors/probe", { method: "POST", as: admin.id });

    const open = await api<ErrorEntry[]>("/api/admin/errors?status=open", { as: admin.id });
    const entry = open.body.find((row) => row.scope === PROBE_SCOPE);
    expect(entry).toBeDefined();

    const resolved = await api(`/api/admin/errors/${entry!.id}/resolve`, { method: "POST", as: admin.id });
    expect(resolved.status).toBe(200);

    const stillOpen = await api<ErrorEntry[]>("/api/admin/errors?status=open", { as: admin.id });
    expect(stillOpen.body.some((row) => row.scope === PROBE_SCOPE)).toBe(false);

    const resolvedList = await api<ErrorEntry[]>("/api/admin/errors?status=resolved", { as: admin.id });
    expect(resolvedList.body.find((row) => row.scope === PROBE_SCOPE)?.resolvedAt).not.toBeNull();

    // Still happening means still open.
    await api("/api/admin/errors/probe", { method: "POST", as: admin.id });
    const reopened = await api<ErrorEntry[]>("/api/admin/errors?status=open", { as: admin.id });
    expect(reopened.body.find((row) => row.scope === PROBE_SCOPE)?.resolvedAt).toBeNull();

    const rows = await auditFor(entry!.id);
    expect(rows[0]?.action).toBe("error.resolved");
  });

  it("dismisses a row for good", async () => {
    const admin = await seedAdmin();
    await clearProbeRows();
    await api("/api/admin/errors/probe", { method: "POST", as: admin.id });

    const entry = await probeRow();
    expect(entry).toBeDefined();

    const deleted = await api(`/api/admin/errors/${entry!.id}`, { method: "DELETE", as: admin.id });
    expect(deleted.status).toBe(200);
    expect(await probeRow()).toBeUndefined();

    const rows = await auditFor(entry!.id);
    expect(rows[0]?.action).toBe("error.dismissed");
  });

  it("404s resolve and dismiss for an unknown id", async () => {
    const admin = await seedAdmin();
    expect((await api("/api/admin/errors/err_nope/resolve", { method: "POST", as: admin.id })).status).toBe(404);
    expect((await api("/api/admin/errors/err_nope", { method: "DELETE", as: admin.id })).status).toBe(404);
  });

  it("is admin-only, probe included", async () => {
    const player = await seedUser();
    expect((await api("/api/admin/errors/probe", { method: "POST", as: player.id })).status).toBe(403);
    expect((await api("/api/admin/errors", { as: player.id })).status).toBe(403);
  });
});

// ------------------------------------------------------------------- audit --

describe("GET /api/admin/audit", () => {
  it("returns recent actions newest first, with the actor's name resolved", async () => {
    const admin = await seedAdmin({ name: "Audit Reader" });
    const player = await seedUser();
    await api(`/api/admin/users/${player.id}/suspend`, { method: "POST", as: admin.id });

    const { status, body } = await api<AuditEntry[]>("/api/admin/audit?limit=5", { as: admin.id });

    expect(status).toBe(200);
    expect(body.length).toBeLessThanOrEqual(5);
    const mine = body.find((entry) => entry.targetId === player.id);
    expect(mine).toMatchObject({
      actorId: admin.id,
      actorName: "Audit Reader",
      action: "user.suspended",
      targetType: "user",
    });
    expect(mine?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects a limit above 200", async () => {
    const admin = await seedAdmin();
    expect((await api("/api/admin/audit?limit=500", { as: admin.id })).status).toBe(400);
  });
});

// ---------------------------------------------------------------- overview --

describe("GET /api/admin/overview", () => {
  it("returns the whole dashboard shape, with 14-day arrays", async () => {
    const admin = await seedAdmin();
    const { status, body } = await api<AdminOverview>("/api/admin/overview", { as: admin.id });

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(
      ["errors", "events", "recentActions", "rsvps", "rsvpsByDay", "signupsByDay", "users"].sort(),
    );
    expect(Object.keys(body.users).sort()).toEqual(
      ["admins", "newLast7d", "organizers", "players", "suspended", "total"].sort(),
    );
    expect(Object.keys(body.events).sort()).toEqual(["cancelled", "full", "past", "upcoming"].sort());
    expect(Object.keys(body.rsvps).sort()).toEqual(["last24h", "last7d", "total"].sort());
    expect(Object.keys(body.errors).sort()).toEqual(["last24h", "open"].sort());

    expect(body.signupsByDay).toHaveLength(14);
    expect(body.rsvpsByDay).toHaveLength(14);
    for (const day of [...body.signupsByDay, ...body.rsvpsByDay]) {
      expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isInteger(day.count)).toBe(true);
    }
    // Oldest first, and today is the last bucket.
    expect(body.signupsByDay[0]!.day < body.signupsByDay[13]!.day).toBe(true);
    expect(body.signupsByDay[13]!.day).toBe(new Date().toISOString().slice(0, 10));

    expect(body.recentActions.length).toBeLessThanOrEqual(10);
  });

  it("counts what was just added — users, events, rsvps, cancellations", async () => {
    const admin = await seedAdmin();
    const before = (await api<AdminOverview>("/api/admin/overview", { as: admin.id })).body;

    const players = await seedUsers(3);
    const organizer = await seedUser({ role: "organizer" });
    const open = await seedEvent({ organizer, capacity: 5, rsvpPlayerIds: players.map((player) => player.id) });
    const full = await seedEvent({ organizer, capacity: 1, rsvpPlayerIds: [players[0]!.id] });
    const doomed = await seedEvent({ organizer, capacity: 4 });
    await api(`/api/admin/events/${doomed.id}/cancel`, { method: "POST", as: admin.id });

    const after = (await api<AdminOverview>("/api/admin/overview", { as: admin.id })).body;

    expect(after.users.total - before.users.total).toBe(4);
    expect(after.users.players - before.users.players).toBe(3);
    expect(after.users.organizers - before.users.organizers).toBe(1);
    expect(after.users.newLast7d - before.users.newLast7d).toBe(4);
    // `open` + `full` stay scheduled; `doomed` moved to cancelled.
    expect(after.events.upcoming - before.events.upcoming).toBe(2);
    expect(after.events.full - before.events.full).toBe(1);
    expect(after.events.cancelled - before.events.cancelled).toBe(1);
    expect(after.rsvps.total - before.rsvps.total).toBe(4);
    expect(after.rsvps.last24h - before.rsvps.last24h).toBe(4);
    expect(open.id).not.toBe(full.id);
  });

  it("counts the errors it just recorded and shows the latest actions", async () => {
    const admin = await seedAdmin({ name: "Overview Admin" });
    await clearProbeRows();

    const before = (await api<AdminOverview>("/api/admin/overview", { as: admin.id })).body;
    await api("/api/admin/errors/probe", { method: "POST", as: admin.id });
    const player = await seedUser();
    await api(`/api/admin/users/${player.id}/suspend`, { method: "POST", as: admin.id });
    const after = (await api<AdminOverview>("/api/admin/overview", { as: admin.id })).body;

    expect(after.errors.open - before.errors.open).toBe(1);
    expect(after.errors.last24h - before.errors.last24h).toBe(1);
    expect(after.recentActions[0]).toMatchObject({
      action: "user.suspended",
      targetId: player.id,
      actorName: "Overview Admin",
    });
  });
});
