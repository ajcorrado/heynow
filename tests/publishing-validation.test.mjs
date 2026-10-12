import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, carouselReadinessErrors, isInstagramUrl, normalizeContent, readinessErrors, transitionErrors } from "../lib/publishing-validation.mjs";
import { buildCarouselSlides, eventFactLines, slideFilename } from "../lib/carousel-assets.mjs";

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
  assert.equal(canTransition("draft", "posted"), false);
  assert.equal(canTransition("ready", "skipped"), true);
  assert.equal(canTransition("skipped", "ready"), false);
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

test("enforces editorial length boundaries", () => {
  assert.deepEqual(readinessErrors({ ...ready, headline: "x".repeat(90), editorial_take: "x".repeat(500), caption: "x".repeat(2200) }), {});
  assert.ok(readinessErrors({ ...ready, headline: "x".repeat(91) }).headline);
  assert.ok(readinessErrors({ ...ready, editorial_take: "x".repeat(501) }).editorial_take);
  assert.ok(readinessErrors({ ...ready, caption: "x".repeat(2201) }).caption);
});

test("carousel readiness requires title, caption, and 3 to 8 events", () => {
  assert.deepEqual(Object.keys(carouselReadinessErrors({}, 0)).sort(), ["caption", "events", "title"]);
  assert.deepEqual(carouselReadinessErrors({ title: "Weekend picks", caption: "Three things worth leaving home for." }, 3), {});
  assert.equal(carouselReadinessErrors({ title: "Weekend picks", caption: "Caption" }, 9).events, "Choose no more than 8 events.");
  assert.equal(carouselReadinessErrors({ title: "Weekend picks", caption: "Caption" }, 3, 2).approval, "2 selected events still need data review.");
});

test("builds an ordered cover and event slide set from stored facts", () => {
  const slides = buildCarouselSlides({ title: "Weekend picks", cover_kicker: "HEY NOW PICKS", instagram_handle: "@heynowelpaso" }, [
    { title: "First event", start_at: "2026-10-17T23:00:00Z", venue: "Plaza Theatre", locality: "El Paso", is_free: true },
    { title: "Second event", venue: "", locality: "" },
  ]);
  assert.equal(slides.length, 3);
  assert.equal(slides[0].kind, "cover");
  assert.equal(slides[1].title, "First event");
  assert.equal(slides[1].price, "FREE");
  assert.equal(slides[2].venue, "VENUE TBA");
  assert.equal(slideFilename(0, slides[0]), "heynow-01-cover.png");
});

test("uses explicit unknown labels without inventing event facts", () => {
  assert.deepEqual(eventFactLines({}), {
    dateLine: "DATE TBA", timeLine: "TIME TBA", venue: "VENUE TBA", locality: "EL PASO", price: "PRICE NOT LISTED", age: "AGE NOT LISTED",
  });
});

