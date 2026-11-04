// ---------------------------------------------------------------------------
// KONUŞMA KONTROLÜ — TEK KARAR NOKTASI (tasarım `docs/TASARIM-2026-11-04-konusma-kontrolu.md` §2, kurucu K-1..K-6 onayı 11-04).
//
// Bugün tek alan (`Conversation.status`) dört şeyi taşıyor: gelen kutusu etiketi, AI anahtarı, tehlike kaydı, iş takibi → host'un tek cevabı
// ("İlgileniyorum") tehlike çözülmeden AI'ı yeniden açıyor. Yeni model üç bağımsız gerçek: açık ihtiyaçlar (öğe defteri) · kontrol
// (`auto` / `host`, yalnız owner/manager açık işlemi değiştirir) · engeller (tür + kapsam; kapanış türüne göre). Bu dosya SAF karar
// fonksiyonudur: veritabanı / ağ / saat okumaz; girdiyi çağıran toplar.
//
// G0 (gölge): karar UYGULANMAZ — bugünkü kararla kıyaslanır, uyuşmazlık yalnız sayılır (`shadowMismatch`). Metin / kimlik taşımaz.
// ---------------------------------------------------------------------------

export const BLOCK_KINDS = ["safety_incident", "hazard_unverified", "host_takeover", "technical", "legacy_problem"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface ActiveBlock {
  kind: BlockKind;
  /** `conversation`: bütün konuşma · `item`: yalnız o ihtiyaç (`itemId`). */
  scope: "conversation" | "item";
  itemId: string | null;
}

export interface AutoSendFacts {
  /** Kontrol: `host` = host devraldı (AI susar, yalnız "AI'ye geri ver" açar). G0'da her zaman `auto` (alan G2'de). */
  controlMode: "auto" | "host";
  /** AKTİF engeller (kapanmışlar çağıranda süzülür). */
  blocks: readonly ActiveBlock[];
  /** Taslağın cevapladığı öğeler (öğe kipi kapalıyken boş). */
  draftItemIds: readonly string[];
  /** Taslağın dayandığı son misafir mesajından SONRA yeni misafir mesajı geldi mi. */
  newerGuestMessage: boolean;
  /** Host'un kuyrukta bekleyen (henüz gitmemiş) mesajı var mı — sıra host'undur. */
  hostQueued: boolean;
  /**
   * Ortak kontrollerin ilk tutan sebebi (org / genel anahtar, abonelik, saat penceresi, iptal edilmiş / bitmiş konaklama — tasarım 10.4 a);
   * yoksa `null`. Kapalı küme KOD (metin değil).
   */
  commonVeto: string | null;
}

export type AutoSendReason =
  | "host_control"
  | "conversation_block"
  | "item_block"
  | "newer_guest_message"
  | "host_queued"
  | "common_veto";

export interface AutoSendDecision {
  allowed: boolean;
  /** Bütün tutan sebepler (sırası sabit — kıyas ve sayım kararlı olsun). */
  reasons: AutoSendReason[];
  /** Tutan engel türleri (sayım için; sıralı, tekil). */
  blockKinds: BlockKind[];
}

/**
 * Yeni modelin kararı. İzin şartları (tasarım §2): kontrol `auto` · konuşma kapsamlı aktif engel yok · taslağın öğesinde öğe kapsamlı engel
 * yok · taslaktan sonra yeni misafir mesajı yok · host'un kuyrukta mesajı yok · ortak kontroller temiz. Öğe kapsamlı engel YALNIZ o öğeyi
 * tutar: taslak başka öğeyi cevaplıyorsa geçer (bağımsız güvenli soru cevaplanır — kurucu kuralı).
 */
export function autoSendDecision(f: AutoSendFacts): AutoSendDecision {
  const reasons: AutoSendReason[] = [];
  const kinds = new Set<BlockKind>();
  if (f.controlMode === "host") reasons.push("host_control");
  const draftItems = new Set(f.draftItemIds);
  let conversationBlocked = false;
  let itemBlocked = false;
  for (const b of f.blocks) {
    if (b.scope === "conversation") {
      conversationBlocked = true;
      kinds.add(b.kind);
    } else if (b.itemId !== null && draftItems.has(b.itemId)) {
      itemBlocked = true;
      kinds.add(b.kind);
    }
  }
  if (conversationBlocked) reasons.push("conversation_block");
  if (itemBlocked) reasons.push("item_block");
  if (f.newerGuestMessage) reasons.push("newer_guest_message");
  if (f.hostQueued) reasons.push("host_queued");
  if (f.commonVeto !== null) reasons.push("common_veto");
  return { allowed: reasons.length === 0, reasons, blockKinds: BLOCK_KINDS.filter((k) => kinds.has(k)) };
}

export type ShadowDirection = "new_blocks_old_sends" | "new_sends_old_blocks";

/**
 * G0 gölge kıyası: bugünkü karar (`oldAllowed`) ile yeni model ayrıştıysa YÖN + yeni modelin sebepleri (sayım anahtarı); aynıysa `null`.
 * Örnek: açık tehlikede host "İlgileniyorum" yazdı → bugün `answered`, AI gönderir; yeni model `safety_incident` ile tutar →
 * `new_blocks_old_sends` · [conversation_block] · [safety_incident].
 */
export function shadowMismatch(
  oldAllowed: boolean,
  next: AutoSendDecision,
): { direction: ShadowDirection; reasons: AutoSendReason[]; blockKinds: BlockKind[] } | null {
  if (oldAllowed === next.allowed) return null;
  return { direction: oldAllowed ? "new_blocks_old_sends" : "new_sends_old_blocks", reasons: next.reasons, blockKinds: next.blockKinds };
}
