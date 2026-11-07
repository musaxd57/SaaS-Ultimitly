import { describe, it, expect } from "vitest";
import { membershipMatchesSession } from "@/lib/membership/session";

// ---------------------------------------------------------------------------
// M-2 dilim 2 (Opus S9): oturumu taşıyabilecek üyelik kuralı — durum · kuşak · kimlik, iddiasız eski belirteç.
// ---------------------------------------------------------------------------

const row = { id: "m1", role: "staff", status: "active", epoch: 2 };

describe("membershipMatchesSession", () => {
  it.each([
    ["etkin + kuşak aynı + kimlik aynı", row, { membershipId: "m1", membershipEpoch: 2 }, true],
    ["kimlik iddiası yok (eski belirteç) + kuşak aynı", row, { membershipEpoch: 2 }, true],
    ["çıkarılmış", { ...row, status: "revoked" }, { membershipId: "m1", membershipEpoch: 2 }, false],
    ["etkin olmayan başka durum (ör. ileride davet bekleyen)", { ...row, status: "invited" }, { membershipId: "m1", membershipEpoch: 2 }, false],
    ["kuşak farklı", row, { membershipId: "m1", membershipEpoch: 1 }, false],
    ["kuşak iddiası yok → 0 sayılır (satır 2)", row, { membershipId: "m1" }, false],
    ["kuşak iddiası yok + satır 0 → geçer", { ...row, epoch: 0 }, {}, true],
    ["kimlik farklı (yeniden alınmış üyelik)", row, { membershipId: "m2", membershipEpoch: 2 }, false],
    ["satır yok", null, { membershipEpoch: 2 }, false],
    ["satır tanımsız", undefined, {}, false],
  ] as const)("%s", (_label, m, session, expected) => {
    expect(membershipMatchesSession(m, session)).toBe(expected);
  });
});
