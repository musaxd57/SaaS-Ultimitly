import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { applyAlertEmailVerification, bumpAlertEmailGeneration, consumeAlertEmailGeneration } from "@/lib/alert-email-generation";

// ---------------------------------------------------------------------------
// Uyarı adresi KUŞAĞI sözleşmesi (15 ajan A13 F2, 10-01): artırma atomik ve 1'den başlar; tüketme yalnız GÜNCEL kuşakta olur
// ve kuşağı İLERLETİR (aynı bağlantı ikinci kez tüketilemez — rota dışında bir yazma yolu kuşak artırmasa da). İşletmeler ayrı.
// ---------------------------------------------------------------------------

describe("uyarı adresi kuşağı", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("artırma 1'den başlar ve her çağrıda bir artar; işletmeler birbirini etkilemez", async () => {
    expect(await bumpAlertEmailGeneration("org_a")).toBe(1);
    expect(await bumpAlertEmailGeneration("org_a")).toBe(2);
    expect(await bumpAlertEmailGeneration("org_b")).toBe(1);
  });

  it("🚨 tüketme TEK kullanımlık: güncel kuşak bir kez tüketilir, ikinci kez tüketilemez; eski / ileri kuşak tüketilemez", async () => {
    const g = await bumpAlertEmailGeneration("org_a");
    expect(await consumeAlertEmailGeneration("org_a", g + 1)).toBe(false);
    expect(await consumeAlertEmailGeneration("org_a", g)).toBe(true);
    expect(await consumeAlertEmailGeneration("org_a", g)).toBe(false);
    // Tüketme kuşağı ilerletti: sonraki artırma onun ÜSTÜNDEN devam eder.
    expect(await bumpAlertEmailGeneration("org_a")).toBe(g + 2);
    expect(await consumeAlertEmailGeneration("org_b", g)).toBe(false); // başka işletmenin satırı yok
  });

  it("eşzamanlı artırmalar aynı kuşağı iki kez vermez", async () => {
    const values = await Promise.all(Array.from({ length: 10 }, () => bumpAlertEmailGeneration("org_c")));
    expect(new Set(values).size).toBe(10);
    expect(Math.max(...values)).toBe(10);
  });

  it("🚨 Y7 (10-14): tüketme ile adres yazma ARASINDA ev sahibi adresi kaldırırsa KALDIRMA kazanır (eski alıcı geri gelmez)", async () => {
    const org = await prisma.organization.create({ data: { name: "Y7", alertEmail: null } });
    const g = await bumpAlertEmailGeneration(org.id);
    let host: Promise<void> | null = null;
    let hostDone = false;
    await applyAlertEmailVerification(
      { organizationId: org.id, generation: g, previous: null, email: "dis@ornek.com" },
      {
        afterConsume: async () => {
          // Ayarlar rotasının sırası: kuşağı artır, sonra adresi boşalt. Kilit tutuluyorsa artırma BEKLER → zaman aşımıyla devam.
          host = (async () => {
            await bumpAlertEmailGeneration(org.id);
            await prisma.organization.update({ where: { id: org.id }, data: { alertEmail: null } });
            hostDone = true;
          })();
          await Promise.race([host, new Promise((r) => setTimeout(r, 400))]);
        },
      },
    );
    await host;
    expect(hostDone).toBe(true);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).alertEmail).toBeNull();
  });

  it("KONTROL: araya bir şey girmezse onay adresi yazar; aynı bağlantı ikinci kez 'stale'", async () => {
    const org = await prisma.organization.create({ data: { name: "Y7b", alertEmail: null } });
    const g = await bumpAlertEmailGeneration(org.id);
    const claim = { organizationId: org.id, generation: g, previous: null, email: "dis@ornek.com" };
    expect(await applyAlertEmailVerification(claim)).toBe("applied");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).alertEmail).toBe("dis@ornek.com");
    expect(await applyAlertEmailVerification(claim)).toBe("stale");
  });

  it("savunma katmanı: kuşağı ARTIRMAYAN bir yazıcı adresi değiştirdiyse onay onu EZMEZ (CAS: eski adres hâlâ kayıtlı olmalı)", async () => {
    const org = await prisma.organization.create({ data: { name: "Y7c", alertEmail: null } });
    const g = await bumpAlertEmailGeneration(org.id);
    await prisma.organization.update({ where: { id: org.id }, data: { alertEmail: "ekip@ornek.com" } }); // kuşak artırılmadı
    expect(
      await applyAlertEmailVerification({ organizationId: org.id, generation: g, previous: null, email: "dis@ornek.com" }),
    ).toBe("changed");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).alertEmail).toBe("ekip@ornek.com");
  });
});
