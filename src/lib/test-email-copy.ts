import { SETTINGS_NAV } from "@/lib/settings-nav";

// ---------------------------------------------------------------------------
// "Test e-postası gönder" e-postasının dipnotu — YAPRAK (rota dosyası yalnız rota alanlarını dışa aktarır).
// Tur 4 (11-05, ölçüldü): dipnot düğmenin yerini "Ayarlar › Bağlantılar" diye gösteriyordu; düğme ve uyarı adresi alanı
// İşletme Ayarları › Genel görünümünde (`settings/page.tsx` notificationsView → `genel`). Ev sahibi adresi değiştirmek için
// Bağlantılar'a gidiyor ve orada yalnız Hospitable / takvim kartını buluyordu. Ayrıca adlandırılmış HTML varlıkları
// (&rsaquo; &ldquo; &rdquo;) düz metin parçasında çözülmüyordu (`htmlToText` yalnız 6 varlık tanır) → düz Unicode karakter.
// Görünüm adı gezinme sözleşmesinden okunur (etiket değişirse dipnot da değişir).
// ---------------------------------------------------------------------------

const NOTIFICATIONS_VIEW_ID = "genel";

function viewLabel(id: string): string {
  for (const g of SETTINGS_NAV) for (const i of g.items) if (i.id === id) return i.label;
  throw new Error(`settings view not found: ${id}`);
}

export const TEST_EMAIL_FOOTNOTE = `Bu mesajı Ayarlar › ${viewLabel(NOTIFICATIONS_VIEW_ID)} bölümündeki “Test e-postası gönder” düğmesi oluşturdu. Adresi istediğiniz zaman aynı yerden değiştirebilirsiniz.`;
