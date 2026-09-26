// ---------------------------------------------------------------------------
// EYLEM BEYANI — `claimedActions` (09-25, `docs/MESAJLASMA-CEKIRDEGI-V2-2026-09-25.md` §4; bayrak
// `AI_ACTION_CLAIMS_ENABLED`, tam "1", varsayılan KAPALI).
//
// Kurucu kuralı: makbuzsuz eylem iddiası misafire GİTMEZ ("ilettim / ayarladım / size döneceğim"). Bugün bunu yalnız
// kelime tabanlı çıktı vetosu (`output-veto.ts`) yakalıyor ve kelime listesi dili kapsayamaz (kör batarya: 7 dilde
// kaçanlar). Burada cevap modeli, misafire yazdığı metinde KENDİSİNİN ya da ekibin yaptığı / yapacağı eylemleri kapalı
// kümeden BEYAN eder. Bizde eylem yürütücüsü ve makbuzu YOK → boş olmayan beyan otomatik GİTMEZ (`action_claim`).
// Beyan istenip gelmediyse ya da bozuksa sonuç `unknown` → yine GİTMEZ (`action_claim_undeclared`): tanınmayan ≠ temiz.
//
// Birleşim: çıktı vetosu bunun deterministik YEDEĞİDİR; hiçbirinin "yok"u diğerinin "var"ını silemez. Kural yalnız
// SIKILAŞTIRIR. Beyan istenmediyse (bayrak kapalı, şablon ya da koddan kurulan metin) alan YOK → kural koşmaz.
//
// Bayrak kapalıyken: istem bayt bayt aynı (blok boş dize), ayrıştırıcı koşmaz, kapı bu alanı hiç görmez (pinli).
// Açmadan önce: cevap kıyası eval'inde `unknown` oranı + yanlış etiket ölçülür, sonra kurucu onayı (§4).
// PII YOK: yalnız kapalı-küme kodlar. Saf; ağ / DB yok.
// ---------------------------------------------------------------------------

/** Cevap metninde söz edilen eylemlerin kapalı kümesi (`other` = listede olmayan eylem, yine eylemdir). */
export const CLAIMED_ACTION_KINDS = [
  "forwarded_to_host",
  "notified_team",
  "contacted_third_party",
  "booked_or_reserved",
  "scheduled",
  "created_task",
  "updated_reservation",
  "granted_exception",
  "checked_availability",
  "arranged_service",
  "payment_action",
  "will_follow_up",
  "other",
] as const;
export type ClaimedActionKind = (typeof CLAIMED_ACTION_KINDS)[number];

/** Beyan: bildirildi (liste, boş olabilir) ya da istendiği hâlde alınamadı (`unknown`). */
export type ClaimedActionsDeclaration =
  | { status: "declared"; actions: ClaimedActionKind[] }
  | { status: "unknown" };

/** Kapı gerekçeleri — `risk-events.ts` REASONS ve QR `ESCALATION_REASONS` ile birebir (parite pinli). */
export const ACTION_CLAIM_REASONS = ["action_claim", "action_claim_undeclared"] as const;
export type ActionClaimReason = (typeof ACTION_CLAIM_REASONS)[number];

const KIND_SET: ReadonlySet<string> = new Set(CLAIMED_ACTION_KINDS);

/** Bayrak: yalnız tam "1" açar (diğer AI katmanlarıyla aynı sözleşme). */
export function actionClaimsEnabled(): boolean {
  return process.env.AI_ACTION_CLAIMS_ENABLED === "1";
}

/**
 * STRICT çözüm (F01 ilkesi: eksik ya da bozuk güvenlik alanı izin vermez):
 *  · alan yok / dizi değil / dizide metin olmayan öğe → `unknown`;
 *  · kümede olmayan metin → `other` (tanınmayan eylem de eylemdir);
 *  · tekrarlar tekilleşir, sıra kümenin sırası (kanıt kararlı olsun).
 */
