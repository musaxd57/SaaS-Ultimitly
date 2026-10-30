import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// DEMO SIFIRLAMA KAPSAMI — büyüyemez sınıflandırma (gece-4 S10-09, `data-export-coverage.test.ts` örneği).
//
// Demo hesabı "her sıfırlamada tertemiz" sözü verir (`docs/DEMO-HESABI.md`). Veri kümesindeki mülkler SİLİNMEZ, güncellenir — bu yüzden
// mülk zincirlemesiyle silindiği sanılan tablolar (Geçmişten öğren, mülk talimatları, takvim bağlantısı) sıfırlamada kalıyordu. Şemadaki
// HER model ya sıfırlamada açıkça silinir (`tx.<model>.deleteMany`), ya silinen bir tablodan zincirleme gider (mülk / işletme HARİÇ — onlar
// silinmez), ya da aşağıda gerekçesiyle bilinçli olarak korunur. Yeni model sınıflandırılmadan eklenemez.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync(path.resolve(__dirname, "../../src/lib/demo-tenant/apply-core.ts"), "utf8");

/** Sıfırlamada SİLİNMEYEN modeller — gerekçe. */
const KEPT: Record<string, string> = {
  Organization: "demo işletmesinin kendisi — upsert ile yeniden kurulur",
  Property: "veri kümesindeki mülkler upsert (QR / takvim belirteci korunur); veri kümesinde olmayanlar silinir",
  User: "demo giriş hesapları (inceleyici) — korunur, ayarı güncellenir",
  PasswordResetChallenge: "kullanıcıya bağlı güvenlik kaydı — kendi süresiyle düşer",
  AuditLog: "denetim kaydı BİLEREK korunur (inceleme izi)",
  OperationalEvent: "yalnız-ekle olay günlüğü (tetikleyicilerle silinemez — migration 63/64)",
  Subscription: "abonelik VARSA sıfırlama baştan reddedilir (canlı bağlantı kemeri) — demo hesabında yok",
  Invoice: "fatura kaydı — demo hesabında üretilmez; varsa iz",
  CheckoutConsent: "ödeme onayı kaydı — iz",
  CheckoutIntent: "ödeme niyeti — onaya bağlı (onay korunur); demo hesabında ödeme ekranı açılmaz (migration 82)",
  ChannelConnection: "bağlantı VARSA sıfırlama baştan reddedilir (canlı bağlantı kemeri) — demo hesabında yok",
  CalendarSource: "takvim bağlantısı VARSA sıfırlama baştan reddedilir (canlı bağlantı kemeri; inceleyici eklerse operatör elle bakar)",
  HostChannelBinding:
    "ev sahibinin WhatsApp bağlantısı (migration 88) — kullanıcıya bağlı (User korunur); demo hesabında bağlanmaz, bağlandıysa kendi akışıyla kapatılır",
  ChannelListing: "bağlantıya bağlı ilan eşlemesi — bağlantıyla birlikte (demo hesabında yok)",
  ErasureTombstone: "silme koruma kaydı — yeniden içe aktarmayı engeller, kendi kuralıyla",
  StorageDeletion: "depo silme kuyruğu — sıfırlama YAZAR (dosyalar silinsin), silmez",
  EmailOutbox: "e-posta kuyruğu — kullanıcıya bağlı, iç işletim",
  ChatUsage: "QR günlük sayacı (mülk + gün) — süreyle düşer, veri değil",
  SystemLock: "sistem kilidi / işaret — işletmeye ait değil",
  RateLimitCounter: "geçici hız sayacı — işletmeye ait değil",
  Lead: "pazarlama başvurusu — işletmeye bağlı değil",
  Plan: "ürün kataloğu — işletmeye ait değil",
  WebhookEvent: "ödeme sağlayıcısı olay günlüğü — işletmeye bağlı değil",
  TrialIdentity: "deneme kimliği izi — işletme silinse de kalır (kötüye kullanım koruması)",
  SignupNetworkTrace: "kayıt ağı izi — kendi süresiyle (90 gün)",
};

const models = Prisma.dmmf.datamodel.models;
const resetNames = new Set([...SOURCE.matchAll(/tx\.(\w+)\.deleteMany/g)].map((m) => m[1]![0]!.toUpperCase() + m[1]!.slice(1)));
const NOT_DELETED_PARENTS = new Set(["Property", "Organization"]);

/** Açıkça silinen + (silinen tablodan) zincirleme gidenler. Mülk / işletme silinmediği için onların zincirlemesi SAYILMAZ. */
function coveredModels(): Set<string> {
  const covered = new Set([...resetNames].filter((n) => !NOT_DELETED_PARENTS.has(n)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of models) {
      if (covered.has(m.name)) continue;
      const parents = m.fields.filter((f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0 && f.relationOnDelete === "Cascade").map((f) => f.type);
      if (parents.some((p) => covered.has(p) && !NOT_DELETED_PARENTS.has(p))) {
        covered.add(m.name);
        changed = true;
      }
    }
  }
  return covered;
}

describe("demo sıfırlama kapsamı (DMMF)", () => {
  it("anti-vakum: model listesi ve silme çağrıları gerçekten okundu", () => {
    expect(models.length).toBeGreaterThan(40);
    expect([...resetNames]).toEqual(expect.arrayContaining(["Conversation", "HistoryLearnRun", "PropertyInstruction", "AutomatedMessageSend"]));
  });

  it("🚨 her model ya sıfırlanır, ya silinen tablodan zincirleme gider, ya da gerekçesiyle korunur", () => {
    const covered = coveredModels();
    const unclassified = models.map((m) => m.name).filter((n) => !covered.has(n) && !(n in KEPT));
    expect(unclassified).toEqual([]);
  });

  it("korunan liste bayatlamaz: korunan model gerçekten şemada ve sıfırlamada silinmiyor", () => {
    const names = new Set(models.map((m) => m.name));
    const covered = coveredModels();
    expect(Object.keys(KEPT).filter((n) => !names.has(n) || covered.has(n))).toEqual([]);
  });
});
