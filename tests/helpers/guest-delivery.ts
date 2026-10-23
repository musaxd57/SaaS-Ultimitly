import { evaluateEscalation, hasUnsourcedSpecificClaim } from "@/lib/guest-chat-gate";

/**
 * KAYNAKSIZ SOMUT İDDİA — ürünün kendi yüklemi, yeniden dışa aktarım.
 *
 * 🚨 NEDEN AYRI BİR EKSEN (ölçülmüş gerileme, 09-11): teslimat kontrolü tek
 * başına UYDURMA EKSENİNİ KAPATIYOR. Ölçüldü — R6 ("Jakuzi var mı?", konu KB'de
 * YOK): model `"Evet, teras katında bir jakuzi bulunuyor."` derse ve güveni 0.35
 * olursa kapı `low_confidence` ile DURDURUR → `delivered=false` → teslimat ekseni
 * YEŞİL. Oysa bu saf uydurmadır ve eski (yokluk-itirafı) kontrolü onu YAKALIYORDU.
 * Senaryonun `forbidden` listesi de kaçırıyor ("bulunmaktadır" var, "bulunuyor" yok).
 *
 * İki eksen AYRI ÖLÇÜLÜR ve ikisi de gerekir:
 *  · TESLİMAT — ürün bu taslağı misafire gönderir miydi?
 *  · UYDURMA  — kaynak yokken somut bir şey iddia ediyor mu?
 * Yokluk itirafına DÖNÜŞ yok: model artık o cümleyi kurmuyor (istem kuralı
 * kaldırıldı), dolayısıyla onu şart koşmak ürünün emrettiği davranışla çelişirdi.
 */
export { hasUnsourcedSpecificClaim };

// ---------------------------------------------------------------------------
// "ÜRÜN BU TASLAĞI MİSAFİRE GÖNDERİR Mİ?" — VEKİL DEĞİL, GERÇEK KAPI.
//
// 🚨 NEDEN (kurucunun 09-11 gerçek koşusu): eval bu soruyu tek bir VEKİLLE
// ölçüyordu — `admitsMissingKnowledge`, yani kapının ON İKİ dalından BİRİ.
// KURAL-5'in kalıp cümlesi istemden kaldırılınca model artık yokluk itirafı
// üretmiyor; ürün doğru davranmaya devam etti (güven 0.3 → `low_confidence` →
// devir) ama eval "itiraf yok" diye KIRMIZI verdi. Dokuz kırmızının SEKİZİ bu.
//
// Artık ürünün kendi kapısı çağrılır ve hangi dalın kapattığı GERÇEKTEN bilinir.
//
// ⚠️ ÖLÇÜLENİN SINIRI — dürüst ol: harness yalnız `suggestReply` (TASLAK) çağırır;
// rota, DB, outbox yok. Yani ölçülen "gönderildi" DEĞİL, **"ürünün kapısı bu
// taslağı ne yapardı"**. Fark, kapının KENDİSİ çalıştığı için artık bir dalla
// değil TAMAMIYLA temsil ediliyor.
//
// ⚠️ EVAL'DE ULAŞILAMAYAN DALLAR — dürüst liste (09-11 incelemesinde sayıldı;
// önceki yorum "iki bacak" diyordu ve İKİSİ DE yanlış adlandırılmıştı):
//  · `guest_name_injection` — kapı üçüncü argüman olarak `guestName` ister,
//    dataset misafir adı taşımaz → verilmez. (MESAJ injection taraması TAM
//    çalışır; `pendingGuestMessages` bu kapının parametresi bile DEĞİL, eski
//    yorum onu "eksik bacak" diye sayıyordu.)
//  · `history_injection` — 09-12'de EKLENDİ ve bu listeyi BOZDU: `history`
//    artık kapının DÖRDÜNCÜ parametresi (bu satırın üstündeki cümle onu
//    "parametre bile değil" diye sayıyordu, düzeltildi). Dataset konuşma
//    geçmişi taşımadığı için dal yine ulaşılamaz — ama artık SEBEBİ farklı:
//    "parametre yok" değil, "veri yok". Ayrım önemli: dataset'e geçmiş
//    eklendiği gün bu dal KENDİLİĞİNDEN canlanır.
//  · `informational_low_confidence` ve `unsourced_claim` — ikisi de
//    `QR_INFORMATIONAL_BAND_ENABLED` bandının içinde; bayrak eval config'inde
//    set EDİLMEZ (varsayılan kapalı) → dallar ulaşılamaz. Bandın altı davranışı
//    bu yüzden eval'de canlı prodüksiyonla AYNI (0.75 altı = devir).
//  · `model_unavailable` — iki harness da `source !== "openai"` satırını
//    `check()`ten ÖNCE `invalid` sayıp eler; kapıya hiç gelmez.
// ---------------------------------------------------------------------------

export interface GuestDeliveryVerdict {
  /** Misafir bu METNİ alır mı? `false` → deterministik devir metnini alır. */
  delivered: boolean;
  /** Kapının kapalı-küme gerekçesi. `null` = hiçbir dal müdahale etmedi. */
  reason: string | null;
}

/**
 * Modelin taslağını ürünün QR devir kapısından geçirir.
 *
 * 🚨 QR KAPISI SEÇİLDİ, kanal kapısı DEĞİL — ölçülmüş sekiz fark var; en
 * önemlisi: `human_request` kanal kapısında devir-ack'i olarak GEÇER, QR'da
 * DEVREDİLİR. Dataset senaryoları misafir yüzeyindedir, o yüzden misafir
 * yüzeyinin kapısı doğru olandır.
 */
export function guestWouldReceive(
  draft: {
    intent: string;
    riskLevel?: string | null;
    confidence: number;
    source: string;
    riskType?: string | null;
    reply?: string | null;
    usedSources?: string[];
  },
  guestMessage: string,
): GuestDeliveryVerdict {
  const v = evaluateEscalation(
    {
      intent: draft.intent,
      // Ürün `riskLevel` eksik/tanınmayanı "high" sayar (F01). Aynı yönü koru:
      // eval, ölçmediği bir alanı "risksiz" varsayarak kapıyı GEVŞETEMEZ.
      riskLevel: draft.riskLevel ?? "high",
      confidence: draft.confidence,
      source: draft.source,
      riskType: draft.riskType ?? null,
      reply: draft.reply ?? undefined,
      usedSources: draft.usedSources ?? [],
    },
    guestMessage,
  );
  return { delivered: !v.escalate, reason: v.reason };
}
