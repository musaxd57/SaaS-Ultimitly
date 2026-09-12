import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NEW_ORG_AUTO_REPLY_WINDOW } from "@/lib/constants";
import { isWithinActiveHours } from "@/lib/automation";

// ---------------------------------------------------------------------------
// OTO-YANIT AKTİF SAAT PENCERESİ — ŞEMA VARSAYILANI 0/9 → 0/0 (migration 55).
//
// 🚨 ÖLÇÜLEN CANLI KUSUR: `isWithinActiveHours` "start == end → TÜM GÜN" der;
// 0/9 ise `hour >= 0 && hour < 9`, yani AI günün yalnız 9 saatinde çalışır ve
// **15 saatinde SUSAR** — üstelik susan 15 saat misafir trafiğinin tamamına
// yakınını kapsar. Saat 09:05'te gelen soru en erken ertesi gece 00:00'da
// cevaplanır; misafir o gece yarısından önce çıkarsa HİÇ cevaplanmaz.
//
// Uygulama katmanı 07-31'de YENİ org'ları kurtardı ama şema varsayılanı 9
// kaldı = TUZAK (üçüncü bir org-yaratma yolu sessizce gece-only org doğurur)
// ve düzeltme eski org'lara — kurucu org dâhil — geriye dönük uygulanmadı.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** `--` yorum satırları soyulmuş SQL — yalnız GERÇEKTEN çalışan ifadeler. */
const executable = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
const MIG = "prisma/migrations/55_auto_reply_window_default/migration.sql";

describe("aktif saat penceresi — anlam", () => {
  it("🚨 0/9 günün 15 saatinde SUSAR (kusurun kendisi ölçülüyor)", () => {
    const acik = Array.from({ length: 24 }, (_, h) => h).filter((h) => isWithinActiveHours(0, 9, h));
    expect(acik.length).toBe(9);
    expect(acik).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // Misafir trafiğinin olduğu saatler KAPALI.
    expect(isWithinActiveHours(0, 9, 12)).toBe(false);
    expect(isWithinActiveHours(0, 9, 20)).toBe(false);
  });

  it("0/0 = 7/24 (start == end kuralı)", () => {
    for (let h = 0; h < 24; h++) expect(isWithinActiveHours(0, 0, h), `saat ${h}`).toBe(true);
  });

  it("host'un seçtiği gece penceresi HÂLÂ çalışır (kural değişmedi)", () => {
    expect(isWithinActiveHours(22, 6, 23)).toBe(true);
    expect(isWithinActiveHours(22, 6, 3)).toBe(true);
    expect(isWithinActiveHours(22, 6, 12)).toBe(false);
  });
});

describe("şema varsayılanı ve migration 55", () => {
  it("🚨 ŞEMA VARSAYILANI artık 0 (tuzak kapandı)", () => {
    const s = read("prisma/schema.prisma");
    expect(s).toMatch(/autoReplyStartHour\s+Int\s+@default\(0\)/);
    expect(s).toMatch(/autoReplyEndHour\s+Int\s+@default\(0\)/);
    // Eski varsayılan geri gelirse KIRMIZI.
    expect(s).not.toMatch(/autoReplyEndHour\s+Int\s+@default\(9\)/);
  });

  it("migration varsayılanı VE dar backfill'i BİRLİKTE taşır", () => {
    const sql = read(MIG);
    expect(sql).toMatch(/ALTER COLUMN "autoReplyEndHour" SET DEFAULT 0/);
    expect(sql).toMatch(/UPDATE "Organization"/);
    expect(sql).toMatch(/SET "autoReplyEndHour" = 0/);
  });

  it("🚨 BACKFILL DAR: koşul tam olarak ESKİ VARSAYILAN (0 ve 9)", () => {
    // 🚨 YORUMSUZ SQL (09-12 incelemesi): migration'ın GERİ ALMA bloğu, örnek
    // olarak aynı `WHERE "autoReplyStartHour" = 0` satırını YORUM İÇİNDE
    // taşıyor — ham metinde iddia o yorumdan da tatmin oluyordu. Çalışan SQL'i
    // taramak için `--` satırları soyulur. (Kardeş dosyadaki `code()` ile aynı
    // ders: belge, kendi pinini vakumlaştırabilir.)
    const sql = executable(read(MIG));
    expect(sql.length, "yorum soyma SQL'i boşaltmış").toBeGreaterThan(100);
    // Host'un bilinçli seçtiği pencereler dokunulmadan kalmalı → iki kolon da
    // koşulda OLMAK ZORUNDA. Yalnız `endHour = 9` yazan bir koşul "1/9"u da
    // ezerdi (shadow DB'de ölçüldü: dokunulmadı).
    expect(sql).toMatch(/WHERE\s+"autoReplyStartHour"\s*=\s*0/);
    expect(sql).toMatch(/AND\s+"autoReplyEndHour"\s*=\s*9/);
    // Geri alma SQL'i YALNIZ yorumda yaşamalı — çalışan blokta bir `= 9` ataması
    // olsaydı migration kendi kendini geri alırdı.
    expect(sql).not.toMatch(/SET\s+"autoReplyEndHour"\s*=\s*9/);
  });

  it("GERİ ALMA yazılı ve tam-tersinir OLMADIĞI söyleniyor (dürüstlük)", () => {
    const sql = read(MIG);
    expect(sql).toMatch(/GERİ ALMA/);
    expect(sql).toMatch(/tam ters çevrilebilir DEĞİL/);
  });

  it("kayıt rotalarının açık yazımı KORUNDU (varsayılan yine kayarsa iki rota etkilenmez)", () => {
    expect(NEW_ORG_AUTO_REPLY_WINDOW.autoReplyStartHour).toBe(
      NEW_ORG_AUTO_REPLY_WINDOW.autoReplyEndHour,
    );
    for (const rel of ["src/app/api/auth/register/route.ts", "src/app/api/admin/customers/route.ts"]) {
      expect(read(rel), rel).toContain("NEW_ORG_AUTO_REPLY_WINDOW");
    }
  });
});
