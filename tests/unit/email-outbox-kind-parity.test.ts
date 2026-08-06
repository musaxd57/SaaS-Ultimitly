import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// YENİ BİR `EmailOutboxKind` EKLEMEK DÖRT YERE BİRDEN DOKUNMAK DEMEKTİR ve
// İKİSİ UNUTULURSA SESSİZCE BAŞARISIZ OLUR. Bu dosya o boşluğu kapatır.
//
// 🚨 Neden gerekli — ölçülen davranış:
//  · `KINDS` seti `ReadonlySet<string>` olarak tiplenmiş, `EmailOutboxKind`
//    olarak DEĞİL. Yani union'a eklemek derleyiciyi memnun eder ama seti
//    güncellemez; `processClaimedRow` bilinmeyen türü `cancelSelf()` ile iptal
//    eder ve `reportError` ÇAĞIRMAZ → e-posta hiç gitmez, hiç sinyal çıkmaz.
//  · `hashLive`'ın ternary zinciri bir CATCH-ALL ile biter (`pwChangeCodeHash`).
//    Türe özel dal yoksa yeni tür oraya düşer, hash NULL bulunur, `false` döner
//    ve satır `rowIsCurrent` tarafından iptal edilir — yine SESSİZ.
//  · `renderIdentityEmail` switch'i exhaustive olduğu için orada unutmak
//    DERLEME hatası verir; yani tek gürültülü nokta o. Diğer üçü sessiz.
//
// Bu test kaynak taramasıdır: dört listenin de AYNI tür kümesini tanıdığını
// asserte eder. Davranış testiyle yapılamaz çünkü sessiz düşüşün gözlemlenebilir
// tek belirtisi "e-posta gelmedi"dir ve bu, testte bir yokluk olarak görünür.
// ---------------------------------------------------------------------------

const SRC = readFileSync(join(process.cwd(), "src/lib/email-outbox.ts"), "utf8");

/** `export type EmailOutboxKind = "a" | "b" | …` içindeki türler. */
function unionKinds(): string[] {
  const m = /export type EmailOutboxKind =([\s\S]*?);/.exec(SRC);
  expect(m, "EmailOutboxKind union'ı bulunamadı — isim değiştiyse test güncellenmeli").toBeTruthy();
  return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

/** `const KINDS: ReadonlySet<string> = new Set([ … ])` içindeki türler. */
function setKinds(): string[] {
  const m = /const KINDS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(SRC);
  expect(m, "KINDS seti bulunamadı").toBeTruthy();
  return [...m![1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

/** `renderIdentityEmail` switch'indeki `case "…":` etiketleri. */
function renderedKinds(): string[] {
  const start = SRC.indexOf("function renderIdentityEmail(");
  expect(start, "renderIdentityEmail bulunamadı").toBeGreaterThan(-1);
  const body = SRC.slice(start, SRC.indexOf("\n}", start));
  return [...body.matchAll(/case "([a-z_]+)":/g)].map((x) => x[1]);
}

/** `hashLive` gövdesinde AÇIKÇA adı geçen türler (catch-all'a düşmeyenler). */
function hashLiveHandled(): string[] {
  const start = SRC.indexOf("function hashLive(");
  expect(start, "hashLive bulunamadı").toBeGreaterThan(-1);
  const body = SRC.slice(start, SRC.indexOf("\n}", start));
  return [...body.matchAll(/kind === "([a-z_]+)"/g)].map((x) => x[1]);
}

describe("EmailOutboxKind — dört listenin paritesi", () => {
  it("union'daki HER tür `KINDS` setinde de var", () => {
    // Eksikse: satır sessizce `canceled`, e-posta hiç gitmez, alarm YOK.
    expect([...setKinds()].sort()).toEqual([...unionKinds()].sort());
  });

  it("union'daki HER türün `renderIdentityEmail` case'i var", () => {
    expect([...renderedKinds()].sort()).toEqual([...unionKinds()].sort());
  });

  it("union'daki HER tür `hashLive`'da AÇIKÇA ele alınmış (catch-all'a düşen yok)", () => {
    // ⚠️ `hashLive` üç türü ternary ile ayırıyor ve SONUNCUSU catch-all.
    // Ternary'de adı geçen türler + erken dönüşle ele alınanlar toplamı, union'ı
    // TAM kapsamalı. Kapsamazsa yeni tür sessizce `pwChangeCodeHash`'e düşer.
    const handled = new Set(hashLiveHandled());
    // Catch-all dalının kendisi (`pw_change_code`) ternary'de adıyla geçmez;
    // bilinçli olarak bu tek istisna tanınır.
    handled.add("pw_change_code");
    const missing = unionKinds().filter((k) => !handled.has(k));
    expect(missing, `hashLive'da ele alınmayan tür(ler): ${missing.join(", ")}`).toEqual([]);
  });

  it("bugünkü kapsam — yeni tür eklendiğinde bu liste BİLİNÇLİ güncellenir", () => {
    // Kanarya: sayı değişince yukarıdaki üç parite testinin de düşünülmesi için.
    expect([...unionKinds()].sort()).toEqual([
      "account_exists",
      "pw_change_code",
      "pw_reset_challenge",
      "pw_reset_code",
      "verify_email",
    ]);
  });
});
