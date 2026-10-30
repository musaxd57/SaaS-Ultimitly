/* ---------------------------------------------------------------------------
 * K-1029-A TEKRAR OYNATMA — "EV SAHİBİNİZE YAZIN" SÜZGECİ, ÜCRETSİZ ÖLÇÜM (tasarım S13, 10-30).
 *
 *   npx tsx --tsconfig tsconfig.json tests/eval/host-contact-replay.ts [--old <eski süzgeç klasörü>] [--label <eski sürüm adı>]
 *
 * Model ÇAĞRILMAZ, veritabanı yok: `docs/olcum/*.json` yan dosyalarındaki GERÇEK model cevapları (geçmiş ölçümlerin çıktısı) yeni
 * süzgeçten geçirilir. Sayılanlar: kaç cevapta yönlendirme cümlesi var, kaç parça silindi (tür / biçim / genel mi), kaç cevabın TAMAMI
 * tutulur (geriye içerik kalmadı), kaç cevapta kalan doğru cevap gider, defter OLMAYAN yolda (QR, öğe kipi kapalı kanal) kaç tur ev
 * sahibine açık kalır (anlama katmanı koşmamış sayılır — ÜST SINIR). `--old` verilirse aynı cevaplar eski süzgeçten de geçer: tutuş
 * kazanılan / kaybedilen, metni değişen. TUTUŞ kıyası yalnız süzgeç değil, kapının metne bakan iki kuralıyla birlikte yapılır ("bilgim yok"
 * itirafı + çıktı vetosu — devir / "ev sahibinizin kararı" cümlesi): eski süzgecin göndereceği bir cevabı bu kurallar zaten tutuyorduysa
 * davranış DEĞİŞMEDİ sayılır.
 * Yan dosyalar ölçüm setlerinin (kurgusal "Lale" fikstürü) çıktısıdır; örnekler kısaltılarak yazılır.
 * ------------------------------------------------------------------------- */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stripHostContactFiller } from "../../src/lib/ai/host-contact-filler";
import { admitsMissingKnowledge, asksHypotheticalSituation } from "../../src/lib/ai/absence";
import { vetoOutgoingReply } from "../../src/lib/ai/output-veto";
import { hostContactOpenWithoutLedger } from "../../src/lib/conversation-items/host-contact-settle";
import { evalRuntime, evalRuntimeMarkdown } from "./run-meta";

const REPO = path.resolve(__dirname, "..", "..");
const OLCUM = path.join(REPO, "docs", "olcum");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

type Sample = { reply: string; guest: string | null; lang: string | null; file: string };

const GUEST_FIELDS = ["guest", "guestMessage", "asked", "message", "question"] as const;

function collect(): Sample[] {
  const seen = new Set<string>();
  const out: Sample[] = [];
  for (const f of readdirSync(OLCUM).filter((n) => n.endsWith(".json")).sort()) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path.join(OLCUM, f), "utf8"));
    } catch {
      continue;
    }
    const walk = (o: unknown, depth: number): void => {
      if (depth > 6 || o === null || typeof o !== "object") return;
      if (Array.isArray(o)) {
        for (const v of o) walk(v, depth + 1);
        return;
      }
      const rec = o as Record<string, unknown>;
      if (typeof rec.reply === "string" && rec.reply.trim() && !seen.has(rec.reply)) {
        seen.add(rec.reply);
        const g = GUEST_FIELDS.map((k) => rec[k]).find((v): v is string => typeof v === "string" && v.trim().length > 0) ?? null;
        out.push({ reply: rec.reply, guest: g, lang: typeof rec.lang === "string" ? rec.lang : null, file: f });
      }
      for (const v of Object.values(rec)) walk(v, depth + 1);
    };
    walk(data, 0);
  }
  return out;
}

type OldFiller = (reply: string, guestTexts?: readonly string[], kbTexts?: readonly string[]) => { text: string; hostContactOnly: boolean };
type OldAbsence = (reply: string) => boolean;
/** Kapının metne bakan iki kuralı: "bilgim yok" itirafı ya da çıktı vetosu (devir / bildirim cümlesi, söz, yer tutucu…). */
const gateHolds = (text: string, admits: OldAbsence) => admits(text) || vetoOutgoingReply(text) !== null;

