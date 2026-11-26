# Büyük rapor — 10-22 akşam → 10-23 gece

> Kurucu: "loopu durdurabilirsin … sonda büyük raporu ver herşey bitince". Bu rapor 10-22 akşamdan bu yana yapılan her şeyi, nedenini,
> ölçümünü ve hangi dosyada olduğunu sade dille anlatır. Önceki ayrıntılı rapor: `docs/RAPOR-2026-10-22-yapay-zeka-ne-ogrendi.md` (§8 bu
> turun ölçümleri).

## 1. Kısaca

| ne | önce | şimdi |
|---|---|---|
| Misafire giden cevapta "bilgi tabanımda / kayıtlarımda / according to my records" gibi kaynak anlatımı (16 senaryo, gerçek model) | **4** | **0** |
| Taslakta mülkün İÇ adı / iç kodu ("Lale – arka cephe", "L5") | 2 | **0** — iç ad yapay zekâya hiç gitmiyor |
| "Dairenin adı ne? Kuryeye söyleyeceğim." | tutuluyordu (iç ad yazılmıştı) | "**Kat 3 Daire 12**'de konaklıyorsunuz." |
| Gelen kutusu şablonu `{{propertyName}}` | iç ad ("Daire 5 / arka cephe") | misafire görünen ad (boşsa boş) |
| "Çıkış saat kaçta, sauna var mı?" (Soru 1, anahtar açıkken) | hiçbir şey gitmiyordu | "Çıkış saati 11:00." gider; sauna sizde açık iş |
| Tek tıkla gönderilen taslakta kaynak cümlesi | uyarısız | turuncu uyarı: "o cümleyi çıkarın" |
| CLAUDE.md | 64 KB, her turda hepsi okunuyordu | 44 KB; konu dosyaları "gerektiğinde oku" |

Misafire giden metni değiştiren yeni kuralların hepsi **anahtarlı ya da kurucu kararıyla**; Railway kapalı olduğu için canlıda hiçbir şey
değişmedi.

## 2. Kararlarınız → ne yaptım, neden, hangi dosya

### 2.1 "Bilgi tabanıyla ilgili … hiçbir şey müşteriye gitmemeli"
- **Kök neden:** istemin kendisi "kayıtlarımda şu yazıyor" diye örnek veriyordu. Silindi; yerine "KAYNAK ANLATMA YASAĞI" + yanlış / doğru örnek.
  Misafir kaynağı SORSA bile o kısım cevaplanmaz (`ai/prompts.ts`).
- **Anlamla okuma:** kıdemli okuyucuya beşinci soru ("taslak bilginin nereden geldiğini anlatıyor mu?"). Evetse aynı cevap kaynak anılmadan
  **bir kez** yeniden yazılır, yeniden okunur; yine anlatıyorsa taslak sizde kalır, **e-posta yok** (`ai/semantic/absence-judge.ts`,
  `senior-rewrite.ts`; anahtar `AI_SENIOR_READER_ENABLED`).
- **Kodun yedeği (anahtarsız, 7 dil):** okuyucu kapalıyken de tutar (`ai/absence.ts` `namesInternalSource`). İki inceleme turunda daraltıldı:
  dairedeki kâğıt ("notes on the fridge", "mutfaktaki bilgilendirme notu"), uygulamaya yönlendirme ("… in the Airbnb app"), misafirin kendi
  verisi ("We only use your details …") **tutulmaz**; "As per our records", "Sistemde … görünüyor", "Kayıtlı bilgilere göre", Rusça / İspanyolca /
  Almanca / Arapça aileleri **tutulur**.
- **Ev sahibi taslağı:** "AI öner" ya da hazır taslak kaynak cümlesi taşıyorsa panelde turuncu uyarı (`ai-suggest/route.ts`,
  `conversation-items/prepared-draft.ts`, `components/inbox/conversation-thread.tsx`).

