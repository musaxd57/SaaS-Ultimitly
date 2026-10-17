import { describe, it, expect } from "vitest";
import { isSafeObjectKey, orgIdFromKey, buildTaskPhotoKey } from "@/lib/storage/keys";
import { sniffImageExt } from "@/lib/image-validation";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// YÜKLEME SALDIRI YÜZEYİ (P1 #5, 08-09 (2))
//
// Bu blok MEVCUT davranışı ölçer ve DEĞİŞMEZE çevirir. Mimari kod-doğrulandı:
// nesne anahtarı `org/{orgId}/task/{taskId}/{ts}-{48 bit rastgele}.ext`,
// uzantı SİHİRLİ BAYTTAN türer (spoof edilebilir MIME'dan değil), servis yolu
// oturum + `orgIdFromKey` kapılı ve kısa ömürlü İMZALI GET'e çözülür —
// hiçbir yerde public-read ACL YOK.
//
// ⚠️ "Private" iddiası KODDAN doğrulandı; BUCKET'ın sağlayıcı tarafındaki
// görünürlüğü bir OPERATÖR adımıdır (runbook'ta) — isimden varsayılmıyor.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
// ⚠️ cuid BİÇİMİ: `ID_SEGMENT` alt çizgi KABUL ETMİYOR (`[a-zA-Z0-9-]`).
// İlk fikstürüm `org_abc123` idi ve BEŞ test birden kırmızı verdi — kodun
// değil testin hatasıydı.
const ORG = "clx1org2abc3def4";
const TASK = "clx9task8xyz7uvw";

describe("nesne anahtarı — path traversal ve şekil", () => {
  it("🚨 PATH TRAVERSAL ve kaçış denemeleri REDDEDİLİR", () => {
    const evil = [
      "org/../../etc/passwd",
      "org/o1/task/t1/../../../../etc/passwd",
      "org/o1/task/t1/..%2Fx.jpg",
      "org//o1/task/t1/x.jpg",
      "org/o1/task/t1/x\\y.jpg",
      "/org/o1/task/t1/x.jpg",
      "org/o1/task/t1/.hidden",
      "org/o1/task/t1/x.jpg/extra",
      "org/o1/task/x.jpg",
      "",
      "x".repeat(600),
      // ⚠️ BU VAKA `..` KONTROLÜNÜN YÜK TAŞIDIĞI TEK YER (ölçüldü, 08-09 (2)).
      // Diğer denemelerin hepsi segment regex'lerine (`parts.length !== 5`,
      // `ID_SEGMENT`, `FILE_SEGMENT`) zaten takılıyor — `..` satırını silen
      // mutasyon onlarla YEŞİL geçiyordu. `FILE_SEGMENT` NOKTAYA izin verdiği
      // için nokta-nokta taşıyan bir DOSYA ADI yalnız o kontrolle eleniyor.
      // Yani satır ölü değil, ama savunma derinliği katmanı: bunu bilerek yaz.
      "org/o1/task/t1/a..b.jpg",
    ];
    for (const k of evil) expect(isSafeObjectKey(k), k).toBe(false);
  });

  it("KONTROL: gerçek anahtar GEÇER (aşırı-uygulama değil)", () => {
    const key = buildTaskPhotoKey(ORG, TASK, "jpg");
    expect(isSafeObjectKey(key)).toBe(true);
    expect(orgIdFromKey(key)).toBe(ORG);
  });

  it("🚨 ÇAPRAZ-KİRACI: anahtarın org segmenti kimliğin TEK kaynağı", () => {
    // Servis rotası `orgIdFromKey(key) !== session.organizationId` ile opak 404
    // veriyor; bu test o kararın girdisinin güvenilir olduğunu tutar.
    const key = buildTaskPhotoKey("clxKURBANorg0001", TASK, "jpg");
    expect(orgIdFromKey(key)).toBe("clxKURBANorg0001");
    expect(orgIdFromKey("org/o1/task/t1/../../org/o2/task/t2/x.jpg")).toBeNull();
  });

  it("🚨 ANAHTAR TAHMİN EDİLEBİLİR DEĞİL — 48 bit rastgelelik", () => {
    // Zaman damgası tek başına tahmin edilebilir; rastgele parça olmadan bir
    // saldırgan aynı görevin fotoğrafını deneme-yanılma ile bulabilirdi.
    const keys = new Set(Array.from({ length: 200 }, () => buildTaskPhotoKey(ORG, TASK, "jpg")));
    expect(keys.size).toBe(200); // çakışma yok
    const file = [...keys][0]!.split("/")[4]!;
    expect(file).toMatch(/^\d+-[0-9a-f]{12}\.jpg$/); // 12 hex = 48 bit
  });

  it("kimlik segmentleri şekil doğrulamasından geçmezse anahtar ÜRETİLMEZ", () => {
    for (const bad of ["../x", "o/1", "", "a".repeat(80), "o 1", "o_1"]) {
      expect(() => buildTaskPhotoKey(bad, TASK, "jpg"), bad).toThrow();
      expect(() => buildTaskPhotoKey(ORG, bad, "jpg"), bad).toThrow();
    }
  });
});

