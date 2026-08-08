# Tasarım — "Sorunlu konuşmalar" triyajı (m48)

> Durum: **KOD HAZIR, MIGRATION UYGULANMADI.** Codex incelemesi bekleniyor.
> Yazan: Claude · 2026-08-08 · Kullanıcı talebi: "sen yol planını kodunu dahi
> hazırla, gece açılıyor Codex, ona kontrol ettireceğim, migration'ı ona göre yaparız".

---

## 1. Kapatılan boşluk — tek cümle

Model, escalate ettiği **her** konuşma için `actionSuggestion` (ne yapılmalı) ve
`missingInfo` (misafirden ne lazım) üretiyor; ikisi de **hiçbir yere yazılmıyor** ve
istek bitince yok oluyor. Bunlar `AiReplyResult` tipinde tanımlı
(`src/lib/ai/types.ts:84,98`) ama `automation.ts`'te ve `schema.prisma`'da **sıfır**
geçiş var (grep ile doğrulandı).

Yani: ev sahibine "3 sorunlu konuşma var" diyoruz, oysa model o üçü için
**bilgi tabanını, mülkü ve rezervasyonu görerek** ne yapılması gerektiğini zaten
yazmıştı. Onu attık.

🚨 **Bu, planı tersine çeviren bulgudur.** İlk niyet "ikinci bir model çağrısıyla
sorunları analiz ettirelim"di. Ama ikinci çağrı, KIRPILMIŞ metinden, KB'siz,
rezervasyonsuz çalışır — yani **birincisinden daha kötü** bir analiz üretir, üstelik
kota harcayarak. Doğru hamle yeni bir çağrı değil, **zaten ödediğimizi saklamak**.

---

## 2. Şema değişikliği (m48) — SAF ADDITIVE

`Conversation` modeline üç nullable kolon:

```prisma
model Conversation {
  // … mevcut alanlar …

  /// Modelin escalate ederken yazdığı "ne yapılmalı" önerisi (host'a gösterilir).
  /// NULL = model bu konuşmaya hiç bakmadı (kelime-eşleşme yolu) ya da eski satır.
  aiActionSuggestion String?
  /// Modelin "misafirden şunlar eksik" listesi. JSON string dizisi.
  aiMissingInfoJson  String?
  /// Modelin kendi güveni (0..1). Kelime-eşleşme yolunda NULL.
  aiConfidence       Float?
}
```

**Neden güvenli:**
- Üç kolon da **nullable**, varsayılansız → dolu tabloya ALTER güvenli
  (CLAUDE.md kuralı: "Dolu tabloya ASLA `@unique`/required-no-default/drop ekleme").
- Hiçbir mevcut sorgu bu kolonları okumuyor → eski satırlar NULL kalır ve
  arayüz onları "AI doğrulaması yok" diye işaretler (↓§5).
- Geri alma: kolonları okumayı bırakmak yeterli; DROP gerekmez.

**Migration SQL** (`prisma/migrations/48_conversation_ai_triage/migration.sql`):

```sql
ALTER TABLE "Conversation" ADD COLUMN "aiActionSuggestion" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "aiMissingInfoJson" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "aiConfidence" DOUBLE PRECISION;
```

⚠️ CLAUDE.md'nin migration kuralı: elle yazma, `prisma migrate diff` ile üret ve
taze bir throwaway Postgres'te sıfır-drift doğrula. Yukarıdaki SQL **beklenen
çıktıdır**, üretilmiş değil.

**Index GEREKMİYOR:** bu kolonlar hiçbir `where`/`orderBy`'da kullanılmıyor,
yalnız zaten seçilmiş satırlarda okunuyor.

---

## 3. Yazma noktaları — TAM İKİ TANE

### (a) Model yolu — `automation.ts:1535`

```ts
const claimed = await prisma.conversation.updateMany({
  where: { id: conversation.id, status: { not: "problem" } },
  data: {
    status: "problem",
    priority: "urgent",
    skippedReason: "escalated_to_human",
    lastRiskLevel: result.riskLevel,
    lastRiskType: result.riskType ?? detectRiskType(last.body),
    // ↓ YENİ — modelin zaten ürettiği analiz. Kırpma `ai/index.ts:252` emsali.
    aiActionSuggestion: result.actionSuggestion?.slice(0, 300) ?? null,
    aiMissingInfoJson: result.missingInfo?.length
      ? JSON.stringify(result.missingInfo.slice(0, 5).map((s) => s.slice(0, 120)))
      : null,
    aiConfidence: typeof result.confidence === "number" ? result.confidence : null,
  },
});
```

### (b) Kelime-eşleşme yolu — `automation.ts:3277`

