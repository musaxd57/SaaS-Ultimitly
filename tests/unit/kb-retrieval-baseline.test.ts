import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { buildScenarios, runHybrid, runLegacy, type RetrievalScenario, type RunOutcome } from "../helpers/kb-retrieval-scenarios";

// ---------------------------------------------------------------------------
// RETRIEVAL BASELINE — legacy (en yeni 30 + 24k) vs hibrit, MODEL YOK (09-09).
//
// Codex şartı: hibrit eklenmeden ÖNCE mevcut toplu-KB yaklaşımının senaryo
// sınıflarındaki davranışı ölçülsün; retrieval isabeti / maliyet (karakter) /
// gürültü / gecikme AYRI raporlansın. Bu dosya hem KAPI (invariantlar) hem
// RAPOR üreticisidir (`KB_RETRIEVAL_REPORT=1` ile `docs/olcum/` altına yazar;
// CI'da yazmaz). Rapor bir retrieval ölçümüdür — modelin cevabını ÖLÇMEZ.
// ---------------------------------------------------------------------------

interface Row {
  s: RetrievalScenario;
  legacy: RunOutcome;
  hybrid: RunOutcome;
}

const rows: Row[] = buildScenarios().map((s) => ({ s, legacy: runLegacy(s), hybrid: runHybrid(s) }));
const byId = Object.fromEntries(rows.map((r) => [r.s.id, r])) as Record<string, Row>;

describe("retrieval baseline — legacy vs hibrit", () => {
  it("senaryo seti Codex sınıflarını kapsıyor", () => {
    const classes = rows.map((r) => r.s.class);
    for (const needle of ["uzun metin", "eşanlam", "yanlış kategori", "çok soru", "kaynak çelişkisi", "kötü niyetli", "yazım", "bağlam", "geri çekilme"]) {
      expect(classes.some((c) => c.includes(needle)), needle).toBe(true);
    }
  });

  it("🚨 LEGACY'nin ölçülen açığı: en eski uzun rehber adet tavanından düşer → ilgili cümle MODELE GİTMEZ", () => {
    expect(byId.long_middle_oldest.legacy.hit).toBe(false);
    expect(byId.long_middle_oldest.hybrid.hit).toBe(true);
  });

  it("hibrit HİÇBİR senaryoda legacy'den az isabet etmez", () => {
    for (const r of rows) {
      if (r.legacy.hit) expect(r.hybrid.hit, r.s.id).toBe(true);
    }
  });

  it("isabetli hibrit seçimlerinde istem bloğu legacy'den KÜÇÜKTÜR (maliyet vekili) ve gürültü daha az", () => {
    for (const r of rows) {
      if (r.hybrid.fallback && r.hybrid.fallback !== "none") continue;
      expect(r.hybrid.chars, r.s.id).toBeLessThan(r.legacy.chars);
      expect(r.hybrid.noise, r.s.id).toBeLessThanOrEqual(r.legacy.noise);
    }
  });

  it("kötü niyetli kaynak: KÜÇÜK KB'de hibrit legacy ile AYNI kümeyi gönderir (maruziyet farkı YOK); daraltılan BÜYÜK KB'de ilgisiz soruda gitmez", () => {
    // 09-23: tamamı 6k'ya sığan ≤30 kalemlik KB'de seçim YAPILMAZ (parafraz ölçümü) → maruziyet
    // legacy'ninkiyle aynı. Retrieval zaten politika DEĞİLDİ; asıl koruma sır elemesi + injection vetosu.
    expect(byId.malicious_source.legacy.leaked).toBe(true);
    expect(byId.malicious_source.hybrid.leaked).toBe(true);
    expect(byId.malicious_source.hybrid.fallback).toBe("small_kb");
    const s = byId.malicious_source.s;
    const pad = Array.from({ length: 12 }, (_, i) => ({
      id: `kb_pad_${i}`,
      category: "faq",
      title: `Ek not ${i}`,
      content: `Bu ek not ${i} yalnız hacim içindir.`,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
    }));
    const big = runHybrid({ ...s, items: [...s.items, ...pad] });
    expect(big.fallback).toBe("none");
    expect(big.leaked).toBe(false);
    expect(big.hit).toBe(true);
  });

  it("kaynak çelişkisinde iki saat de gider (retrieval çelişkiyi gizlemez)", () => {
    expect(byId.source_conflict.hybrid.hit).toBe(true);
  });

  it("geri çekilme senaryolarında hibrit blok legacy ile AYNI metindir", () => {
    for (const id of ["greeting_only", "no_hits"]) {
      expect(byId[id].hybrid.text, id).toBe(byId[id].legacy.text);
      expect(byId[id].hybrid.fallback, id).not.toBe("none");
    }
  });

  it("gecikme: hibrit seçim senaryo başına 250 ms'nin altında (indeks kurulumu dahil)", () => {
    for (const r of rows) expect(r.hybrid.ms, r.s.id).toBeLessThan(250);
  });
});

