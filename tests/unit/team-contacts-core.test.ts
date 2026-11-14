import { describe, it, expect } from "vitest";
import {
  STAFF_CODE_PREFIX,
  STAFF_CODE_TTL_MS,
  extractStaffCode,
  isUndeliverableEmail,
  judgeStaffCode,
  newStaffCode,
  normalizeTeamContactName,
  staffCodeHash,
  staffWaMeLink,
  teamContactEmail,
} from "@/lib/team-contacts/core";
import { teamContactsEnabled, teamPhoneNumberId } from "@/lib/team-contacts/flag";
import { extractBindingCode } from "@/lib/host-channel/binding-code";

// EKİP KİŞİSİ saf kuralları (T3; tasarım docs/TASARIM-2026-11-13-temizlikci-akisi-whatsapp-yedek.md §9 İ3 / İ5, §10).

describe("ekip kişisi — yapay e-posta", () => {
  it("her zaman .invalid alan adında ve tahmin edilemez (24 onaltılık hane)", () => {
    const a = teamContactEmail();
    const b = teamContactEmail();
    expect(a).toMatch(/^team-[0-9a-f]{24}@team\.invalid$/);
    expect(a).not.toBe(b);
    expect(isUndeliverableEmail(a)).toBe(true);
  });

  it("ulaşılamaz adres: .invalid ve alt alan adları, büyük harf / sondaki nokta; gerçek adresler DEĞİL", () => {
    expect(isUndeliverableEmail("x@team.invalid")).toBe(true);
    expect(isUndeliverableEmail("x@INVALID")).toBe(true);
    expect(isUndeliverableEmail("x@a.b.invalid.")).toBe(true);
    expect(isUndeliverableEmail("yok-at-isareti")).toBe(true);
    expect(isUndeliverableEmail("host@example.com")).toBe(false);
    expect(isUndeliverableEmail("a@invalid.com")).toBe(false);
    expect(isUndeliverableEmail("a@notinvalid")).toBe(false);
  });
});

describe("ekip kişisi — ad", () => {
  it("boşluk sadeleşir, görünmez / denetim karakteri düşer, 80 karakter tavanı; boş → null", () => {
    expect(normalizeTeamContactName("  Ayşe   Yılmaz ")).toBe("Ayşe Yılmaz");
    expect(normalizeTeamContactName("A\u200by\u0007şe")).toBe("Ayşe");
    expect(normalizeTeamContactName("x".repeat(200))).toHaveLength(80);
    expect(normalizeTeamContactName("   ")).toBeNull();
    expect(normalizeTeamContactName("\u200b")).toBeNull();
    expect(normalizeTeamContactName(42)).toBeNull();
  });
});

describe("personel kodu", () => {
  it("biçim EKIP- + 6 karakter; ev sahibi kod ayıklayıcısı onu TANIMAZ (iki akış karışmaz)", () => {
    const code = newStaffCode();
    expect(code).toMatch(/^EKIP-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(extractBindingCode(code)).toBeNull();
    expect(extractStaffCode("LIXUS-7F3K2Q")).toBeNull();
  });

  it("elle yazım varyantları kanonik biçime döner", () => {
    expect(extractStaffCode("EKIP-7F3K2Q")).toBe("EKIP-7F3K2Q");
    expect(extractStaffCode("merhaba ekip 7f3k2q")).toBe("EKIP-7F3K2Q");
    expect(extractStaffCode("ekip7f3k2q")).toBe("EKIP-7F3K2Q");
    expect(extractStaffCode("Ekİp-7F3K2Q")).toBe("EKIP-7F3K2Q");
    expect(extractStaffCode("ekıp-7f3k2q")).toBe("EKIP-7F3K2Q");
    expect(extractStaffCode("EKIP-OI1L00")).toBe("EKIP-011100");
  });

  it("sözcük içinde ya da eksik / fazla karakterle kod sayılmaz", () => {
    expect(extractStaffCode("takipEKIP-7F3K2Q")).toBeNull();
    expect(extractStaffCode("EKIP-7F3K2")).toBeNull();
    expect(extractStaffCode("EKIP-7F3K2QX")).toBeNull();
    expect(extractStaffCode("EKIP-7F3U2Q")).toBeNull(); // U alfabede yok
    expect(extractStaffCode("ekip toplantısı yarın")).toBeNull();
  });

  it("özet anahtara ve koda bağlı; ev sahibi kod özetinden farklı alan adı", () => {
    const s = "s".repeat(40);
    expect(staffCodeHash("EKIP-AAAAAA", s)).toBe(staffCodeHash("EKIP-AAAAAA", s));
    expect(staffCodeHash("EKIP-AAAAAA", s)).not.toBe(staffCodeHash("EKIP-AAAAAB", s));
    expect(staffCodeHash("EKIP-AAAAAA", s)).not.toBe(staffCodeHash("EKIP-AAAAAA", "t".repeat(40)));
  });

  it("hüküm: yalnız bekleyen + süresi dolmamış; tam bitiş anında süresi dolmuş", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    const ok = { status: "pending", codeHash: "h", codeExpiresAt: new Date(now.getTime() + 1) };
    expect(judgeStaffCode(ok, now)).toBe("ok");
    expect(judgeStaffCode({ ...ok, codeExpiresAt: now }, now)).toBe("expired");
    expect(judgeStaffCode({ ...ok, status: "active" }, now)).toBe("not_pending");
    expect(judgeStaffCode({ ...ok, codeHash: null }, now)).toBe("not_pending");
    expect(STAFF_CODE_TTL_MS).toBe(72 * 3_600_000);
    expect(STAFF_CODE_PREFIX).toBe("EKIP-");
  });
});

describe("wa.me bağlantısı + anahtarlar", () => {
  it("numara rakama iner; geçersizse null; kod metne kodlanır", () => {
    expect(staffWaMeLink("+90 555 000 11 22", "EKIP-AAAAAA")).toBe("https://wa.me/905550001122?text=EKIP-AAAAAA");
    expect(staffWaMeLink(undefined, "EKIP-AAAAAA")).toBeNull();
    expect(staffWaMeLink("abc", "EKIP-AAAAAA")).toBeNull();
  });

  it("anahtar yalnız '1' ile açılır; temizlikçi numara kimliği ev sahibininkiyle aynıysa yok sayılır", () => {
    expect(teamContactsEnabled({ TEAM_CONTACTS_ENABLED: "1" })).toBe(true);
    expect(teamContactsEnabled({ TEAM_CONTACTS_ENABLED: "true" })).toBe(false);
    expect(teamPhoneNumberId({ TEAM_WHATSAPP_PHONE_NUMBER_ID: "222222222", WHATSAPP_PHONE_NUMBER_ID: "111111111" })).toBe("222222222");
    expect(teamPhoneNumberId({ TEAM_WHATSAPP_PHONE_NUMBER_ID: "111111111", WHATSAPP_PHONE_NUMBER_ID: "111111111" })).toBeNull();
    expect(teamPhoneNumberId({ TEAM_WHATSAPP_PHONE_NUMBER_ID: "12ab" })).toBeNull();
  });
});