export function parseClaimedActions(raw: unknown): ClaimedActionsDeclaration {
  if (!Array.isArray(raw)) return { status: "unknown" };
  const seen = new Set<ClaimedActionKind>();
  for (const item of raw) {
    if (typeof item !== "string") return { status: "unknown" };
    const code = item.trim();
    seen.add(KIND_SET.has(code) ? (code as ClaimedActionKind) : "other");
  }
  return { status: "declared", actions: CLAIMED_ACTION_KINDS.filter((k) => seen.has(k)) };
}

/**
 * Kapı yüklemi (kanal + QR + önizleme aynı). `null`/`undefined` = beyan istenmedi → kural koşmaz.
 * Boş liste = eylem iddiası yok → geçer.
 */
export function actionClaimHold(decl: ClaimedActionsDeclaration | null | undefined): ActionClaimReason | null {
  if (decl == null) return null;
  if (decl.status === "unknown") return "action_claim_undeclared";
  return decl.actions.length > 0 ? "action_claim" : null;
}

/** Karar kaydı kanıtı (`g.ma`): kapalı-küme kodlar ya da `["unknown"]`; beyan istenmediyse alan yok. */
export function actionClaimEvidence(decl: ClaimedActionsDeclaration | null | undefined): string[] | undefined {
  if (decl == null) return undefined;
  return decl.status === "unknown" ? ["unknown"] : [...decl.actions];
}

/** Kanıt doğrulaması: yalnız küme kodları ya da tek başına "unknown" (serbest metin sızamaz). */
export function cleanActionClaimEvidence(x: unknown): string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  if (x.length === 1 && x[0] === "unknown") return ["unknown"];
  return CLAIMED_ACTION_KINDS.filter((k) => x.includes(k));
}

/**
 * Kullanıcı isteminin GÖREV çerçevesine eklenen alan tanımı (yalnız bayrak açıkken; kapalıyken istem aynı). Sistem
 * istemine KONMAZ: önbellekli önek bayraktan bağımsız kalsın. Etiket cevabı BETİMLER (Bölüm 4.5 ile aynı ilke).
 */
export const ACTION_CLAIMS_PROMPT_BLOCK = `
EYLEM BEYANI — JSON'a "claimedActions" alanını da EKLE (zorunlu; reply'DEN SONRA gelir):
reply metninde SENİN ya da ekibin (ev sahibi, temizlik, görevli) YAPTIĞINI, YAPTIRDIĞINI ya da YAPACAĞINI
söylediğin her eylemi aşağıdaki KAPALI listeden yaz. Hiçbir eylem söylemiyorsan boş liste [] yaz.
  forwarded_to_host (ev sahibine ilettim / bildirdim / soracağım) · notified_team (ekibe, temizliğe, görevliye
  haber verdim / vereceğim) · contacted_third_party (taksi, servis, yönetim gibi biriyle görüştüm / görüşeceğim) ·
  booked_or_reserved (yer ayırttım, rezervasyon yaptım) · scheduled (saat / randevu ayarladım) · created_task
  (kayıt ya da görev oluşturdum) · updated_reservation (rezervasyonu değiştirdim, uzattım) · granted_exception
  (erken giriş, geç çıkış ya da başka bir istisna için izin verdim) · checked_availability (takvimi / müsaitliği
  kontrol ettim / edeceğim) · arranged_service (havlu, temizlik, tamir gibi bir hizmet ayarladım / göndereceğim) ·
  payment_action (ödeme, iade, indirim işlemi yaptım / yapacağım) · will_follow_up (size döneceğim, haber vereceğim,
  takip edeceğim) · other (listede olmayan başka bir eylem).
Eylem DEĞİL (boş liste): bilgi vermek ("Wi-Fi şifresi 1234."), olgu bildirmek ("Mesajınız kaydedildi; ev sahibiniz
görebilir."), kararın kime ait olduğunu söylemek ("Bu ev sahibinizin kararıdır."), bu misafire özel olmayan süreç ya da
rutin anlatmak ("Temizlik her gün 11:00'de yapılır.", "Her misafirden önce kontrol ediyoruz."), misafire soru sormak.
actionSuggestion'daki öneriler SAYILMAZ; yalnız misafire giden reply metnine bak. Emin değilsen eylemi YAZ.
Örnek: "claimedActions": [] · "claimedActions": ["forwarded_to_host", "will_follow_up"]`;
