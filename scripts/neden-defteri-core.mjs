// NEDEN DEFTERİ — saf çekirdek (kurucu 11-26: "test niye burda hata oluyor onları öğren en ufak gitmeme nedeni hatanın sebeplerini tut
// bir dosyada biriksin datalar"). Betik `scripts/neden-defteri.mjs` bu modülü kullanır; tasarım `docs/TASARIM-2026-11-26-neden-defteri.md`.
//
// Girdi: canlı hat ölçerinin (`tests/eval/live-pipeline.eval.test.ts`) AYRINTI dosyası (`…-ayrinti.json`, suite
// "live-pipeline-sealed-detail": senaryo + tam satır) ya da mühürsüz koşunun yan dosyası (suite "live-pipeline", tam satırlar, senaryo YOK).
// Çıktı: ihtiyaç başına BİR satır (ihtiyacı olmayan senaryoda senaryo başına bir satır). Sonuç ölçerin KENDİ işaretlerinden okunur
// (`need-scoring.ts` `needMetrics` ile birebir aynı sayım); sebep ürünün kendi kodlarından (parça hükmü, kapı ayrıntısı, risk gerekçesi).
// Sebep okunamıyorsa UYDURULMAZ: `sebep: "bilinmiyor"` + hangi alanın eksik olduğu.
//
// 🚨 Setin DOSYA ADI bu modülde ve ürettiği satırlarda geçmez (erişim pini `tests/unit/sealed-eval-access.test.ts`); set türü etiketle anılır.

export const DEFTER_SURUMU = 1;

/** Ölçerin yanmış set etiketi → set türü (sıra `live-pipeline.eval.test.ts` `SEALED_NAMES` ile aynı; adlar burada YOK). */
export const SET_TURLERI = Object.freeze({
  "yanmis-1": "ihtiyac-kor",
  "yanmis-2": "ihtiyac-kabul",
  "yanmis-3": "evcil-hayvan-kabul",
  "yanmis-4": "gec-mesaj-kabul",
  "yanmis-5": "dayanak-kabul",
});

/** Sonuç sınıfları (ihtiyaç satırı). Sayım `needMetrics` ile aynı: tutma = gereksiz_tutuldu + metin_gitti_deger_yok. */
export const SONUCLAR = Object.freeze([
  "dogru_gitti",
  "gereksiz_tutuldu",
  "metin_gitti_deger_yok",
  "yanlis_gitti",
  "dogru_acik_kaldi",
  "acik_kalmaliyken_cevaplandi",
]);

// ── Ölçer deseni (need-scoring.ts ile AYNI; test iki tarafı aynı girdide kıyaslar) ──────────────────────────────────────────────
const DISCLOSURE_LINE = /\n*\((?:Bu yanıt|This reply|Diese Antwort|Cette réponse|Esta respuesta|تم إعداد|Этот ответ)[^()\n]{0,120}\)\s*$/u;
const rx = (p) => new RegExp(p, "iu");
const withoutDisclosure = (text) => String(text ?? "").replace(DISCLOSURE_LINE, "");

/**
 * "Bilgi yok / listede yok" anlatımına benzeyen ifadeler — YALNIZ şüphe işareti (ölçerin `ABSENCE_LEAK` sayacı bunların çoğunu görmüyor;
 * `NEDEN-ANALIZI` §7.1 örnekleri). Karar değildir; satırın sonucunu değiştirmez.
 */
