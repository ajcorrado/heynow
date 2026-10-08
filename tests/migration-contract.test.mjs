import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20261006194000_instagram_publishing_desk.sql", import.meta.url), "utf8");
const carouselSql = await readFile(new URL("../supabase/migrations/20261007182000_instagram_carousels.sql", import.meta.url), "utf8");
const carouselCandidateSql = await readFile(new URL("../supabase/migrations/20261008003000_carousel_draft_candidates.sql", import.meta.url), "utf8");

test("migration keeps Instagram rules scoped to the Instagram channel", () => {
  assert.match(sql, /channel <> 'instagram' or status in/);
  assert.match(sql, /channel = 'instagram' and format = 'feed_single'/);
});

test("migration uses the PostgreSQL Instagram URL pattern", () => {
  assert.ok(sql.includes("'^https://(www\\.)?instagram\\.com/'"));
  assert.ok(!sql.includes("'^https://(www\\\\.)?instagram\\\\.com/'"));
});

test("ready content is immutable until returned to draft", () => {
  assert.match(sql, /current_row\.status <> 'draft'/);
  assert.match(sql, /target_status in \('ready', 'posted'\)/);
});

test("carousel migration keeps ordered immutable event snapshots", () => {
  assert.match(carouselSql, /create table if not exists public\.content_draft_events/);
  assert.match(carouselSql, /unique \(draft_id, position\) deferrable initially deferred/);
  assert.match(carouselSql, /Carousel event snapshot is immutable/);
});

test("carousel readiness is enforced in the database", () => {
  assert.match(carouselSql, /item_count < 3 or item_count > 8/);
  assert.match(carouselSql, /data_review_state is distinct from 'approved'/);
});

test("pending events can be drafted but approval remains a readiness gate", () => {
  assert.match(carouselCandidateSql, /Every carousel event must be active and in the selected city/);
  assert.doesNotMatch(carouselCandidateSql, /Every carousel event must be active, data-approved/);
  assert.match(carouselSql, /Every linked event must still be active and data-approved/);
});

