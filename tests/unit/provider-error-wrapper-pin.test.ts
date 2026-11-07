import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// SINIF PİNİ — SAĞLAYICI HATASI, SARMALA KÖR BİR KONTROLLE OKUNMAZ (09-23 olayı)
//
// V0.6 okuma yolunu ingest adaptörüne taşıdı; adaptör `HospitableError`ı
// `IngestError`a SARAR. O günden sonra `err instanceof HospitableError` ya da
// `err.name === "HospitableError"` diye bakan her kontrol, adaptörden geçen yolda
// SESSİZCE ölüydü. Üç yer ölçüldü:
//   · `scheduled-sync.ts` — 402'yi susturan dal → 09-08'den beri her senkron
//     geçişi kurucuya "sistem hatası" e-postası (CANLI OLAY)
//   · `api.ts serverError` — aynı 402 → 500 + alarm
//   · `provider-errors.ts` — elle senkron düğmesi 402'de jenerik metin
// Hiçbiri derleme hatası vermedi ve hiçbir test görmedi: tip sistemi `unknown`
// bir hatanın hangi sarmalda geleceğini bilemez.
//
// TEK DOĞRU OKUMA `@/lib/provider-errors` (`providerErrorStatus` /
// `isChannelSubscriptionInactive`): iki sarmalı da tanır, `status` taşıyan
// başka HİÇBİR hatayı tanımaz (OpenAI SDK hatası da `status: 402` taşır).
//
// İzinli yerler yalnız HAM istemci hatasını GERÇEKTEN aldığı kanıtlı olanlar:
// istemcinin kendisi, onu saran adaptör, tek-kaynak yardımcı ve istemciyi
// (`verifyToken`/`exchangeCodeForToken`) adaptörsüz çağıran iki bağlantı rotası.
// Yeni bir yer eklemek istiyorsan önce çağrı zincirini kanıtla: hata oraya
// adaptörden GEÇMEDEN mi geliyor? Emin değilsen yardımcıyı kullan.
// ⚠️ Kaynak taraması TEK YÖNLÜDÜR — davranışsal kardeşleri:
// `tests/integration/scheduled-sync-402-no-alert.test.ts`,
// `tests/unit/server-error-hospitable-402.test.ts`, `tests/unit/provider-errors.test.ts`.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Yorum satırlarını at (satır başına çapalı). */
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const SARMALA_KOR = /instanceof\s+HospitableError\b|\.name\s*===\s*["'`]HospitableError["'`]/;

const IZINLI = new Set([
  "src/lib/hospitable.ts", // sınıfın tanımı + istemcinin kendi yeniden-deneme mantığı
  "src/lib/channels/hospitable-ingest.ts", // sarmalın kendisi (ham → IngestError)
  "src/lib/provider-errors.ts", // tek-kaynak yardımcı
  "src/app/api/hospitable/connect/route.ts", // `verifyToken`ı adaptörsüz çağırır
  "src/app/api/hospitable/oauth/callback/route.ts", // `exchangeCodeForToken`/`verifyToken`ı adaptörsüz çağırır
]);

describe("sağlayıcı hatası sarmala kör kontrolle okunmaz", () => {
  it("izinli liste dışında `instanceof HospitableError` / `name === \"HospitableError\"` YOK", () => {
    const files = [...walk(path.join(ROOT, "src"))];
    const offenders = files
      .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
      .filter((rel) => !IZINLI.has(rel))
      .filter((rel) => SARMALA_KOR.test(code(read(rel))));
    expect(
      offenders,
      "Bu dosyalar sağlayıcı hatasını sarmala kör biçimde okuyor — `@/lib/provider-errors` " +
        "(`providerErrorStatus` / `isChannelSubscriptionInactive`) kullan:",
    ).toEqual([]);
  });

  it("ANTİ-VAKUMLUK: tarayıcı kalıbı gerçekten yakalıyor (sarmalın kendisinde bulunmalı)", () => {
    // Kalıp bozulursa (ör. regex yanlış kaçışla hiçbir şey eşleştirmez) yukarıdaki
    // test SESSİZCE yeşil kalırdı. Sarmal bu kontrolü kanıtlı olarak taşır.
    expect(SARMALA_KOR.test(code(read("src/lib/channels/hospitable-ingest.ts")))).toBe(true);
    // ve izinli listedeki her yol gerçekten var (bayat giriş listeyi sessizce genişletmesin)
    for (const rel of IZINLI) expect(() => read(rel), rel).not.toThrow();
  });
});
