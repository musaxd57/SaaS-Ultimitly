// ---------------------------------------------------------------------------
// NEZAKET CEVABI METNİ — KAYIT ANI KONTROLÜ (Tur 7, kurucu onayı 11-05). Saf, istemci de içe aktarır (Ayarlar formu yazarken uyarır).
// Kural gönderimdekiyle AYNI: metin `{isim}` / `{daire}` örnek değerlerle doldurulur (gönderimde gerçek değerler), sonra
// `unfilledPlaceholderTokens` (gönderim kapısı `hasUnfilledPlaceholders`ın aynı dört kuralı). Gönderim öncesindeki son kontrol AYRICA
// durur (`maybeSendClosingCourtesy`): ör. `{daire}` o dairenin adından çözülemezse kayıtta değil gönderimde yakalanır.
// ---------------------------------------------------------------------------
import { fillGuestPlaceholders } from "@/lib/kb-placeholders";
import { unfilledPlaceholderTokens } from "@/lib/auto-messages/render";

/** Kayıt anında `{daire}`in çözüldüğünü varsaymak için örnek daire adı (gönderimde gerçek mülk adı kullanılır). */
const SAMPLE = { guestFirstName: "Ayşe", propertyName: "Daire 5" } as const;

/** Nezaket metninde desteklenmeyen alanlar (boşsa metin kaydedilebilir). */
export function unsupportedCourtesyTokens(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return unfilledPlaceholderTokens(fillGuestPlaceholders(trimmed, SAMPLE));
}

/** Ev sahibine gösterilen metin (kurucu onayı 11-05): "[ADRES] desteklenmiyor. Kullanılabilir alanlar: {isim}, {daire}." */
export function unsupportedCourtesyMessage(tokens: readonly string[]): string {
  return `${tokens.join(", ")} desteklenmiyor. Kullanılabilir alanlar: {isim}, {daire}.`;
}