function report(): string {
  // Rapor kodla AYNI commit'e girer, bu yüzden kendi commit hash'ini taşıyamaz: HEAD
  // ölçülen kodun EBEVEYNİDİR; çalışma ağacı kirliyse bu açıkça yazılır.
  let commit = "?";
  try {
    const head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    commit = dirty ? `${head} + çalışma ağacı (rapor kodla aynı commit'e girer; hash ebeveyndir)` : head;
  } catch {
    /* rapor yine yazılır */
  }
  const lines: string[] = [];
  lines.push(`# Retrieval baseline — legacy vs hibrit (${new Date().toISOString().slice(0, 10)}, commit ${commit})`);
  lines.push("");
  lines.push("> Model YOK, DB YOK. Ölçülen: modele giden bilgi bloğunda ilgili cümle var mı (isabet), blok karakteri (maliyet vekili),");
  lines.push("> ilgisiz kalem sayısı (gürültü), seçim süresi (ms). Legacy = `kb-fetch` (en yeni 30) + `packKnowledgeBase` (24k) aynası;");
  lines.push("> hibrit = `selectKbForPrompt` (bayrak `KB_RETRIEVAL_MODE`, 09-11'den beri varsayılan AÇIK). Bu rapor modelin CEVABINI ölçmez;");
  lines.push("> gerçek model eval'ini kurucu koşar (`docs/EVAL-CALISTIRMA.md`). Üretici: `tests/unit/kb-retrieval-baseline.test.ts`.");
  lines.push("");
  lines.push("| Senaryo | Sınıf | Legacy isabet | Hibrit isabet | Legacy kar. | Hibrit kar. | Legacy gürültü | Hibrit gürültü | Hibrit ms | Geri çekilme |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const h = (o: RunOutcome, s: RetrievalScenario) =>
      s.mustContain.length === 0 ? "—" : o.hit ? "✅" : "❌";
    lines.push(
      `| ${r.s.id} | ${r.s.class} | ${h(r.legacy, r.s)} | ${h(r.hybrid, r.s)} | ${r.legacy.chars} | ${r.hybrid.chars} | ${r.legacy.noise} | ${r.hybrid.noise} | ${r.hybrid.ms} | ${r.hybrid.fallback ?? ""} |`,
    );
  }
  lines.push("");
  lines.push("## Notlar");
  for (const r of rows) if (r.s.note) lines.push(`- **${r.s.id}:** ${r.s.note}`);
  lines.push("- **malicious_source:** legacy'de kötü niyetli kalem modele GİDER (sızıntı ölçümü ✅ legacy / ❌ hibrit); bu bir maruziyet farkıdır, politika değil.");
  lines.push("");
  lines.push("## Okuma kılavuzu");
  lines.push("- İsabet '—' = senaryonun ilgili cümlesi yok (geri çekilme sınıfı); orada beklenen, hibrit bloğun legacy ile AYNI olmasıdır.");
  lines.push("- Karakter farkı, istem maliyetinin vekilidir (token sayısı ölçülmedi; tahmin YAZILMADI).");
  lines.push("- Gürültü = blokta yer alan ilgisiz kalem başlığı sayısı.");
  return lines.join("\n");
}

afterAll(() => {
  if (process.env.KB_RETRIEVAL_REPORT !== "1") return;
  const dir = path.resolve(__dirname, "../../docs/olcum");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `kb-retrieval-baseline-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, `${report()}\n`, "utf8");
  console.log(`[kb-retrieval-baseline] rapor yazıldı: ${file}`);
});
