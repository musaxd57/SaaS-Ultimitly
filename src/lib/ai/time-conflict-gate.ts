// ---------------------------------------------------------------------------
// SAAT KAYNAĞI ÇELİŞKİSİ KAPISI — P4-b KODDA (09-25). SAF: DB/ağ yok.
//
// KURUCU KARARI (P4-b, 09-09): mülk ayarı ile bilgi tabanı giriş/çıkış saatinde çelişiyorsa misafire KESİN SAAT
// söylenmez, cevap İNSAN İNCELEMESİNE gider. 09-25'e kadar "insana gider" kısmı yalnız istemdeki "güveni 0.75'in
// altında tut" talimatına bağlıydı — yani karar MODELE bırakılmıştı. Ölçüldü (canlı Ayarlar testi, 09-25): model
// çelişkili mülkte erken giriş isteğine güven 0.80 verdi; bekçi açılınca iki model ertelemesiyle "kayıtlarım
// tutarsız, net bir saat söyleyemiyorum" cevabı misafire OTOMATİK gidebilirdi. Kapı artık kendisi tutar.
//
// Çelişki, istemin kendi hesabından gelir (`findTimeConflicts`, modelin GÖRDÜĞÜ bilgi tabanı kümesi) → model neyi
// gördüyse kapı onu bilir. Kural yalnız SIKILAŞTIRIR ve çelişkili ALANA değen konuşmayı tutar:
//   · cevap modelinin niyet etiketi o alanın konusu (giriş: checkin / early_checkin · çıkış: checkout / late_checkout),
//   · misafirin cevapsız mesajlarından biri ya da cevabın kendisi o alanın konusunu adlandırıyor (saat alanı sözlüğü,
//     `retrieval/lexicon` — "giriş", "check-in", "arrival", "çıkış", "leave" …),
//   · cevap çelişen saatlerden birini söylüyor (konu adı geçmese bile, ör. "14:00'ten itibaren").
// Çelişkisiz mülkte hiçbir şey değişmez. Wi-Fi / otopark gibi çelişkili alana değmeyen sorular gitmeye devam eder.
// Bedeli bilinçli: çelişkili mülkte giriş/çıkış konulu her cevap host'a düşer — kalıcı çözüm host'un saati eşitlemesi
// (Bilgi Tabanı → "Uyuşmayan saatler").
// ---------------------------------------------------------------------------

import type { TimeConflict } from "@/lib/ai/prompts";
import { timeFieldsIn } from "@/lib/ai/retrieval/lexicon";
import { contentStems } from "@/lib/ai/retrieval/text";
import { timesIn } from "@/lib/ai/retrieval/time-fields";

/** Çelişen alan → o alanın konu adı (saat alanı sözlüğü) + cevap modelinin o alana ait niyet etiketleri. */
const FIELD_SCOPE: Record<TimeConflict["field"], { topic: string; intents: ReadonlySet<string> }> = {
  checkInTime: { topic: "checkin", intents: new Set(["checkin", "early_checkin"]) },
  checkOutTime: { topic: "checkout", intents: new Set(["checkout", "late_checkout"]) },
};

function topicsOf(text: string | null | undefined): Set<string> {
  return new Set(text ? timeFieldsIn(contentStems(text)) : []);
}

/**
 * Otomatik gönderimi tutar mı? Çelişki listesi boşsa/verilmediyse ASLA (`false`). Çelişkili bir alan için: niyet o
 * alanın konusuysa, misafirin mesajı ya da cevap o alanı adlandırıyorsa ya da cevap çelişen saatlerden birini
 * söylüyorsa `true`.
 */
export function timeConflictHolds(
  conflicts: readonly TimeConflict[] | null | undefined,
  input: { intent: string; reply: string | null | undefined; guestTexts: readonly string[] },
): boolean {
  // Boş liste `.some` ile de false döner (mutasyon T7 eşdeğer): satır, çelişkisiz her mesajda kelime köklerini boşuna
  // hesaplamamak içindir (performans; her kapı çağrısında koşar).
  if (!conflicts || conflicts.length === 0) return false;
  const guestTopics = new Set(input.guestTexts.flatMap((t) => [...topicsOf(t)]));
  const replyTopics = topicsOf(input.reply);
  const replyTimes = timesIn(input.reply ?? "");
  return conflicts.some((c) => {
    const scope = FIELD_SCOPE[c.field];
    if (!scope) return false;
    if (scope.intents.has(input.intent)) return true;
    if (guestTopics.has(scope.topic) || replyTopics.has(scope.topic)) return true;
    return [c.propertyValue, ...c.kbValues].some((t) => replyTimes.has(t));
  });
}
