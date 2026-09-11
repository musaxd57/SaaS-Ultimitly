import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { signSession, verifySession, type SessionPayload } from "@/lib/auth/session";

// AUTH_SECRET is injected via vitest.config.ts (test.env).

const payload: SessionPayload = {
  userId: "u1",
  organizationId: "org1",
  role: "owner",
  email: "demo@guestops.ai",
  name: "Demo Sahibi",
  sessionEpoch: 0,
};

describe("session JWT", () => {
  it("round-trips a signed session", async () => {
    const token = await signSession(payload);
    expect(typeof token).toBe("string");

    const verified = await verifySession(token);
    expect(verified).toMatchObject(payload);
  });

  it("returns null for a missing token", async () => {
    expect(await verifySession(undefined)).toBeNull();
  });

  it("returns null for a malformed token", async () => {
    expect(await verifySession("not.a.jwt")).toBeNull();
  });

  // 🚨 BU TEST KIRILGANDI ve CI'da RASTGELE KIRMIZI VERİYORDU (09-11, ölçüldü).
  //
  // Eski hâli SON İKİ karakteri değiştiriyordu:
  //   token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa")
  //
  // HS256 imzası 32 BAYT = 43 base64url karakter. 43 × 6 = 258 bit, ama anlamlı
  // olan yalnız 256 — yani SON karakterin sadece İLK 2 BİTİ imzaya girer, kalan
  // 4 bit ATILIR. Dolayısıyla son karakteri değiştirmek imzayı DEĞİŞTİRMEYEBİLİR.
  // Eski tamper, sondan ikinci karakter zaten hedef harfse VE son karakterin üst
  // 2 biti tutuyorsa BAYT BAYT AYNI imzayı üretiyordu → token geçerli kalıyor →
  // test haklı olarak kırmızı. ÖLÇÜLDÜ: 64×64 son-iki-karakter kombinasyonunun
  // 16'sı çarpışıyor = **%0,39** koşu başına kırılganlık.
  //
  // Yeni tamper İMZANIN ORTASINDAN bir karakter değiştirir: ortadaki her karakter
  // 6 BİTİN TAMAMINI taşır, yani farklı karakter = farklı imza, ÇARPIŞMA YOK.
  it("rejects a tampered token (imza baytı GERÇEKTEN değişir)", async () => {
    const token = await signSession(payload);
    const [head, body, sig] = token.split(".");
    expect(sig.length, "HS256 imzası 43 base64url karakter olmalı").toBe(43);
    const at = Math.floor(sig.length / 2); // tam ortada: 6 bitin tamamı anlamlı
    const swapped = sig[at] === "A" ? "B" : "A";
    const tampered = `${head}.${body}.${sig.slice(0, at)}${swapped}${sig.slice(at + 1)}`;
    expect(tampered).not.toBe(token); // anti-vakum: gerçekten değiştirdik
    expect(await verifySession(tampered)).toBeNull();
  });

  it("NEDEN son karakter kurcalanamaz — çarpışma sınıfı PİNLİ (kripto yok, saf hesap)", () => {
    // Bu satır olmadan yukarıdaki yorum bir iddia; burada ÖLÇÜLÜYOR.
    // base64url alfabesinde son karakterin yalnız ÜST 2 BİTİ imzaya girer.
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const top2 = (c: string) => A.indexOf(c) >> 4;
    // Eski tamper'ın kullandığı iki harf, SON konumda BİRBİRİNİN AYNISI:
    expect(top2("a")).toBe(top2("b"));
    // Ortadaki bir karakterde böyle bir kayıp YOK — 6 bitin tamamı anlamlı:
    expect(A.indexOf("A")).not.toBe(A.indexOf("B"));
  });

  it("🚨 GÖVDE kurcalanırsa da reddedilir (imza dışı yüzey)", async () => {
    // İmzayı bozmak tek saldırı değil: asıl tehlike GÖVDEYİ değiştirip imzayı
    // olduğu gibi bırakmaktır (rol yükseltme, başka org'a geçiş). Eski test bu
    // yönü hiç ölçmüyordu.
    const token = await signSession(payload);
    const [head, , sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload, role: "owner", organizationId: "BASKA_ORG" }),
    ).toString("base64url");
    expect(await verifySession(`${head}.${forged}.${sig}`)).toBeNull();
  });

  it("carries a non-zero sessionEpoch through sign/verify", async () => {
    const token = await signSession({ ...payload, sessionEpoch: 7 });
    expect((await verifySession(token))?.sessionEpoch).toBe(7);
  });

  it("carries the operator's actorSessionEpoch through an impersonation session", async () => {
    const token = await signSession({
      ...payload,
      email: "customer@client.com",
      organizationId: "org2",
      actorUserId: "operator1",
      actorEmail: "operator@example.com",
      actorName: "Operator",
      actorSessionEpoch: 3,
    });
    const verified = await verifySession(token);
    expect(verified?.actorUserId).toBe("operator1");
    expect(verified?.actorSessionEpoch).toBe(3); // used to kill a stolen impersonation token on operator reset
  });

  it("leaves actorSessionEpoch undefined on a session that isn't impersonating (guard skips the actor check)", async () => {
    const verified = await verifySession(await signSession(payload));
    expect(verified?.actorSessionEpoch).toBeUndefined();
  });

  it("defaults a legacy token (no sessionEpoch claim) to epoch 0 — matches the DB default so the deploy that adds this never mass-logs-out", async () => {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const legacy = await new SignJWT({
      userId: "u1",
      organizationId: "org1",
      role: "owner",
      email: "demo@guestops.ai",
      name: "Demo Sahibi",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("14d")
      .sign(secret);
    const verified = await verifySession(legacy);
    expect(verified).not.toBeNull();
    expect(verified?.sessionEpoch).toBe(0);
  });
});
