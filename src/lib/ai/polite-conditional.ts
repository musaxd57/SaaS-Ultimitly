/**
 * Nezaket / belirsizlik kalıpları KOŞUL DEĞİLDİR ("isterseniz", "mümkünse", "if you have a moment", "لو سمحت" = lütfen, "I'm not sure if"):
 * tehlike bildirimini varsayıma ÇEVİRMESİN diye varsayım testinden ÖNCE nötrlenir. TEK KAYNAK (Y1, 10-14 dış inceleme): tehlike okuyucu
 * (`hazard-evidence.ts`) ve dedektör sesi okuyucusu (`gas-detector-alarm.ts`) aynı listeyi kullanır — önce yalnız ilkinde vardı ve
 * "If you have a moment, our CO alarm is beeping." dedektör okuyucusunda varsayım sayılıp İKİ ağda da acilden düşüyordu.
 * Kalıplar katlanmış (küçük harf, Türkçe harf ASCII) metne yazılır. Yaprak modül.
 */
const NL = "(?<![\\p{L}\\p{N}])";
const NR = "(?![\\p{L}\\p{N}])";
const LB = "\\p{L}{0,12}";

export const POLITE_CONDITIONAL_PARTS: readonly string[] = [
  // "Eğer" ile başlayan nezaket de nezakettir ("Eğer müsaitseniz, …"); "vaktiniz / fırsatınız olursa / varsa" (Y1, 10-14).
  `${NL}(?:eger\\s+)?(?:zahmet\\s+olmazsa|mumkunse|mumkun\\s+ise|isterseniz|isterse|dilerseniz|uygunsa|musaitseniz|musaitse|musait\\s+oldugunuzda|rica\\s+etsem|(?:vaktiniz|zamaniniz|firsatiniz|bir\\s+dakikaniz)\\s+(?:olursa|varsa|oldugunda))${NR}`,
  `${NL}if\\s+(?:you\\s+(?:can|could|don'?t\\s+mind|have\\s+(?:a\\s+)?(?:time|moment|minute|second|sec|chance)|get\\s+(?:a\\s+)?(?:chance|moment|minute|second|sec)|are\\s+(?:able|free|available)|want|wish|like|please)|possible|needed|necessary|that'?s\\s+(?:ok|okay|alright|fine))${NR}`,
  `${NL}when\\s+you\\s+(?:have|get)\\s+(?:a\\s+)?(?:time|moment|minute|second|sec|chance)${NR}`,
  `${NL}(?:not\\s+sure|don'?t\\s+know|no\\s+idea|can'?t\\s+tell|wondering|unsure)\\s+(?:if|whether)${NR}`,
  `${NL}(?:wenn|falls)\\s+(?:möglich|moglich|sie\\s+(?:können|konnen|mögen|mogen|wollen|zeit\\s+haben)|es\\s+(?:geht|ihnen\\s+passt))${NR}`,
  `${NL}si\\s+(?:possible|vous\\s+(?:pouvez|voulez|le\\s+pouvez|avez\\s+(?:un\\s+moment|le\\s+temps))|ça\\s+vous\\s+(?:va|dérange)|ca\\s+vous\\s+(?:va|derange))${NR}`,
  `${NL}si\\s+(?:es\\s+posible|puede[ns]?|pudiera[ns]?|no\\s+es\\s+molestia|le\\s+parece|tiene\\s+(?:un\\s+momento|tiempo))${NR}`,
  `${NL}если\\s+(?:можно|не\\s+сложно|не\\s+трудно|возможно|вам\\s+удобно)`,
  `(?:لو\\s+سمحت${LB}|إذا\\s+(?:أمكن|ممكن|سمحت${LB}|تكرمت${LB})|من\\s+فضلك)`,
];

const POLITE_G = new RegExp(POLITE_CONDITIONAL_PARTS.join("|"), "giu");

/** Nezaket kalıplarını AYNI UZUNLUKTA boşlukla değiştirir (konumlar korunur — sesin / varsayımın yeri kıyaslanır). */
export function blankPoliteConditionals(text: string): string {
  return text.replace(POLITE_G, (m) => " ".repeat(m.length));
}
