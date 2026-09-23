import "server-only";

import { alertOnTransition, clearAlertState } from "@/lib/alert-state";
import { reportError } from "@/lib/report-error";

// ---------------------------------------------------------------------------
// MODEL SAĞLAYICISININ KALICI ARIZASI — geçiş tabanlı alarm (09-23 ölçümü).
//
// 🚨 ÖLÇÜLEN DURUM: bu oturumdaki anahtarın kredisi BİTMİŞ; OpenAI her çağrıya
// `429 insufficient_quota / credit_balance_exhausted` dönüyor. `callOpenAI`
// bunu `reportError("openai-reply 429")` ile bildiriyordu. O yolun e-posta
// bacağı context başına 10 dakikada bir kısılır ama Sentry olayı ve log satırı
// HER çağrıda üretilir (`ai/index.ts` "anahtar yok" dalının kendi ölçümü). Ve
// kaynak bir DÖNGÜDÜR: model cevap veremeyince konuşma damgalanmaz, 2 dakikada
// bir yeniden denenir (geçiş başına 25 konuşma, yanıt başına 2 çağrı). Yani
// kredisi biten bir hesapla Railway yeniden açıldığı gün 09-23'teki alarm selinin
// aynısı (günde ~144 e-posta + on binlerce Sentry olayı) yaşanırdı.
//
// KALICI sınıflar YALNIZ şunlar — bunlar kendiliğinden düzelmez, bir insanın
// (kurucu/operatör) müdahalesini ister:
//   · quota — kredi/fatura limiti bitti (429 + `insufficient_quota` gövdesi),
//   · auth  — anahtar geçersiz/iptal ya da bölge/proje yasağı (401/403),
//   · model — yapılandırılan model yok/erişilemez (404 ya da `model_not_found`).
// 🚨 Düz 429 (hız sınırı) ve 5xx GEÇİCİDİR ve eski yolda kalır: onları "kalıcı"
// saymak, düzelmeleri hâlinde alarm durumunu gereksiz yere açık tutardı.
//
// Durum `alert-state` satırındadır (migration YOK). Başarı yolu SORGU ATMAZ:
// süreç başına "alarm açık olabilir" bayrağı tutulur, yalnız ilk başarıda (ya da
// bir arızadan sonraki ilk başarıda) TEK silme yapılır.
// ---------------------------------------------------------------------------

export type ModelProviderPersistentFailure = "quota" | "auth" | "model";

/** Durum anahtarı (`alert-state:model-provider:reply`). */
export const MODEL_PROVIDER_ALERT_KEY = "model-provider:reply";
/** E-posta konusu — kurucu aynı başlığı tanısın diye sabittir. */
export const MODEL_PROVIDER_ALERT_CONTEXT = "openai-reply kalıcı arıza";

/**
 * HTTP durum + gövde → kalıcı arıza sınıfı (yoksa null = geçici).
 * Saf; gövde metni yalnız SINIFLANDIRMA için okunur, sınıfın kendisine girmez.
 */
export function classifyModelProviderFailure(status: number, body: string): ModelProviderPersistentFailure | null {
  if (/\bmodel_not_found\b/.test(body)) return "model";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model";
  if (status === 429 && /\b(insufficient_quota|credit_balance_exhausted|billing_hard_limit_reached)\b/.test(body)) {
    return "quota";
  }
  return null;
}

/** Alarm e-postasında görünen hata; sınıf (`errorClassOf`) ad + kod + durumdan kurulur. */
export class ModelProviderPersistentError extends Error {
  readonly code: ModelProviderPersistentFailure;
  readonly status: number;
  constructor(code: ModelProviderPersistentFailure, status: number, detail: string) {
    super(`${HUMAN_CAUSE[code]} (HTTP ${status}): ${detail.slice(0, 400)}`);
    this.name = "ModelProviderPersistentError";
    this.code = code;
    this.status = status;
  }
}

const HUMAN_CAUSE: Record<ModelProviderPersistentFailure, string> = {
  quota: "OpenAI kredisi/kotası bitti — AI yanıtı üretilemiyor, oto-yanıt durdu",
  auth: "OpenAI anahtarı reddedildi — AI yanıtı üretilemiyor, oto-yanıt durdu",
  model: "Yapılandırılan OpenAI modeli bulunamadı — AI yanıtı üretilemiyor, oto-yanıt durdu",
};

/**
 * Bu süreçte bir alarm durumunun AÇIK OLABİLECEĞİ bilgisi. Süreç başında
 * bilinmez (başka bir süreç ya da önceki çalıştırma açmış olabilir) → `true`;
 * ilk başarı TEK silmeyle kapatır ve bayrağı indirir.
 */
let alertMayBeActive = true;

/** Kalıcı arızayı bildir: alarm YALNIZ durum geçişinde. Asla fırlatmaz. */
export async function noteModelProviderPersistentFailure(
  code: ModelProviderPersistentFailure,
  status: number,
  body: string,
): Promise<void> {
  alertMayBeActive = true;
  const err = new ModelProviderPersistentError(code, status, body);
  try {
    await alertOnTransition(MODEL_PROVIDER_ALERT_KEY, MODEL_PROVIDER_ALERT_CONTEXT, err);
  } catch {
    // Alarm yolunun kendisi düştü: SUSMA — eski (kısıtlı) yola düş.
    await reportError(MODEL_PROVIDER_ALERT_CONTEXT, err).catch(() => {});
  }
}

/** Başarılı model çağrısı: açık olabilecek alarm durumunu kapat (sağlıklı yolda sorgu yok). */
export function noteModelProviderSuccess(): void {
  if (!alertMayBeActive) return;
  alertMayBeActive = false;
  void clearAlertState(MODEL_PROVIDER_ALERT_KEY).catch(() => {});
}

/** TEST KANCASI: süreç bayrağını sıfırla (her test kendi başlangıç durumunu kurar). */
export function __resetModelProviderHealthForTests(mayBeActive = true): void {
  alertMayBeActive = mayBeActive;
}
