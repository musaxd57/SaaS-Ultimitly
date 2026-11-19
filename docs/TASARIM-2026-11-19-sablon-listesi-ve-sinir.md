# Tasarım 2026-11-19 — Mesaj şablonları: sunucuda 30'luk liste + başlangıç sınırı 500

> Kaynak: kurucu talimatı 11-19 akşam madde 1 (`docs/KURUCU-TALIMATI-2026-11-19-aksam-ajan-turu-cevabi.md`, AYNEN) · bulgu T2-B8
> (`docs/claude/acik-isler.md` "11-19 (3)": ~10 dk yazımla 3.000 şablon → tek istek 284 MB yığın, 2,8 sn). Şema DEĞİŞMEZ, migration YOK.

## 1. Bugün ne var (envanter, kodla doğrulandı)

**Tablo** `MessageTemplate` (`prisma/schema.prisma`): `id` (cuid) · `organizationId` · `propertyId?` (null = işletme geneli) · `category` ·
`title` (≤300) · `body` (≤20.000) · `language` · `isActive` · `createdAt` · `updatedAt`; tek dizin `organizationId`. Ayırıcı alan (hazır /
özel) YOK — gerek de yok, bkz. "hazır şablon".

**"Hazır Lixus şablonu" ne demek:** `src/lib/templates.ts` `DEFAULT_TEMPLATES` — koddaki 16 sabit (kimlik öneki `default-`,
`isDefault: true`). Veritabanına HİÇ yazılmaz; liste ucu yanıta ekliyordu, yönetim sayfası ayrı katlanır bölümde gösteriyor. "Kendime uyarla"
içeriği forma doldurur, kaydedilince ev sahibinin KENDİ satırı olur (o artık özel şablondur, sayılır). Demo işletmesinin veri kümesi
şablonları (`demo-tenant/apply-core.ts`) tabloya yazılır ama sistem işidir (önce hepsini siler, sabit küçük kümeyi yazar).

| Uç / yüzey | Okur / yazar | Bugün |
|---|---|---|
| `GET /api/templates` (`src/app/api/templates/route.ts`) | okur | işletmenin BÜTÜN etkin şablonları, `take` yok, tam gövde + 16 hazır şablon; `createdAt asc` |
| `POST /api/templates` | yazar | düz `create`, adet sınırı YOK (yalnız kişi başı yazma 300/dk) |
| `PATCH` / `DELETE /api/templates/[id]` | yazar | sürüm ön şartı (H1) var; `GET [id]` YOK |
| `/templates` sayfası (`src/app/(app)/templates/page.tsx`) | okur | BÜTÜN şablonlar (pasifler dahil), tam gövde, `createdAt desc`; `TemplateManager`'a dizi |
| `TemplateManager` (`src/components/templates/template-manager.tsx`) | — | satırdaki tam gövdeyle düzenleme formunu açar; arama / sayfalama yok |
| Şablon seçici (`src/components/inbox/conversation-thread.tsx` `loadTemplates`) | `GET /api/templates?propertyId=` | tam listeyi bir kez çeker, seçilince satırdaki gövdeyi uygular |
| `getTemplatesForProperty` (`src/lib/templates.ts`) | okur | üretimde ÇAĞIRANI YOK (yalnız tanım), tavansız `findMany` |
| `GET /api/kb/suggestions` | okur | etkin şablonlar (KB önerisi, kategori allowlist wifi + rules) — tavansız; bu turun kapsamı DIŞI (§7) |
| hesap dökümü `data-export.ts` | okur | sahibin kendi dökümü — bilinçli tam |
| demo sıfırlama `apply-core.ts` | yazar | sistem işi, kapı dışı (§4) |

Kopyalama / içe aktarma ucu YOK: tek kopyalama yolu "Kendime uyarla" → `POST /api/templates`.

## 2. Yeni liste sözleşmesi (tek sorgu, iki yüzey)

Yeni yaprak modül `src/lib/template-list.ts` (`template-apply.ts` yanında):