const ABSENCE_HINT =
  /bilgi(m| tabanı| tabanımda)|paylaşılmamış|belirtilmemiş|kayıtlar(ım|ımızda)|not (mentioned|listed|indicated)|mentioned among|(don'?t|do not) have (any )?(information|details)|n'est pas (indiqu|mentionn)|pas (de |d')information|pas de .{1,30} indiqu|no (se )?(indica|menciona)|keine (informationen|angaben)|nicht (angegeben|erwähnt)|нет информации|записи .{0,30}нет|не указан/iu;

const kisalt = (s, n) => {
  const t = String(s ?? "").replace(/\s+/gu, " ").trim();
  return Array.from(t).length <= n ? t : `${Array.from(t).slice(0, n - 1).join("")}…`;
};

// ── Koşu kimliği ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Açık bayraklar: değeri boş / "(boş)" / "0" olmayanlar; "1" ise yalnız ad, başka değerse "AD=değer". Sıralı. */
export function acikBayraklar(flags) {
  return Object.entries(flags ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "(boş)" && v !== "0")
    .map(([k, v]) => (v === "1" ? k : `${k}=${v}`))
    .sort();
}

/**
 * Dosya adından koşu etiketi + tarih: "live-pipeline-<tarih>-<model>-<etiket>(-ayrinti).json" → etiket "<tarih>-<model>-<etiket>".
 * Ad biçimi tanınmazsa uzantısız dosya adı (etiket benzersiz olsun diye kısaltılmaz).
 */
export function kosuEtiketi(fileName) {
  const base = String(fileName).split(/[\\/]/u).pop().replace(/\.json$/u, "").replace(/-ayrinti$/u, "");
  const m = /^live-pipeline-(\d{4}-\d{2}-\d{2})-(.+)$/u.exec(base);
  return m ? { kosu: `${m[1]}-${m[2]}`, tarih: m[1] } : { kosu: base, tarih: null };
}

/**
 * Girdi dosyasını tanır ve satırları ortak biçime getirir: `{ scenario | null, result }`. Mühürlü koşunun TOPLU yan dosyası (satırda yalnız
 * kimlik + ok) reddedilir — ondan sebep okunamaz, ayrıntı dosyası verilmeli.
 */
export function girdiyiOku(detail, fileName) {
  if (!detail || typeof detail !== "object" || !Array.isArray(detail.rows)) throw new Error(`${fileName}: ölçer çıktısı değil (rows yok)`);
  const { kosu, tarih } = kosuEtiketi(fileName);
  const runtime = detail.runtime ?? {};
  const meta = detail.meta ?? {};
  let rows;
  let setEtiketi;
  if (detail.suite === "live-pipeline-sealed-detail") {
    rows = detail.rows.map((r) => ({ scenario: r.scenario ?? null, result: r.result }));
    setEtiketi = typeof meta.set === "string" ? meta.set : null;
  } else if (detail.suite === "live-pipeline") {
    if (detail.rows.some((r) => r && typeof r === "object" && !("cls" in r))) {
      throw new Error(`${fileName}: mühürlü koşunun toplu yan dosyası (satırda yalnız kimlik) — ayrıntı dosyasını (…-ayrinti.json) verin`);
    }
    rows = detail.rows.map((r) => ({ scenario: null, result: r }));
    setEtiketi = /yanmis-\d/u.exec(kosu)?.[0] ?? null;
  } else {
    throw new Error(`${fileName}: tanınmayan suite "${detail.suite}" (canlı hat ölçerinin ayrıntı / yan dosyası bekleniyor)`);
  }
  const setTuru = setEtiketi && SET_TURLERI[setEtiketi] ? SET_TURLERI[setEtiketi] : setEtiketi ? setEtiketi : "gelistirme";
  return {
    kosu: {
      kosu,
      tarih,
      commit: meta.commit ?? runtime.commit ?? null,
      model: meta.model ?? runtime.layers?.reply?.model ?? null,
      durum: meta.status ?? null,
      bayraklar: acikBayraklar(runtime.flags),
      setTuru,
    },
    rows,
  };
}

// ── İhtiyaç ↔ istek ↔ parça eşlemesi ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * İhtiyaçları (insanın yazdığı tür) anlama katmanının isteklerine (modelin okuduğu tür) eşler: önce aynı tür, sırayla; kalan TEK ihtiyaç ↔
 * kalan TEK istek tahmini eşlenir (`tahmini: true`). Dönüş: ihtiyaç başına `{ index, tahmini } | null` (index = istek sırası; parça `R<index+1>`).
 */
export function istekEsle(needKinds, intents) {
  const used = new Set();
  const out = needKinds.map((kind) => {
    const i = intents.findIndex((it, j) => !used.has(j) && it === kind);
    if (i < 0) return null;
    used.add(i);
    return { index: i, tahmini: false };
  });
  const freeNeeds = out.map((o, i) => (o === null ? i : -1)).filter((i) => i >= 0);
  const freeReqs = intents.map((_, j) => j).filter((j) => !used.has(j));
  if (freeNeeds.length === 1 && freeReqs.length === 1) out[freeNeeds[0]] = { index: freeReqs[0], tahmini: true };
  return out;
}

/**
 * İstek sırası → parça kimliği. Ürün parça kimliğini (R1, R2 …) yalnız CEVAPLANABİLİR öğelere, sırayla verir
 * (`conversation-items/plan.ts` `composeItemsPlan`: ev sahibine bırakılan hassas öğe numara almaz). Ayrıntı dosyası hangi isteğin
 * cevaplanabilir olduğunu yazmaz. Önce: parça sayısı istek sayısına eşitse her istek sırasıyla numara almıştır. Değilse öğe durumundan
 * okunur: türünün TEK öğesi `pending_host` olan istek numara almaz. (Öğe durumu turun SONUNDAKİ durumdur — kapı turu tutunca öğe sonradan
 * `pending_host`a geçebilir; bu yüzden eşit sayı kuralı önce gelir.) Sayım yine tutmazsa (şikâyete bağlı istek, aynı türden iki öğe …)
 * eşleme güvenilmez → `guvenilir: false` (satır şüphe işareti taşır).
 * @returns {{ refs: (string | null)[], guvenilir: boolean }}
 */
export function parcaKimlikleri(intents, items, partCount) {
  if (intents.length === partCount) return { refs: intents.map((_, i) => `R${i + 1}`), guvenilir: true };
  const heldKind = (kind) => {
    const of = (items ?? []).filter((i) => i.kind === kind);
    return of.length === 1 && of[0].status === "pending_host";
  };
  let n = 0;
  const refs = intents.map((kind) => (heldKind(kind) ? null : `R${++n}`));
  return { refs, guvenilir: n === partCount };
}

// ── Katman / sebep tabloları (ürün kodlarından; kaynak dosyalar tasarım belgesinde) ─────────────────────────────────────────────

/** Kapı ayrıntısı (`gate-evidence.ts` `GATE_BLOCK_DETAILS`) → katman. */
export function kapiKatmani(detail) {
  if (["not_model", "model_intent", "model_risk_label", "model_risk_level", "confidence_invalid", "low_confidence"].includes(detail)) return "cevap_modeli";
  if (["lexical_intent", "lexical_risk", "lexical_injection", "context_injection"].includes(detail)) return "kelime_agi";
  if (detail.startsWith("items_") || detail === "late_without_ledger") return "oge_kapisi";
  return "cikti_kapisi"; // reply_* · hazard_reassurance · signature_offplatform_contact
}

/** Risk gerekçesi (`risk-events.ts`) → katman. Genel kodlar (`low_confidence_or_risky`, `gate_passed`) sebep sayılmaz → null. */
export function riskKatmani(reason) {
  if (!reason || reason === "low_confidence_or_risky" || reason === "gate_passed") return null;
  if (reason === "availability_unconfirmed" || reason === "price_claim" || reason === "kb_time_conflict") return "konaklama_bekcisi";
  if (reason === "reply_language_mismatch") return "dil";
  if (reason === "understanding_risk") return "anlama";
  if (reason === "items_held") return "oge_kapisi";
  if (reason === "closing_ack" || reason === "closing_ack_semantic" || reason === "escalated_to_human") return "tur_kapisi";
  return "cikti_kapisi"; // handoff_notice · action_claim · reply_* …
}

/** Turun tamamını tutan sebep (gönderilmeyen tur). Bulunamazsa null. */
export function turSebebi(r) {
  const ev = r.trace?.evidence ?? null;
  if (r.skippedReason === "already_answered") {
    return { katman: "tur_kapisi", sebep: "already_answered", ayrinti: "geç mesajın turu açılmadı (anahtar kapalı ya da şart dışı)" };
  }
  if (r.skippedReason === "closing_ack" || r.skippedReason === "closing_ack_open") {
    return { katman: "tur_kapisi", sebep: r.skippedReason, ayrinti: "mesaj kapanış sayıldı" };
  }
  if (r.skippedReason === "escalated_to_human" || r.escalated) {
    if (ev?.ir?.v && ev.ir.v !== "-") return { katman: "anlama", sebep: `${ev.ir.v}:${ev.ir.k}`, ayrinti: "anlama katmanı riskli niyet okudu, insana devredildi" };
    const lx = Array.isArray(ev?.g?.lx) ? ev.g.lx : [];
    if (lx.length > 0) return { katman: "kelime_agi", sebep: `lexical:${lx.join("+")}`, ayrinti: "kelime ağı riskli etiket verdi, insana devredildi" };
    return { katman: "tur_kapisi", sebep: r.skippedReason ?? "escalated", ayrinti: "insana devredildi (risk kaynağı izde yok)" };
  }
  if (r.gateDetail) {
    const katman = kapiKatmani(r.gateDetail);
    const ayrinti =
      r.gateDetail === "items_nothing_answered"
        ? `modelin cevapladım dediği istek: ${JSON.stringify(r.trace?.declared?.answeredRequests?.refs ?? null)}`
        : katman === "cevap_modeli" && r.model
          ? `model etiketi: niyet ${r.model.intent} · risk ${r.model.riskLevel}/${r.model.riskType ?? "-"} · güven ${r.model.confidence}`
          : katman === "cikti_kapisi"
            ? "giden metin kod kapısına takıldı, bütün tur tutuldu"
            : katman === "kelime_agi"
              ? "kelime ağı turu tuttu"
              : "öğe kapısı turu tuttu";
    return { katman, sebep: r.gateDetail, ayrinti };
  }
  const rk = riskKatmani(r.riskReason);
  if (rk) {
    const sc = ev?.sc && ev.sc.v && ev.sc.v !== "-" ? ` · bekçi ${ev.sc.d} (${ev.sc.ri ?? "-"})` : "";
    return { katman: rk, sebep: r.riskReason, ayrinti: `risk gerekçesi${sc}` };
  }
  return null;
}

/**
 * Okuyucunun tutma sebepleri (`semantic/part-reader.ts` `PART_READER_HOLDS`; parça hükmünde `reader_<sebep>`) → defterde okunur ad. Sebep
 * kodu satırın `sebep` alanında AYNEN durur; bu tablo yalnız ayrıntıyı okunur kılar. Ürün listesiyle eşitliği pinli (`neden-defteri.test.ts`).
 */
export const OKUYUCU_SEBEPLERI = Object.freeze({
  not_answered: "sorulanı cevaplamıyor",
  binding: "değer / koşul başka şeye bağlı",
  unsupported: "notlarda yok",
  exception_only: "genel kuralı anmadan istisna",
  partial: "yarım cevap",
  unsure: "okuyucu emin değil",
  unread: "okuyucu okumadı (düştü / eksik / tavan)",
  notes_conflict: "notlar kendi arasında çelişiyor",
  wrong_language: "misafirin dilinde değil",
});

/**
 * Okuyucunun ham hükmü (ölçerin `readerRaw` alanı, 11-26'dan sonraki koşular) → kısa ayrıntı. Alan yoksa boş dize: okuyucunun HANGİ soruya
 * "hayır" dediği bugünkü ayrıntı dosyalarında yazılı değildir (yalnız tutma kodu).
 */
export function okuyucuAyrintisi(verdict) {
  if (!verdict || typeof verdict !== "object") return "";
  const f = [
    `cevaplıyor=${verdict.answers_request ?? "?"}`,
    `notlarla_destekli=${verdict.supported_by_notes ?? "?"}`,
    `bag_dogru=${verdict.binding_ok ?? "?"}`,
    ...(verdict.exception_without_rule ? ["kuralsız_istisna"] : []),
    ...(verdict.only_known_case ? ["yalnız_bilinen_durum"] : []),
    // 11-26 iki soru (`semantic/part-reader.ts`): yalnız "tutan" yön yazılır; alan yoksa (eski koşu) hiçbir şey eklenmez.
    ...(verdict.in_guest_language === false ? ["misafirin_dilinde_degil"] : []),
    ...(verdict.notes_conflict === true ? ["notlar_celisiyor"] : []),
  ];
  return `okuyucu: ${f.join(" · ")}${verdict.quote ? ` · alıntı "${kisalt(verdict.quote, 60)}"` : ""}`;
}

/** Parça hükmü → katman + sebep (parça kipi). `verdict` = okuyucunun aynı parçaya ham hükmü (varsa). */
function parcaSebebi(part, verdict) {
  if (part.status === "rejected") {
    const issues = Array.isArray(part.issues) ? part.issues : [];
    const okuyucu = issues.length > 0 && issues.every((i) => String(i).startsWith("reader_"));
    // Okuyucu sebebinin okunur adı (tanınmayan kod sessizce atlanır — sebep kodu `sebep` alanında aynen durur).
    const okunur = okuyucu
      ? issues
          .map((i) => String(i).slice("reader_".length))
          .filter((k) => Object.hasOwn(OKUYUCU_SEBEPLERI, k))
          .map((k) => OKUYUCU_SEBEPLERI[k])
          .join(", ")
      : "";
    const ayrinti = [
      okunur ? `okuyucu sebebi: ${okunur}` : "",
      part.advisory?.length ? `kodun gördüğü: ${part.advisory.join(",")}` : "",
      okuyucu ? okuyucuAyrintisi(verdict) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      katman: okuyucu ? "okuyucu" : "parca_dogrulama",
      sebep: issues.join("+") || "rejected",
      ayrinti: `${ayrinti}${part.rewritten ? `${ayrinti ? " · " : ""}bir kez yeniden yazıldı` : ""}`,
    };
  }
  if (part.status === "no_info") return { katman: "cevap_modeli", sebep: "parca_no_info", ayrinti: "model bu istek için 'bilgi yok' parçası yazdı" };
  if (part.status === "missing") return { katman: "cevap_modeli", sebep: "parca_eksik", ayrinti: "model bu isteğe parça yazmadı" };
  return null;
}

// ── Yanlış gönderimin mekanik dalı (need-scoring.ts scoreNeeds ile aynı dallar) ───────────────────────────────────────────────────

/** Hangi dal ihtiyacı "yanlış" saydı. Desen (senaryo) yoksa "desen_yok". */
export function yanlisDali(spec, allSpecs, sentText, items) {
  if (!spec) return "desen_yok";
  const text = withoutDisclosure(sentText);
  const sameKind = allSpecs.filter((x) => x.kind === spec.kind).length;
  const ofKind = (items ?? []).filter((i) => i.kind === spec.kind);
  const answeredItem = ofKind.some((i) => i.status === "answered");
  const forbidHit = (spec.forbid ?? []).some((p) => rx(p).test(text));
  if (forbidHit) return "yasak_desen_gitti";
  if (spec.want === "open") return sameKind === 1 && ofKind.length === 1 && answeredItem ? "oge_yanlis_kapandi" : "bilinmiyor";
  const pats = spec.all ?? [];
  const allOk = pats.every((p) => rx(p).test(text)) && text.length > 0;
  if (sameKind === 1 && ofKind.length === 1 && answeredItem && !allOk) return "eksik_deger_kapandi";
  if (sameKind > 1 && text.length > 0 && pats.length >= 2 && pats.some((p) => rx(p).test(text)) && !allOk) return "kismi_deger";
  if (text.length > 0 && !allOk && (spec.about ?? []).some((p) => rx(p).test(text))) return "konu_var_deger_yok";
  return "bilinmiyor";
}

const YANLIS_DAL_AYRINTI = {
  yasak_desen_gitti: "giden metinde bu ihtiyacın yasak deseni var",
  oge_yanlis_kapandi: "metin konuya değinmedi ama öğe 'cevaplandı' kapandı (ev sahibi açık soruyu görmez)",
  eksik_deger_kapandi: "beklenen değer metinde yok, öğe 'cevaplandı' kapandı",
  kismi_deger: "aynı türden iki ihtiyaç; değerlerin bir kısmı gitti",
  konu_var_deger_yok: "konu metinde geçiyor, beklenen değer yok (yanlış / eksik değer)",
  desen_yok: "senaryo deseni dosyada yok (mühürsüz yan dosya) — dal okunamadı",
  bilinmiyor: "ölçerin dallarından hiçbiri yeniden üretilemedi",
};

// ── Satır üretimi ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Sonuç: ölçerin kaydettiği işaretlerden (yeniden puanlama YOK). */
export function sonucOf(n) {
  if (n.want === "answered") {
    if (n.wrongAnswered) return "yanlis_gitti";
    if (n.textOk) return "dogru_gitti";
    return n.sentMissing ? "metin_gitti_deger_yok" : "gereksiz_tutuldu";
  }
  return n.textOk && !n.wrongAnswered ? "dogru_acik_kaldi" : "acik_kalmaliyken_cevaplandi";
}

/** Kararlı anahtar: aynı koşu + senaryo + ihtiyaç (sıra + tür) ikinci kez eklenmez. */
export function satirAnahtari(kosu, senaryo, ihtiyacSira, ihtiyacTuru) {
  return `${kosu}|${senaryo}|${ihtiyacSira ?? "-"}|${ihtiyacTuru ?? "-"}`;
}

function kanitOf(guest, etiket, metin) {
  const g = kisalt(guest, 90);
  if (!metin) return kisalt(`misafir: "${g}" → ${etiket}`, 200);
  return kisalt(`misafir: "${g}" → ${etiket}: "${kisalt(metin, 90)}"`, 200);
}

/**
 * Bir senaryo satırından defter satırları. `kosu` = `girdiyiOku().kosu`. İhtiyacı olan satırda ihtiyaç başına bir satır; ihtiyacı olmayan
 * satırda (`autoSend` beklentisi) senaryo başına bir satır (`birim: "senaryo"`, ihtiyaç toplamlarına girmez). Düşen satır (`ok: false`)
 * `sonuc: "olculmedi"` ile yazılır (ölçerin toplamlarına girmez).
 */
export function satirlariUret(kosu, scenario, r) {
  const ortak = {
    v: DEFTER_SURUMU,
    tarih: kosu.tarih,
    kosu: kosu.kosu,
    commit: kosu.commit,
    model: kosu.model,
    setTuru: kosu.setTuru,
    senaryo: r.id,
    sinif: r.cls ?? scenario?.class ?? null,
    dil: r.lang ?? scenario?.lang ?? null,
  };
  const guest = r.trace?.guest ?? scenario?.message ?? "";
  const parcaKipi = Array.isArray(r.parts);
  const sentText = r.sentText ?? null;
  const supheTur = [];
  if (r.sent && r.langOk === false) supheTur.push("dil_olcusu_uyusmuyor");
  if (r.sent && sentText && ABSENCE_HINT.test(withoutDisclosure(sentText)) && !r.absenceLeak) supheTur.push("bilgi_yok_anlatimi_olasi");

  if (r.ok === false) {
    return [
      {
        ...ortak,
        birim: r.needs ? "ihtiyac" : "senaryo",
        anahtar: satirAnahtari(kosu.kosu, r.id, null, null),
        sonuc: "olculmedi",
        katman: "olcer",
        sebep: r.error ?? r.skippedReason ?? "satir_dustu",
        ayrinti: "satır düştü (model yanıt vermedi / ölçer hatası) — toplamlara girmez",
        kanit: kanitOf(guest, "ölçülmedi", null),
        olcerSuphesi: [],
      },
    ];
  }

  if (!r.needs) {
    const beklenen = r.expectAuto === "yes" ? "gitmeli" : r.expectAuto === "no" ? "gitmemeli" : "farketmez";
    const sonuc = r.sent
      ? beklenen === "gitmemeli" ? "gitmemeliyken_gitti" : "gitti"
      : beklenen === "gitmeli" ? "gereksiz_tutuldu" : beklenen === "gitmemeli" ? "dogru_tutuldu" : "tutuldu";
    let neden = r.sent ? null : turSebebi(r);
    if (sonuc === "gitmemeliyken_gitti") {
      // Gitmemesi beklenen tur gitti. Geç mesaj senaryosunda turu açan şey belli (geç tur açıldı, `already_answered` değil); başka sınıfta
      // hangi katmanın tutması gerektiği izde yok → uydurulmaz.
      neden = r.late
        ? { katman: "tur_kapisi", sebep: "gec_tur_acildi_gonderildi", ayrinti: "geç mesajın turu açıldı ve cevap gitti; beklenti 'gitmez'" }
        : { katman: "bilinmiyor", sebep: "bilinmiyor", ayrinti: "beklenti 'gitmez' ama tur gitti; hangi katmanın tutması gerektiği izde yok (ihtiyaç tanımı yok)" };
    }
    return [
      {
        ...ortak,
        birim: "senaryo",
        anahtar: satirAnahtari(kosu.kosu, r.id, null, null),
        ihtiyacTuru: null,
        beklenen,
        sonuc,
        katman: neden ? neden.katman : r.sent ? null : "bilinmiyor",
        sebep: neden ? neden.sebep : r.sent ? null : "bilinmiyor",
        ayrinti: neden ? neden.ayrinti : r.sent ? "" : `tur tutuldu ama sebep izde yok (skippedReason ${r.skippedReason ?? "-"} · riskReason ${r.riskReason ?? "-"} · gateDetail -)`,
        kanit: kanitOf(guest, r.sent ? "giden" : "taslak", r.sent ? sentText : r.draft),
        olcerSuphesi: supheTur,
      },
    ];
  }

  const specs = scenario?.expect?.needs ?? null;
  const intents = (Array.isArray(r.requestsRaw) && Array.isArray(r.requestsRaw.at(-1)) ? r.requestsRaw.at(-1) : []).map((q) => q?.intent ?? null);
  const esleme = istekEsle(r.needs.map((n) => n.kind), intents);
  const partsRaw = Array.isArray(r.partsRaw) && Array.isArray(r.partsRaw.at(-1)) ? r.partsRaw.at(-1) : [];
  const readerRaw = Array.isArray(r.readerRaw) && Array.isArray(r.readerRaw.at(-1)) ? r.readerRaw.at(-1) : [];
  const items = r.itemStates ?? [];
  const tur = r.sent ? null : turSebebi(r);
  const kimlik = parcaKipi ? parcaKimlikleri(intents, items, r.parts.length) : null;

  return r.needs.map((n, i) => {
    const sonuc = sonucOf(n);
    const e = esleme[i];
    const ref = e && kimlik ? kimlik.refs[e.index] : null;
    const part = ref ? (r.parts.find((p) => p.ref === ref) ?? null) : null;
    const partText = ref ? (partsRaw.find((p) => p?.ref === ref)?.text ?? null) : null;
    const suphe = [...supheTur];
    if (e?.tahmini) suphe.push("eslesme_tahmini");
    if (kimlik && !kimlik.guvenilir) suphe.push("parca_kimligi_belirsiz");
    let katman = null;
    let sebep = null;
    let ayrinti = "";

    if (sonuc === "yanlis_gitti" || sonuc === "acik_kalmaliyken_cevaplandi") {
      const dal = yanlisDali(specs?.[i] ?? null, specs ?? [], sentText, items);
      katman = "cevap_modeli";
      sebep = dal;
      const gecen = parcaKipi
        ? part?.status === "verified"
          ? "parça doğrulandı (kod + okuyucu geçirdi)"
          : part
            ? `parça ${part.status} — metin başka parçadan`
            : "parça eşlenemedi"
        : r.sent
          ? "çıktı kapıları geçirdi"
          : "tur gitmedi";
      ayrinti = `${YANLIS_DAL_AYRINTI[dal] ?? dal} · ${gecen}`;
      if (dal === "oge_yanlis_kapandi") suphe.push("metin_sessiz_is_kapandi");
      if (dal === "bilinmiyor" || dal === "desen_yok") suphe.push("yanlis_dali_okunamadi");
    } else if (sonuc !== "dogru_gitti") {
      // Değer misafire ulaşmadı (tutma · metin gitti değer yok · doğru açık kaldı): neden?
      let neden = null;
      const itemOfKind = items.filter((it) => it.kind === n.kind);
      if (tur && ["tur_kapisi", "anlama", "kelime_agi"].includes(tur.katman)) neden = tur;
      else if (parcaKipi) {
        if (e && ref === null) {
          neden = { katman: "oge_kapisi", sebep: "oge_ev_sahibinde", ayrinti: `istek (${intents[e.index]}) hassas öğe olarak ev sahibine bırakıldı, parça yazılmadı${tur ? ` · tur: ${tur.sebep}` : ""}` };
        } else if (part) {
          neden = parcaSebebi(part, readerRaw.find((v) => v?.ref === ref) ?? null);
          // Tek satır tek sebep: parçanın kendi hükmü önce gelir; turu AYRICA tutan kapı varsa ayrıntıya yazılır (parça düzelse de gitmezdi).
          // (`items_nothing_answered` bağımsız bir kapı değildir: hiçbir parça doğrulanmadı demektir.)
          if (neden && tur && tur.sebep !== "items_nothing_answered") neden = { ...neden, ayrinti: [neden.ayrinti, `tur da tutuldu: ${tur.sebep}`].filter(Boolean).join(" · ") };
          if (!neden) {
            // Parça doğrulandı ama değer ulaşmadı.
            if (!r.sent) neden = tur ? { ...tur, ayrinti: `parça doğrulandı ama tur tutuldu · ${tur.ayrinti}`.trim() } : null;
            else if (n.want === "answered") {
              neden = { katman: "olcer", sebep: "dogrulanan_parca_deger_eslesmedi", ayrinti: "parça doğrulanıp gitti; ölçerin değer deseni giden metinde bulunmadı" };
              suphe.push("olcer_deseni_eslesmedi");
            }
          }
        } else if (!e) {
          neden = tur && tur.sebep !== "items_nothing_answered"
            ? tur
            : { katman: "anlama", sebep: "istek_eslesmedi", ayrinti: `ihtiyaç türü (${n.kind}) anlama katmanının isteklerinde yok: [${intents.join(", ")}]` };
          suphe.push("eslesme_tur_adina_dayali");
        } else {
          neden = { katman: "cevap_modeli", sebep: "parca_hukmu_yok", ayrinti: `${ref} için parça hükmü kaydı yok` };
        }
      } else if (!r.sent) {
        neden = tur;
      } else if (itemOfKind.some((it) => it.status === "pending_host")) {
        neden = { katman: "oge_kapisi", sebep: "oge_ev_sahibinde", ayrinti: "tur gitti; bu ihtiyacın öğesi ev sahibinde tutuldu" };
      } else if (n.want === "answered") {
        neden = { katman: "cevap_modeli", sebep: "ihtiyac_atlandi", ayrinti: `tur gitti; cevap bu ihtiyacı taşımıyor (modelin cevapladım dediği: ${JSON.stringify(r.trace?.declared?.answeredRequests?.refs ?? null)})` };
      }
      if (n.sentMissing) suphe.push("atlandi_mi_yanlis_mi_ayirt_edilemez");
      if (neden) ({ katman, sebep, ayrinti } = { katman: neden.katman, sebep: neden.sebep, ayrinti: neden.ayrinti ?? "" });
      else if (sonuc === "dogru_acik_kaldi" && r.sent) {
        katman = null;
        sebep = "konuya_degilmedi";
        ayrinti = "tur gitti, bu açık ihtiyaca değinilmedi";
      } else {
        katman = "bilinmiyor";
        sebep = "bilinmiyor";
        ayrinti = `sebep alanı eksik (skippedReason ${r.skippedReason ?? "-"} · riskReason ${r.riskReason ?? "-"} · gateDetail ${r.gateDetail ?? "-"} · parça ${part ? part.status : parcaKipi ? "eşlenemedi" : "kip kapalı"})`;
      }
    }

    const etiket = r.sent ? "giden" : partText ? "parça" : "taslak";
    const metin = r.sent ? sentText : (partText ?? r.draft);
    return {
      ...ortak,
      birim: "ihtiyac",
      anahtar: satirAnahtari(kosu.kosu, r.id, i, n.kind),
      ihtiyacSira: i,
      ihtiyacTuru: n.kind,
      istek: e ? { ref, tur: intents[e.index] ?? null, ...(part ? { parca: part.status } : {}) } : null,
      beklenen: n.want === "answered" ? "cevaplanmali" : "acik_kalmali",
      sonuc,
      katman,
      sebep,
      ayrinti,
      kanit: kanitOf(guest, etiket, metin),
      olcerSuphesi: [...new Set(suphe)],
    };
  });
}

/** Ayrıntı dosyası → defter satırları. */
export function dosyadanSatirlar(detail, fileName, etiket) {
  const { kosu, rows } = girdiyiOku(detail, fileName);
  if (etiket) kosu.kosu = etiket;
  return [kosuSatiri(kosu), ...rows.flatMap(({ scenario, result }) => satirlariUret(kosu, scenario, result))];
}

/**
 * Koşu başlık satırı (`birim: "kosu"`): bayraklar, durum ve set türü koşu başına BİR kez yazılır (ihtiyaç satırları `kosu` alanıyla
 * bağlanır — her satırda yirmi bayrak tekrarlanmasın).
 */
export function kosuSatiri(kosu) {
  return {
    v: DEFTER_SURUMU,
    birim: "kosu",
    anahtar: satirAnahtari(kosu.kosu, "-", null, null),
    tarih: kosu.tarih,
    kosu: kosu.kosu,
    commit: kosu.commit,
    model: kosu.model,
    durum: kosu.durum,
    setTuru: kosu.setTuru,
    bayraklar: kosu.bayraklar,
  };
}

/**
 * Deftere ekleme (saf): var olan satırların anahtarları + yeni satırlar → yalnız YENİ olanlar (aynı çağrıdaki tekrar da yutulur).
 * @returns {{ eklenecek: object[], yutulan: number }}
 */
export function yeniSatirlar(mevcutSatirlar, adaylar) {
  const keys = new Set(mevcutSatirlar.map((s) => s.anahtar));
  const eklenecek = [];
  let yutulan = 0;
  for (const s of adaylar) {
    if (keys.has(s.anahtar)) {
      yutulan += 1;
      continue;
    }
    keys.add(s.anahtar);
    eklenecek.push(s);
  }
  return { eklenecek, yutulan };
}

/** JSONL metni → satırlar (boş satır atlanır; bozuk satır HATA — defter sessizce kısalmaz). */
export function defteriAyristir(text) {
  return String(text ?? "")
    .split("\n")
    .map((l, i) => [l.trim(), i + 1])
    .filter(([l]) => l.length > 0)
    .map(([l, no]) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`defter satırı ${no} bozuk JSON`);
      }
    });
}

