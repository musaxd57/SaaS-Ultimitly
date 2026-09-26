import { vetoAvailability, type AvailabilityVetoReason } from "@/lib/ai/availability-claims";

/**
 * HAZIR TASLAK — konuşma açılınca öneri panelinde gösterilecek kayıtlı taslak (kurucu 09-26, "Otomatik hazır dursun";
 * konuşma öğeleri kipi). Otomasyon, turun bütün istekleri ev sahibine kaldığında modelin cevabını ev sahibinin ağzıyla
 * son misafir mesajına yazar (`aiSuggestedReply`); "AI öner" de aynı alana yazar.
 *
 * Kural (saf, sayfanın GÖRÜNEN mesaj listesiyle çağrılır — iptal edilmiş giden satır sayılmaz):
 *  · yalnız EN SON mesaj misafirinse ve onun kaydı varsa — eski bir mesajın taslağı yeni mesajı karşılamaz, ondan sonra
 *    giden bir cevap varsa taslak artık bayattır;
 *  · MÜSAİTLİK UYARISI yeniden hesaplanır (kayıtta uyarı yok): kelime ağı + taslağın kendi niyet etiketi (birleşim
 *    değişmezi — `early_checkin` etiketi hassas isteği tutar), model beyanı / anlama katmanı / bekçi burada YOK → konaklama
 *    isteğinde uyarı her zaman çıkar (temkinli yön). Takvim iddiası taşıyan taslak uyarısız görünmez.
 */
export interface PreparedDraftMessage {
  id: string;
  direction: string;
  body: string;
  aiSuggestedReply: string | null;
  aiIntent: string | null;
  aiConfidence: number | null;
}

export interface PreparedDraft {
  messageId: string;
  reply: string;
  intent: string;
  confidence: number;
  availabilityCheck: AvailabilityVetoReason | null;
}

export function preparedDraftOf(
  messages: readonly PreparedDraftMessage[],
  opts: { stayTimes: { checkIn: string; checkOut: string } | null; hostOfferText: string | null },
): PreparedDraft | null {
  const last = messages.at(-1);
  if (!last || last.direction !== "inbound") return null;
  const reply = last.aiSuggestedReply;
  if (!reply || !reply.trim()) return null;
  const lastOut = messages.map((m) => m.direction).lastIndexOf("outbound");
  const guestTexts = messages
    .slice(lastOut + 1)
    .filter((m) => m.direction === "inbound")
    .map((m) => m.body);
  return {
    messageId: last.id,
    reply,
    intent: last.aiIntent ?? "general",
    confidence: last.aiConfidence ?? 0,
    availabilityCheck: vetoAvailability(reply, guestTexts, {
      declared: null,
      replyIntent: last.aiIntent,
      deterministicReply: false,
      stayTimes: opts.stayTimes,
      hostOfferText: opts.hostOfferText,
    }),
  };
}
