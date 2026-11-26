// ---------------------------------------------------------------------------
// BİLGİ TABANI ŞABLONU — "şablonu indir → doldur → yükle" (kurucu 10-28, §7-A (2); deneme sürümünde KAPALI — uç `api/kb/template`).
//
// Şablon yalnız BAŞLIK ("Wi-Fi:") ve BOŞLUKLU SATIR ("Şifre: ____") taşır; açıklama paragrafı YOK — içe aktarıcı (`document.ts
// planDocumentImport`) her paragrafı taslak sayar, açıklama da "Genel" taslağına düşerdi. Boş bırakılan satır yer tutucudur (`____`) ve içe
// aktarılmaz; doldurulan satır başlığının konusuna düşer (pin: `tests/unit/kb-template-export.test.ts`). Her soru AYRI paragraf: aynı
// paragrafta biri dolu biri boş iki satır olsaydı paragrafın tamamı atlanırdı. Erişim (anahtar / kapı kodu) satırı içe aktarmada "Giriş
// Talimatı"na gider (QR ve aday misafir görmez). Saf.
// ---------------------------------------------------------------------------

export type KbTemplateLang = "tr" | "en";

/** Boşluk: içe aktarıcının yer tutucu tanıdığı biçim (`kb-placeholders`). */
const BLANK = "____";

const SECTIONS: Record<KbTemplateLang, readonly { heading: string; prompts: readonly string[] }[]> = {
  tr: [
    { heading: "Giriş", prompts: ["Giriş saati", "Anahtar / kapı kodu nasıl alınır", "Çıkış saati"] },
    { heading: "Wi-Fi", prompts: ["Ağ adı", "Wi-Fi şifresi"] },
    { heading: "Otopark", prompts: ["Otopark var mı, nerede, ücretli mi"] },
    { heading: "Çöp", prompts: ["Çöp nereye atılır"] },
    { heading: "Ev Kuralları", prompts: ["Sigara", "Evcil hayvan", "Sessizlik saatleri", "Parti / ziyaretçi"] },
    { heading: "Temizlik", prompts: ["Havlu / çarşaf değişimi"] },
    { heading: "Konum", prompts: ["Adres ve ulaşım", "Havalimanından nasıl gelinir"] },
    { heading: "Yerel Tavsiye", prompts: ["Yakındaki market / eczane / restoran"] },
    { heading: "Genel", prompts: ["Diğer bilgiler"] },
  ],
  en: [
    { heading: "Check-in", prompts: ["Check-in time", "How to get the key / door code", "Check-out time"] },
    { heading: "Wi-Fi", prompts: ["Network name", "Wi-Fi password"] },
    { heading: "Parking", prompts: ["Is there parking, where, is it paid"] },
    { heading: "Trash", prompts: ["Where does the trash go"] },
    { heading: "House rules", prompts: ["Smoking", "Pets", "Quiet hours", "Parties / visitors"] },
    { heading: "Cleaning", prompts: ["Towel / linen change"] },
    { heading: "Location", prompts: ["Address and directions", "How to get here from the airport"] },
    { heading: "Local tips", prompts: ["Nearby supermarket / pharmacy / restaurants"] },
    { heading: "General", prompts: ["Other information"] },
  ],
};

/** Şablon metni (UTF-8; paragraflar boş satırla ayrılır). */
export function kbTemplateText(lang: KbTemplateLang = "tr"): string {
  return SECTIONS[lang].map((s) => [`${s.heading}:`, ...s.prompts.map((p) => `${p}: ${BLANK}`)].join("\n\n")).join("\n\n") + "\n";
}

/** İndirilen dosyanın adı (ASCII; tarayıcılar arası güvenli). */
export function kbTemplateFilename(lang: KbTemplateLang = "tr"): string {
  return lang === "en" ? "knowledge-base-template.txt" : "bilgi-tabani-sablonu.txt";
}
