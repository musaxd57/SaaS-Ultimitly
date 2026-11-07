import { describe, it, expect } from "vitest";
import { extractAdvisories } from "../../scripts/audit-check.mjs";

// ---------------------------------------------------------------------------
// ZAFİYET KAPISI: GHSA KİMLİĞİ OLMAYAN DANIŞMA SESSİZCE ATLANMAZ (09-23, denetim ajanı)
//
// `extractAdvisories` kimliği danışmanın URL'sinden `GHSA-…` diye çekiyordu ve
// bulamadığında `continue` ediyordu. npm'in eski `/advisories/<no>` biçimi ya da url
// alanı eksik bir kayıt böylece HİÇ sayılmıyordu: `npm audit` zafiyet raporlarken kapı
// yeşil kalıyordu — bir tedarik zinciri kapısının en kötü arıza modu (fail-open).
// ---------------------------------------------------------------------------

const auditOf = (via: unknown[]) => ({ vulnerabilities: { pkg: { via } } });

describe("extractAdvisories", () => {
  it("🚨 url'sinde GHSA olmayan danışma SAYILIR (kararlı yedek kimlikle)", () => {
    const found = extractAdvisories(
      auditOf([{ source: 1234, name: "left-pad", severity: "high", title: "RCE", url: "https://npmjs.com/advisories/1234" }]),
    );
    expect([...found.keys()]).toEqual(["NO-GHSA:1234"]);
  });

  it("url ve source ikisi de yoksa ad + başlıktan kimlik kurulur (yine sayılır)", () => {
    const found = extractAdvisories(auditOf([{ name: "x", severity: "critical", title: "t" }]));
    expect([...found.keys()]).toEqual(["NO-GHSA:x:t"]);
  });

  it("GHSA'lı danışma kendi kimliğiyle; geçişli (string) via atlanır; tekrar TEKİLLEŞİR", () => {
    const g = { name: "postcss", severity: "moderate", title: "t", url: "https://github.com/advisories/GHSA-abcd-efgh-ijkl" };
    const found = extractAdvisories({
      vulnerabilities: { postcss: { via: [g, "next"] }, next: { via: [g] } },
    });
    expect([...found.keys()]).toEqual(["GHSA-abcd-efgh-ijkl"]);
  });
});
