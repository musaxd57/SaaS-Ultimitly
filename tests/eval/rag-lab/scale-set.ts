import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { seededRandom } from "../../helpers/kb-retrieval-synthetic";
import type { LabItem, LabQuery } from "./core";

// ---------------------------------------------------------------------------
// GERÇEKÇİ ÖLÇEK SETİ YÜKLEYİCİSİ (#189). `evals/rag-scale/{dev,holdout}.json` (üretici `rag-dataset-gen.eval.test.ts`):
// ayrı olgulu ~300 kalem + olgu başına iki misafir sorusu. Yükleyici üstüne DETERMİNİSTİK zor durumlar kurar:
//  · version  — eski sürüm (`supersededById` yeni kalem) rakamı değiştirilmiş iğneyle: yeni iğne blokta, eski iğne YOK olmalı;
//  · conflict — giriş/çıkış saatine çelişen ikinci kalem: iki saat de blokta YA DA çelişki notu;
//  · draft    — onaylanmamış (`draft`) kalem: iğnesi bloğa HİÇ girmemeli (sızıntı);
//  · multi    — iki olgu tek mesajda (farklı bağlaçlar, TR/EN) ya da art arda iki cevapsız mesaj (geçmiş);
//  · neg      — bilgi tabanında OLMAYAN konular (üretici bu konuları yasakladı).
// `updatedAt` = taban − yaş (0–400 gün): 300 kalemde okuma tavanı (200) en eski kalemleri dışarıda bırakır — ölçülen şey bu.
// Holdout yalnız `EVAL_RAG_HOLDOUT=1` iken okunur; raporda yalnız toplamlar (metin yok).
// ---------------------------------------------------------------------------

export interface ScaleSetFile {
  version: 1;
  split: "dev" | "holdout";
  property: string;
  items: { id: string; category: string; title: string; content: string; lang: "tr" | "en"; ageDays: number }[];
  facts: { id: string; itemId: string; needle: string; questions: { lang: string; text: string }[] }[];
}

export const SCALE_BASE = Date.UTC(2026, 8, 20, 10);
const DAY = 86_400_000;

export function loadScaleFile(split: "dev" | "holdout"): ScaleSetFile | null {
  const f = path.resolve(__dirname, `../../../evals/rag-scale/${split}.json`);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8")) as ScaleSetFile;
}

const NEG_TOPICS: { tr: string; en: string }[] = [
  { tr: "Dairede sauna var mı, akşam kullanabilir miyiz?", en: "Is there a sauna we could use in the evening?" },
  { tr: "Jakuziyi nasıl çalıştırıyoruz?", en: "How do we turn on the jacuzzi?" },
  { tr: "Evde piyano var mı, kızım pratik yapmak istiyor", en: "Is there a piano in the flat? My daughter needs to practise" },
  { tr: "Tekne turu ayarlayabilir misiniz?", en: "Can you arrange a boat trip for us?" },
  { tr: "Yakında yoga dersi veren bir yer biliyor musunuz, siz ayarlar mısınız?", en: "Do you organise yoga classes for guests?" },
  { tr: "Tenis kortunu nasıl rezerve ederiz?", en: "How do we book the tennis court?" },
  { tr: "Çatı terasına çıkabilir miyiz?", en: "Can we go up to the rooftop terrace?" },
  { tr: "Bir akşam için bebek bakıcısı bulabilir misiniz?", en: "Could you find us a babysitter for one evening?" },
  { tr: "Oyun konsolu var mı, çocuklar sıkıldı", en: "Is there a game console? The kids are bored" },
  { tr: "Şömineyi yakabilir miyiz?", en: "Can we light the fireplace?" },
  { tr: "Bahçede mangal yapabilir miyiz?", en: "Can we have a barbecue outside?" },
  { tr: "Elektrikli aracımızı şarj edebileceğimiz bir yer var mı?", en: "Is there an EV charger for our car?" },
  { tr: "Biniş kartımı yazdırmam lazım, yazıcı var mı?", en: "I need to print my boarding pass, is there a printer?" },
  { tr: "Dikiş seti var mı, düğmem koptu", en: "Do you have a sewing kit? I lost a button" },
  { tr: "Bisiklet kiralayabilir miyiz sizden?", en: "Can we rent bicycles from you?" },
  { tr: "Spor salonuna nasıl girilir?", en: "How do we get into the gym?" },
  { tr: "Spa rezervasyonu yapabilir misiniz?", en: "Can you book us a spa treatment?" },
  { tr: "Golf sahası yakın mı, sopa kiralanıyor mu?", en: "Is there a golf course nearby where we can rent clubs?" },
];

const CONNECTORS_TR = [" Ayrıca ", "\n", " Bir de ", " ", " Bu arada "];
const CONNECTORS_EN = [" Also, ", "\n", " And ", " Another thing: "];

export interface ScaleLab {
  items: LabItem[];
  queries: LabQuery[];
}

function alterDigits(s: string): string {
  return s.replace(/\d/g, (d) => String((Number(d) + 1) % 10));
}

