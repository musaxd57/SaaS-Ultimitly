// ---------------------------------------------------------------------------
// KONAKLAMA EVAL'İ — KARAR ÖLÇÜLERİ (saf; dilim 9, 09-24). Kurucunun sorduğu oranlar tek yerden:
//  · TEHLİKELİ KAÇAK — gerçek istek (etiket ≠ none) birleşimde tutulmadı → model cevabı otomatik gidebilirdi;
//  · GEREKSİZ İNCELEME — istek yok (none) ama birleşim tuttu → insana gereksiz iş;
//  · BİLGİ SORUSU ↔ İZİN — erken giriş KONULU "none" satırları (ör. "ücretli mi?"): kaçı incelemeye düştü, kaçı
//    politika metnine uygun (iki model "istek yok" + kelime ağı yalnız aynı konu + saat / başka gün yok) — ürünün
//    `stayInfoOnly` + `earlyCheckinPolicyAllowed` şartlarının cevap modeli OLMADAN yaklaşığı (alt sınır);
//  · BİLİNMİYOR — modelin düştüğü satır (hüküm yok; birleşim sayımına girmez, rapor GEÇERSİZ damgası ayrı);
//  · KATMAN GEREKLİLİĞİ — gerçek isteği YALNIZ tek bir katmanın yakaladığı satır sayısı (o katman kalksa kaçacaktı).
// Metin taşımaz: yalnız sayılar (gerçek set B'de de raporlanabilir).
// ---------------------------------------------------------------------------

export interface UnionRow {
  /** Doğru etiket: "none" ya da istek türü (early / late / extend / date_change / availability). */
  kind: string;
  /** Deterministik kelime ağı istek gördü mü. */
  lexical: boolean;
  /** Kelime ağının gördüğü türler (early / late / extend / …) — bilgi sorusu konusu için. */
  lexicalKinds: readonly string[];
  /** Bekçi: istek gördü mü; `null` = model düştü (hüküm yok). */
  guard: boolean | null;
  /** Anlama katmanı: istek gördü mü; `null` = model düştü. */
  nlu: boolean | null;
  /** Anlama katmanının niyet etiketleri (konu için). */
  intents: readonly string[];
  /** Metinde saat ya da başka güne işaret (somut istek işareti; deterministik). */
  concrete: boolean;
}

export interface UnionMetrics {
  requests: number;
  misses: number;
  missesByKind: Record<string, number>;
  none: number;
  falseAlarms: number;
  unknown: { guard: number; nlu: number; rows: number };
  onlyLeg: { lexical: number; guard: number; nlu: number };
  info: { questions: number; flagged: number; policyEligible: number };
}

/** Politika yolu yalnız erken giriş konusudur (bavul deposu sorusu bilgi sorusu sayılmaz). */
const EARLY_TOPIC_INTENTS = new Set(["early_checkin"]);

export function summarizeUnion(rows: readonly UnionRow[]): UnionMetrics {
  const m: UnionMetrics = {
    requests: 0,
    misses: 0,
    missesByKind: {},
    none: 0,
    falseAlarms: 0,
    unknown: { guard: 0, nlu: 0, rows: 0 },
    onlyLeg: { lexical: 0, guard: 0, nlu: 0 },
    info: { questions: 0, flagged: 0, policyEligible: 0 },
  };
  for (const r of rows) {
    if (r.guard === null) m.unknown.guard++;
    if (r.nlu === null) m.unknown.nlu++;
    if (r.guard === null || r.nlu === null) {
      m.unknown.rows++;
      continue;
    }
    const held = r.lexical || r.guard || r.nlu;
    if (r.kind !== "none") {
      m.requests++;
      if (!held) {
        m.misses++;
        m.missesByKind[r.kind] = (m.missesByKind[r.kind] ?? 0) + 1;
      }
      const legs = [r.lexical, r.guard, r.nlu].filter(Boolean).length;
      if (legs === 1) {
        if (r.lexical) m.onlyLeg.lexical++;
        else if (r.guard) m.onlyLeg.guard++;
        else m.onlyLeg.nlu++;
      }
      continue;
    }
    m.none++;
    if (held) m.falseAlarms++;
    const earlyTopic = r.lexicalKinds.includes("early") || r.intents.some((i) => EARLY_TOPIC_INTENTS.has(i));
    if (!earlyTopic) continue;
    m.info.questions++;
    if (held) m.info.flagged++;
    const lexicalOtherKind = r.lexicalKinds.some((k) => k !== "early");
    if (!r.guard && !r.nlu && !lexicalOtherKind && !r.concrete) m.info.policyEligible++;
  }
  return m;
}

const ratio = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "—");

/** Markdown satırları (rapor). */
export function unionMetricsLines(title: string, m: UnionMetrics): string[] {
  const byKind = Object.entries(m.missesByKind)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
  return [
    `## ${title}`,
    "",
    "| ölçü | değer |",
    "|---|---|",
    `| Tehlikeli kaçak (istek → tutulmadı) | ${ratio(m.misses, m.requests)}${byKind ? ` — ${byKind}` : ""} |`,
    `| Gereksiz inceleme (istek yok → tutuldu) | ${ratio(m.falseAlarms, m.none)} |`,
    `| Bilgi sorusu (erken giriş konulu, istek yok) → incelemeye düştü | ${ratio(m.info.flagged, m.info.questions)} |`,
    `| Bilgi sorusu → politika metnine uygun (cevap modeli hariç, alt sınır) | ${ratio(m.info.policyEligible, m.info.questions)} |`,
    `| Bilinmiyor (model düştü; satır sayılmadı) | bekçi ${m.unknown.guard} · anlama ${m.unknown.nlu} · satır ${m.unknown.rows} |`,
    `| Yalnız TEK katmanın yakaladığı istek | kelime ağı ${m.onlyLeg.lexical} · bekçi ${m.onlyLeg.guard} · anlama ${m.onlyLeg.nlu} |`,
    "",
  ];
}
