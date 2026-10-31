import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// DEĞİŞMEZ 14 / KVKK DIŞA AKTARMA KAPSAMI — büyüyemez sınıflandırma (10-11 gece). Şemadaki HER model ya işletme dökümünde
// (`src/lib/data-export.ts`, iki dışa aktarma ucu aynı yapıyı kullanır) ya da gerekçesiyle BİLİNÇLİ DIŞARIDA. Yeni bir model
// sınıflandırılmadan eklenemez (sessizce dökümün dışında kalan misafir / ev sahibi verisi olmasın). Davranış DEĞİŞMEZ — yalnız envanter.
// "Karar bekliyor" satırları kurucu karar listesinde (dışa aktarmaya eklemek kapsam kararıdır). AutomationRule + DecisionRequest kurucu
// kararıyla (10-11) dışarıda: "KVKK bu iki bilgiyle ne yapacak" — kişisel veri taşımıyor, misafir yazışması zaten dökümde.
// ---------------------------------------------------------------------------

/** Dökümde olan modeller → kaynakta onu taşıyan iğne (ilişki alanı ya da sorgu). */
const EXPORTED: Record<string, string> = {
  Organization: "prisma.organization.findUnique",
  User: "users: {",
  Property: "properties: {",
  CalendarSource: "calendarSources: {",
  SupplyRequest: "supplyRequests: {",
  Reservation: "reservations: {",
  Conversation: "conversations: {",
  Message: "messages: {",
  Task: "tasks: {",
  TaskUpdate: "updates: {",
  KnowledgeBaseItem: "knowledgeBase: {",
  MessageTemplate: "messageTemplates: {",
  Subscription: "prisma.subscription.findUnique",
  Invoice: "prisma.invoice.findMany",
  AuditLog: "prisma.auditLog.findMany",
  CheckoutConsent: "prisma.checkoutConsent.findMany",
  RiskEvent: "prisma.riskEvent.findMany",
  MessageOutbox: "prisma.messageOutbox.findMany",
  PropertyMemory: "prisma.propertyMemory.findMany", // yalnız ev sahibinin girdiği (source human); türetilmiş hafıza kaynağından gelir
  GuestCommitment: "prisma.guestCommitment.findMany",
  PropertyInstruction: "prisma.propertyInstruction.findMany", // ev sahibinin yazdığı talimat (migration 65)
  HistoryLearnComparison: "prisma.historyLearnComparison.findMany", // ev sahibinin karşılaştırma notu (migration 65)
  AutoMessageTemplate: "prisma.autoMessageTemplate.findMany", // ev sahibinin otomatik mesaj metni (kurucu T4, migration 80)
};

