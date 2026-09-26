import { describe, it, expect, beforeAll } from "vitest";
import { signSession, verifySession, type SessionPayload } from "@/lib/auth/session";

// ---------------------------------------------------------------------------
// OTURUM CLAIM'LERİ İMZALA→DOĞRULA TURUNDAN SAĞ ÇIKIYOR MU?
//
// 🚨 GERÇEK ARIZA (08-05, CANLIDA): `mfa` claim'i eklendi, `signSession` onu
// token'a yazdı, ama `verifySession` payload'ı ALAN ALAN BEYAZ LİSTEYLE yeniden
// kurduğu için okurken SESSİZCE DÜŞÜRDÜ. Sonuç: `isSuperAdmin` HERKESTE false
// döndü, Operatör Paneli üretimde kayboldu ve tekrar giriş yapmak da
// çözmedi — `middleware.ts` doğrulama çıktısını yeniden imzaladığı için claim
// bir sonraki istekte çerezden de siliniyordu.
//
// O turda `admin.test.ts` YEŞİLDİ çünkü `isSuperAdmin`'i DÜZ NESNEYLE çağırıyor:
// KARAR pinlenmişti, TAŞIMA pinlenmemişti. Bu dosya o boşluğu kapatır.
//
// ⚠️ Test tek tek alan saymaz — TAM NESNE karşılaştırması yapar. Böylece
// `SessionPayload`'a eklenip `verifySession`'a eklenmeyen HER yeni alan
// otomatik olarak kırmızı verir; bir sonraki kişi aynı tuzağa düşemez.
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.AUTH_SECRET = "roundtrip-test-secret-not-used-anywhere-42";
});

/** Her opsiyonel alan DAHİL, eksiksiz bir oturum. */
const FULL: Required<SessionPayload> = {
  userId: "u1",
  organizationId: "o1",
  role: "owner",
  email: "operator@example.com",
  name: "Operatör",
  sessionEpoch: 7,
  actorUserId: "actor1",
  actorEmail: "actor@example.com",
  actorName: "Gerçek Operatör",
  actorSessionEpoch: 3,
  mfa: true,
};

describe("oturum claim'leri imzala→doğrula turunu geçiyor", () => {
  it("EKSİKSİZ payload birebir geri geliyor (yeni alan eklendiğinde kırmızı)", async () => {
    const back = await verifySession(await signSession(FULL));
    expect(back).toEqual(FULL);
  });

  it("her alan TEK TEK sağ çıkıyor (hangi alanın düştüğü mesajda görünsün)", async () => {
    const back = await verifySession(await signSession(FULL));
    for (const key of Object.keys(FULL) as (keyof SessionPayload)[]) {
      expect(back?.[key], `"${key}" claim'i doğrulamada DÜŞÜYOR`).toEqual(FULL[key]);
    }
  });

  // ── `mfa`ya özel: operatör yetkisinin dayandığı claim ──────────────────────
  it("mfa:true tur sonunda HÂLÂ true (operatör paneli buna bağlı)", async () => {
    expect((await verifySession(await signSession({ ...FULL, mfa: true })))?.mfa).toBe(true);
  });

  it("mfa:false true'ya dönüşmüyor (yanlış yön de pinli)", async () => {
    expect((await verifySession(await signSession({ ...FULL, mfa: false })))?.mfa).toBe(false);
  });

  it("mfa YOKSA undefined kalır — uydurulmaz (eski token'lar yetki almaz)", async () => {
    const { mfa: _unused, ...legacy } = FULL;
    void _unused;
    const back = await verifySession(await signSession(legacy as SessionPayload));
    expect(back?.mfa).toBeUndefined();
  });

  it("mfa boolean DEĞİLSE atılır (kurcalanmış/bozuk claim yetki vermez)", async () => {
    // Beyaz listenin tip kontrolü yalnız `boolean` kabul eder; "true" dizesi ya
    // da 1 gibi truthy değerler `isSuperAdmin`'in `=== true` şartını zaten
    // geçemez, ama payload'a hiç girmemeleri daha temiz bir sözleşme.
    const forged = await signSession({ ...FULL, mfa: "true" as unknown as boolean });
    expect((await verifySession(forged))?.mfa).toBeUndefined();
  });

  // ── SLIDING SESSION: middleware çıktıyı YENİDEN İMZALIYOR ─────────────────
  it("yeniden imzalama claim'i KAYBETMİYOR (middleware her istekte bunu yapıyor)", async () => {
    // Canlıdaki arızanın ikinci yarısı buydu: doğrulama claim'i düşürdükten
    // sonra middleware o eksik payload'ı yeniden imzalıyor, yani tek bir istek
    // claim'i çerezden KALICI olarak siliyordu. Üç tur sonra hâlâ durmalı.
    let token = await signSession(FULL);
    for (let i = 0; i < 3; i++) {
      const s = await verifySession(token);
      expect(s?.mfa, `${i + 1}. yeniden imzalamada mfa düştü`).toBe(true);
      token = await signSession(s!);
    }
  });
});
