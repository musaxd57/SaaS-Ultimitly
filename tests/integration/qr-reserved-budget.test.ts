import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import {
  consumeDailyAiBudget,
  consumeDailyAiBudgetForQr,
  dailyAiQrSharePercent,
} from "@/lib/ai/daily-budget";

// ---------------------------------------------------------------------------
// QR'IN REZERVE PAYI — kimliksiz yüzey org'un bütçesini TEK BAŞINA bitiremez.
//
// `chat/[token]` kimlik doğrulaması OLMAYAN tek AI yüzeyi ve `chatToken` daire
// başına KALICI bir sır (fiziksel QR etiketi olarak dairede asılı). Tek sızmış
// token → org'un günlük AI tavanı tükenir → o gün TÜM dairelerdeki GERÇEK
// Airbnb misafirlerinin oto-yanıtı kapanır.
//
// 🚨 BU DOSYANIN ASIL TESTİ 3 NUMARA. İlk tasarım "aynı anahtara daha düşük
// limit ver" idi ve KORUMA SAĞLAMIYORDU: `rateLimit` sayacı KOŞULSUZ artırıyor
// (`rate-limit.ts`: `"count" = r."count" + 1`), karşılaştırma ondan SONRA JS'te.
// Yani limiti aşan QR çağrıları modele gitmez ama PAYLAŞILAN SAYACI YAKMAYA
// DEVAM EDERDİ. O tasarım uygulanmış olsaydı bu test onu yakalardı.
// ---------------------------------------------------------------------------

const ORG = "org-qr-budget";

async function seedOrg() {
  await prisma.organization.create({ data: { id: ORG, name: "Org" } });
}

describe("QR rezerve payı — inbox'ın hakkı korunur", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    // Tavanı env'den sabitle: plan okumasına bağlı kalmadan matematiği ölçelim.
    vi.stubEnv("AI_DAILY_CALL_CAP", "10");
    vi.stubEnv("AI_DAILY_QR_SHARE_PERCENT", "30"); // → tavan 3
    await seedOrg();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("1) QR tavanı, org tavanının yüzdesi", async () => {
    const v = await consumeDailyAiBudgetForQr(ORG);
    expect(v.cap).toBe(3); // floor(10 * 30/100)
    expect(v.ok).toBe(true);
  });

  it("2) QR kendi payında DURUR", async () => {
    for (let i = 0; i < 3; i++) expect((await consumeDailyAiBudgetForQr(ORG)).ok, `çağrı ${i + 1}`).toBe(true);
    expect((await consumeDailyAiBudgetForQr(ORG)).ok).toBe(false); // 4. → pay bitti
  });

  it("3) 🚨 QR TAŞSA BİLE kimlik doğrulamalı yol ÇALIŞIR (asıl koruma)", async () => {
    // QR'ı payının ÇOK ötesine kadar hammer'la — gerçek saldırı böyle görünür.
    for (let i = 0; i < 50; i++) await consumeDailyAiBudgetForQr(ORG);

    // Inbox oto-yanıtı / panel yolu HÂLÂ çalışmalı: QR'ın taşan trafiği
    // paylaşılan sayaca DOKUNMADI, yani org tavanının (10) en az 7'si duruyor.
    for (let i = 0; i < 7; i++) {
      expect((await consumeDailyAiBudget(ORG)).ok, `kimlik doğrulamalı çağrı ${i + 1}`).toBe(true);
    }
  });

  it("4) TOPLAM harcama org tavanını AŞMAZ (fatura korunur)", async () => {
    // QR payını (3) tüketsin…
    for (let i = 0; i < 3; i++) await consumeDailyAiBudgetForQr(ORG);
    // …ardından kimlik doğrulamalı yol kalan 7'yi tüketsin.
    for (let i = 0; i < 7; i++) expect((await consumeDailyAiBudget(ORG)).ok).toBe(true);
    // 11. çağrı ortak tavana takılmalı — QR'ın 3'ü de o tavana sayıldı.
    expect((await consumeDailyAiBudget(ORG)).ok).toBe(false);
  });

  it("5) QR SESSİZKEN inbox tavanın TAMAMINI kullanabilir (israf yok)", async () => {
    // Ayrı "carve-out" tasarımı burada 7'de dururdu; iki-kova tasarımı durmaz.
    for (let i = 0; i < 10; i++) expect((await consumeDailyAiBudget(ORG)).ok, `çağrı ${i + 1}`).toBe(true);
    expect((await consumeDailyAiBudget(ORG)).ok).toBe(false);
  });

  it("7) DÜRÜSTLÜK: uyarı metni 'planınızın hakkı doldu' DEMEZ", async () => {
    // 🚨 QR artık org bütçesinin yalnız REZERVE payını tüketiyor. Eski
    // `daily_budget` metni ("Planınızın günlük AI işlem hakkı doldu") bu
    // değişiklikten sonra host'a YANLIŞ BEYAN olurdu — genel hak duruyor.
    // Bu, projenin kendi kültüründeki "misafire/host'a yanlış söyleme"
    // kuralının (08-01, escalationReply metni) aynı sınıfı.
    const { qrEscalationEmail } = await import("@/lib/email-templates");
    const html = qrEscalationEmail("Nuve 5", "daily_budget_qr", "https://x/y");
    expect(html).toContain("genel AI hakkı etkilenmedi");
    expect(html).not.toContain("Planınızın günlük AI işlem hakkı doldu");
    // Eski sebep AYNEN korunur (org'un gerçek tavanı dolduğunda hâlâ doğru).
    const old = qrEscalationEmail("Nuve 5", "daily_budget", "https://x/y");
    expect(old).toContain("Planınızın günlük AI işlem hakkı");
  });

  it("8) QR rotası YENİ sebebi kullanıyor (kaynak pini)", async () => {
    // Metin doğru olsa bile rota eski sebebi geçirirse yanlış beyan geri gelir.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/api/chat/[token]/route.ts", "utf8");
    expect(src).toContain('reason: "daily_budget_qr"');
    expect(src).toContain("consumeDailyAiBudgetForQr");
  });

  it("9) kimlik doğrulamalı rotalar TAM tavanlı fonksiyonda kaldı (kaynak pini)", async () => {
    // Biri yanlışlıkla panel rotasını da "rezerve" fonksiyona bağlarsa, ödeyen
    // müşteri kendi kotasının %30'una düşer. Bu pin o kazayı yakalar.
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "src/app/api/conversations/[id]/ai-suggest/route.ts",
      "src/app/api/conversations/[id]/translate-message/route.ts",
      "src/app/api/hazirlik/summary/route.ts",
      "src/app/api/ai/test/route.ts",
      "src/lib/automation.ts",
    ]) {
      expect(readFileSync(f, "utf8"), f).not.toContain("consumeDailyAiBudgetForQr");
    }
  });

  it("6) bozuk/eksik env güvenli varsayılana düşer", () => {
    for (const bad of ["", "0", "abc", "150", "-5", "  "]) {
      vi.stubEnv("AI_DAILY_QR_SHARE_PERCENT", bad);
      expect(dailyAiQrSharePercent(), `env="${bad}"`).toBe(30);
    }
    vi.stubEnv("AI_DAILY_QR_SHARE_PERCENT", "10");
    expect(dailyAiQrSharePercent()).toBe(10);
  });
});