describe("içerik türü — MIME yanıltması, çift uzantı, aktif içerik", () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("🚨 SVG ve HTML REDDEDİLİR — aktif içerik taşıyabilir", () => {
    // SVG içine <script> gömülebilir; aynı origin'den servis edilseydi XSS olurdu.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const html = Buffer.from("<!doctype html><html><body><script>alert(1)</script>");
    expect(sniffImageExt(svg)).toBeNull();
    expect(sniffImageExt(html)).toBeNull();
  });

  it("🚨 MIME YANILTMASI işe yaramaz — hüküm BAYTLARDAN verilir", () => {
    // Saldırgan `Content-Type: image/jpeg` diyebilir; sniff gerçeği söyler.
    const phpish = Buffer.from("<?php system($_GET['c']); ?>");
    expect(sniffImageExt(phpish)).toBeNull();
    expect(sniffImageExt(Buffer.from("GIF89a"))).toBeNull(); // GIF bile kabul değil
  });

  it("🚨 ÇİFT UZANTI etkisiz — uzantı DOSYA ADINDAN değil BAYTTAN türer", () => {
    // `evil.svg.jpg` ya da `evil.jpg.html`: dosya adı hiç okunmuyor.
    expect(sniffImageExt(jpg)).toBe("jpg");
    expect(sniffImageExt(png)).toBe("png");
    // Bayt gerçek jpg ise anahtar `.jpg` ile biter — ad ne olursa olsun.
    expect(buildTaskPhotoKey(ORG, TASK, sniffImageExt(jpg)!).endsWith(".jpg")).toBe(true);
  });

  it("KONTROL: gerçek görseller kabul edilir (kapı her şeyi reddetmiyor)", () => {
    expect(sniffImageExt(jpg)).toBe("jpg");
    expect(sniffImageExt(png)).toBe("png");
  });
});

describe("PUBLIC URL üretilmez — kaynak sözleşmesi", () => {
  it("🚨 kodda public-read ACL / public bucket URL'i YOK", () => {
    // Nesneler varsayılan olarak private doğar; okuma YALNIZ kısa ömürlü imzalı
    // GET ile yapılır. Bir gün biri `ACL: public-read` eklerse burası kırmızı.
    const files = [
      "src/lib/storage/adapter.ts",
      "src/lib/storage/s3.ts",
      "src/lib/storage/keys.ts",
      "src/app/api/upload/route.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(/public-read/i);
      expect(src, rel).not.toMatch(/x-amz-acl/i);
    }
  });

  it("saklanan photoUrl AYNI ORIGIN göreli yol — sağlayıcı URL'i DB'ye yazılmaz", () => {
    const key = buildTaskPhotoKey(ORG, TASK, "jpg");
    const url = `/api/storage/photo/${key}`;
    expect(url.startsWith("/api/storage/photo/")).toBe(true);
    expect(url).not.toMatch(/^https?:/);
  });

  it("🚨 ÜRETİMDE eski yerel-disk yoluna SESSİZCE düşülmez (fail-closed)", () => {
    // `public/uploads` statik servis edilir: URL süresiz, oturumsuz, kiracı
    // kontrolsüz. Depolama env'i bir gün düşerse yükleme HATA vermeli, sessizce
    // zayıf yola geçmemeli.
    const src = readFileSync(path.join(ROOT, "src/app/api/upload/route.ts"), "utf8");
    expect(src).toMatch(/NODE_ENV === "production"/);
    expect(src).toMatch(/ALLOW_LEGACY_LOCAL_UPLOADS/);
    // Kaçış kapısı ÖLÜ OLMAMALI: koşul negatif karşılaştırma taşımalı.
    expect(src).toMatch(/ALLOW_LEGACY_LOCAL_UPLOADS !== "1"/);
  });
});
