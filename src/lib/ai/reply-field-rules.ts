import type { SuggestReplyResult } from "@/lib/ai/types";

/**
 * GD7 (kurucu 10-29 gece K-1029-E) — cevap sonucunun HER alanı için iki kural, TEK tabloda:
 *
 *  · `rewrite` — kıdemli okuyucu cevabı yeniden yazdırınca (`mergeSeniorRewrite`) alan nereden gelir: MESAJA ait hüküm (niyet, risk,
 *    dil, misafirin yazdığı çıkış saati…) ilk çağrıdan (`first`), METNE ait her şey (metin, kaynak / iddia denetimi, cevaplanan
 *    istekler, parçalar, eylem beyanı, metin işaretleri…) yeni çağrıdan (`retried`); güven ikisinin küçüğü (`min`), kullanım toplamı
 *    (`sum`), "bu turda ikinci model çağrısı yapıldı" sayacı ikisinden biri (`either`), konaklama beyanı yarı yarıya (`split`).
 *  · `codeBuilt` — modelin taslağı KODDAN kurulan doğrulanmış metinle değiştirilince (`codeBuiltResult`: erken giriş onayı, doğrulanmış
 *    müsaitlik / uzatma; kanal + QR) alan ne olur: `replace` (kod metnine göre yeniden yazılır), `clear` (atılan taslağın METNİ hakkında bir
 *    ifadeydi → düşer), `keep` (mesaja ait, ya da bilinçli istisna — gerekçesi satırında).
 *
 * Neden tablo: GD7 hatasının sınıfı "metin hakkındaki bir işaret, metin değişince eski metinden yeni metne taşındı" idi (`hostContactOnly`
 * kod metnine taşınıyor, onaylı metni gereksiz tutuyordu; `verifiedPartsOnly` kod metnine taşınıp 09-24'te bilinçli korunan güven
 * tabanını atlatıyordu). Elle yazılan iki fonksiyon her yeni alanda ayrı ayrı hatırlanmak zorundaydı. Şimdi:
 *   ① TAMLIK derleyicide: `SuggestReplyResult`a yeni alan eklenip burada sınıflanmazsa `tsc` kırılır (CI `tsc --noEmit` koşar);
 *   ② DOĞRULUK testte: `tests/unit/reply-field-rules.test.ts` her alan için iki fonksiyonu bu tabloya karşı sınar (yanlış sınıflanan alan
 *      derlenir ama test kırılır; yanlış KURAL yazılırsa gözden geçirme yakalar — tablo tek bakışta okunur).
 * Kural yalnız ÇIKARMA yapan düzenlemeleri (selam / dolgu / konu ayıklama, ev sahibine başvurma cümlesi silme) kapsamaz: onlar aynı metnin
 * parçasını siler, işaretler metnin kendisi için yeniden hesaplanır (`index.ts`, `host-contact-filler.ts`).
 */
export type ReplyFieldRule = {
  readonly rewrite: "first" | "retried" | "min" | "sum" | "either" | "split";
  readonly codeBuilt: "keep" | "replace" | "clear";
};

