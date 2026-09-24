// ---------------------------------------------------------------------------
// GERÇEK MESAJ SETİ — ETİKETLEME + SET ÜRETİMİ (saf; 09-24). Etiketi KURUCU verir, kendi makinesinde; araç ona
// hiçbir model/kelime ağı tahmini GÖSTERMEZ (kör etiket). Geliştirici (ve ajanlar) içeriği hiç görmez: depoya
// yalnız mühür (SHA-256 + sayılar) ve final koşusunun toplam sayıları girer.
//
// Etiket kümesi eval şemasıyla AYNI (`evals/stay-change.json`): none · extend · early · late · date_change ·
// availability. Ek iki çıkış: `pii` (anonimleştirmeden kişisel bilgi kaldı → sete GİRMEZ) ve `unsure` (mesaj tek
// başına anlaşılmıyor → sete GİRMEZ). Çıkarılanlar yalnız sayı olarak raporlanır.
// ---------------------------------------------------------------------------

import path from "node:path";

export const REAL_KINDS = ["none", "extend", "early", "late", "date_change", "availability"] as const;
export type RealKind = (typeof REAL_KINDS)[number];
export type RealLabel = RealKind | "pii" | "unsure";

/** Tuş → etiket (satır tabanlı giriş; Windows terminalinde de çalışır). */
export const LABEL_KEYS: Readonly<Record<string, RealLabel>> = {
  "0": "none",
  "1": "extend",
  "2": "early",
  "3": "late",
  "4": "date_change",
  "5": "availability",
  x: "pii",
  s: "unsure",
};

/** Kurucuya etiketlemeden önce gösterilen kısa kural (müşteriye gitmez; operatör aracı). */
export const LABEL_RUBRIC = [
  "Soru: misafir bu mesajda konaklamasında bir DEĞİŞİKLİK ya da müsaitliğe bağlı bir İZİN istiyor mu?",
  "0  İstek yok — bilgi sorusu da buraya ('Giriş saat kaçta?', 'Erken giriş ücretli mi?'), teşekkür, şikâyet, yol tarifi.",
  "1  Ek gece / uzatma ('Bir gece daha kalabilir miyiz?').",
  "2  Erken giriş ya da erken erişim: standart saatten önce gelmek, erken gelip bavul bırakmak, 'oda erken hazır olur mu',",
  "   '11 gibi orada oluruz sorun yok değil mi' (giriş 15:00 iken).",
  "3  Geç çıkış ya da çıkıştan sonra dairede kalmak / eşya bırakmak.",
  "4  Tarih değişikliği (rezervasyonun günlerini kaydırmak).",
  "5  Müsaitlik sorusu (başka bir tarih boş mu, tekrar gelmek için yer var mı).",
  "x  Metinde kişisel bilgi KALMIŞ (ad, telefon, adres…) → sete girmez.",
  "s  Emin değilim / mesaj tek başına anlaşılmıyor → sete girmez.",
  "Birden çok şey isteniyorsa konaklamayla ilgili olanı seçin. Önceki mesajlara bakmadan, yalnız bu mesaja göre.",
] as const;

export interface CandidateItem {
  id: string; // "r-0001" — veritabanı kimliği DEĞİL (geri bağlanamaz)
  stratum: "candidate" | "rest";
  text: string;
  lang: string;
  checkIn: string;
  checkOut: string;
}

export interface CandidateFile {
  kind: "lixus-real-candidates";
  version: 1;
  seed: string;
  population: { candidate: number; rest: number };
  items: CandidateItem[];
}

export interface LabelState {
  labels: Record<string, RealLabel>;
  index: number;
}

export type LabelAction = { type: "key"; key: string } | { type: "back" };

/** Saf durum geçişi: bilinen tuş etiketler ve ilerler; bilinmeyen tuş durumu DEĞİŞTİRMEZ; "geri" bir adım döner. */
export function applyLabelAction(state: LabelState, items: readonly CandidateItem[], action: LabelAction): LabelState {
  if (action.type === "back") return { ...state, index: Math.max(0, state.index - 1) };
  const label = LABEL_KEYS[action.key.trim().toLowerCase()];
  const item = items[state.index];
  if (!label || !item) return state;
  return { labels: { ...state.labels, [item.id]: label }, index: Math.min(items.length, state.index + 1) };
}