**Bu dalda model HİÇ koşmadı.** Uydurma değer yazılmaz — üç kolon da NULL kalır.
Kodun kendi yorumu bunu zaten söylüyor ("keyword path deliberately never
fabricates a verdict"). `aiConfidence IS NULL` böylece **bedava bir sinyal** olur:
"bu satıra AI hiç bakmadı".

---

## 4. Okuma yüzeyi — `/inbox?status=problem` sayfasının ÜSTÜ

**Neden panel değil:** ev sahibi sorunu okuyup **cevap yazacak**; cevap gelen
kutusunda yazılıyor. Paneldeki bir panelde analizi okuyup sonra başka sayfaya
gitmek zorunda kalır.

**Neden yeni bir menü sayfası değil:** kenar çubuğunda 14 satır var ve toplam
803 CSS px, bütçe 808.4 (`app-shell.tsx` yorumunda ölçülü). 15. satır 768px'te
kaydırma çubuğu doğurur — `mt-4` kararının önlediği şeyin ta kendisi.

**Neden `/reports` değil:** oradaki "AI Risk Görünümü" kartı **30 günlük geçmiş**
(`RiskEvent` sayımları). "Şu an açık olan" kavramı yok; yan yana koymak tam da
kaçınmak istediğimiz tekrarı üretir.

Render (model çağrısı YOK):

```
Açık sorunlar — triyaj                                    [3 konuşma]

  Temizlik/hijyen · 2 konuşma
    Nuve 3 · 4 saattir bekliyor
      Ne oldu       Misafir banyoda temizlik sorunu bildirdi.
      Önerilen adım Ekibi bugün yönlendirin, fotoğraf isteyin.
      Eksik bilgi   Fotoğraf · hangi oda
    Nuve 7 · 2 saattir bekliyor
      …

  Platform dışı ödeme · 1 konuşma
    Nuve 5 · 1 gündür bekliyor   ⚠ Yalnız kelime eşleşmesi — AI doğrulaması yok
```

Gruplama `lastRiskType` (11'lik kapalı set, etiketler `ui-labels.ts`), sıralama
`lastMessageAt` (en uzun bekleyen üstte).

---

## 5. Yanlış-pozitif işareti — bu özelliğin ÖN KOŞULU DEĞİL, ÇÖZÜMÜNÜN PARÇASI

Ölçülmüş gerçek vaka: `"Can you send location link. Its not working"` →
`intent=complaint`, çünkü `"not working"` `fallback.ts:90`'da düz bir kelime.
Bu yol `sendDueAlerts`'te **hiç model çapraz-kontrolü olmadan** escalate ediyor
ve ev sahibine "⚠️ Acil misafir mesajı" maili atıyor.

`aiConfidence IS NULL` bunu **bedavaya** görünür kılar:

- O satırlar `⚠ Yalnız kelime eşleşmesi — AI doğrulaması yok` rozetiyle çizilir.
- Yanına çıkış yolu konur: `Bu bir şikayet değil — sorunlu işaretini kaldır`.
- İleride bir model çağrısı eklenirse bu satırlar **çağrıdan hariç tutulur** →
  hem gürültü hem maliyet düşer.

🚨 Kelime listesini DARALTMAK ayrı ve tehlikeli bir turdur (CLAUDE.md: bu depoda
bir sır dedektörünü genişletip 12 meşru kalemin 6'sını elemiştim). Golden set
zorunlu. **Bu tasarım o tura bağımlı değildir.**

---

## 6. Opsiyonel ikinci aşama — model çağrısı (ŞİMDİ YAPILMIYOR)

Tek meşru gerekçe **konuşmalar arası sentez**: "Nuve 3'te üç ayrı şikayetin ortak
sebebi kombi olabilir." Gruplama bunu yapamaz.

Kurulursa: `withManage` → `premiumAllowed` → `rateLimit("problem-triage:{org}", 10/saat)
→ **sıfır-sorun erken dönüş** → *sonra* `consumeDailyAiBudget` (repo kuralı: bütçe
doğrulamadan SONRA tüketilir). Tek çağrı, N konuşma. Gönderilen: sıra numarası
(cuid ASLA), mülk **adı**, `riskType`, yaş, ve **misafir adı redakte edilmiş** gövde.
`guestIdentifier` (ad/telefon/e-posta) hiç çıkmaz.

---

## 7. Uygulama sırası

1. `schema.prisma` + `migrate diff` ile m48 üret, taze PG'de sıfır-drift doğrula
2. `automation.ts:1535` yazma satırları (üç alan)
3. `/inbox` üstü triyaj bileşeni (deterministik, model YOK)
4. Testler: escalate edilince üç alan dolu · kelime yolunda üç alan NULL ·
   gruplama sırası · NULL güven rozeti · mutasyon (alanları yazmayı kaldır → kırmızı)
5. Deploy → Railway `migrate deploy` otomatik koşar

**Geri alma:** okuma yüzeyini kaldır. Kolonlar NULL kalır, kimse okumaz, DROP gerekmez.

---

## 8. Bu turda BULUNAN AMA AYRI OLAN — panelde iki farklı "Acil"

Kullanıcı "acile aldım gene de acil olmuyor" dedi. Sebep ölçüldü:

- Konuşma sayfasındaki **Öncelik: Acil** → `Conversation.priority`, yalnız gelen
  kutusu listesinde bir rozet çiziyor (`inbox/page.tsx:341`). Başka hiçbir yeri
  beslemiyor.
- Paneldeki **"Acil Görevler"** kutucuğu → `Task` sayıyor (`reports.ts:96`),
  konuşmaları DEĞİL.

Yani aynı kelime iki ayrı şeyi anlatıyor ve host haklı olarak birinin diğerini
etkilemesini bekliyor. Çözüm ürün kararı: ya kutucuk konuşmaları da saysın, ya
konuşma önceliği kaldırılsın, ya da etiketler ayrıştırılsın ("Acil görev" /
"Öncelikli konuşma"). **Karar verilmedi.**
