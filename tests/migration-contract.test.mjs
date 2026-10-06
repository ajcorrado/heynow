import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/20261006194000_instagram_publishing_desk.sql", import.meta.url), "utf8");

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