// ── Özet ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Koşu başına ihtiyaç toplamları — ölçer raporundaki dört sayı (doğru · tutma · yanlış · açık kaldı / açık toplam). */
export function kosuToplamlari(satirlar) {
  const by = new Map();
  for (const s of satirlar) {
    if (s.birim !== "ihtiyac" || s.sonuc === "olculmedi") continue;
    const t = by.get(s.kosu) ?? { kosu: s.kosu, setTuru: s.setTuru, commit: s.commit, model: s.model, dogru: 0, tutma: 0, metinGittiDegerYok: 0, yanlis: 0, acikOk: 0, acik: 0, cevaplanmali: 0 };
    if (s.beklenen === "cevaplanmali") t.cevaplanmali += 1;
    if (s.beklenen === "acik_kalmali") t.acik += 1;
    if (s.sonuc === "dogru_gitti") t.dogru += 1;
    if (s.sonuc === "gereksiz_tutuldu" || s.sonuc === "metin_gitti_deger_yok") t.tutma += 1;
    if (s.sonuc === "metin_gitti_deger_yok") t.metinGittiDegerYok += 1;
    if (s.sonuc === "yanlis_gitti" || s.sonuc === "acik_kalmaliyken_cevaplandi") t.yanlis += 1;
    if (s.sonuc === "dogru_acik_kaldi") t.acikOk += 1;
    by.set(s.kosu, t);
  }
  return [...by.values()];
}

