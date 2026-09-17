import { describe, expect, it } from "vitest";

import type { ApiErrorBody, User } from "../../shared/api-types";
import { api, seedUser } from "../helpers";

describe("GET /api/users", () => {
  it("lists users with their roles", async () => {
    const player = await seedUser({ role: "player", name: "Picker Player" });
    const organizer = await seedUser({ role: "organizer", name: "Picker Organizer" });

    const { status, body } = await api<User[]>("/api/users");

    expect(status).toBe(200);
    expect(body).toContainEqual({ id: player.id, name: player.name, role: "player" });
    expect(body).toContainEqual({ id: organizer.id, name: organizer.name, role: "organizer" });
  });
});

describe("POST /api/users", () => {
  it("defaults to a player when no role is sent", async () => {
    const { status, body } = await api<User>("/api/users", {
      method: "POST",
      body: { name: "  New Player  " },
    });

    expect(status).toBe(201);
    expect(body.role).toBe("player");
    expect(body.name).toBe("New Player"); // trimmed
    expect(body.id).toMatch(/^u_/);

    // …and the new id works immediately as an identity.
    const me = await api<User>("/api/me", { as: body.id });
    expect(me.status).toBe(200);
    expect(me.body).toEqual(body);
  });

  it("creates an organizer when the role is asked for, and the role is real", async () => {
    const { status, body } = await api<User>("/api/users", {
      method: "POST",
      body: { name: "Back Room Games", role: "organizer" },
    });

    expect(status).toBe(201);
    expect(body.role).toBe("organizer");
    expect(body.id).toMatch(/^org_/);

    // The role is not cosmetic: the new account can immediately do the one
    // thing only organizers may do.
    const created = await api<{ id: string }>("/api/events", {
      as: body.id,
      method: "POST",
      body: {
        title: "Opening Night",
        gameType: "board",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        location: "Back Room",
        capacity: 6,
      },
    });
    expect(created.status).toBe(201);
  });

  it("rejects a role that is not player or organizer", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/users", {
      method: "POST",
      body: { name: "Impostor", role: "admin" },
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details?.[0]?.path).toBe("role");
  });

  it("rejects a blank name with a field error", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/users", { method: "POST", body: { name: "   " } });

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toEqual([{ path: "name", message: "Name is required" }]);
  });

  it("rejects a name over 40 characters", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/users", {
      method: "POST",
      body: { name: "x".repeat(41) },
    });

    expect(status).toBe(400);
    expect(body.error.details?.[0]?.path).toBe("name");
  });

  it("rejects a malformed JSON body as a 400, not a 500", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/users", {
      method: "POST",
      rawBody: "{ not json",
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toMatch(/valid JSON/i);
  });
});

describe("GET /api/me", () => {
  it("401s with AUTH_REQUIRED when no identity is sent", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/me");

    expect(status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("401s with UNKNOWN_USER for an id that is not in the table", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/me", { as: `u_${crypto.randomUUID()}` });

    expect(status).toBe(401);
    expect(body.error.code).toBe("UNKNOWN_USER");
  });

  it("returns the caller", async () => {
    const user = await seedUser({ role: "organizer" });
    const { status, body } = await api<User>("/api/me", { as: user.id });

    expect(status).toBe(200);
    expect(body).toEqual({ id: user.id, name: user.name, role: "organizer" });
  });
});

describe("error shape", () => {
  it("returns a JSON 404 for an unknown /api path, never index.html", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/nope");

    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(typeof body.error.message).toBe("string");
  });

  it("serves the health check", async () => {
    const { status, body } = await api<{ ok: boolean }>("/api/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
