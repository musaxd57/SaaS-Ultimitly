import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// KVKK SÜPÜRGE PARİTESİ — iki süpürge AYNI kolonlara dokunmak zorunda.
//
// Misafir PII'si İKİ ayrı yoldan temizleniyor ve ikisi de kolon listesini ELLE
// sayıyor, birbirinden bağımsız olarak:
//   · `data-retention.ts` → SÜRE-BAZLI anonimleştirme (6698 m.7, resen imha)
//   · `erasure.ts`        → misafirin AÇIK SİLME talebi (m.11)
// CLAUDE.md'deki "SCRUB KAPSAMI KURALI" ikisinin birlikte güncellenmesini
// söylüyor ama bunu YAPISAL olarak hiçbir şey zorlamıyordu — yani kural insan
// hafızasına dayanıyordu. Tarihçe bu sınıftan GERÇEK sızıntılar kaydetmiş:
// `Task.description` bir dönem HİÇBİR süpürgede yoktu (derin denetim, 08-01).
//
// 🚨 Bu test kolonların "PII mi" olduğuna KARAR VERMEZ — o yargıyı yazmak,
// yanlış bir "kapsam dışı" etiketiyle testsizlikten daha kötü bir YANLIŞ GÜVENCE
// üretirdi. Bunun yerine gerçek değişmezi pinler: **iki süpürge birbirinden
// ayrışamaz**, ve o modellere yeni bir kolon eklendiği an biri KARAR VERMEK
// zorunda kalır (↓şema kanaryası).
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Misafir verisi taşıyan modeller — süpürgelerin dokunduğu kümenin tamamı. */
const GUEST_MODELS = ["Message", "Conversation", "Reservation", "Task", "TaskUpdate", "MessageOutbox"] as const;
type GuestModel = (typeof GUEST_MODELS)[number];

/** schema.prisma'dan model → kolon adları (skaler; ilişki ve id hariç). */
function schemaColumns(): Record<string, Set<string>> {
  const src = read("prisma/schema.prisma");
  const out: Record<string, Set<string>> = {};
  for (const [, name, body] of src.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const cols = new Set<string>();
    for (const line of body.split("\n")) {
      // 🚨 TÜM Prisma SKALER tipleri + liste/opsiyonel son ekleri (08-09 (2)).
      // Eski alternasyon `Float`/`Decimal`/`Bytes`/`BigInt` ve `String[]` gibi
      // liste tiplerini GÖRMÜYORDU → o tipteki bir kolon eklendiğinde kanarya
      // SESSİZ kalıyor ve "bu kolon misafir verisi mi" sorusu hiç sorulmuyordu.
      // Ölçüldü: dört kolon kanaryanın kör noktasındaydı (↓EXPECTED yorumu).
      // ⚠️ İlişkiler ve ENUM'lar hâlâ dışarıda — ilişki alanı model adı taşır,
      // enum ise kendi adını; ikisi de bu listede yok. Şemaya bir gün enum
      // kolonu eklenirse kanarya onu da göremez (bilinen sınır).
      const m = /^\s+(\w+)\s+(String|Boolean|Int|BigInt|Float|Decimal|DateTime|Json|Bytes)(\[\])?\??\s*(.*)$/.exec(line);
      if (m && !m[4].includes("@relation") && !m[4].includes("@id")) cols.add(m[1]);
    }
    out[name] = cols;
  }
  return out;
}

/**
 * Bir dosyanın YAZDIĞI (model, kolon) çiftleri.
 *
 * `prisma.<model>.update/updateMany(...)` çağrılarındaki `data: { … }` bloğunu
 * DENGELİ PARANTEZLE çıkarır, içindeki tüm `anahtar:` belirteçlerini toplar ve
 * şemadaki gerçek kolon adlarıyla KESİŞTİRİR.
 *
 * ⚠️ Kesişim şart: blok içinde `in:`/`not:`/`set:` gibi Prisma operatörleri de
 * geçiyor, ham toplama gürültü üretirdi. Kesişim ayrıca ternary spread içindeki
 * koşullu alanları da yakalar — `data-retention.ts`'te `Task.description` tam
 * olarak öyle yazılıyor (`...(t.description ? { description: … } : {})`), ve
 * yalnız üst seviyeye bakan bir ayrıştırıcı onu KAÇIRIRDI.
 */