const KUSURLU = new Set(["gereksiz_tutuldu", "metin_gitti_deger_yok", "yanlis_gitti", "acik_kalmaliyken_cevaplandi", "gitmemeliyken_gitti"]);
const cell = (s) => String(s ?? "—").replace(/\|/gu, "/").replace(/\n/gu, " ");

/** İnsan için özet (Markdown). Girdi: defterin bütün satırları. Çıktı deterministik (aynı defter → aynı metin). */
export function ozetMetni(tumSatirlar) {
  const basliklar = new Map(tumSatirlar.filter((s) => s.birim === "kosu").map((s) => [s.kosu, s]));
  const satirlar = tumSatirlar.filter((s) => s.birim !== "kosu");
  const kosular = [...new Set(satirlar.map((s) => s.kosu))];
  const ihtiyac = satirlar.filter((s) => s.birim === "ihtiyac" && s.sonuc !== "olculmedi");
  const kusurlu = satirlar.filter((s) => KUSURLU.has(s.sonuc));
  const bilinmiyor = kusurlu.filter((s) => s.sebep === "bilinmiyor" || s.katman === "bilinmiyor");
  const L = [];
  L.push("# Neden defteri — özet");
  L.push("");
  L.push("Kaynak: `docs/olcum/neden-defteri.jsonl` (ihtiyaç başına bir satır; ihtiyacı olmayan senaryoda senaryo başına). Bu dosya her");
  L.push("`node scripts/neden-defteri.mjs ozet` çalıştırmasında YENİDEN üretilir — elle düzenlemeyin. Alanlar ve sınırlar:");
  L.push("`docs/TASARIM-2026-11-26-neden-defteri.md`.");
  L.push("");
  L.push(`Koşu ${kosular.length} · satır ${satirlar.length} (ihtiyaç ${ihtiyac.length}) · kusurlu satır (tutma / yanlış) ${kusurlu.length} · sebebi "bilinmiyor" ${bilinmiyor.length} (${kusurlu.length ? Math.round((100 * bilinmiyor.length) / kusurlu.length) : 0}%)`);
  L.push("");
  L.push("## Koşular — ölçer raporuyla aynı dört sayı");
  L.push("");
  // Ayırt eden bayraklar: bu koşuda açık olup defterdeki HER koşuda açık olmayanlar (kolun farkı).
  const ortakBayrak = [...basliklar.values()].reduce((acc, b) => (acc === null ? new Set(b.bayraklar ?? []) : new Set([...acc].filter((f) => (b.bayraklar ?? []).includes(f)))), null) ?? new Set();
  L.push("| koşu | set türü | commit | doğru (cevaplanmalı) | tutma (↳ metin gitti, değer yok) | yanlış | açık kaldı | ayırt eden açık bayraklar |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const t of kosuToplamlari(satirlar)) {
    const fark = (basliklar.get(t.kosu)?.bayraklar ?? []).filter((f) => !ortakBayrak.has(f));
    L.push(`| ${t.kosu} | ${t.setTuru} | ${t.commit ?? "?"} | ${t.dogru}/${t.cevaplanmali} | ${t.tutma} (↳ ${t.metinGittiDegerYok}) | ${t.yanlis} | ${t.acikOk}/${t.acik} | ${basliklar.has(t.kosu) ? fark.join(" · ") || "(yok)" : "başlık satırı yok"} |`);
  }
  L.push("");
  L.push(`Bütün koşularda açık: ${[...ortakBayrak].sort().join(" · ") || "(yok)"}`);
  L.push("");

  // Sebep × katman × koşu
  const grup = new Map();
  for (const s of kusurlu) {
    const k = `${s.katman ?? "—"}\u0000${s.sebep ?? "—"}`;
    const g = grup.get(k) ?? { katman: s.katman ?? "—", sebep: s.sebep ?? "—", toplam: 0, by: new Map(), ornek: [] };
    g.toplam += 1;
    g.by.set(s.kosu, (g.by.get(s.kosu) ?? 0) + 1);
    if (g.ornek.length < 2) g.ornek.push(s);
    grup.set(k, g);
  }
  const sirali = [...grup.values()].sort((a, b) => b.toplam - a.toplam || a.katman.localeCompare(b.katman) || a.sebep.localeCompare(b.sebep));
  L.push("## Sebep × katman × koşu (yalnız kusurlu satırlar: tutma, metin gitti değer yok, yanlış, açık kalmalıyken cevaplandı)");
  L.push("");
  L.push(`Koşu sütunları: ${kosular.map((k, i) => `K${i + 1} = ${k}`).join(" · ")}`);
  L.push("");
  L.push(`| katman | sebep | toplam | ${kosular.map((_, i) => `K${i + 1}`).join(" | ")} |`);
  L.push(`|---|---|---|${kosular.map(() => "---").join("|")}|`);
  for (const g of sirali) L.push(`| ${cell(g.katman)} | ${cell(g.sebep)} | ${g.toplam} | ${kosular.map((k) => g.by.get(k) ?? 0).join(" | ")} |`);
  L.push("");

  L.push("## Sonuç × katman");
  L.push("");
  const sk = new Map();
  for (const s of kusurlu) sk.set(`${s.sonuc}\u0000${s.katman ?? "—"}`, (sk.get(`${s.sonuc}\u0000${s.katman ?? "—"}`) ?? 0) + 1);
  L.push("| sonuç | katman | satır |");
  L.push("|---|---|---|");
  for (const [k, n] of [...sk.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const [so, ka] = k.split("\u0000");
    L.push(`| ${so} | ${ka} | ${n} |`);
  }
  L.push("");

  L.push("## En sık 15 sebep — örnekler");
  L.push("");
  for (const g of sirali.slice(0, 15)) {
    L.push(`### ${g.sebep} (${g.katman}) — ${g.toplam}`);
    for (const o of g.ornek) L.push(`- ${o.kosu} · ${o.senaryo}${o.ihtiyacTuru ? ` · ${o.ihtiyacTuru}` : ""} · ${o.sonuc}: ${cell(o.ayrinti)} — ${cell(o.kanit)}`);
    L.push("");
  }

  L.push('## "Bilinmiyor" kalanlar');
  L.push("");
  if (bilinmiyor.length === 0) L.push("Yok.");
  for (const s of bilinmiyor) L.push(`- ${s.kosu} · ${s.senaryo} · ${s.ihtiyacTuru ?? "senaryo"} · ${s.sonuc}: ${cell(s.ayrinti)}`);
  L.push("");

  L.push("## Ölçer şüphesi işaretleri (sonucu değiştirmez; satır elle incelenir)");
  L.push("");
  const sup = new Map();
  for (const s of satirlar) for (const f of s.olcerSuphesi ?? []) sup.set(f, (sup.get(f) ?? 0) + 1);
  L.push("| işaret | satır |");
  L.push("|---|---|");
  for (const [f, n] of [...sup.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) L.push(`| ${f} | ${n} |`);
  L.push("");

  L.push("## Koşular arası değişen ihtiyaçlar (aynı set türü + senaryo + ihtiyaç, sonucu koşudan koşuya farklı)");
  L.push("");
  const byNeed = new Map();
  for (const s of ihtiyac) {
    const k = `${s.setTuru}\u0000${s.senaryo}\u0000${s.ihtiyacSira}\u0000${s.ihtiyacTuru}`;
    const arr = byNeed.get(k) ?? [];
    arr.push(s);
    byNeed.set(k, arr);
  }
  const degisen = [...byNeed.entries()].filter(([, arr]) => new Set(arr.map((s) => s.sonuc)).size > 1);
  if (degisen.length === 0) L.push("Yok.");
  else {
    L.push("| set türü | senaryo | ihtiyaç | koşu → sonuç (sebep) |");
    L.push("|---|---|---|---|");
    for (const [k, arr] of degisen.sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true }))) {
      const [st, sc, , kind] = k.split("\u0000");
      const runs = arr.map((s) => `K${kosular.indexOf(s.kosu) + 1}: ${s.sonuc}${s.sebep ? ` (${s.sebep})` : ""}`).join(" · ");
      L.push(`| ${st} | ${sc} | ${kind} | ${cell(runs)} |`);
    }
  }
  L.push("");

  const senaryo = satirlar.filter((s) => s.birim === "senaryo");
  if (senaryo.length > 0) {
    L.push("## İhtiyacı olmayan senaryolar (autoSend beklentisi; ihtiyaç toplamlarına girmez)");
    L.push("");
    const ss = new Map();
    for (const s of senaryo) ss.set(`${s.kosu}\u0000${s.sonuc}\u0000${s.sebep ?? "—"}`, (ss.get(`${s.kosu}\u0000${s.sonuc}\u0000${s.sebep ?? "—"}`) ?? 0) + 1);
    L.push("| koşu | sonuç | sebep | satır |");
    L.push("|---|---|---|---|");
    for (const [k, n] of [...ss.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const [ko, so, se] = k.split("\u0000");
      L.push(`| ${ko} | ${so} | ${cell(se)} | ${n} |`);
    }
    L.push("");
  }
  return `${L.join("\n")}\n`;
}
