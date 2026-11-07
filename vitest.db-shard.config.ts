import { defineConfig } from "vitest/config";
import db from "./vitest.db.config";
import { dbShards, parseShard } from "./tests/ci-shards.mjs";

// CI VERİTABANLI GRUP (kurucu 10-31, `docs/TASARIM-2026-10-31-ci-paralel-test.md`): veritabanlı kolun AYNISI (tek sıra, süre sınırları,
// `globalSetup` ile kendi PostgreSQL'i) — yalnız dosya listesi `TEST_DB_SHARD=i/n` grubunun payı. Değişken yoksa / bozuksa açılışta fırlatır.
const { index, total } = parseShard(process.env.TEST_DB_SHARD);
const files = dbShards(process.cwd(), total)[index]?.files ?? [];
if (files.length === 0) throw new Error(`TEST_DB_SHARD=${process.env.TEST_DB_SHARD}: grup boş`);

export default defineConfig({ ...db, test: { ...db.test, include: files } });
