import { describe, it, expect } from "vitest";
import {
  BINDING_CODE_ALPHABET,
  BINDING_CODE_MAX_ATTEMPTS,
  addressHash,
  bindingCodeHash,
  bindingUsable,
  extractBindingCode,
  hashesEqual,
  judgeBindingCode,
  maskE164,
  newBindingCode,
  normalizeE164Digits,
} from "@/lib/host-channel/binding-code";

// ---------------------------------------------------------------------------
// WhatsApp numara bağlama — saf parçalar (tasarım §5.4–5.5): kod üretimi / okunması, anahtarlı saklama, sabit zamanlı karşılaştırma, süre +
// deneme sınırı, oturum kuşağı. DB yok.
// ---------------------------------------------------------------------------

const SECRET = "test-secret-0123456789";

describe("kod üretimi", () => {
  it("LIXUS- + 6 simge, yalnız karışmayan alfabe (I, L, O, U yok); her bayt değeri geçerli simgeye düşer", () => {
    expect(BINDING_CODE_ALPHABET).toHaveLength(32);
    expect(BINDING_CODE_ALPHABET).not.toMatch(/[ILOU]/);
    for (let i = 0; i < 200; i++) expect(newBindingCode()).toMatch(/^LIXUS-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(newBindingCode(() => new Uint8Array([0, 31, 32, 255, 100, 7]))).toBe("LIXUS-0Z0Z47");
  });
});

describe("gelen metinde kod", () => {
  it.each([
    ["LIXUS-7F3K2Q", "LIXUS-7F3K2Q"],
    ["lixus-7f3k2q", "LIXUS-7F3K2Q"],
    ["Merhaba LIXUS 7F3K2Q teşekkürler", "LIXUS-7F3K2Q"],
    ["LIXUS7F3K2Q", "LIXUS-7F3K2Q"],
    // Elle yazımda karışan harfler kanonik biçime döner.
    ["LIXUS-7FOK2I", "LIXUS-7F0K21"],
    ["LIXUS-7F0KL2", "LIXUS-7F0K12"],
  ])("%j → %j", (text, code) => {
    expect(extractBindingCode(text)).toBe(code);
  });
  it.each(["", "merhaba", "LIXUS-7F3K2", "LIXUS-7F3K2QX", "XLIXUS-7F3K2Q", "LIXUS-7F3U2Q", "LIXUS--7F3K2Q"])("%j → null", (text) => {
    expect(extractBindingCode(text)).toBeNull();
  });
  it("uzun girdide doğrusal (50.000 karakter)", () => {
    const t0 = performance.now();
    extractBindingCode("lixus ".repeat(10_000));
    extractBindingCode("a".repeat(50_000));
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("saklama ve karşılaştırma", () => {
  it("kod düz saklanmaz; aynı kod aynı anahtarla aynı özet, başka anahtarla farklı", () => {
    const h = bindingCodeHash("LIXUS-7F3K2Q", SECRET);
    expect(h).not.toContain("7F3K2Q");
    expect(h).toBe(bindingCodeHash("LIXUS-7F3K2Q", SECRET));
    expect(h).not.toBe(bindingCodeHash("LIXUS-7F3K2Q", "baska-anahtar"));
    expect(hashesEqual(h, h)).toBe(true);
    expect(hashesEqual(h, h.slice(0, -1))).toBe(false);
    expect(hashesEqual(h, bindingCodeHash("LIXUS-7F3K2R", SECRET))).toBe(false);
  });
  it("numara anahtarı sağlayıcıya ve numaraya bağlı; düz numara özette yok", () => {
    const a = addressHash("whatsapp_cloud", "905321234567", SECRET);
    expect(a).not.toContain("5321234567");
    expect(a).not.toBe(addressHash("fake", "905321234567", SECRET));
    expect(a).not.toBe(addressHash("whatsapp_cloud", "905321234568", SECRET));
  });
  it("maskeli gösterim yalnız ülke kodu + son iki hane", () => {
    expect(maskE164("905321234567")).toBe("+90 ••• ••• •• 67");
    expect(maskE164("4915112345678")).toBe("+491 ••• ••• •• 78");
    expect(maskE164("123")).toBe("••••");
    expect(maskE164("905321234567")).not.toContain("532");
  });
});

describe("numara biçimi", () => {
  it.each([
    ["+90 532 123 45 67", "905321234567"],
    ["+90 (532) 123-45-67", "905321234567"],
    ["0090 532 123 45 67", "905321234567"],
    ["+49 151 12345678", "4915112345678"],
  ])("%j → %j", (raw, out) => {
    expect(normalizeE164Digits(raw)).toBe(out);
  });
  it.each(["0532 123 45 67", "5321234567", "+0 532 123", "+90 532", "+90 532 123 45 67 89 01 23", "+90abc", ""])("%j → null (ülke kodu tahmin edilmez)", (raw) => {
    expect(normalizeE164Digits(raw)).toBeNull();
  });
});

describe("kod hükmü", () => {
  const now = new Date("2026-10-30T20:00:00Z");
  const pending = (over: Partial<Parameters<typeof judgeBindingCode>[0]> = {}) => ({
    status: "pending",
    verifyCodeHash: bindingCodeHash("LIXUS-7F3K2Q", SECRET),
    verifyExpiresAt: new Date(now.getTime() + 60_000),
    verifyAttempts: 0,
    ...over,
  });
  it("doğru kod → ok; yanlış → mismatch", () => {
    expect(judgeBindingCode(pending(), "LIXUS-7F3K2Q", SECRET, now)).toBe("ok");
    expect(judgeBindingCode(pending(), "LIXUS-7F3K2R", SECRET, now)).toBe("mismatch");
  });
  it("süre dolmuş / deneme hakkı bitmiş / bekleyen değil → doğru kod da kabul EDİLMEZ", () => {
    expect(judgeBindingCode(pending({ verifyExpiresAt: now }), "LIXUS-7F3K2Q", SECRET, now)).toBe("expired");
    expect(judgeBindingCode(pending({ verifyAttempts: BINDING_CODE_MAX_ATTEMPTS }), "LIXUS-7F3K2Q", SECRET, now)).toBe("too_many_attempts");
    expect(judgeBindingCode(pending({ verifyAttempts: BINDING_CODE_MAX_ATTEMPTS - 1 }), "LIXUS-7F3K2Q", SECRET, now)).toBe("ok");
    expect(judgeBindingCode(pending({ status: "active" }), "LIXUS-7F3K2Q", SECRET, now)).toBe("not_pending");
    expect(judgeBindingCode(pending({ verifyCodeHash: null }), "LIXUS-7F3K2Q", SECRET, now)).toBe("not_pending");
    expect(judgeBindingCode(pending({ verifyExpiresAt: null }), "LIXUS-7F3K2Q", SECRET, now)).toBe("not_pending");
  });
  it("başka anahtarla üretilmiş özet eşleşmez", () => {
    expect(judgeBindingCode(pending(), "LIXUS-7F3K2Q", "baska-anahtar", now)).toBe("mismatch");
  });
});

describe("bağlantı kullanılabilir mi (oturum kuşağı)", () => {
  it("yalnız etkin + kuşak aynı", () => {
    expect(bindingUsable({ status: "active", userSessionEpoch: 3 }, 3)).toBe(true);
    expect(bindingUsable({ status: "active", userSessionEpoch: 3 }, 4)).toBe(false);
    expect(bindingUsable({ status: "pending", userSessionEpoch: 3 }, 3)).toBe(false);
    expect(bindingUsable({ status: "revoked", userSessionEpoch: 3 }, 3)).toBe(false);
  });
});
