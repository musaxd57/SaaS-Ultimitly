// ---------------------------------------------------------------------------
// ÇIKIŞTAN ÖNCE AÇIK KONU — satır metni (saf; plan madde 7, kurucu örneği "Lale 3 yarın 11:00'de çıkıyor; sıcak su konusu açık.").
// Tasarım `docs/TASARIM-2026-11-25-cikistan-once-acik-konu.md`. Yalnız ev sahibinin panosu; misafire HİÇBİR şey gitmez.
//
// Konu adı YALNIZ kodun tuttuğu yapılı etiketten gelir (bırakılan isteğin türü, sözün konusu / türü); misafir metninden konu çıkarılmaz.
// "Sorunlu" durumunun konusu uydurulmaz ("konuşma Sorunlu olarak işaretli").
// ---------------------------------------------------------------------------

import type { ItemKind } from "@/lib/conversation-items/core";
import { itemKindLabel } from "@/lib/conversation-items/view";
import { COMMITMENT_KIND_LABELS, COMMITMENT_TOPIC_LABELS, isCommitmentTopic, type CommitmentKind } from "@/lib/guest-commitments-core";

/** Birleşik satırın açık konusu (kapalı küme kodlar; METİN değil). */
export type DepartureTopic =
  | { source: "held"; kind: ItemKind }
  | { source: "commitment"; kind: CommitmentKind; topic: string | null };

export interface DepartureOpen {
  /** Çıkış günü işletmenin takviminde bugün mü yarın mı. */
  day: "today" | "tomorrow";
  /** Çıkış saati "SS:DD" (işletmenin saatiyle); bilinmiyorsa null — saat yazılmaz. */
  time: string | null;
  /** Açık konular (tekil, ilk görülen sırayla). */
  topics: DepartureTopic[];
  /** Konuşma "Sorunlu" olarak işaretli. */
  problem: boolean;
  /** Misafirin cevapsız mesajı varsa kaç saattir bekliyor (aşağı yuvarlanmış). */
  hoursWaiting?: number;
}

/** Ekranda en çok bu kadar konu adı yazılır; fazlası "· N konu daha". */
export const DEPARTURE_TOPICS_SHOWN = 3;

/** "SS:DD" mi (dairenin çıkış saati alanı serbest metin olabilir; geçersizse saat yazılmaz). */
export function isClockText(v: string | null | undefined): v is string {
  return typeof v === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
}

// Sayının okunuşunun son sesli harfine göre bulunma eki (bir→de, üç→te, altı→da, kırk→ta …). Birler basamağı; birler 0 ise onlar.
const UNIT_SUFFIX = ["", "de", "de", "te", "te", "te", "da", "de", "de", "da"] as const;
const TENS_SUFFIX = ["", "da", "de", "da", "ta", "de"] as const;

/** Bir sayının (0–59) okunuşuna gelen bulunma eki. 0 → "sıfır" → "da". */
function numberLocative(n: number): string {
  if (n === 0) return "da";
  const unit = n % 10;
  return unit !== 0 ? UNIT_SUFFIX[unit] : TENS_SUFFIX[Math.floor(n / 10)];
}

/**
 * Saate bulunma eki: "11:00'de", "10:00'da", "09:30'da", "14:15'te". Dakika 00 ise saat okunur ("on bir"), değilse dakika ("otuz").
 * Geçersiz saat metnine ek takılmaz (null).
 */
export function clockLocative(time: string): string | null {
  if (!isClockText(time)) return null;
  const [h, m] = time.split(":").map(Number);
  return `${time}'${numberLocative(m === 0 ? h : m)}`;
}

function topicLabel(t: DepartureTopic): string {
  if (t.source === "held") return itemKindLabel(t.kind);
  return isCommitmentTopic(t.topic) ? COMMITMENT_TOPIC_LABELS[t.topic] : COMMITMENT_KIND_LABELS[t.kind].toLocaleLowerCase("tr-TR");
}

/** Başlık: "Lale 3 yarın 11:00'de çıkıyor" · saat yoksa "Lale 3 bugün çıkıyor". */
export function departureOpenHeadline(propertyName: string, d: Pick<DepartureOpen, "day" | "time">): string {
  const day = d.day === "today" ? "bugün" : "yarın";
  const at = d.time ? clockLocative(d.time) : null;
  return `${propertyName} ${day}${at ? ` ${at}` : ""} çıkıyor`;
}

/** Alt satır: "sıcak su konusu açık" · "sıcak su, ödeme / fatura konuları açık · misafir 3 saattir cevap bekliyor". */
export function departureOpenDetail(d: Pick<DepartureOpen, "topics" | "problem" | "hoursWaiting">): string {
  const parts: string[] = [];
  const labels = [...new Set(d.topics.map(topicLabel))];
  if (labels.length > 0) {
    const shown = labels.slice(0, DEPARTURE_TOPICS_SHOWN);
    const more = labels.length - shown.length;
    parts.push(`${shown.join(", ")} ${labels.length > 1 ? "konuları" : "konusu"} açık${more > 0 ? ` · ${more} konu daha` : ""}`);
  }
  if (d.problem) parts.push("konuşma Sorunlu olarak işaretli");
  if (d.hoursWaiting !== undefined) parts.push(`misafir ${d.hoursWaiting} saattir cevap bekliyor`);
  return parts.join(" · ");
}
