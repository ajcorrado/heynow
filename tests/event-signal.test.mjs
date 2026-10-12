import test from "node:test";
import assert from "node:assert/strict";
import { scoreEventSignal } from "../supabase/functions/_shared/event-signal.mjs";

const now = new Date("2026-10-12T18:00:00Z");

test("primary edge sources outrank commodity listings", () => {
  const base = { title: "Local show", start_at: "2026-10-16T02:00:00Z", venues: { name: "Venue", locality: "El Paso" } };
  const edge = scoreEventSignal({ ...base, factual_description: "One-night borderland performance", hero_image_url: "https://example.com/image.jpg", event_sources: [{ sources: { uniqueness_score: 5, source_roles: ["edge", "authority"] } }] }, now);
  const commodity = scoreEventSignal({ ...base, event_sources: [{ sources: { uniqueness_score: 1, source_roles: ["breadth"] } }] }, now);
  assert.ok(edge.total_score > commodity.total_score);
  assert.match(edge.rationale, /hard-to-find/);
});

test("missing material facts cannot receive a high usefulness score", () => {
  const result = scoreEventSignal({ title: "Mystery event", start_at: "2026-10-13T18:00:00Z", venues: null, event_sources: [] }, now);
  assert.equal(result.verification_state, "incomplete");
  assert.equal(result.usefulness, 0);
});