export const REPLY_FIELD_RULES = {
  // ── Mesaja ait hüküm ──────────────────────────────────────────────────────────────────────────────────────────────
  // Niyet mesaja aittir ama kod metni kendi niyetini taşır: modelin `human_request` etiketi onay metnine insan talebi muafiyeti
  // taşıyamaz (09-24 P1-2).
  intent: { rewrite: "first", codeBuilt: "replace" },
  risk: { rewrite: "first", codeBuilt: "keep" },
  priority: { rewrite: "first", codeBuilt: "keep" },
  source: { rewrite: "first", codeBuilt: "keep" },
  actionSuggestion: { rewrite: "first", codeBuilt: "keep" },
  riskLevel: { rewrite: "first", codeBuilt: "keep" },
  detectedLanguage: { rewrite: "first", codeBuilt: "keep" },
  riskType: { rewrite: "first", codeBuilt: "keep" },
  statedCheckoutTime: { rewrite: "first", codeBuilt: "keep" },
  // İSTEK yarısı mesajdan, TUTUM yarısı metinden. Kod metninde AYNEN: kapı kod metnini kendi doğrulanmış izniyle yeniden okur.
  stayChange: { rewrite: "split", codeBuilt: "keep" },
  // ── Güven: kod metninde AYNEN (09-24 P2: 1'e çekmek, müsaitlik kontrolünden SONRA gelen ≥ 0,75 tabanını kaldırıyordu) ─────────
  confidence: { rewrite: "min", codeBuilt: "keep" },
  // ── Metne ait ─────────────────────────────────────────────────────────────────────────────────────────────────────
  reply: { rewrite: "retried", codeBuilt: "replace" },
  // Kod metni bilgi tabanına dayanmaz → boş liste.
  usedSources: { rewrite: "retried", codeBuilt: "replace" },
  // Kaynak sayımı ve iddia desteği atılan taslağındı → ölçülmedi (A2: NULL, 0 değil).
  sourceAudit: { rewrite: "retried", codeBuilt: "clear" },
  claimAudit: { rewrite: "retried", codeBuilt: "clear" },
  // İstendiyse boş beyan (kod metni makbuzsuz eylem iddia etmez — MÇ §4), istenmediyse alan yok.
  claimedActions: { rewrite: "retried", codeBuilt: "replace" },
  // İstemin kendi KB muhasebesi: yeniden yazma yeni istem kurar; kod metni istemin ölçümünü silmez (karar kaydı istemi anlatır).
  kbOmittedInPrompt: { rewrite: "retried", codeBuilt: "keep" },
  missingInfo: { rewrite: "retried", codeBuilt: "keep" },
  // İstemin gördüğü saat çelişkileri; kapı kod metnine değip değmediğini yeniden okur.
  timeConflicts: { rewrite: "retried", codeBuilt: "keep" },
  // Kod metni yalnız TEK konulu turda kurulur (`early-checkin/core.ts` multi_intent, politika `automation.ts`) → cevaplanan istek
  // beyanı aynı tek isteği anlatır; parça kararları açık kalan istekleri açık tutar (yalnız sıkılaştırır).
  answeredRequests: { rewrite: "retried", codeBuilt: "keep" },
  answerParts: { rewrite: "retried", codeBuilt: "keep" },
  // Doğrulanmış parça METİNLERİ atılan taslağındı: kod metni onlardan kurulmadı (gölge tekrar ölçümü gönderilmeyen parçayı "gitti"
  // saymasın). Parça kipi kontrolü (`automation.ts` "onaylı parça son metinde aynen") kod metni yerleşmeden ÖNCE koşar.
  verifiedParts: { rewrite: "retried", codeBuilt: "clear" },
  // ── Metin işaretleri (metnin KENDİSİ hakkında ifade; metin değişince düşer, yeniden yazmada yeni metinden) ───────────────
  // 4.12: "giden metin yalnız doğrulanmış parçalar" — kod metni parça değildir → güven tabanı geri gelir.
  verifiedPartsOnly: { rewrite: "retried", codeBuilt: "clear" },
  // R13-b/c: "cevap yalnız ev sahibine başvurma talimatı" — onaylı kod metni böyle değildir.
  hostContactOnly: { rewrite: "retried", codeBuilt: "clear" },
  // ── Muhasebe ──────────────────────────────────────────────────────────────────────────────────────────────────────
  llmUsage: { rewrite: "sum", codeBuilt: "keep" },
  // Parça yeniden yazması bu turda ikinci bir cevap modeli çağrısı yaptı → kotadan bir birim. İki çağrıdan HERHANGİ biri yaptıysa
  // birim düşer (önceden yalnız ilk çağrınınki okunuyordu: yeniden yazılan çağrının parça yeniden yazması kotaya sayılmıyordu).
  // Kod metni çağrıları geri almaz.
  partRewriteBilled: { rewrite: "either", codeBuilt: "keep" },
} as const satisfies { readonly [K in keyof Required<SuggestReplyResult>]: ReplyFieldRule };

type Rules = typeof REPLY_FIELD_RULES;
/** Kod metninde düşen alanlar (tablodan türetilir). */
export type CodeBuiltClearedField = { [K in keyof Rules]: Rules[K]["codeBuilt"] extends "clear" ? K : never }[keyof Rules];

export const CODE_BUILT_CLEARED_FIELDS = (Object.keys(REPLY_FIELD_RULES) as (keyof Rules)[]).filter(
  (k) => REPLY_FIELD_RULES[k].codeBuilt === "clear",
) as readonly CodeBuiltClearedField[];

/** Kod metninde düşen alanlar olmadan kopya (girdi değişmez). */
export function withoutCodeBuiltClearedFields<T extends object>(result: T): T {
  const out = { ...result } as Record<string, unknown>;
  for (const k of CODE_BUILT_CLEARED_FIELDS) delete out[k];
  return out as T;
}