### 2.2 "Müşteriye daire adı ne … kat 2 daire 3 gibidir"
- **U4 ana dalda (migration 83):** Mülk Ayarları → "Misafire görünen ad" (örnek "Kat 2 Daire 3"); QR başlığı "Kat 2 Daire 3 · Misafir Asistanı".
- **İç ad yapay zekâya hiç gitmez:** istemde yalnız misafire görünen ad (boşsa ad satırı yok, iç ada geri düşmez). Model "property:name" diye
  kaynak gösterirse yalnız görünen ad gönderildiyse kabul edilir (`ai/index.ts`).
- **Gelen kutusu şablonları** iç adı artık yazmıyor; `{daire}` numarası yine iç addan okunuyor ama iç ad şablona yazılamıyor
  (`template-apply.ts`, `inbox/[id]/page.tsx`).
- Misafirin KENDİ dairesini sorması ("hangi dairedeyiz, adı ne?") artık "başka kişinin bilgisi" sayılıp tutulmuyor (`ai/semantic/understand.ts`).

### 2.3 Soru 1 ("önerin çok mantıklı")
- "Bilgim yok" cümlesinin hangi soruya ait olduğu artık **misafirin kendi soru sözcükleriyle** bulunuyor (sabit konu sözlüğünde "sauna" yoktu)
  (`conversation-items/topic-absence.ts` `needTerms`; anahtar `AI_TOPIC_ABSENCE_ENABLED`, açılışta sizinle).
- İki ayrı eşleştirme (Haiku incelemesinden sonra): cevabın **gönderilmesine izin veren** kararlarda **sıkı** (yalnız çekim eki: "sauna" ~
  "saunada" ✓, "check" ~ "checkout" ✗, "kapı" ~ "kapıcı" ✗); **tutma** yönündeki kararlarda **gevşek** (fazla eşleşme daha çok tutar).

## 3. Ölçümler (gerçek model gpt-5.1, ürünün kendi akışı, 16 senaryo — misafire hiçbir şey gitmedi)

| koşu | kaynak anlatımı GİDEN | iç ad | "daire adı" sorusu | yeniden yazma |
|---|---|---|---|---|
| eski kod | 4 | 2 | iç ad (tutuldu) | — |
| yeni, anahtarlar açık | **0** | 0 | "Kat 3 Daire 12" ✓ | 4 kez; 1'i temiz gitti, kaynağı açıkça soran 3'ü tutuldu (e-posta 0) |
| yeni, anahtarlar kapalı | 1 → kalıp eklendi | 0 | ✓ | — |
| sertleştirilmiş notla | **0** | 0 | ✓ | Almanca kaynak sorusu temiz gitti |

Eski / yeni örnek (misafire giden): "**Kayıtlarımda** havluların 3 günde bir … görünüyor." → "Havlular 3 günde bir ücretsiz olarak
değiştiriliyor." · "Checkout time is 11:00 **according to my records**." → "Checkout time is 11:00."

Dosyalar: `docs/olcum/live-pipeline-2026-10-22-gpt-5.1-internal-source-2026-10-22-is1022*.md`.

## 4. İncelemeler — kim ne buldu, ne yapıldı

| inceleme | buldu | yapılan |
|---|---|---|
| Haiku (iç kaynak listesi) | yanlış alarm: "notes on the fridge", "data plate", "We only use your details"; kaçan: "Notlarıma baktım", "My information says"… | daraltıldı + eklendi, testli |
| Opus (bu akşamın tamamı, derin) | P1 yok. P2: şablonda iç ad; yedek listede kaçanlar. P3: QR'da kapı sırası, erken giriş akışını engelleme, tek tıkla taslak uyarısı, "property:name" kaynağı | hepsi düzeltildi, her biri önce kırmızı sonra yeşil testle |
| Haiku (Soru 1 kodu) | "check" ~ "checkout", "kapı" ~ "kapıcı" yanlış eşleşmesi; "gibt" gibi işlev sözcükleri; çekim / yumuşama | sıkı / gevşek eşleştirme + genel sözcükler, testli |
| 4 Haiku envanteri (Codex maddeleri için) | §5'teki eksik listesi | tasarım belgesine işlendi |

