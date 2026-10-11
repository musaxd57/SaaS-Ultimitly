// ---------------------------------------------------------------------------
// ÖLÇÜM HATASI → NEDEN ANALİZİ (kurucu 10-11: "hata oldu, hemen nedenini görmek için — neyden etkilendiğini, neden hata verdiğini
// anlaman için"). Bir ölçümde yanlış çıkan her vaka için İKİ bacak:
//  1. Modelin açıklaması (İPUCU): model kendi çıktısını açıklar, onu etkileyen ifadeleri söyler. Sonradan kurulan bir gerekçedir — iç
//     nedenin kanıtı DEĞİLDİR (acil numara ölçümünde görüldü: "şikâyet etiketi vermeliydim" dedi, aynı soruda bir tekrarda yine vermedi).
//  2. Karşı deneme (KANIT): mesajdan cümleler / modelin andığı ifadeler TEK TEK çıkarılır, aynı katman aynı ayarla yeniden koşar. Hangi
//     ifade çıkınca hata düzeliyorsa (tekrarların en az yarısında) TETİKLEYİCİ odur; modelin iddiası da böyle sınanır (doğrulandı /
//     doğrulanmadı).
//  3. Hata türü → düzeltme katmanı (kurucu: "önerdiğin döngü gibi olsun"): kanıt (kararsız · tetikleyici ifade · bağlam) + modelin
//     iki beyanı (talimatlarda bu durumu kapsayan kural var mıydı · test beklentisine katılıyor mu · bilgi eksik miydi) birleşir:
//     test beklentisi → bilgi tabanı → istem → kod kuralı → model sınırı (`suggestLayer`). Bu bir ÖNERİDİR; katmanı insan seçer,
//     misafire giden metni değiştiren her düzeltme kurucuya önce / sonra örneğiyle sorulur.
//  4. Doğrulama: düzeltmeden sonra AYNI vakalar yeniden ölçülür + kör set (görülmemiş sorular) — ezber olmasın. Rapor bu adımları yazar.
// Bu dosya SAF (model / ağ / DB yok) — model çağrıları bağdaştırıcıdan gelir (`failure-analysis-understanding.ts`).
// ---------------------------------------------------------------------------

export interface ModelExplanation {
  /** Modelin "beni etkiledi" dediği ifadeler (misafir metninden aynen). */
  influencedBy: string[];
  /** Neden bu çıktıyı verdi (kısa). */
  why: string;
  /** Şimdi tekrar baksa ne verirdi. */
  wouldNow: string;
  /** Talimatlarda bu durumu açıkça kapsayan bir kural var mıydı. */
  ruleCoverage: "covered" | "not_covered" | "unclear";
  /** Testin beklediği sonuca katılıyor mu (katılmıyorsa önce test beklentisi gözden geçirilir). */
  expectationAgrees: boolean;
  /** Doğru cevap için gereken bir bilgi eksik miydi (bilgi tabanı / bağlam). */
  infoMissing: boolean;
}

export type FixLayer = "test_expectation" | "knowledge" | "prompt" | "code_rule" | "model_limit" | "unknown";

export interface FailureCase<O> {
  id: string;
  text: string;
  observed: O;
  expected: string;
}

export interface AblationCandidate {
  kind: "clause" | "claimed";
  /** Çıkarılan ifade. */
  phrase: string;
  /** İfade çıkarılmış mesaj. */
  text: string;
}

export interface AblationResult extends AblationCandidate {
  correct: number;
  runs: number;
  outputs: string[];
}

export type FailureKind = "flaky" | "trigger" | "context" | "unrunnable";

export interface FailureAnalysis {
  id: string;
  text: string;
  expected: string;
  observed: string;
  explanation: ModelExplanation | null;
  baseline: { correct: number; runs: number; outputs: string[] };
  ablations: AblationResult[];
  triggers: string[];
  claimChecks: { phrase: string; confirmed: boolean | null }[];
  kind: FailureKind;
  layer: FixLayer;
  calls: number;
}

