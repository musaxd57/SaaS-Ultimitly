// ---------------------------------------------------------------------------
// ÖLÇÜM = ÜRÜN AYARI (kurucu 10-15: "kodda ne kullanıyorsak o olsun, Luna 6.0'ı kullandığımız yerler o olsun").
//
// Ölçümler katman modelini ortam değişkeninden okur; kabukta değişken yoksa kod varsayılanına (5.1) düşüyordu → Luna'ya geçen katmanlar
// (cevap, bekçi, çeviri, üslup) ölçümde 5.1 ile koşuyordu. Bu profil, kurucunun 10-10 model kararını (`docs/RAILWAY-ACILIS-2026-10-15.md`
// §2 · `docs/olcum/LUNA-GECIS-2026-10-10.md` sonu) eval yapılandırmasının KURULUM dosyasında doldurur:
//  · Yalnız BOŞ değişken doldurulur — kabukta / kolda açıkça verilen değer kazanır (model kıyas kolları aynen çalışır).
//  · `EVAL_PROD_PROFILE=0` profili kapatır (eski davranış: kod varsayılanları).
//  · Canlıda ayar değişirse TEK yer burası + Railway listesi; `run-meta.ts` koşu kimliği her raporda katman modelini yazar.
// ---------------------------------------------------------------------------

export const PROD_MODEL_PROFILE: Readonly<Record<string, string>> = {
  OPENAI_MODEL: "gpt-6-luna",
  OPENAI_REASONING_EFFORT: "low",
  AI_STAY_GUARD_MODEL: "gpt-6-luna",
  AI_STAY_GUARD_REASONING_EFFORT: "low",
  OPENAI_TRANSLATE_MODEL: "gpt-6-luna",
  OPENAI_TRANSLATE_REASONING_EFFORT: "medium",
  OPENAI_STYLE_MODEL: "gpt-6-luna",
  OPENAI_STYLE_REASONING_EFFORT: "none",
  AI_DECISION_TEXT_MODEL: "gpt-5.1",
  // Anlama + yeniden sıralayıcı 5.1'de (10-10 dalga 5) — ortak anahtar; katman anahtarları BOŞ kalır.
  AI_SEMANTIC_MODEL: "gpt-5.1",
};

/** Profili uygular; doldurulan değişkenlerin adlarını döner (rapor / test için). */
export function applyProdModelProfile(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.EVAL_PROD_PROFILE === "0") return [];
  const filled: string[] = [];
  for (const [k, v] of Object.entries(PROD_MODEL_PROFILE)) {
    if (env[k] === undefined || env[k] === "") {
      env[k] = v;
      filled.push(k);
    }
  }
  return filled;
}
