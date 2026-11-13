// ---------------------------------------------------------------------------
// İHTİYAÇ PUANLAMASI — ORTAK CETVEL (11-13: `live-pipeline.eval.test.ts`ten AYNEN taşındı, davranış değişmedi).
//
// Neden ayrı modül: "ham model kararı ↔ ürünün son kararı" karşılaştırması (kurucu / Codex 11-12) iki kolu AYNI cetvelle ölçmek zorunda.
// Ürün kolu (`live-pipeline.eval.test.ts`) ve ham model kolu (`raw-arm.eval.test.ts`) bu dosyadaki tek puanlayıcıyı kullanır; cetvelin
// kopyası tutulmaz (iki kopya ayrışırsa "sonra" satırı başka bir şeyi ölçer). Puanlayıcının pinleri ürün ölçerinin çevrimdışı
// testlerindedir ("ihtiyaç puanlaması" — o dosya buradan içe aktarır).
// ---------------------------------------------------------------------------

/**
 * İNSANIN yazdığı ihtiyaç: answered = `all` desenlerinin hepsi giden metinde; open = `forbid` desenleri giden metinde yok ve öğe "answered"
 * sayılmadı. Desenler büyük / küçük harf duyarsız düzenli ifadedir.
 */
export interface NeedSpec {
  kind: string;
  want: "answered" | "open";
  all?: string[];
  forbid?: string[];
  /**
   * İhtiyacın KONUSU (isteğe bağlı; Opus 11-12 P2-14): giden metinde geçiyorsa o ihtiyaca DEĞİNİLMİŞTİR. Cevaplanması gereken ihtiyaçta konu
   * geçip beklenen değer yoksa yanlış / eksik değer gitmiştir → yanlış gönderim (öğe eşleşmesi kurulamasa da: aynı türden iki ihtiyaç, başka
   * türe konmuş istek). Konu geçmiyorsa ihtiyaç giden cevapta ATLANMIŞTIR (gereksiz tutma). Açık kalması gereken ihtiyaçta konu `forbid`e yazılır.
   */
  about?: string[];
}

export interface NeedResult {
  kind: string;
  want: "answered" | "open";
  /** answered: bütün desenler giden metinde · open: yasak desen yok. */
  textOk: boolean;
  /** Tek öğeli türde öğe durumu beklentiyle uyumlu mu (aynı türden iki ihtiyaç varsa ölçülmez → null). */
  statusOk: boolean | null;
  /** 🚨 open beklenip giden metinde yasak desen ya da öğe "answered" — yanlış "cevaplandı". */
  wrongAnswered: boolean;
  /**
   * Cevaplanması gereken ihtiyaç: misafire METİN GİTTİ ama bu ihtiyacın beklenen değeri içinde yok ve yanlış gönderim de sayılamadı (Opus 11-12
   * P2-14). İki olasılık: ihtiyaç giden cevapta atlandı (kısmi tutma) ya da ölçerin göremediği yanlış değer gitti → satır elle incelenir;
   * "tur hiç gitmedi" tutmasından AYRI sayılır.
   */
  sentMissing?: boolean;
}


const rx = (p: string) => new RegExp(p, "iu");

/**
 * Otomatik cevabın sonundaki açıklama satırı ("(Bu yanıt otomatik asistan tarafından hazırlandı.)", yedi dil — `automation.ts`) ölçümde
 * misafire söylenmiş içerik sayılmaz (kör set incelemesi 10-23: asistan sorusunda "asistan / otomatik" yasağı her gidende yanlış gönderim
 * sayıyordu).
 */
const DISCLOSURE_LINE = /\n*\((?:Bu yanıt|This reply|Diese Antwort|Cette réponse|Esta respuesta|تم إعداد|Этот ответ)[^()\n]{0,120}\)\s*$/u;
export function withoutDisclosure(text: string): string {
  return text.replace(DISCLOSURE_LINE, "");
}

