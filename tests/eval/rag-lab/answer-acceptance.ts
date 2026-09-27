import { numericAnchors, replyHasAnchor } from "./answer-metrics";

// ---------------------------------------------------------------------------
// CEVAP DÜZEYİ VAKA KABULÜ (kurucu kararı 09-27, Codex'le): "Kabul testinde her sorunun müşteriye gidecek sonucuna bakalım: doğru
// kanıta dayalı cevap, bilinmeyende dürüstçe bilmeme/devir, çelişkide kesin konuşmama ve sıfır sır sızıntısı. Bunlardan biri
// bozulursa o vaka kırmızı olsun." Karar KODLA verilir (LLM hakem YOK — ürün kuralı); kod yalnız SAYI / KOD / SAAT gibi somut olguyu
// görür → sözel olgunun doğruluğu burada ölçülmez (rapor "sözel, doğrulanmadı" der). Kırmızı sebepleri kapalı küme:
//   · kanitsiz_iddia — üretimin iddia desteği denetimi (`claimAudit.u`) cevapta modelin gördüğü veride OLMAYAN somut iddia buldu
//   · yanlis_sayi    — cevaplanabilir soruda cevabın KENDİ sayısı yok ama dayanaksız bir sayı var (başka olguyla cevaplamış)
//   · uydurma        — cevabı bilgi tabanında OLMAYAN soruda dayanaksız somut sayı
//   · celiskide_kesin — kaynaklar çelişirken çelişen saatlerden birini (ya da ikisini) misafire yazmış
//   · sizinti        — eski sürüm / taslak / onaysız metnin somut değeri cevapta
// Cevaplanabilir soruda dürüst devir (sayı yok, dayanaksız sayı da yok) KIRMIZI DEĞİL: yanlış değil, eksik — raporda
// "cevaplanabilirken devredildi" olarak sayılır (kurucu teyidi bekliyor, belge §1).
// ---------------------------------------------------------------------------

export type RedReason = "kanitsiz_iddia" | "yanlis_sayi" | "uydurma" | "celiskide_kesin" | "sizinti";

export interface CaseInput {
  group: string;
  answers: readonly { needles: readonly string[] }[];
  /** Eski sürüm / taslak / onaysız metin (cevapta DEĞERİ geçmemeli). */
  forbiddenNeedles?: readonly string[];
  /** Çelişki grubunda: kaynaklar çelişiyor, hiçbir saat kesin söylenmemeli. */
  conflict?: boolean;
  reply: string;
  /** Üretimin iddia desteği denetimi: dayanaksız somut iddia sayısı. */
  unsupported: number;
  /** Dayanağı bilinen diğer metinler (mülk saatleri, misafirin kendi yazdıkları). */
  allowedTexts: readonly string[];
}

export interface CaseVerdict {
  red: boolean;
  reasons: RedReason[];
  /** Sayı taşıyan cevaplardan kaçının sayısı cevapta (cevaplanabilir soruda); diğerlerinde null. */
  answered: { anchored: number; hit: number } | null;
  /** Cevaplanabilir soruda somut cevap yok ama yanlış da yok (dürüst devir / yalnız sözel cevap). */
  handedOff: boolean;
}

export function caseVerdict(c: CaseInput): CaseVerdict {
  const reasons: RedReason[] = [];
  if (c.unsupported > 0) reasons.push("kanitsiz_iddia");
  const answerTexts = c.answers.flatMap((a) => a.needles);
  const allowed = new Set([...answerTexts, ...c.allowedTexts].flatMap((t) => numericAnchors(t)));
  const foreign = numericAnchors(c.reply).filter((a) => !allowed.has(a));
  // Sızıntı: yasak metnin, geçerli cevaplarda OLMAYAN somut değeri cevapta.
  const forbidden = (c.forbiddenNeedles ?? []).flatMap((t) => numericAnchors(t)).filter((a) => !allowed.has(a));
  if (forbidden.length > 0 && replyHasAnchor(c.reply, forbidden)) reasons.push("sizinti");
  let answered: CaseVerdict["answered"] = null;
  let handedOff = false;
  if (c.conflict) {
    const conflicting = answerTexts.flatMap((t) => numericAnchors(t));
    if (conflicting.length > 0 && replyHasAnchor(c.reply, conflicting)) reasons.push("celiskide_kesin");
  } else if (c.answers.length === 0) {
    if (foreign.length > 0) reasons.push("uydurma");
  } else {
    let anchored = 0;
    let hit = 0;
    for (const a of c.answers) {
      const own = numericAnchors(a.needles[0] ?? "");
      if (own.length === 0) continue;
      anchored += 1;
      if (replyHasAnchor(c.reply, own)) hit += 1;
    }
    answered = { anchored, hit };
    if (anchored > 0 && hit < anchored) {
      if (foreign.length > 0) reasons.push("yanlis_sayi");
      else handedOff = true;
    }
  }
  return { red: reasons.length > 0, reasons, answered, handedOff };
}