export interface FailureAnalysisOptions<O> {
  /** Aynı katmanı aynı ayarla yeniden koştur (başarısızlıkta null). */
  run: (text: string) => Promise<O | null>;
  isCorrect: (o: O) => boolean;
  /** Çıktının kısa yazımı (rapor için; ör. niyet listesi). */
  show: (o: O) => string;
  /** Modelin açıklaması (isteğe bağlı; ücretli bir çağrı). */
  explain?: (c: FailureCase<O>) => Promise<ModelExplanation | null>;
  /** Tekrar sayısı (varsayılan 2). */
  reps?: number;
  /** En çok karşı deneme adayı (varsayılan 6). */
  maxAblations?: number;
}

const CLAUSE_BREAK = /[.!?;。！？\n]+|,\s+|،\s*/u;

/** Mesajı cümle / yan cümle parçalarına böler (nokta, ünlem, soru, noktalı virgül, satır, virgül+boşluk). Deterministik. */
export function splitClauses(text: string): string[] {
  return text
    .split(CLAUSE_BREAK)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

const collapse = (s: string) =>
  s
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/[,;:]\s*([.!?])/g, "$1")
    .replace(/([.!?])[.!?]+/g, "$1")
    .replace(/^[\s,.;:!?]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/** İfadeyi metinden bir kez çıkarır (büyük / küçük harf duyarsız); bulunamazsa null. */
export function removePhrase(text: string, phrase: string): string | null {
  const p = phrase.trim();
  if (!p) return null;
  const at = text.toLocaleLowerCase("tr").indexOf(p.toLocaleLowerCase("tr"));
  if (at < 0) return null;
  const out = collapse(text.slice(0, at) + " " + text.slice(at + p.length));
  return /[\p{L}\p{N}]/u.test(out) ? out : null;
}

/**
 * Karşı deneme adayları: önce modelin andığı ifadeler (iddiası sınansın), sonra cümle parçaları. Aynı sonucu veren aday tekilleştirilir;
 * tek parçalı mesajda parça çıkarılamaz (geriye bir şey kalmaz). Tavan `max`.
 */
export function ablationCandidates(text: string, claimed: readonly string[] = [], max = 6): AblationCandidate[] {
  const out: AblationCandidate[] = [];
  const seen = new Set<string>();
  const push = (kind: AblationCandidate["kind"], phrase: string) => {
    const t = removePhrase(text, phrase);
    if (t === null) return;
    const k = t.toLocaleLowerCase("tr");
    if (seen.has(k) || k === text.trim().toLocaleLowerCase("tr")) return;
    seen.add(k);
    out.push({ kind, phrase: phrase.trim(), text: t });
  };
  for (const c of claimed) push("claimed", c);
  const clauses = splitClauses(text);
  if (clauses.length > 1) for (const c of clauses) push("clause", c);
  return out.slice(0, max);
}

/** Tekrarların en az yarısında doğru → "düzeldi". */
export const fixedBy = (correct: number, runs: number) => runs > 0 && correct * 2 >= runs;

/** Hüküm: kararsız / tetikleyici / bağlam / koşulamadı + modelin iddialarının sınanması. */
export function judge(
  baseline: { correct: number; runs: number },
  ablations: readonly AblationResult[],
  claimed: readonly string[],
): { kind: FailureKind; triggers: string[]; claimChecks: { phrase: string; confirmed: boolean | null }[] } {
  const claimChecks = claimed.map((phrase) => {
    const a = ablations.find((x) => x.kind === "claimed" && x.phrase.toLocaleLowerCase("tr") === phrase.trim().toLocaleLowerCase("tr"));
    return { phrase, confirmed: a && a.runs > 0 ? fixedBy(a.correct, a.runs) : null };
  });
  if (baseline.runs === 0) return { kind: "unrunnable", triggers: [], claimChecks };
  if (fixedBy(baseline.correct, baseline.runs)) return { kind: "flaky", triggers: [], claimChecks };
  const triggers = [...new Set(ablations.filter((a) => a.runs > 0 && fixedBy(a.correct, a.runs)).map((a) => a.phrase))];
  return { kind: triggers.length > 0 ? "trigger" : "context", triggers, claimChecks };
}

/**
 * 3. adım — düzeltme katmanı ÖNERİSİ (sıra önemli): test beklentisi şüpheliyse önce o; bilgi eksikse bilgi tabanı; talimat bu durumu
 * kapsamıyor / belirsizse istem; kapsıyor ama belirli bir ifade kararı bozuyorsa kod kuralı (deterministik yakalama) ya da o ifadeye dair
 * açık istem kuralı; kapsıyor + kararsız / bağlam → model sınırı (çoğunluk oyu, çaba, model). Açıklama yoksa yalnız kanıta bakılır.
 */
export function suggestLayer(kind: FailureKind, explanation: ModelExplanation | null): FixLayer {
  if (kind === "unrunnable") return "unknown";
  if (explanation && !explanation.expectationAgrees) return "test_expectation";
  if (explanation?.infoMissing) return "knowledge";
  if (explanation && explanation.ruleCoverage !== "covered") return "prompt";
  if (kind === "trigger") return "code_rule";
  return explanation ? "model_limit" : "unknown";
}

async function repeat<O>(text: string, opts: FailureAnalysisOptions<O>, reps: number) {
  let correct = 0;
  let runs = 0;
  const outputs: string[] = [];
  for (let i = 0; i < reps; i++) {
    const o = await opts.run(text);
    if (o === null) {
      outputs.push("(çağrı başarısız)");
      continue;
    }
    runs++;
    if (opts.isCorrect(o)) correct++;
    outputs.push(opts.show(o));
  }
  return { correct, runs, outputs };
}

/** Bir hatalı vakanın neden analizi (çağrı sayısı = açıklama + reps × (1 + aday)). */
export async function analyzeFailure<O>(c: FailureCase<O>, opts: FailureAnalysisOptions<O>): Promise<FailureAnalysis> {
  const reps = Math.max(1, opts.reps ?? 2);
  let calls = 0;
  let explanation: ModelExplanation | null = null;
  if (opts.explain) {
    calls++;
    explanation = await opts.explain(c).catch(() => null);
  }
  const claimed = (explanation?.influencedBy ?? []).filter((p) => removePhrase(c.text, p) !== null);
  const baseline = await repeat(c.text, opts, reps);
  calls += reps;
  const ablations: AblationResult[] = [];
  for (const cand of ablationCandidates(c.text, claimed, opts.maxAblations ?? 6)) {
    const r = await repeat(cand.text, opts, reps);
    calls += reps;
    ablations.push({ ...cand, ...r });
  }
  const verdict = judge(baseline, ablations, claimed);
  return {
    layer: suggestLayer(verdict.kind, explanation),
    id: c.id,
    text: c.text,
    expected: c.expected,
    observed: opts.show(c.observed),
    explanation,
    baseline,
    ablations,
    triggers: verdict.triggers,
    claimChecks: verdict.claimChecks,
    kind: verdict.kind,
    calls,
  };
}

const LAYER_TEXT: Record<FixLayer, string> = {
  test_expectation: "TEST BEKLENTİSİ — model beklenene katılmıyor; önce senaryonun beklentisini gözden geçir (yanlış olan test olabilir)",
  knowledge: "BİLGİ TABANI / BAĞLAM — doğru cevap için gereken bilgi eksik",
  prompt: "İSTEM — talimatlar bu durumu kapsamıyor ya da belirsiz; açık bir kural / örnek eklenmeli",
  code_rule: "KOD KURALI — kural var ama belirli bir ifade kararı bozuyor; deterministik yakalama (ya da o ifadeye dair açık istem kuralı)",
  model_limit: "MODEL SINIRI — kural var, tek ifade suçlu değil; çoğunluk oyu / daha yüksek çaba / başka model ölçülmeli",
  unknown: "BELİRSİZ — açıklama yok ya da koşulamadı",
};

const KIND_TEXT: Record<FailureKind, string> = {
  flaky: "KARARSIZ — özgün mesaj yeniden koşunca çoğunlukla doğru; hata tekrar farkı (tek bir ifade suçlanamaz)",
  trigger: "TETİKLEYİCİ İFADE — aşağıdaki ifade çıkınca hata düzeliyor",
  context: "BAĞLAM — hiçbir tek ifade çıkınca düzelmiyor (mesajın bütünü ya da modelin sınırı)",
  unrunnable: "KOŞULAMADI — yeniden çağrılar başarısız",
};

/** İnsan okunur rapor (misafir metni sentetik geliştirme setinden; gerçek misafir verisi bu araca girmez). */
export function failureAnalysisMarkdown(title: string, header: string, results: readonly FailureAnalysis[]): string {
  const totalCalls = results.reduce((s, r) => s + r.calls, 0);
  const lines = [
    `# ${title}`,
    "",
    header,
    "",
    `Vaka: ${results.length} · toplam model çağrısı: ${totalCalls}. Modelin açıklaması İPUCUDUR (sonradan kurulan gerekçe); karşı deneme KANITTIR`,
    `(ifade çıkarılıp aynı katman yeniden koşuldu; tekrarların en az yarısında düzelen ifade tetikleyicidir).`,
    "",
  ];
  for (const r of results) {
    lines.push(`## ${r.id}`, "", `- Mesaj: "${r.text}"`, `- Beklenen: ${r.expected} · Gözlenen: ${r.observed}`);
    lines.push(`- Özgün mesaj yeniden: ${r.baseline.correct}/${r.baseline.runs} doğru (${r.baseline.outputs.join(" | ") || "—"})`);
    lines.push(`- **Kanıt: ${KIND_TEXT[r.kind]}**${r.triggers.length ? `: ${r.triggers.map((t) => `"${t}"`).join(", ")}` : ""}`);
    lines.push(`- **Önerilen düzeltme katmanı: ${LAYER_TEXT[r.layer]}**`);
    if (r.explanation) {
      lines.push(
        `- Modelin açıklaması: ${r.explanation.why}`,
        `- Modelin "beni etkiledi" dediği: ${r.explanation.influencedBy.map((p) => `"${p}"`).join(", ") || "—"}`,
        `- Şimdi verirdiği: ${r.explanation.wouldNow}`,
        `- Talimatlarda kural: ${r.explanation.ruleCoverage === "covered" ? "var" : r.explanation.ruleCoverage === "not_covered" ? "YOK" : "belirsiz"} · test beklentisine: ${r.explanation.expectationAgrees ? "katılıyor" : "KATILMIYOR"} · eksik bilgi: ${r.explanation.infoMissing ? "VAR" : "yok"}`,
      );
    }
    if (r.claimChecks.length) {
      lines.push(
        `- Modelin iddiası karşı denemede: ${r.claimChecks
          .map((c) => `"${c.phrase}" → ${c.confirmed === null ? "sınanamadı" : c.confirmed ? "DOĞRULANDI" : "doğrulanmadı"}`)
          .join(" · ")}`,
      );
    }
    lines.push("", "| çıkarılan ifade | tür | doğru | çıktılar |", "|---|---|---|---|");
    for (const a of r.ablations) {
      lines.push(`| "${a.phrase}" | ${a.kind === "claimed" ? "modelin andığı" : "cümle"} | ${a.correct}/${a.runs} | ${a.outputs.join(" \\| ")} |`);
    }
    lines.push("");
  }
  lines.push(
    "## Doğrulama (4. adım)",
    "",
    "- Düzeltmeden sonra bu vakalar AYNI ayarla yeniden ölçülür (her biri tekrarların çoğunda doğru olmalı).",
    "- Kör set (görülmemiş sorular) yeniden ölçülür — düzeltme yalnız görülen sorulara uymuş olmasın.",
    "- Misafire giden metni değiştiren düzeltme kurucuya önce / sonra örneğiyle sorulur; kod kuralı kırmızı-önce + mutasyonla pinlenir.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