export function scoreNeeds(needs: readonly NeedSpec[], sentText: string | null, items: readonly { kind: string; status: string }[]): NeedResult[] {
  const text = withoutDisclosure(sentText ?? "");
  return needs.map((n) => {
    const sameKind = needs.filter((x) => x.kind === n.kind).length;
    const ofKind = items.filter((i) => i.kind === n.kind);
    const answeredItem = ofKind.some((i) => i.status === "answered");
    const statusOk = sameKind > 1 || ofKind.length !== 1 ? null : n.want === "answered" ? answeredItem : !answeredItem;
    const allOk = (n.all ?? []).every((p) => rx(p).test(text)) && (n.want !== "answered" || text.length > 0);
    const forbidHit = (n.forbid ?? []).some((p) => rx(p).test(text));
    const textOk = n.want === "answered" ? allOk && !forbidHit : !forbidHit;
    // Opus 10-23 sabah F9: cevaplanması gereken ihtiyacın öğesi "cevaplandı" kapandı ama giden metinde beklenen değer yok → yanlış "cevaplandı"
    // (eksik / yanıltıcı cevap gitti ve iş kapandı); eskiden "gereksiz tutma" sayılıyordu.
    // Opus 10-23 G6: aynı türden iki ihtiyaçta (Soru 9'un tam yeri — "havuz kaçta kapanıyor? sauna kaçta?") öğe ihtiyaca bağlanamaz; giden metin
    // ihtiyacın değerlerinin BİR KISMINI taşıyorsa (yalnız istisna gitti) yanlış gönderim sayılır — sıkı yön (başka ihtiyacın cevabındaki aynı
    // değer de yanlış sayılabilir; ölçüm yanlış gönderimi eksik değil fazla sayar).
    const pats = n.all ?? [];
    const partialSent = text.length > 0 && pats.length >= 2 && pats.some((p) => rx(p).test(text)) && !allOk;
    // Opus 11-12 P2-14: konusu giden metinde geçen ama beklenen değeri taşımayan ihtiyaç = yanlış / eksik değer gitti (öğe eşleşmesinden
    // bağımsız — "Otopark ücretlidir." ücretsiz otoparkta, istek başka türe konmuş olsa da yanlış gönderimdir).
    const addressedWithoutValue = n.want === "answered" && text.length > 0 && !allOk && (n.about ?? []).some((p) => rx(p).test(text));
    const wrongAnswered =
      n.want === "open"
        ? forbidHit || (sameKind === 1 && ofKind.length === 1 && answeredItem)
        : forbidHit || (sameKind === 1 && ofKind.length === 1 && answeredItem && !allOk) || (sameKind > 1 && partialSent) || addressedWithoutValue;
    const sentMissing = n.want === "answered" && text.length > 0 && !textOk && !wrongAnswered;
    return { kind: n.kind, want: n.want, textOk, statusOk, wrongAnswered, ...(sentMissing ? { sentMissing: true } : {}) };
  });
}

/**
 * İhtiyaç sayıları (kurucu 10-23 sabah: "Hem yanlış gönderimleri hem gereksiz tutmaları ölçsün"): yanlış gönderim = yanlış değer ya da
 * açık kalması gerekirken "cevaplandı"; gereksiz tutma = cevaplanması gereken ihtiyacın doğru değeri misafire gitmedi (yanlış değer yokken).
 */
export function needMetrics(all: readonly NeedResult[]) {
  const answered = all.filter((n) => n.want === "answered");
  const open = all.filter((n) => n.want === "open");
  return {
    answered: answered.length,
    answeredOk: answered.filter((n) => n.textOk && !n.wrongAnswered).length,
    needlessHold: answered.filter((n) => !n.textOk && !n.wrongAnswered).length,
    /** `needlessHold`in alt kümesi: metin gitti ama bu ihtiyacın beklenen değeri yok (atlanmış ihtiyaç ya da ölçerin göremediği yanlış değer). */
    sentMissing: answered.filter((n) => n.sentMissing === true).length,
    open: open.length,
    openOk: open.filter((n) => n.textOk && !n.wrongAnswered).length,
    wrong: all.filter((n) => n.wrongAnswered).length,
  };
}
