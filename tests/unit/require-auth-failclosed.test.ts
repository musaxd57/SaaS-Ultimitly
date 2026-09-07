import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";

// requireAuth (lib/auth) runs on every page-segment render (soft-nav doesn't
// re-run the layout). It refreshes the DB-authoritative role and enforces the
// epoch. This pins the fail-mode contract: on a DB read error it keeps the
// (signature-valid) session ALIVE — no mass-logout — but clamps the role to the
// least-privileged "staff" so a just-demoted / stolen-elevated token can't render
// owner/manager-gated views during the outage.

// Feed getSession a real signed cookie, and drive the DB read per-test.
let TOKEN = "";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (TOKEN ? { value: TOKEN } : undefined) }),
}));

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));

// redirect() normally throws NEXT_REDIRECT; make it a detectable sentinel.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { requireAuth } from "@/lib/auth";
import { signSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/admin-core";

const base: SessionPayload = {
  userId: "u1",
  organizationId: "o1",
  role: "manager",
  email: "m@x.com",
  name: "M",
  sessionEpoch: 0,
};

describe("requireAuth — fail-open session, fail-closed capability", () => {
  beforeEach(async () => {
    findUnique.mockReset();
    TOKEN = await signSession(base);
  });

  it("clamps role to staff when the DB role read throws (capability fail-closed, session kept)", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    const s = await requireAuth();
    expect(s.role).toBe("staff"); // no stale "manager" during the blip
    expect(s.organizationId).toBe("o1"); // session stays alive — not logged out
  });

  it("uses the DB-current role when the read succeeds (demoted manager → staff)", async () => {
    findUnique.mockResolvedValue({ sessionEpoch: 0, role: "staff", organizationId: "o1" });
    const s = await requireAuth();
    expect(s.role).toBe("staff");
  });

  it("keeps owner when the DB confirms it and the epoch matches", async () => {
    findUnique.mockResolvedValue({ sessionEpoch: 0, role: "owner", organizationId: "o1" });
    const s = await requireAuth();
    expect(s.role).toBe("owner");
  });

  it("redirects to logout on an epoch mismatch (stolen/reset token, DB reachable)", async () => {
    findUnique.mockResolvedValue({ sessionEpoch: 5, role: "manager", organizationId: "o1" });
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("redirects to logout when the user no longer exists", async () => {
    findUnique.mockResolvedValue(null);
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("redirects to login when there is no session cookie", async () => {
    TOKEN = "";
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/login");
  });
});

// ---------------------------------------------------------------------------
// OPERATÖR YETKİSİ SAYFA YOLUNDA DA DOĞRULANIR (08-06 — denetim ajanı bulgusu)
//
// 🚨 KAPATILAN AÇIK: aynı kapı 08-01'de YALNIZ `requireSession`'a (API yolu,
// `api.ts:54`) eklenmişti ve kendi yorumu amacı açıkça yazıyor: "Env'den silmek
// etkili bir iptal aracı olmalı". SAYFA yolu (`requireAuth` → 22 sayfa +
// `(app)/layout.tsx`) o kapıyı HİÇ taşımıyordu; yalnız aktörün EPOCH'una
// bakıyordu ve dosya `admin`'i import bile etmiyordu.
//
// Sonuç: bir e-postayı `SUPERADMIN_EMAILS`'ten silmek `/api/*`'ı 401'liyor ama
// `/inbox`, `/dashboard`, `/guest-chats`, `/reports` … RENDER OLMAYA DEVAM
// ediyordu ve `session.organizationId` hâlâ MÜŞTERİNİN org'uydu → misafir
// adları, mesaj gövdeleri, rezervasyonlar okunabiliyordu. `/api/admin/exit` de
// 401 döndüğü için kişi müşteri org'unda KİLİTLİ ve OKUYABİLİR kalıyordu;
// middleware çerezi her sayfa görüntülemesinde 14 gün ileri ittiği için pencere
// kendiliğinden hiç kapanmıyordu.
// ---------------------------------------------------------------------------
describe("requireAuth — impersonation yetkisi her render'da doğrulanır", () => {
  const OPERATOR = "ops@lixusai.com";

  /** Operatörün müşteri org'una girdiği oturum. */
  const impersonation: SessionPayload = {
    ...base,
    role: "owner",
    actorUserId: "op1",
    actorEmail: OPERATOR,
    actorName: "Operator",
    actorSessionEpoch: 0,
    // `isSuperAdmin` İKİ koşul ister: e-posta listede VE bu oturum ikinci
    // faktörden geçmiş (08-05). Taban oturum iddiayı taşır ki ölçülen şey
    // env'den silmenin etkisi olsun.
    mfa: true,
  } as SessionPayload;

  beforeEach(() => {
    // DB tarafı SAĞLIKLI: epoch uyuyor, rol/org okunabiliyor. Böylece bir
    // redirect görürsek sebebi KESİNLİKLE yetki kapısıdır, epoch/DB değil.
    // ⚠️ `twoFactorEnabledAt` EKLENDİ (08-09): `requireAuth` artık `mfa`
    // iddiasını AKTÖRÜN satırından doğruluyor, yani "operatörün 2FA'sı duruyor"
    // bu senaryonun ön koşulu. Bunu ölçülen sebebi şu: DÜRÜST OLMAK GEREKİRSE
    // 2FA'sı olmayan bir hesabın `mfa:true` taşıması ÜRETİMDE MÜMKÜNDÜR —
    // kişi 2FA açıkken giriş yapar (`login` `true` damgalar), sonra 2FA'yı
    // kapatır ve `disable` epoch'u ARTIRMADIĞI için canlı oturum iddiayı
    // taşımaya devam eder. Zaten bu değişikliğin VAR OLMA SEBEBİ o durum.
    // Dolayısıyla buradaki ekleme "o durum olamaz" demek DEĞİL; bu testin
    // ölçtüğü şeyin (SUPERADMIN_EMAILS'ten silmenin etkisi) tek değişken
    // kalması için diğer değişkeni sabitlemek. Yeni eklenen boyut ayrıca
    // kendi testleriyle pinli (↑"mfa iddiası sayfa yolunda da doğrulanır").
    findUnique.mockResolvedValue({
      sessionEpoch: 0,
      role: "owner",
      organizationId: "o1",
      twoFactorEnabledAt: new Date(),
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  // 🚨 SAYFA YOLUNDAKİ İKİ SATIR PİNSİZDİ (savunmacı denetim 08-09).
  // Ölçüldü: (1) `if (session.actorUserId && !isSuperAdmin(session)) invalid = true;`
  // satırını SİLMEK ve (2) fail-safe koşulu `(factorRow != null && …)`e
  // çevirmek — İKİSİ DE 8 dosya / 67 testi YEŞİL bırakıyordu. Oysa (1), sayfa
  // yolunun genişletilmesinin TEK sebebiydi ve (2) legacy token boşluğunun
  // kapağı. Yeni describe yalnız impersonation OLMAYAN oturum imzalıyordu,
  // yani aktör dalına hiç girmiyordu. Aşağıdaki iki test o boşluğu kapatıyor.
  it("AKTÖRÜN 2FA'sı kaldırılmışsa sayfa yolu oturumu DÜŞÜRÜR", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
    // Müşteri satırı sağlıklı; AKTÖR satırında 2FA yok.
    findUnique
      .mockResolvedValueOnce({ sessionEpoch: 0, role: "owner", organizationId: "o1", twoFactorEnabledAt: new Date() })
      .mockResolvedValueOnce({ sessionEpoch: 0, twoFactorEnabledAt: null });
    TOKEN = await signSession(impersonation);
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("epoch iddiası OLMAYAN legacy token da DÜŞER (fail-safe)", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
    // `actorSessionEpoch` yok → aktör satırı HİÇ okunmaz → iddia doğrulanamaz.
    const legacy = { ...impersonation } as Record<string, unknown>;
    delete legacy.actorSessionEpoch;
    findUnique.mockResolvedValue({
      sessionEpoch: 0,
      role: "owner",
      organizationId: "o1",
      twoFactorEnabledAt: new Date(),
    });
    TOKEN = await signSession(legacy as unknown as SessionPayload);
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("yetki DURUYORSA sayfa render olur (regresyon pini)", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
    TOKEN = await signSession(impersonation);
    await expect(requireAuth()).resolves.toMatchObject({ actorEmail: OPERATOR });
  });

  it("e-posta SUPERADMIN_EMAILS'ten SİLİNİNCE sayfa yolu da oturumu DÜŞÜRÜR", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "someone-else@lixusai.com");
    TOKEN = await signSession(impersonation);
    // ⬅️ ARIZADA: çözülür, sayfa render olur, müşterinin misafir PII'si görünür.
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("liste tamamen BOŞALINCA da düşer (fail-closed)", async () => {
    vi.stubEnv("SUPERADMIN_EMAILS", "");
    TOKEN = await signSession(impersonation);
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("`mfa` iddiası YOKSA da düşer — API yoluyla AYNI kural", async () => {
    // Sayfa yolunun yalnız e-posta koşulunu uygulaması, kapıyı API yolundan
    // DAHA GEVŞEK yapardı; iki yol ayrışamaz.
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR);
    const withoutMfa = { ...impersonation };
    delete (withoutMfa as { mfa?: boolean }).mfa;
    TOKEN = await signSession(withoutMfa as SessionPayload);
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("NORMAL müşteri oturumu ETKİLENMEZ (yanlış-pozitif pini)", async () => {
    // Kapı YALNIZ impersonation oturumlarını ilgilendirir. Bu olmadan
    // "herkesi düşür" gibi bir kaza da testten geçerdi.
    vi.stubEnv("SUPERADMIN_EMAILS", "");
    TOKEN = await signSession(base); // actorUserId YOK
    await expect(requireAuth()).resolves.toMatchObject({ userId: "u1" });
  });
});

// ---------------------------------------------------------------------------
// 🚨 `mfa` İDDİASI SAYFA YOLUNDA DA DÜŞER (denetim 08-09).
//
// Düzeltme ilk turda YALNIZ `requireSession`'a (API yolu) konmuştu ve iki
// bağımsız inceleme de bunu BLOKLAYICI saydı: `/admin` sayfası `requireAuth`
// üzerinden TAM RENDER oluyor (her org, abonelik, 50 lead, 50 denetim satırı —
// sunucuda doğrudan `prisma` ile okunuyor) ama sayfadaki HER DÜĞME
// `requireSession`'a gittiği için 401 dönüyordu. Kurucu için "çalışıyor
// görünen ama hiçbir şey yapmayan panel". Yarım uygulanmış bir kapı,
// uygulanmamış olandan daha kötüdür.
// ---------------------------------------------------------------------------
describe("requireAuth — mfa iddiası sayfa yolunda da doğrulanır", () => {
  beforeEach(async () => {
    findUnique.mockReset();
    TOKEN = await signSession({ ...base, role: "owner", mfa: true });
  });

  it("2FA silinmiş hesapta iddia DÜŞER (oturum YAŞAR)", async () => {
    findUnique.mockResolvedValue({
      sessionEpoch: 0,
      role: "owner",
      organizationId: "o1",
      twoFactorEnabledAt: null,
    });
    const s = await requireAuth();
    expect(s.organizationId).toBe("o1"); // kimse çıkışa atılmadı
    expect(s.mfa).toBe(false); // operatör yetkisi kapandı
  });

  it("KONTROL: 2FA AÇIKKEN iddia KORUNUR", async () => {
    // Bu olmadan "iddiayı her zaman düşür" mutasyonu da yeşil geçerdi.
    findUnique.mockResolvedValue({
      sessionEpoch: 0,
      role: "owner",
      organizationId: "o1",
      twoFactorEnabledAt: new Date(),
    });
    expect((await requireAuth()).mfa).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 🚨 DB ARIZASINDA `mfa` İDDİASI DA DÜŞER (Codex F06 — P1, koşullu)
  //
  // Eski pin tam tersini söylüyordu ("iddia OLDUĞU GİBİ kalır, belgelenmiş
  // taviz"). Ama `isSuperAdmin` tenant ROLÜNE değil e-posta allowlist'i + `mfa`
  // iddiasına bakar; catch dalı yalnız rolü staff'a kısıyordu, iddia korunuyordu
  // → `/admin` sayfası DB'nin doğrulayamadığı bir oturumla TAM RENDER oluyordu
  // (her org, abonelik, lead, denetim satırı). API yolu (`requireSession`)
  // aynı hâlde fail-closed; sayfa yolu asimetrikti. Codex: "izinli kurucu
  // oturumu, DB lookup hatası sonrası role=staff, mfa=true, isSuperAdmin=true".
  // Doğrulanamayan ayrıcalık ayrıcalık DEĞİLDİR: oturum yaşar (kitlesel çıkış
  // yok), yetki İKİ eksende kısılır — rol staff, operatör iddiası düşer.
  // -------------------------------------------------------------------------
  it("🚨 DB arızasında iddia DÜŞER — oturum yaşar, operatör yetkisi kapanır", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    const s = await requireAuth();
    expect(s.role).toBe("staff");
    expect(s.organizationId).toBe("o1"); // kimse çıkışa atılmadı
    expect(s.mfa).toBe(false); // ⬅️ ARIZADA: true (doğrulanmamış ayrıcalık korunuyordu)
  });
});

describe("requireAuth — operatör sayfası DB arızasında fail-closed (F06)", () => {
  const FOUNDER = "founder@lixusai.com";
  beforeEach(async () => {
    findUnique.mockReset();
    vi.stubEnv("SUPERADMIN_EMAILS", FOUNDER);
    TOKEN = await signSession({ ...base, email: FOUNDER, role: "owner", mfa: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 Codex kanıtı: izinli kurucu oturumu + DB lookup hatası → isSuperAdmin FALSE (sayfa yetki vermez)", async () => {
    // `/admin/page.tsx` tam olarak bunu yapar: requireAuth → isSuperAdmin → değilse redirect.
    findUnique.mockRejectedValue(new Error("db down"));
    const s = await requireAuth();
    expect(isSuperAdmin(s)).toBe(false); // ⬅️ ARIZADA: true — çapraz-kiracı veri okunurdu
  });

  it("KONTROL: DB sağlıklı + 2FA açıkken kurucu yetkisi KORUNUR (aşırı-uygulama değil)", async () => {
    // Bu olmadan "iddiayı her zaman düşür" mutasyonu da yeşil geçerdi.
    findUnique.mockResolvedValue({ sessionEpoch: 0, role: "owner", organizationId: "o1", twoFactorEnabledAt: new Date() });
    const s = await requireAuth();
    expect(isSuperAdmin(s)).toBe(true);
    expect(s.role).toBe("owner");
  });

  it("IMPERSONATION oturumu DB arızasında müşteri org'unda KALMAZ — çıkış (ayrıcalıklı bağlam fail-closed)", async () => {
    // Müşteri satırı okunur, AKTÖR satırı okunurken arıza → kısmi doğrulama yeterli
    // değil; normal müşteri oturumunun fail-open tavizi impersonation'a UYGULANMAZ.
    findUnique
      .mockResolvedValueOnce({ sessionEpoch: 0, role: "owner", organizationId: "o1", twoFactorEnabledAt: new Date() })
      .mockRejectedValueOnce(new Error("db down"));
    TOKEN = await signSession({
      ...base,
      role: "owner",
      actorUserId: "op1",
      actorEmail: FOUNDER,
      actorName: "Founder",
      actorSessionEpoch: 0,
      mfa: true,
    } as SessionPayload);
    await expect(requireAuth()).rejects.toThrow("REDIRECT:/api/auth/logout");
  });

  it("KONTROL: normal müşteri oturumu DB arızasında YAŞAR (fail-open korunur, kitlesel çıkış yok)", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    TOKEN = await signSession(base); // actorUserId YOK, superadmin değil
    const s = await requireAuth();
    expect(s.userId).toBe("u1");
    expect(s.role).toBe("staff");
  });
});