/** Bilinçli dışarıda — gerekçe. "⚠️ KARAR" = kurucu / avukat kararı bekliyor. */
const EXCLUDED: Record<string, string> = {
  VerifiedAnswer: "doğrulanmış cevap tekrarının GÖLGE kaydı (migration 85) — misafir metni / kimliği yok: bilgi tabanından doğrulanmış cevap + süzülmüş Türkçe arama sorgusu; 30 günde geçersiz, 90 gün dokunulmazsa silinir",
  CheckoutIntent: "ödeme ekranı durumu — iç işletim; delil CheckoutConsent ve sonuç Invoice dökümde; takma adlı Paddle işlem kimliği, kapanıştan 90 gün sonra silinir (Codex 10-21, migration 82)",
  KbChunkVector: "bilgi tabanı parçalarının anlam vektörleri (migration 87) — türetilmiş önbellek, METİN YOK; kaynağı (bilgi tabanı kalemi) dökümde; kalem silinince cascade ile gider",
  KbCopyOperation: "kopyalama tekrar güvenliği iç kaydı (kaynak kimliği + istek kimliği + içerik izi) — içerik yok; 30 gün sonra saatlik süpürgeyle silinir (Codex 10-21, migration 81)",
  SystemLock: "Sistem kilidi / işaret satırı — işletme verisi değil",
  RateLimitCounter: "Geçici hız sınırı sayacı",
  Lead: "Pazarlama başvurusu (operatör CRM) — işletme hesabına bağlı değil",
  PasswordResetChallenge: "Güvenlik sırrı (hash) — sırlar dökümde YOK",
  TwoFactorRecoveryCode: "Güvenlik sırrı (hash) — sırlar dökümde YOK",
  ChatUsage: "QR kullanım sayacı — ölçüm, kişisel veri değil",
  AutomationRule: "İşletme ayarı (erken giriş / ev kuralları) — kişisel veri değil; kurucu kararı 10-11: dışa aktarılmaz",
  Plan: "Ürün kataloğu (plan tanımları) — işletmeye ait değil",
  WebhookEvent: "Ödeme sağlayıcısı olay günlüğü (tekilleştirme) — iç işletim",
  ShadowVerdict: "Gölge model ölçümü — iç kalite kaydı",
  AutomatedMessageSend: "Otomatik mesaj tekilleştirme kaydı — iç işletim (gönderilen metin Message'da)",
  ChannelConnection: "Kanal bağlantısı — şifreli kimlik bilgisi taşır; sırlar dökümde YOK",
  IngestEvent: "İç olay günlüğü (türetilmiş, kaynak satırlar dökümde)",
  Signal: "Mesajdan türetilmiş gözlem — kaynağı (mesaj) dökümde",
  ConversationItem: "Mesajdan türetilmiş istek kalemi — kaynağı (mesaj) dökümde",
  DecisionRequest: "Misafir talebine bağlı ev sahibi kararı — misafirle yazışmanın kendisi (mesajlar) dökümde; kurucu kararı 10-11: dışa aktarılmaz",
  StorageDeletion: "Depo silme kuyruğu — iç işletim",
  ErasureTombstone: "Silme koruma kaydı (ham kişisel veri yok; anahtarı bizde HMAC özeti = takma adlı veri, Codex C6) — iç işletim",
  EmailOutbox: "E-posta gönderim kuyruğu — iç işletim",
  ChannelListing: "Bağlantı-ilan kimlik eşlemesi — iç teknik",
  AiGeneration: "⚠️ KARAR 25 (avukat): yapay zekâ üretim izi — eğitim / dışa aktarma yasağı tasarımı",
  AiReviewLabel: "⚠️ KARAR 25: kurucunun kalite etiket notu",
  TrialIdentity: "Deneme kötüye kullanımı parmak izi (HMAC) — iç güvenlik",
  SignupNetworkTrace:
    "K1 (10-17) kayıt ağı izi — HMAC özeti, ham IP yok; deneme kötüye kullanımı incelemesi, süre dolunca silinir; takma adlı kişisel veri, iç güvenlik",
  HistoryLearnRun: "Geçmişten öğren çalıştırma kaydı (durum / sayaç / maliyet) — iç işletim, metin yok",
  HistoryLearnDraft:
    "Modelin önerdiği taslak — türetilmiş; kaynağı (mesajlar) dökümde, onaylanan taslak bilgi tabanı kalemi olarak dökümde",
  OperationalEvent:
    "⚠️ KARAR (avukat paketi, tasarım §5): takip numarası olay günlüğü — iç teşhis; DOĞRUDAN kişisel veri taşımaz (kapalı olay adı + anahtar başına kalıplı kimlik / kod / sayı); Paddle abonelik / işlem kimliği yalnız işletmeye bağlı satırda (işletme silinince satırla gider), 90 gün",
  HostChannelBinding:
    "Ev sahibinin bildirim adresi (migration 88) — numara yalnız şifreli + HMAC anahtarı, doğrulama özetleri; kimlik bilgisi niteliğinde (bağlantı ayarlardan görülür / kapatılır), dökümde düz numara olmaz",
  HostQuestion:
    "Ev sahibine giden soru kuyruğu (migration 88) — geçici iş satırı (metinler şifreli, 7 günde boşalır, 90 günde silinir; misafire giden cevabı işaretleyen satır metinsiz kalır, konuşmayla gider); misafir yazışmasının kendisi (mesajlar) dökümde",
};

const EXPORT_SRC = readFileSync("src/lib/data-export.ts", "utf8");
const MODELS = Prisma.dmmf.datamodel.models.map((m) => m.name).sort();
const delegate = (model: string) => `prisma.${model[0].toLowerCase()}${model.slice(1)}.`;

describe("dışa aktarma kapsamı — her model sınıflandırılmış", () => {
  it("ANTİ-VAKUM: şema modelleri okunuyor", () => {
    expect(MODELS.length).toBeGreaterThanOrEqual(40);
    expect(MODELS).toContain("Reservation");
  });

  it("🚨 her model YA dökümde YA gerekçeli dışarıda (yeni model sınıflandırılmadan eklenemez); ikisinde birden değil", () => {
    const unclassified = MODELS.filter((m) => !(m in EXPORTED) && !(m in EXCLUDED));
    const both = MODELS.filter((m) => m in EXPORTED && m in EXCLUDED);
    expect(unclassified, "yeni model: dışa aktarma kapsamına alın ya da gerekçeyle EXCLUDED'a ekleyin").toEqual([]);
    expect(both).toEqual([]);
  });

  it("🚨 'dökümde' denen her model dışa aktarma kaynağında gerçekten var", () => {
    const missing = Object.entries(EXPORTED).filter(([, needle]) => !EXPORT_SRC.includes(needle)).map(([m]) => m);
    expect(missing).toEqual([]);
  });

  it("'dışarıda' denen model dökümde doğrudan sorgulanmıyor (sınıflandırma bayatlamadı)", () => {
    const leaked = Object.keys(EXCLUDED).filter((m) => EXPORT_SRC.includes(delegate(m)));
    expect(leaked).toEqual([]);
  });

  it("bayat sınıflandırma yok: listelerdeki her model şemada var", () => {
    for (const m of [...Object.keys(EXPORTED), ...Object.keys(EXCLUDED)]) expect(MODELS, m).toContain(m);
  });
});