async function main(): Promise<void> {
  const oldDir = arg("--old");
  const oldLabel = arg("--label") ?? (oldDir ? path.basename(oldDir) : null);
  let oldFiller: OldFiller | null = null;
  let oldAdmits: OldAbsence | null = null;
  if (oldDir) {
    const mod = (await import(path.resolve(oldDir, "host-contact-filler.ts"))) as { stripHostContactFiller: OldFiller };
    oldFiller = mod.stripHostContactFiller;
    const abs = (await import(path.resolve(oldDir, "absence.ts"))) as { admitsMissingKnowledge: OldAbsence };
    oldAdmits = abs.admitsMissingKnowledge;
  }

  const samples = collect();
  const c = {
    replies: samples.length,
    withRemoval: 0,
    removals: 0,
    byKind: { write: 0, call: 0, referral: 0 } as Record<string, number>,
    byForm: { conditional: 0, referral: 0 } as Record<string, number>,
    generic: 0,
    topical: 0,
    appendix: 0,
    heldWhole: 0,
    partialSent: 0,
    openWithoutLedger: 0,
    guestContingency: 0,
    byLang: {} as Record<string, { replies: number; withRemoval: number }>,
  };
  const old = { changed: 0, held: 0, heldGained: 0, heldLost: 0, textDiffers: 0, systemHeldGained: 0, systemHeldLost: 0, sentTextDiffers: 0 };
  const gainedExamples: { file: string; before: string }[] = [];
  const liftedExamples: { file: string; before: string; sent: string; open: boolean }[] = [];
  const examples: { file: string; before: string; after: string; held: boolean }[] = [];
  const lostExamples: { file: string; before: string; oldAfter: string; newAfter: string }[] = [];

  for (const s of samples) {
    const guestTexts = s.guest ? [s.guest] : [];
    const r = stripHostContactFiller(s.reply, guestTexts);
    const lang = s.lang ?? "?";
    c.byLang[lang] ??= { replies: 0, withRemoval: 0 };
    c.byLang[lang].replies++;
    if (r.removals.length > 0) {
      c.withRemoval++;
      c.byLang[lang].withRemoval++;
      c.removals += r.removals.length;
      for (const x of r.removals) {
        c.byKind[x.kind] = (c.byKind[x.kind] ?? 0) + 1;
        c.byForm[x.form] = (c.byForm[x.form] ?? 0) + 1;
        if (x.generic) c.generic++;
        else c.topical++;
        if (x.appendix) c.appendix++;
      }
      if (r.hostContactOnly) c.heldWhole++;
      else c.partialSent++;
      const contingency = guestTexts.some((t) => asksHypotheticalSituation(t));
      if (contingency) c.guestContingency++;
      if (!r.hostContactOnly && hostContactOpenWithoutLedger({ removals: r.removals, keptText: r.text, guestAskedContingency: contingency, needs: null })) {
        c.openWithoutLedger++;
      }
      if (examples.length < 15) examples.push({ file: s.file, before: s.reply, after: r.hostContactOnly ? "(tamamı tutulur)" : r.text, held: r.hostContactOnly });
    }
    if (oldFiller) {
      const o = oldFiller(s.reply, guestTexts, []);
      if (o.text !== s.reply) old.changed++;
      if (o.hostContactOnly) old.held++;
      if (r.hostContactOnly && !o.hostContactOnly) old.heldGained++;
      if (!r.hostContactOnly && o.hostContactOnly) {
        old.heldLost++;
        if (lostExamples.length < 15) lostExamples.push({ file: s.file, before: s.reply, oldAfter: o.text, newAfter: r.text });
      }
      if (o.text !== r.text) old.textDiffers++;
      // Sistem düzeyi (süzgeç + kapının metin kuralları): eski ve yeni yol cevabı tutuyor mu, gönderiyorsa ne gönderiyor.
      const oldHeld = o.hostContactOnly || gateHolds(o.text, oldAdmits ?? admitsMissingKnowledge);
      const newHeld = r.hostContactOnly || gateHolds(r.text, admitsMissingKnowledge);
      if (newHeld && !oldHeld) {
        old.systemHeldGained++;
        if (gainedExamples.length < 15) gainedExamples.push({ file: s.file, before: s.reply });
      }
      if (!newHeld && oldHeld) {
        old.systemHeldLost++;
        // Defter olmayan yolda bu tur yine ev sahibine açık kalır mı (kanal öğe kipi kapalı → tutulur; QR → kalan gider + devir).
        const open = hostContactOpenWithoutLedger({
          removals: r.removals,
          keptText: r.text,
          guestAskedContingency: guestTexts.some((t) => asksHypotheticalSituation(t)),
          needs: null,
        });
        if (liftedExamples.length < 25) liftedExamples.push({ file: s.file, before: s.reply, sent: r.text, open });
      }
      if (!newHeld && !oldHeld && o.text !== r.text) old.sentTextDiffers++;
    }
  }

  const cut = (t: string) => (t.length > 220 ? `${t.slice(0, 217)}…` : t).replace(/\s+/g, " ");
  const pct = (n: number, d: number) => (d === 0 ? "—" : `%${((100 * n) / d).toFixed(1)}`);
  const lines: string[] = [];
  lines.push("# K-1029-A tekrar oynatma — ev sahibine yönlendirme süzgeci (ücretsiz, model yok)", "");
  lines.push(
    `Kaynak: \`docs/olcum/*.json\` içindeki ${c.replies} benzersiz model cevabı (geçmiş ölçümlerin çıktısı, kurgusal fikstür). Model ÇAĞRILMADI.`,
    "",
  );
  lines.push("## Yeni süzgeç", "");
  lines.push("| Ölçü | Sayı |", "|---|---|");
  lines.push(`| Yönlendirme parçası silinen cevap | ${c.withRemoval} (${pct(c.withRemoval, c.replies)}) |`);
  lines.push(`| Silinen parça (toplam) | ${c.removals} |`);
  lines.push(`| — tür: yaz / ara / başvur | ${c.byKind.write ?? 0} / ${c.byKind.call ?? 0} / ${c.byKind.referral ?? 0} |`);
  lines.push(`| — biçim: koşullu / başvurma | ${c.byForm.conditional ?? 0} / ${c.byForm.referral ?? 0} |`);
  lines.push(`| — genel kapanış / konulu | ${c.generic} / ${c.topical} |`);
  lines.push(`| — yalnız yan cümle silindi (cümlenin başı kaldı) | ${c.appendix} |`);
  lines.push(`| Cevabın TAMAMI tutulur (geriye içerik kalmadı) | ${c.heldWhole} |`);
  lines.push(`| Kalan doğru cevap gider | ${c.partialSent} |`);
  lines.push(`| — defter olmayan yolda (QR / öğe kipi kapalı) ev sahibine açık kalır — ÜST SINIR (anlama koşmamış sayıldı) | ${c.openWithoutLedger} |`);
  lines.push(`| — misafir olasılık sordu (soru her zaman açık) | ${c.guestContingency} |`, "");
  lines.push("### Dile göre", "", "| Dil | Cevap | Silme olan |", "|---|---|---|");
  for (const [lang, v] of Object.entries(c.byLang).sort((a, b) => b[1].replies - a[1].replies)) lines.push(`| ${lang} | ${v.replies} | ${v.withRemoval} |`);
  lines.push("");
  if (oldFiller) {
    lines.push(`## Eski süzgeçle kıyas (${oldLabel})`, "");
    lines.push("| Ölçü | Sayı |", "|---|---|");
    lines.push(`| Eski süzgeç metni değiştirdi | ${old.changed} |`);
    lines.push(`| Eski süzgeç tamamını tuttu | ${old.held} |`);
    lines.push(`| Tutuş KAZANILDI (yeni tutar, eski göndermişti) | ${old.heldGained} |`);
    lines.push(`| Tutuş KAYBEDİLDİ (eski tutuyordu, yeni kalan doğru cevabı gönderir) | ${old.heldLost} |`);
    lines.push(`| Süzgeç çıktısı farklı | ${old.textDiffers} |`);
    lines.push(`| **SİSTEM: yeni tutuş** (süzgeç + "bilgim yok" + çıktı vetosu; eski yol gönderiyordu) | ${old.systemHeldGained} |`);
    lines.push(`| **SİSTEM: kalkan tutuş** (eski yol tutuyordu, yeni gönderir) | ${old.systemHeldLost} |`);
    lines.push(`| **SİSTEM: iki yol da gönderir ama metin farklı** (yönlendirme cümlesi çıktı) | ${old.sentTextDiffers} |`, "");
    if (liftedExamples.length > 0) {
      lines.push(
        "### Kalkan tutuş örnekleri (eski yol cevabın TAMAMINI tutuyordu; yeni yol yönlendirme / devir cümlesini silip kalanı gönderir)",
        "",
        "Öğe kipinde istek açık kalır (\"cevaplandı\" kuralı); defter olmayan yolda \"açık\" = kanal tutar, QR kalanı gönderip devreder.",
        "",
      );
      for (const e of liftedExamples) lines.push(`- \`${e.file}\`${e.open ? " (defter yoksa açık)" : ""}  `, `  önce: ${cut(e.before)}  `, `  gider: ${cut(e.sent)}`);
      lines.push("");
    }
    if (gainedExamples.length > 0) {
      lines.push("### Sistem düzeyinde yeni tutuş örnekleri (eski yol misafire gönderiyordu)", "");
      for (const e of gainedExamples) lines.push(`- \`${e.file}\`: ${cut(e.before)}`);
      lines.push("");
    }
    if (lostExamples.length > 0) {
      lines.push("### Tutuşu kaybedilen örnekler (eski tutuyordu → yeni kalan cevabı gönderir)", "");
      for (const e of lostExamples) lines.push(`- \`${e.file}\`  `, `  önce: ${cut(e.before)}  `, `  yeni gönderir: ${cut(e.newAfter)}`);
      lines.push("");
    }
  }
  lines.push("## Örnekler (yeni süzgeç)", "");
  for (const e of examples) lines.push(`- \`${e.file}\`  `, `  önce: ${cut(e.before)}  `, `  sonra: ${cut(e.after)}`);
  lines.push("", evalRuntimeMarkdown(evalRuntime()));

  const day = new Date().toISOString().slice(0, 10);
  const md = path.join(OLCUM, `host-contact-replay-${day}.md`);
  writeFileSync(md, lines.join("\n") + "\n");
  writeFileSync(path.join(OLCUM, `host-contact-replay-${day}.json`), JSON.stringify({ counts: c, old: oldFiller ? { label: oldLabel, ...old } : null }, null, 2) + "\n");
  console.log(`yazıldı: ${path.relative(REPO, md)} — ${c.replies} cevap, ${c.withRemoval} silme, ${c.heldWhole} tam tutuş${oldFiller ? `, kazanılan ${old.heldGained} / kaybedilen ${old.heldLost}` : ""}`);
}

void main();
