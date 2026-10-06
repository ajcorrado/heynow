import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, isInstagramUrl, normalizeContent, readinessErrors, transitionErrors } from "../lib/publishing-validation.mjs";

const ready = { headline: "Tonight downtown", editorial_take: "Worth leaving the house for.", caption: "Tonight downtown.", display_facts: { date: "Oct 6", venue: "Plaza Theatre", locality: "El Paso" } };

test("normalizes optional unknowns without inventing facts", () => {
  const content = normalizeContent({ headline: "  Hello  ", display_facts: {} });
  assert.equal(content.headline, "Hello");
  assert.equal(content.display_facts.time, "Time TBA");
  assert.equal(content.display_facts.price, "Price not listed");
});

test("enforces the frozen state machine", () => {
  assert.equal(canTransition("draft", "ready"), true);
  assert.equal(canTransition("ready", "posted"), true);
  assert.equal(canTransition("posted", "draft"), false);
  assert.equal(canTransition("skipped", "draft"), true);
});

test("requires complete editorial fields before ready", () => {
  assert.deepEqual(readinessErrors(ready), {});
  assert.equal(readinessErrors({}).headline, "Headline is required.");
});

test("only accepts HTTPS Instagram links", () => {
  assert.equal(isInstagramUrl("https://www.instagram.com/p/abc/"), true);
  assert.equal(isInstagramUrl("http://instagram.com/p/abc"), false);
  assert.equal(isInstagramUrl("https://example.com/instagram.com"), false);
});

test("posted requires an Instagram URL", () => {
  assert.ok(transitionErrors("ready", "posted", ready, {}).instagram_url);
  assert.deepEqual(transitionErrors("ready", "posted", ready, { instagram_url: "https://instagram.com/p/abc/" }), {});
});
