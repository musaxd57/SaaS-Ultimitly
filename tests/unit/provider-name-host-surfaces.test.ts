import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Kurucu kararı 10-11 (karar listesi 28; talimat: "uygulama içinde yalnız Airbnb / Booking / Vrbo, PMS adı yok"): ev sahibine görünen
// HATA / DURUM / UYARI / silme-dışa aktarma metinleri sağlayıcı adını taşımaz. Ad yalnız bağlantı kartının "nasıl bağlanırım" adımlarında
// (bağlantı düğmesi, anahtar alanı, adım adım rehber, anahtar doğrulama hataları) ve landing SSS'de kalır (ayrı karar).
// Kaynak taraması: yorumlar ayıklanır, dize / JSX metni taranır.
// ---------------------------------------------------------------------------

const SURFACES = [
  "src/app/(app)/inbox/[id]/page.tsx",
  "src/app/(app)/sent/queue/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/components/settings/delete-account-card.tsx",
  "src/components/properties/guest-erasure-control.tsx",
];

/** Yorum satırlarını ve blok yorumları ayıklar (JSX yorumları dahil); kalan metinde ad aranır. */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");
}

describe("ev sahibi yüzeylerinde sağlayıcı adı yok", () => {
  it.each(SURFACES)("%s", (file) => {
    const src = withoutComments(readFileSync(file, "utf8"));
    // TAM SÖZCÜK, büyük harf: kod tanımlayıcıları (autoReplyHospitable, HospitableSyncButton) ve yollar (/api/hospitable/…) eşleşmez;
    // satır başındaki çok satırlı JSX metni DE yakalanır (Haiku incelemesi 10-11: eski kalıp yalnız tırnak / ">" sonrasını görüyordu).
    const hits = src.split("\n").filter((l) => /(?<![A-Za-z0-9_])Hospitable(?![A-Za-z0-9_])/.test(l));
    expect(hits).toEqual([]);
  });

  it("bağlantı kartı: durum bantları ve kesme onayı adsız; 'nasıl bağlanırım' adımları adı KORUR", () => {
    const src = readFileSync("src/components/settings/hospitable-connect-card.tsx", "utf8");
    for (const gone of ["Hospitable ile bağlandı", "Hospitable ile bağlantı kurulamadı", "Hospitable bağlantısını kesmek", "kendi Hospitable bağlantısı", "(env)"]) {
      expect(src, gone).not.toContain(gone);
    }
    expect(src).toContain("Hospitable ile Bağlan");
    expect(src).toContain("my.hospitable.com");
  });
});