## 5. Uzun vadeli yön — "İhtiyaç Defteri" (`docs/TASARIM-2026-10-23-ihtiyac-defteri.md`)
Bugün bir mesaj tek metin olarak üretilip bütün hâlinde kontrol ediliyor. Hedef: misafirin **her ihtiyacı** kendi kimliği, kendi dayanağı
(bilgi tabanı kalemi + sürümü), kendi cevap parçası ve kendi durumu olan bir satır olsun; misafire yalnız **doğrulanmış parçalar** gitsin;
cevaplanamayan ihtiyaç sizde açık kalsın ve "en çok sorulan ama bilgi tabanında olmayan" listesini beslesin. Ek model çağrısı gerektirmiyor.

Kodda ölçülen eksikler: aynı türden iki istek tek öğeye birleşiyor · arama kanıtı soru başına tutulmuyor · cevaptaki saat / tutar konuya
bağlanmıyor ("Havuz 22:00" ← 22:00 saunanın) · QR'da öğe sistemi yok · ev sahibinin ilgisiz mesajı açık işi kapatıyor · kalıcı kuyrukta cevap
teslim edilmeden "cevaplandı" sayılıyor.

**Sizden karar bekleyenler (belge §6, önce / sonra örnekli):**
- **A.** Cevap soru soru kurulsun mu (yalnız doğrulanan parçalar gider)?
- **B.** Ev sahibinin konuyla ilgisiz mesajı ("Hoş geldiniz") açık işi kapatmasın mı?
- **C.** İhtiyaç başına kısa konu etiketi ("sauna") saklansın mı (24 ay + silme kapsamı)?
- **D.** Migration 84 (aynı türden ikinci istek ayrı satır) — dolu tabloda güvenli.
- **E.** İki kollu ücretli ölçüm (~$3–5).

## 6. CLAUDE.md
Kurucu: "her tur okumak yerine gerektiğinde oku". Railway durumu, fiyat + özellikler, Hospitable, çalışma ortamı ve eski durum satırları
`docs/claude/` altına **aynen** taşındı (her satır betikle doğrulandı); CLAUDE.md'de kısa özet + "gerektiğinde oku" satırı. Hospitable dosyası
güncel: OAuth uygulaması Partner Portal'da PRODUCTION onaylı; webhook'lar açılabilir ama kullanılmıyor (kurmak yeni bir sistem — önce sorarım);
amaç Hospitable'dan ayrılmak.

## 7. Test / push / CI
- **1. paket** (U4 + iç kaynak + daire adı + 4 ölçüm): tam kapı yeşil → push `b571727f` → **CI #1617 yeşil**.
- **2. paket** (Opus düzeltmeleri + CLAUDE.md + Soru 1 + Haiku düzeltmeleri + taslak uyarısı): ilk kapıda 2 kırmızı (benim eklediğim yeni alanı
  tanımayan iki eski test — güncellendi) → son sürümde tam kapı **yeşil** (572 + 448 + 64 dosya, 18.458 test; build yeşil) → push `7cec46dc` →
  CI #1619 (sonucu ↓).
- Her yeni kural önce KIRMIZI (eski kodda düşen) sonra YEŞİL testle eklendi; sauna örneği ürünün gerçek akışından da (veritabanlı entegrasyon
  testi) geçirildi.

## 8. Bilinen sınırlar (dürüst)
- Misafir kaynağı AÇIKÇA sorunca ("bunu nereden biliyorsun?") model ikinci yazışta da kaynaktan söz edebiliyor → tutuluyor, e-posta yok.
- Taslak kaynak cümlesi yüzünden ÖNCE başka bir kontrole (ör. "aktarıyorum" → söz vetosu) takılırsa yeniden yazma koşmaz (bilerek; tutulur).
- Kodun yedek listesi tam değildir — asıl karar okuyucunun (anlamla); okuyucu açılınca kapsam genişler.

## 9. Railway açılınca (sırayla, ilk denemeler birlikte)
`AI_NO_APOLOGY_RULE_ENABLED` → `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED` → `AI_SENIOR_READER_ENABLED` → `AI_TOPIC_ABSENCE_ENABLED`.
Migration 83 (U4) yayından önce taze veritabanı yedeği. Ardından Mülk Ayarları'nda her daireye "Misafire görünen ad".