/** Tam set (300'e yakın kalem) + zor durumlar; `size` verilirse kalemlerin tohumlu ilk `size`'ı ve onlara ait sorular. */
export function buildScaleLab(file: ScaleSetFile, size?: number): ScaleLab {
  const rnd = seededRandom(file.split === "dev" ? 101 : 202);
  const order = file.items.map((it) => ({ it, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.it);
  const chosen = size ? order.slice(0, size) : order;
  const chosenIds = new Set(chosen.map((i) => i.id));
  const items: LabItem[] = chosen.map((it) => ({
    id: it.id,
    category: it.category,
    title: it.title,
    content: it.content,
    updatedAt: new Date(SCALE_BASE - it.ageDays * DAY),
    supersededById: null,
    reviewState: "legacy",
  }));
  const facts = file.facts.filter((f) => chosenIds.has(f.itemId));
  const factItem = new Map(items.map((i) => [i.id, i] as const));
  const queries: LabQuery[] = [];
  const special = new Set<string>();

  // draft: her 60. olgunun kalemi onaysız — iğnesi bloğa GİRMEMELİ.
  const drafts = facts.filter((_, i) => i % 60 === 7).slice(0, 5);
  for (const f of drafts) {
    const it = factItem.get(f.itemId)!;
    if (special.has(it.id)) continue;
    it.reviewState = "draft";
    special.add(it.id);
    f.questions.forEach((q, qi) =>
      queries.push({ id: `${f.id}_draft_${qi}`, group: "draft", cls: `draft_${q.lang}`, lang: q.lang, text: q.text, answers: [], forbiddenNeedles: [f.needle] }),
    );
  }
  // version: rakam taşıyan 6 olgunun eski sürümü (rakamlar değişik) — yeni iğne gelmeli, eski gelmemeli.
  const versionFacts = facts.filter((f) => /\d/.test(f.needle) && !special.has(f.itemId)).filter((_, i) => i % 9 === 3).slice(0, 6);
  for (const f of versionFacts) {
    const it = factItem.get(f.itemId)!;
    special.add(it.id);
    const oldNeedle = alterDigits(f.needle);
    items.push({
      ...it,
      id: `${it.id}_old`,
      content: it.content.replace(f.needle, oldNeedle),
      updatedAt: new Date(it.updatedAt.getTime() - 30 * DAY),
      supersededById: it.id,
    });
    f.questions.forEach((q, qi) =>
      queries.push({
        id: `${f.id}_ver_${qi}`,
        group: "version",
        cls: `version_${q.lang}`,
        lang: q.lang,
        text: q.text,
        answers: [{ needles: [f.needle], goldIds: [it.id] }],
        forbiddenNeedles: [oldNeedle],
      }),
    );
  }
  // conflict: saat taşıyan giriş/çıkış olgusu için çelişen ikinci kalem (farklı saat, sürüm DEĞİL).
  const conflictFacts = facts
    .filter((f) => /\b\d{1,2}[:.]\d{2}\b/.test(f.needle) && !special.has(f.itemId) && ["checkin", "checkout"].includes(factItem.get(f.itemId)!.category))
    .slice(0, 4);
  for (const f of conflictFacts) {
    const it = factItem.get(f.itemId)!;
    special.add(it.id);
    const other = f.needle.replace(/\b(\d{1,2})([:.])(\d{2})\b/, (_m, h: string, sep: string, mm: string) => `${String((Number(h) + 1) % 24).padStart(h.length, "0")}${sep}${mm}`);
    items.push({ ...it, id: `${it.id}_conf`, title: `${it.title} (not)`, content: other, updatedAt: new Date(it.updatedAt.getTime() - 60 * DAY), supersededById: null });
    f.questions.forEach((q, qi) =>
      queries.push({
        id: `${f.id}_conf_${qi}`,
        group: "conflict",
        cls: `conflict_${q.lang}`,
        lang: q.lang,
        text: q.text,
        answers: [{ needles: [f.needle], goldIds: [it.id] }, { needles: [other], goldIds: [`${it.id}_conf`] }],
        conflictOk: true,
      }),
    );
  }
  // single: kalan her olgunun her sorusu.
  for (const f of facts) {
    if (special.has(f.itemId)) continue;
    f.questions.forEach((q, qi) =>
      queries.push({ id: `${f.id}_q${qi}`, group: q.lang === "tr" ? "single_tr" : "single_xx", cls: q.lang, lang: q.lang, text: q.text, answers: [{ needles: [f.needle], goldIds: [f.itemId] }] }),
    );
  }
  // multi: iki farklı kalemin olgusu tek mesajda ya da iki cevapsız mesajda.
  const pool = facts.filter((f) => !special.has(f.itemId));
  const nMulti = Math.min(120, Math.floor(pool.length / 2));
  for (let i = 0; i < nMulti; i++) {
    const a = pool[(i * 7) % pool.length];
    let b = pool[(i * 13 + 5) % pool.length];
    for (let k = 1; b.itemId === a.itemId && k < pool.length; k++) b = pool[(i * 13 + 5 + k) % pool.length];
    const en = i % 10 >= 7;
    const qa = a.questions.find((q) => q.lang === (en ? "en" : "tr")) ?? a.questions[0];
    const qb = b.questions.find((q) => q.lang === (en ? "en" : "tr")) ?? b.questions[0];
    const answers = [
      { needles: [a.needle], goldIds: [a.itemId] },
      { needles: [b.needle], goldIds: [b.itemId] },
    ];
    if (i % 5 === 4) {
      queries.push({ id: `multi_hist_${i}`, group: "multi", cls: en ? "multi_hist_en" : "multi_hist_tr", lang: en ? "en" : "tr", text: qb.text, history: [{ direction: "inbound", body: qa.text }], answers });
    } else {
      const con = en ? CONNECTORS_EN[i % CONNECTORS_EN.length] : CONNECTORS_TR[i % CONNECTORS_TR.length];
      queries.push({ id: `multi_${i}`, group: "multi", cls: en ? "multi_en" : "multi_tr", lang: en ? "en" : "tr", text: `${qa.text}${con}${qb.text}`, answers });
    }
  }
  NEG_TOPICS.forEach((n, i) => {
    queries.push({ id: `neg_${i}_tr`, group: "neg", cls: "neg_tr", lang: "tr", text: n.tr, answers: [] });
    queries.push({ id: `neg_${i}_en`, group: "neg", cls: "neg_en", lang: "en", text: n.en, answers: [] });
  });
  return { items, queries };
}