function writtenPairs(rel: string, cols: Record<string, Set<string>>): Set<string> {
  const src = read(rel);
  const pairs = new Set<string>();
  for (const m of src.matchAll(/(?:prisma|db)\.(\w+)\.(?:update|updateMany)\(/g)) {
    const model = m[1][0].toUpperCase() + m[1].slice(1);
    if (!GUEST_MODELS.includes(model as GuestModel)) continue;
    const at = src.indexOf("data:", m.index! + m[0].length);
    if (at === -1 || at - m.index! > 800) continue;
    let i = src.indexOf("{", at);
    if (i === -1) continue;
    let depth = 1;
    const start = ++i;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    for (const k of src.slice(start, i - 1).matchAll(/(\w+)\s*:/g)) {
      if (cols[model]?.has(k[1])) pairs.add(`${model}.${k[1]}`);
    }
  }
  return pairs;
}

const COLS = schemaColumns();
const RETENTION = writtenPairs("src/lib/data-retention.ts", COLS);
const ERASURE = writtenPairs("src/lib/erasure.ts", COLS);

describe("KVKK süpürgeleri — süre-bazlı ↔ açık-silme paritesi", () => {
  it("ayrıştırıcı GERÇEKTEN bir şey buldu (test kendini boşa düşürmesin)", () => {
    // Bu olmadan regex'i bozan bir refactor iki tarafı da BOŞ küme yapar ve
    // "iki küme eşit" assertion'ı sessizce geçerdi — testin en klasik ölüm şekli.
    expect(RETENTION.size).toBeGreaterThanOrEqual(10);
    expect(ERASURE.size).toBeGreaterThanOrEqual(10);
  });

  it("İKİ SÜPÜRGE AYNI (model, kolon) kümesine dokunuyor", () => {
    // Asıl değişmez bu. Biri güncellenip diğeri unutulursa kırmızı.
    //  · yalnız retention'da → misafir SİLME talep etti ama veri kaldı (m.11 ihlali)
    //  · yalnız erasure'da   → 24 ay sonra resen imha edilmedi (m.7 ihlali)
    const onlyRetention = [...RETENTION].filter((p) => !ERASURE.has(p)).sort();
    const onlyErasure = [...ERASURE].filter((p) => !RETENTION.has(p)).sort();
    expect({ yalnizSureBazli: onlyRetention, yalnizAcikSilme: onlyErasure }).toEqual({
      yalnizSureBazli: [],
      yalnizAcikSilme: [],
    });
  });

  it("bugünkü kapsam AÇIKÇA yazılı (sessiz daralma da kırmızı verir)", () => {
    // Parite testi tek başına yetmez: biri İKİ süpürgeden de bir kolonu
    // çıkarırsa kümeler yine eşit kalır ve kapsam sessizce DARALIR. Beklenen
    // liste o yolu kapatır.
    expect([...RETENTION].sort()).toEqual(
      [
        // m48 (08-09): triyaj METİNLERİ misafirin mesajından türemiş model
        // çıktısıdır → misafir kişisel verisi. Diğer dört triyaj kolonu
        // (`aiConfidence` sayı · `aiTriageSource` kapalı-set etiket ·
        // `aiTriagedAt` damga · `aiTriageTriggerMessageId` opak id) BİLİNÇLİ
        // olarak kapsam DIŞI — `Message.aiSourcesJson` emsali.
        "Conversation.aiActionSuggestion",
        "Conversation.aiMissingInfoJson",
        "Conversation.guestIdentifier",
        "Message.aiSuggestedReply",
        "Message.body",
        "Message.senderName",
        "MessageOutbox.body",
        "MessageOutbox.status",
        "Reservation.guestCheckoutTime",
        "Reservation.guestEmail",
        "Reservation.guestExternalId",
        "Reservation.guestName",
        "Reservation.guestPhone",
        "Reservation.notes",
        "Task.description",
        "Task.title",
        "TaskUpdate.note",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// ŞEMA KANARYASI — yeni kolon eklendiğinde birinin KARAR VERMESİNİ zorlar.
//
// Parite testi yalnız "iki taraf aynı mı" der; şemaya misafir metni taşıyan YENİ
// bir kolon eklenip İKİ süpürgeye de yazılmazsa kümeler yine eşit kalır ve
// sızıntı sessizce doğar. Bu sayaç o boşluğu kapatır.
//
// ⚠️ Bilerek SAYI, sınıflandırma DEĞİL. 68 kolonu tek tek "PII mi" diye
// etiketlemek, yanlış bir "kapsam dışı" kaydıyla testsizlikten DAHA KÖTÜ bir
// yanlış güvence üretirdi. Kararı, kolonu ekleyen kişi verir — çünkü o kolonun
// ne taşıdığını gerçekten bilen tek kişi odur.
// ---------------------------------------------------------------------------
describe("şema kanaryası — misafir modellerine yeni kolon", () => {
  it.each(GUEST_MODELS)("%s kolon sayısı değişmedi", (model) => {
    const EXPECTED: Record<GuestModel, number> = {
      // ⚠️ SAYILAR 08-09 (2)'DE ARTTI ÇÜNKÜ KANARYANIN KÖR NOKTASI KAPANDI —
      // yeni kolon eklendiği için DEĞİL. Regex `Float`/`Decimal`/liste tiplerini
      // görmüyordu; genişletilince DÖRT kolon ilk kez göründü ve her biri için
      // kapsam kararı ELLE verildi (kanaryanın istediği tam olarak budur):
      //   · Message.aiConfidence      (Float?)   → KAPSAM DIŞI: 0..1 arası bir
      //   · Conversation.aiConfidence (Float?)      sayı; misafirin metnini de
      //                                             kimliğini de taşımaz.
      //   · Reservation.totalAmount    (Float?)  → KAPSAM DIŞI ve BİLİNÇLİ:
      //   · Reservation.totalAmountDec (Decimal?)   süpürgenin TANIMI "anonymize
      //     rather than hard-delete so occupancy/report history stays intact" —
      //     tutarı silmek, korunması İSTENEN finansal geçmişi yok ederdi.
      //   · MessageOutbox.connectionId (String?, V0.3 / migration 49) → KAPSAM DIŞI:
      //     opak ChannelConnection cuid'i (org'un sağlayıcı bağlantısı); misafirin
      //     ne metnini ne kimliğini taşır. Kimlik bilgisinin kendisi
      //     ChannelConnection satırında ŞİFRELİ durur ve org cascade ile silinir —
      //     misafir verisi değil, host'un sağlayıcı sırrıdır (retention/erasure kapsamı
      //     dışı, KVKK ihracına da girmez).
      Message: 14,
      Conversation: 23,
      Reservation: 32,
      Task: 15,
      TaskUpdate: 6,
      MessageOutbox: 23,
    };
    expect(
      COLS[model]?.size,
      `\n\n🚨 "${model}" modeline kolon eklendi/çıkarıldı.\n` +
        `   SORU: bu kolon misafirin METNİNİ ya da KİMLİĞİNİ taşıyor mu?\n` +
        `   EVET ise → data-retention.ts VE erasure.ts'e EKLE, sonra yukarıdaki\n` +
        `              "bugünkü kapsam" listesini güncelle.\n` +
        `   HAYIR ise → yalnız bu sayacı güncelle (kararı vermiş olursun).\n`,
    ).toBe(EXPECTED[model]);
  });
});