- `listTemplatePage(organizationId, { scope, query, page })` → `{ items, total, page, pageSize, hasMore }`.
  - **Sayfa boyu 30** (`TEMPLATE_PAGE_SIZE`); veritabanından en çok 30 satır (`take`). Sayfalama SAYFA NUMARALI (`skip`), sıra
    `createdAt desc, id desc` (kimlik eşitlik bozucu → aynı anda yazılmış satırlar sayfa sınırında kaymaz / tekrarlanmaz).
  - **Seçilen alanlar:** kimlik, başlık, kategori, dil, etkinlik, daire, sürüm + KISA ÖNİZLEME (`preview`: ilk 200 karakter, kesildiyse
    "…"; vekil çift bölünmez). Tam gövde istemciye GİTMEZ. (Sunucu 30 satırın gövdesini okur ve keser — bellek 30 satırla sınırlı. Gövdeyi
    veritabanında kesmek ham SQL ister; §7.)
  - **Arama** (`query`, ≤100 karakter, denetim karakteri silinir) işletmenin BÜTÜN şablonlarında, sunucuda: başlık VEYA gövde, büyük /
    küçük harf duyarsız (Prisma `contains` + `insensitive`, gelen kutusu aramasıyla aynı). `%` `_` `\` elle kaçışlanır (Prisma 6.2.1
    kaçışlamıyor — ölçüldü: `%` araması her satırı buluyordu).
  - `scope: "manage"` (yönetim sayfası): pasifler dahil, bütün daireler, daire adı.
  - `scope: "compose"` (seçici): yalnız etkin; daire verilmişse o dairenin + işletme geneli; `includeDefaults` açıksa hazır şablonlar ÖZEL
    şablonların ARDINDAN aynı sayfalamaya girer (tek sıra: önce özel, sonra hazır; aramaya da girer) — yanıt yine en çok 30 kalem.
- `getTemplateDetail(organizationId, id)` → tam gövde (işletme kapsamı; `default-…` kimliği koddaki sabitten).

Uçlar:
- `GET /api/templates?propertyId=&q=&page=&includeDefaults=` → `listTemplatePage(…, compose)`. **Yanıt biçimi değişir:** dizi yerine
  `{ items, total, page, pageSize, hasMore }` (tek çağıran seçici; birlikte değişir).
- YENİ `GET /api/templates/[id]` (`withManage`) → tam şablon. Seçici seçimde, yönetim sayfası "Düzenle"de çağırır.
- `/templates` sayfası → `listTemplatePage(…, manage)`; adres `?q=…&sayfa=N` (gelen kutusu kalıbı, `clampPage` + aralık dışı sayfada son
  sayfaya yönlendirme), sayfalama çubuğu ortak `Pager`.

Yüzey davranışı:
- **Yönetim:** arama kutusu (GET formu), sayfalama çubuğu (çok sayfada), başlıktaki sayı = işletmenin TOPLAM özel şablonu. "Düzenle" tam
  şablonu `GET [id]` ile alır; formun sürüm ön şartı (H1) bu okumanın `updatedAt`'idir (gövde ile sürüm aynı okumadan — eski "kaydedilen sürüm"
  belleğine gerek kalmaz).
- **Seçici:** ilk açılışta ilk 30; panelin üstünde arama kutusu (yazarken 300 ms sonra sunucuya), "Daha fazla göster" (sonraki sayfa
  eklenir, kimlikle tekilleştirilir), seçimde `GET [id]` → tam gövde → `applyTemplateBody` (tek ikame kaynağı aynen). Sıra yönetim sayfasıyla
  AYNI (yeni → eski); bugün seçici eski → yeni gösteriyordu (görünür değişiklik, §6).

## 3. Sınır: nerede, ne sayılır

- **Değer:** `PlanLimits.messageTemplatesPerOrg` (`src/lib/billing/plan-limits.ts`, "sayılar burada, tek yerde") — üç planda da başlangıç
  değeri `500` (kurucu: "makul bir başlangıç; kalıcı ürün kuralı olarak koda gömmeyelim"); plan başına ayrışabilir. Acil müdahale için
  ortam değişkeni `MESSAGE_TEMPLATE_CAP` (yalnız rakam, ≥1; geçersizse yok sayılır) plandan bağımsız herkese uygulanır — `AI_DAILY_CALL_CAP`
  emsali. Kurucu hesabı / aboneliksiz işletme `limitsForOrg` kuralıyla en geniş plana düşer (bugün aynı sayı).
- **Sayılan:** `MessageTemplate` satırları, işletme başına: pasifler DAHİL (pasife alma biriktirme yolu olmasın); işletme geneli şablon tek
  satırdır → BİR kez sayılır (daire sayısıyla çarpılmaz); hazır Lixus şablonları tabloda olmadığı için sayılmaz.
- **Kilit:** `src/lib/template-cap.ts` `createTemplateWithinCap` — sayım + yazma TEK işlemde, işletme başına danışma kilidi
  (`pg_advisory_xact_lock(52, hashtext(organizationId))`; ekip kişisi sınırının kalıbı, ad alanı 52 — diğerleri 23 · 40–51). Kilit commit'te
  bırakılır → sıradaki istek öncekinin satırını sayar. Test kancası `__templateCapHooks.afterCount` (bilgi tabanı kalıbı).
- **Sınırı aşmış işletme:** hiçbir şey silinmez / gizlenmez; liste, arama, `GET [id]`, düzenleme, pasife alma / etkinleştirme, silme, seçicide
  kullanım sürer. YALNIZ yeni ekleme (`POST`, "Kendime uyarla" dahil) 400 döner ("yalnız büyüme reddedilir").

## 4. Kapsam dışı / bilinçli istisna

- Demo sıfırlaması kapıdan geçmez: sistem işi, önce işletmenin bütün şablonlarını siler, sabit küçük kümeyi yazar.
- Yeni bir yazıcı (kopyalama / içe aktarma) sessizce kapıyı atlamasın diye kaynak pini: `messageTemplate.create / createMany / upsert`
  yalnız `template-cap.ts` ve demo sıfırlamasında; tavansız `messageTemplate.findMany` yalnız bilinen okuyucularda (§1 tablosu).

## 5. Testler

Eşzamanlı veritabanı testi: 499 şablon varken aynı anda 10 ekleme → tam 1 kabul, 9 sınır (400), toplam 500, kilitli bölgede aynı anda tek
istek. Sınırı aşmış işletmede düzenleme / liste / tam okuma / silme çalışır, ekleme 400, satır sayısı değişmez. Liste: en çok 30, önizleme
(tam gövde yanıtta yok — 20.000 karakterlik gövdelerle yanıt boyu pini), ilk 30'un dışındaki şablon aramayla bulunur, eşit `createdAt`'te
sayfalar ayrık ve eksiksiz, kiracı yalıtımı, daire kapsamı, hazır şablonların sırası ve sayımı.

## 6. Müşteriye (ev sahibine) görünen yeni metinler — kurucu onayına

| Yer | Önce | Sonra |
|---|---|---|
| Ekleme sınırı (form hatası) | — (sınır yoktu) | "Özel şablon sınırına ulaştınız (500 şablon). Yeni şablon eklemek için kullanmadığınız bir şablonu silin." |
| Yönetim arama kutusu (gizli etiket / yer tutucu) | — | "Şablonlarda ara" / "Başlıkta veya metinde ara…" (düğme "Ara", temizle "Aramayı temizle" — var olan) |
| Yönetim arama sonucu boş | — | "“…” ile eşleşen şablon bulunamadı." |
| Yönetim sayfalama özeti | — | "640 şablondan 1–30 arası · Sayfa 1 / 22" · tek sayfalık aramada "4 şablon" (gelen kutusu kalıbı) |
| Seçici arama kutusu | — | "Şablonlarda ara…" (gizli etiket "Şablonlarda ara") |
| Seçici "daha fazla" | — | "Daha fazla göster" |
| Seçici arama sonucu boş | — | "Şablon bulunamadı." (var olan cümlenin ilk yarısı) |
| Seçici / Düzenle tam şablon okunamadı | — | "Şablon yüklenemedi. Lütfen tekrar deneyin." (silinmişse sunucunun var olan "Bu kayıt bulunamadı.") |
| Seçici sırası | eski → yeni | yeni → eski (yönetim sayfasıyla aynı) |

## 7. Açık sorular / öneriler

1. Sınıra yaklaşırken (ör. 450+) ekranda önceden uyarı göstermek — yeni metin ister; bu turda yalnız ekleme anında hata.
2. Önizlemeyi veritabanında kesmek (`LEFT(body, 200)`) ham SQL ister; 30 satırla sunucu belleği zaten sınırlı — gerekirse ayrı tur.
3. `GET /api/kb/suggestions` da etkin şablonların hepsini tam gövdeyle okuyor (aynı sınıf; sınır 500 bunu da dolaylı sınırlar ama sınırı
   aşmış eski işletmede sınırsız). Sorguda kategori allowlist'ine (wifi + rules) daraltma + tavan önerilir — ayrı tur.
4. "Daha fazla göster" sayfa numaralı: arada eklenen şablon tekilleştirilir, arada silinen bir şablon yüzünden bir kalem o oturumda
   atlanabilir (yenileyince görünür). İmleçli sayfalama bunu kapatır; bugün gerek görülmedi.
5. `(organizationId, createdAt, id)` bileşik dizini sınır 500 ile gereksiz; sınırı çok aşmış eski işletme ölçülürse migration turu.
