/**
 * The security review's mechanical fixes, each pinned by a request:
 * headers on the API, `no-store` on anything answered to someone, a body
 * limit that answers in the API's own error shape, a bounded page number,
 * one cache key per rendered map, and redaction on the way into `error_log`.
 */

import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { ApiErrorBody } from "../../shared/api-types";
import { PAGE_MAX } from "../../shared/schemas";
import { eventMapKey } from "../../worker/lib/map-key";
import { reportError } from "../../worker/lib/report";
import { BASE, api, seedAdmin, seedUser } from "../helpers";

describe("security headers", () => {
  it("are on every API response, with the strict policy JSON can afford", async () => {
    const response = await SELF.fetch(new Request(`${BASE}/api/health`));
    const h = response.headers;
    expect(h.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(h.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(h.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});

describe("Cache-Control on personal answers", () => {
  it("is no-store when the request carried an identity", async () => {
    const player = await seedUser();
    const response = await SELF.fetch(new Request(`${BASE}/api/me`, { headers: { "X-User-Id": player.id } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is left alone on the anonymous board, which is the response that may be cached", async () => {
    const response = await SELF.fetch(new Request(`${BASE}/api/events`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBeNull();
  });
});

describe("request body limit", () => {
  it("413s a 20 KB body in the API's own error shape, before validation reads it", async () => {
    const { status, body } = await api<ApiErrorBody>("/api/users", {
      method: "POST",
      rawBody: JSON.stringify({ name: "x".repeat(20 * 1024), role: "player" }),
    });
    expect(status).toBe(413);
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("admin pagination is bounded", () => {
  it(`400s past page ${PAGE_MAX} — OFFSET is a scan`, async () => {
    const admin = await seedAdmin();
    const last = await api("/api/admin/users?page=" + PAGE_MAX, { as: admin.id });
    expect(last.status).toBe(200);
    const beyond = await api<ApiErrorBody>("/api/admin/users?page=" + (PAGE_MAX + 1), { as: admin.id });
    expect(beyond.status).toBe(400);
  });
});

describe("one cache key per rendered map", () => {
  it("400s an unknown query parameter instead of minting a fresh key for it", async () => {
    const response = await SELF.fetch(new Request(`${BASE}/api/events/evt_x/map?w=640&h=320&scale=1&v=p&x=1`));
    expect(response.status).toBe(400);
  });

  it("serves the same image whatever order the parameters arrive in", async () => {
    // The event does not exist in D1. If the reordered request were keyed on
    // its raw URL it would miss, reach the database and 404; keyed on the
    // parsed values it finds the image the canonical form stored.
    const key = eventMapKey(BASE, "evt_never_in_d1", { width: 640, height: 320, scale: 1 }, "place_1");
    await caches.default.put(
      key,
      new Response("png-bytes", { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=60" } }),
    );

    const reordered = await SELF.fetch(
      new Request(`${BASE}/api/events/evt_never_in_d1/map?v=place_1&scale=1&h=320&w=640`),
    );
    expect(reordered.status).toBe(200);
    expect(reordered.headers.get("X-Map-Cache")).toBe("HIT");
    expect(await reordered.text()).toBe("png-bytes");
  });
});

describe("error_log redaction", () => {
  it("never stores a key that arrived inside a message or a stack", async () => {
    const fakeKey = "AIza" + "Q".repeat(35);
    const error = new Error(`upstream 403 for https://maps.example/api?key=${fakeKey}&size=1`);
    error.stack = `Error: leaked ${fakeKey}\n    at somewhere`;
    await reportError(env.DB, "test.redaction", error);

    const row = await env.DB.prepare("SELECT message, stack FROM error_log WHERE scope = 'test.redaction'").first<{
      message: string;
      stack: string;
    }>();
    expect(row).not.toBeNull();
    expect(row!.message).not.toContain(fakeKey);
    expect(row!.message).toContain("key=REDACTED");
    expect(row!.stack).not.toContain(fakeKey);
  });
});
