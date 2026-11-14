// TAZMİNAT / İADE SÖZÜ — kod kemeri (sızma testi 11-14, E-3). YAPRAK modül, saf, doğrusal.
//
// Konuşma öğeleri kipinde şikâyet / iade / ödeme öğesi ev sahibinde TUTULUR, güvenli kısım (ör. anahtar sorusu) gider. Modelin cevabı
// tutulan isteğe değinip bir SÖZ verirse ("Bir gecelik ücreti iade edeceğiz.") bunu durduran bir kod kemeri yoktu: çıktı vetosu iade için
// yalnız geçmiş zamanı ("iade ettim") tutuyor, özür / telafi yasağının kod yedeği yalnız kıdemli okuyucuda (açılışta kapalı). Makbuzsuz
// para sözü ev sahibini bağlar — kurucunun kuralı: riskli mesaj insana kalır, ev sahibini haksız duruma düşürecek söz misafire gitmez.
//
// Kural: AYNI yan cümlede (a) para anlamında bir telafi nesnesi VE (b) bir söz / taahhüt biçimi. Söz biçimi gelecek zaman, geniş zaman
// birinci çoğul, şimdiki zaman, "yapılacak / edilecek" edilgen gelecek ve İngilizce "we'll / I will / you'll get / will be refunded".
// Olumsuzu da ("iade edemeyeceğiz") tutar: iade REDDİ de ev sahibinin kararıdır.
// Dışarıda kalanlar (aşırı engelleme olmasın — bu turun güvenli cevabını gereksiz yere tutmayalım):
//  · eşya iadesi: aynı yan cümlede anahtar / kart / kumanda / eşya ("Anahtarı kutuya iade edebilirsiniz" — bu senaryonun güvenli cevabı);
//  · depozito / politika cümleleri ("Depozitonuz çıkışta iade edilecek" bilgi tabanı olgusudur, söz değil);
//  · üçüncü taraf öznesi (Airbnb / Booking / platform) — platformun kendi süreci;
//  · soru biçimi (yan cümle "?" ile biter).
// Çağıran yalnız tutulan öğe şikâyet / iade / ödeme iken sorar (`automation.ts` öğe kapısı) — yanlış pozitif yalnız zaten hassas turu tutar.

const COMPENSATION =
  /(?:^|[^\p{L}])(?:iade|geri\s+öde|geri\s+ödeme|para(?:nız|sını|yı|nızı)?\s+geri|indirim|tazminat|telafi|refund|reimburs|compensat|discount|credit(?!\s*card)|money\s+back)/u;
/** "Ücretsiz / bedava / free" yalnız bir konaklama birimiyle telafidir ("bir gece ücretsiz") — "ücretsiz otopark" bilgi tabanı olgusudur. */
const FREE_WORD = /(?:^|[^\p{L}])(?:ücretsiz|bedava|free)(?![\p{L}])/u;
const STAY_UNIT = /(?:^|[^\p{L}])(?:gece|konaklama|kalış|night|stay)/u;

function hasCompensation(clause: string): boolean {
  return COMPENSATION.test(clause) || (FREE_WORD.test(clause) && STAY_UNIT.test(clause));
}

const TR_PROMISE =
  /(?:[eaıiuü]?y?ece[gğ]iz|[eaıiuü]?y?aca[gğ]ız|[eaıiuü]?y?ece[gğ]im|[eaıiuü]?y?aca[gğ]ım|(?:il|ıl|ul|ül|n)?ecek(?:tir)?|(?:il|ıl|ul|ül|n)?acak(?:tır)?|[ea]r[iı]z|[ıiuü]r[ıiuü]z|[ıiuü]yoruz|[ea]bilir[ıi]z|[ea]bilir[ıi]m)(?![\p{L}])/u;

const EN_PROMISE =
  /(?:^|[^\p{L}])(?:we(?:'ll|\s+will|\s+shall|\s+can|\s+are\s+going\s+to|\s+would\s+be\s+happy\s+to)|i(?:'ll|\s+will|\s+can)|you(?:'ll|\s+will)\s+(?:get|receive|be)|will\s+be\s+(?:refunded|reimbursed|credited|compensated|issued|applied))(?![\p{L}])/u;

const PHYSICAL_ITEM = /(?:^|[^\p{L}])(?:anahtar|kart|kumanda|eşya|esya|key|card|remote|fob)/u;
const POLICY_OR_DEPOSIT = /(?:^|[^\p{L}])(?:depozito|politika|deposit|policy)/u;
const THIRD_PARTY = /(?:^|[^\p{L}])(?:airbnb|booking|platform|expedia|vrbo)/u;

/**
 * Eşleşme kopyaları: görünmez karakter silinir, kıvrık kesme düzleşir; biri Türkçe küçük harf (çıktı vetosuyla AYNI), biri dilden bağımsız
 * küçük harf — Türkçe katlama büyük "I"yı noktasız "ı" yapar ("I will" → "ı will", büyük harfli "CREDIT" → "credıt"); İngilizce kalıplar
 * ikinci kopyada tutar.
 */
function matchForms(text: string): string[] {
  const clean = text.replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}\u2800]/gu, "").replace(/[\u2018\u2019\u02BC\u2032]/g, "'");
  return [clean.toLocaleLowerCase("tr"), clean.toLowerCase()];
}

/** Cevap tutulan bir telafi / iade isteğine SÖZ veriyor mu (yan cümle başına; doğrusal). */
export function promisesCompensation(reply: string | null | undefined): boolean {
  if (typeof reply !== "string" || reply.trim() === "") return false;
  for (const text of matchForms(reply.slice(0, 8_000))) {
    for (const m of text.matchAll(/[^.!?\n;]+[.!?\n;]?/g)) {
      const clause = m[0];
      if (clause.trimEnd().endsWith("?")) continue;
      if (!hasCompensation(clause)) continue;
      if (POLICY_OR_DEPOSIT.test(clause) || THIRD_PARTY.test(clause)) continue;
      // Eşya iadesi: yan cümledeki TEK telafi sözcüğü "iade" ise ve eşya adı geçiyorsa söz değildir.
      if (PHYSICAL_ITEM.test(clause) && !hasCompensation(clause.replace(/iade/g, ""))) continue;
      if (TR_PROMISE.test(clause) || EN_PROMISE.test(clause)) return true;
    }
  }
  return false;
}
