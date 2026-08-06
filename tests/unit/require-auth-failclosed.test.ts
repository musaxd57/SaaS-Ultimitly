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
    findUnique.mockResolvedValue({ sessionEpoch: 0, role: "owner", organizationId: "o1" });
  });
  afterEach(() => vi.unstubAllEnvs());

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