/** Kaldığı yerden devam: ilk etiketsiz öğe. */
export function resumeIndex(items: readonly CandidateItem[], labels: Record<string, RealLabel>): number {
  const i = items.findIndex((it) => labels[it.id] === undefined);
  return i === -1 ? items.length : i;
}

export interface RealDataset {
  version: 1;
  source: "real-anonymized";
  requests: { id: string; split: "real"; text: string; lang: string; kind: RealKind; checkIn: string; checkOut: string }[];
  replies: never[];
  excluded: { pii: number; unsure: number; unlabeled: number };
  strata: Record<"candidate" | "rest", { population: number; labeled: number }>;
}

/** Eval şemasında set: yalnız geçerli etiketli öğeler; çıkarılanlar yalnız SAYI. */
export function buildRealDataset(file: CandidateFile, labels: Record<string, RealLabel>): RealDataset {
  const requests: RealDataset["requests"] = [];
  const excluded = { pii: 0, unsure: 0, unlabeled: 0 };
  const labeled = { candidate: 0, rest: 0 };
  for (const it of file.items) {
    const l = labels[it.id];
    if (l === undefined) excluded.unlabeled++;
    else if (l === "pii") excluded.pii++;
    else if (l === "unsure") excluded.unsure++;
    else {
      requests.push({ id: it.id, split: "real", text: it.text, lang: it.lang, kind: l, checkIn: it.checkIn, checkOut: it.checkOut });
      labeled[it.stratum]++;
    }
  }
  return {
    version: 1,
    source: "real-anonymized",
    requests,
    replies: [],
    excluded,
    strata: {
      candidate: { population: file.population.candidate, labeled: labeled.candidate },
      rest: { population: file.population.rest, labeled: labeled.rest },
    },
  };
}

/**
 * Çıktı yolu kapısı: depo İÇİNDEKİ bir yol yalnız git'in YOK SAYDIĞI `evals/private/` altına yazılabilir (gerçek
 * misafir metni asla commit'lenmesin). Depo dışı yol serbest (git onu göremez).
 */
export function outputPathDecision(input: { relToRepo: string; insideRepo: boolean; gitIgnored: boolean }): { ok: true } | { ok: false; reason: string } {
  if (!input.insideRepo) return { ok: true };
  const rel = input.relToRepo.replace(/\\/g, "/");
  if (!rel.startsWith("evals/private/")) return { ok: false, reason: "depo içinde yalnız evals/private/ altına yazılır" };
  if (!input.gitIgnored) return { ok: false, reason: "evals/private/ git tarafından yok sayılmıyor (.gitignore) — gerçek metin commit'lenebilirdi" };
  return { ok: true };
}

/**
 * Yolu çözer ve kapıdan geçirir; reddedilirse FIRLATIR (hiçbir şey yazılmadan). `isGitIgnored` depoya göreli yol
 * alır (betikler `git check-ignore` ile verir; testler sahte verir).
 */
export function guardedOutputPath(repo: string, target: string, isGitIgnored: (relToRepo: string) => boolean): string {
  const abs = path.resolve(repo, target);
  const rel = path.relative(repo, abs);
  const insideRepo = !rel.startsWith("..") && !path.isAbsolute(rel);
  const d = outputPathDecision({ relToRepo: rel, insideRepo, gitIgnored: insideRepo && isGitIgnored(rel) });
  if (!d.ok) throw new Error(`çıktı yolu reddedildi: ${d.reason}`);
  return abs;
}

/** Salt-okuma doğrulaması: `SHOW transaction_read_only` sonucu tam olarak "on" değilse HİÇBİR sorgu koşmaz. */
export function readOnlyVerified(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0] as Record<string, unknown> | null;
  return row !== null && typeof row === "object" && row.transaction_read_only === "on";
}
