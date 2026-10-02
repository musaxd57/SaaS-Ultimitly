import type { DecisionKind, DecisionLang } from "./core";

// HOST KARAR MOTORU — kart verisinin tipi (sunucu kurar `card.ts`, istemci çizer `decision-panel.tsx`). Kart yalnız sahip /
// yöneticinin konuşma sayfasında görünür (konuşmanın tamamını zaten görürler); misafir metninden yalnız talebin KISA alıntısı
// taşınır — e-postaya ve panoya misafir metni girmez.

export interface DecisionLine {
  ok: boolean;
  text: string;
  info?: boolean;
}

export interface DecisionCardData {
  id: string;
  kind: DecisionKind;
  /** "13:00 erken giriş" / "Geç çıkış — saat belirtilmedi". */
  title: string;
  /** Görünen durum etiketi ("Karar bekliyor", "Yanıtladınız", "Gönderim doğrulanamadı"). */
  statusLabel: string;
  /** Kart ev sahibinin işi mi (karar bekliyor) — değilse sönük gösterilir ama eylemler yine açıktır. */
  open: boolean;
  /** Gönderimi doğrulanamadı: mesaj ulaşmış olabilir — yalnız "kontrol ettim" kapatması. */
  unverified: boolean;
  version: number;
  requestedTime: string | null;
  dayKey: string | null;
  /** "14 Ekim (varış günü)". */
  dayLabel: string | null;
  /** Talebin yazıldığı an (ev sahibinin saatinde). */
  askedAt: string;
  /** Talebin mesajından kısa alıntı (tek satır, kırpılmış) — ev sahibi kararı konuşmayı kaydırmadan görsün. */
  requestQuote: string | null;
  /** Mülkün standart giriş (erken giriş) / çıkış (geç çıkış) saati. */
  standardTime: string | null;
  lang: DecisionLang;
  fee: { amount: number; currency: string } | null;
  note: string | null;
  /** Kontrol listesi satırları (erken giriş kanıt modeli / komşu konaklama). */
  lines: DecisionLine[];
  /** Talepten sonra misafirin yazdığı son mesaj (varsa) — gönderimde "okudum" onayı için. */
  laterGuestMessageId: string | null;
}

/** Sonuçlanmış karar (onaylandı / reddedildi / otomatik onaylandı / kapatıldı) — panelde tek satırlık kayıt. */
export interface ResolvedDecisionRow {
  id: string;
  /** "13:00 erken giriş". */
  title: string;
  /** "Onaylandı · 14:00" / "Reddedildi" / "Kapatıldı". */
  outcome: string;
  tone: "success" | "muted";
  /** Kararın verildiği an (ev sahibinin saatinde). */
  at: string;
}
