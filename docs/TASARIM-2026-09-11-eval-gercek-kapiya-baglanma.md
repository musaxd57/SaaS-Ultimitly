# Eval sözleşmesi: VEKİLDEN GERÇEK KAPIYA (09-11)

> Durum: TASARIM + uygulama bu turda. Migration YOK, ücretli servis YOK, ürün
> davranışı DEĞİŞMEZ — değişen yalnız evalin NEYİ ölçtüğü.
>
> ⚠️ Bu belge 09-11 inceleme turunda DÜZELTİLDİ: ilk hâli beş olgusal hata ve bir
> yönetişim eksiği taşıyordu. Düzeltilenler §8'de tek tek yazılı — sessiz revizyon yok.

## 0. 🚨 CODEX BU TAŞIMAYI REDDETMİŞTİ — kaydı ve karşı gerekçem

`docs/EVAL-BULGULARI-2026-09-09-kok-neden-ve-duzeltme-plani.md:196-201` şunu yazıyor:

> **Ö1 — ~~Kapıyı taşı~~ → GERÇEK ROTAYI KULLAN. ✅ YAPILDI.** İlk taslağımda
> `evaluateEscalation`'ı `lib/guest-chat-gate.ts`'e taşımayı önermiştim. **Codex
> reddetti ve haklı:** gönderim/güvenlik kodunun taşınması bile otomatik yetkinin
> dışında, ayrı onayda kalmalı. … Ürün kodunda **tek satır değişmedi**.

Bu tur o kararı BOZUYOR. Codex protokolü ("daha iyisini biliyorsan gerekçeyle
reddet; son karar karşılıklı") gereği gerekçeyi açık yazıyorum — **son söz kurucunun**:

1. **Bu bir POLİTİKA değişikliği değil, YER değişikliği.** Taşıma satır satır
   karşılaştırıldı: dal sırası, eşikler (0.45 / 0.75), `??` varsayılanları, erken
   dönüşler, regex'ler ve yorumlar AYNI; tek fark `export` anahtar kelimesi.
   Gönderim davranışı DEĞİŞMEDİ.
2. **Codex'in önerdiği alternatif bu boşluğu kapatmıyor.** `qr-draft-vs-delivered`
   gerçek rotayı çağırır ama modeli MOCK'lar ve DB ister; eval ise GERÇEK modeli
   çağırır ve DB'siz koşar. Yani rota yolu eval'de kullanılamaz — kapı taşınmazsa
   eval, kapının ON İKİ dalından BİRİNİ vekil olarak ölçmeye devam ederdi. Kurucunun
   09-11 gerçek koşusundaki dokuz kırmızının sekizi tam bu vekilden geldi.
3. **Rotadan DEĞER export etmek `next build`i kırar** (Next App Router üretilmiş
   tipleri yeni değer export'unu `never` kısıtıyla reddeder; depoda emsali yok), yani
   "olduğu yerde bırak ama dışa aç" seçeneği YOK.
4. **Emsal var:** kanal tarafının aynı görevdeki kapısı `passesAutoReplySafetyGate`
   zaten `automation.ts`te, rotanın dışında yaşıyor.

⚠️ Codex'in itirazının GEÇERLİ kalan kısmı: güvenlik kodunun dosyası değişti ve bu
kurucunun görmesi gereken bir şey. Bu yüzden burada, commit mesajında ve kurucuya
giden özette AÇIKÇA yazılı. Kurucu "geri al" derse taşıma tek commit'le geri alınır
ve eval yine vekile döner (borç açık kalır).

## 1. Kapatılan borç (benim hatam)

09-11'de `83630c4` ile KURAL-5'in **kalıp cümlesi** istemden kaldırıldı: model artık
temellendiremediğinde "bilgim yok" yazmıyor, kısa ve somut iddia içermeyen bir cümle
kurup `confidence`ı 0.4'ün altına yazıyor.

Ama iki eval **hâlâ o kalıp cümleyi bekliyordu**. Kurucunun gerçek koşusundaki
**9 kırmızının 8'i** bundan geldi (9.'su E4, ilgisiz: `future_commitment`).
🚨 Eşleştirilmiş tarafta bu 8'in 7'si **SATIR**, 6 SENARYO'dur — R6 hem legacy hem
hibrit modda kırmızıydı.

🚨 **Mekanizma, daha önce yazdığımdan farklı.** `notDeliverable` alanı 09-11'de
`acknowledgesAbsence`ten yeniden ADLANDIRILDI ama **karşılaştırma değişmedi**. Eski
kodun ÖZETİ (birebir alıntı DEĞİL — gerçek blokta bir de "RAKAM" bacağı vardı):

```ts
if (e.notDeliverable) {
  if (!acknowledgesAbsence(r.reply ?? "")) fails.push(…);
  if (/\d/.test(r.reply ?? "")) fails.push("kaynaksız cevapta RAKAM var");
}
```

Yani "gönderilmedi" değil, **kapının TEK BACAĞI** (`admitsMissingKnowledge`) ölçülüyordu.
Adı niyeti anlatıyordu, kodu tek bir dalı sınıyordu.

## 2. Ölçülen sonuç: ürün DOĞRU davrandı, eval yanlış ölçtü

E1'in gerçek cevabı `confidence 0.3` ile geldi. Ürünün eşikleri:

| Yüzey | Eşik | Sonuç |
|---|---|---|
| Kanal (`automation.ts`) | `AUTO_REPLY_MIN_CONFIDENCE = 0.75` | **gönderilmez** |
| QR (`chat/[token]`) | `< 0.75 → low_confidence` | **devir** |

Sözleşmenin NİYETİ (bu cevap misafire gitmesin) **fiilen sağlanmıştı**; E1'in
beklenti alanları bunu göremedi çünkü güven eşiğini, `riskLevel`ı ve intent kara
listesini kullanmıyordu. (⚠️ Harness'ın KENDİSİ güveni okuyabiliyor —
`minConfidence`/`maxConfidence` alanları var; E1'in sözleşmesi onları kullanmıyordu.)

## 3. 🚨 Ölçülen İKİNCİ boşluk: pozitif yön HİÇ pinli değil

Sekiz QR senaryosunun beklenti alanları tarandı. **Hiçbiri** "iyi temellendirilmiş
cevap GERÇEKTEN gönderiliyor mu" diye sormuyordu:

| senaryo | alanlar |
|---|---|
| E2 (kaynak VAR) | `minConfidence` · `mustContainAny` · `usedSourcesInclude` |
| E8 (çok soru, kaynak VAR) | `mustContainAll` · `mustContainAny` · `usedSourcesInclude` |

Bunların hiçbiri kapıyı çağırmıyordu. **Sonuç: ürün her şeyi bloklamaya başlasa eval
yine yeşil kalırdı.** Kurucunun kuralı çift taraflı — *"bilgim yok gitmesin"* AMA
*"AI sus pus olmasın"* — ve harness yalnız birinci yarıyı ölçüyordu.

## 4. Yeni sözleşme — İKİ YÖN, İKİ EKSEN

| alan | anlamı | nasıl ölçülür |
|---|---|---|
| `notDeliverable: true` | kaynak yokken bu taslak misafire GİTMEMELİ | **gerçek kapı** BLOKLAR |
| `deliverable: true` | kaynak varken bu taslak misafire GİTMELİ | **gerçek kapı** GEÇİRİR |

🚨 **Kaynaksız senaryoda İKİ EKSEN birden gerekir** (bu, incelemede ölçülen gerilemenin
düzeltmesidir — §8/B2):

- **TESLİMAT** — kapı bu taslağı durdurur mu?
- **UYDURMA** — kaynak yokken somut bir şey (rakam / yer tarifi) iddia ediyor mu?
  Ölçen: ürünün KENDİ yüklemi `hasUnsourcedSpecificClaim`.

Tek başına teslimat ekseni yetmez: düşük güvenli bir uydurma kapıda durur, teslimat
ekseni yeşil kalır ve saf uydurma "ok" görünür.

## 5. Dataset değişiklikleri (sessiz gevşetme YOK)

- `evals/qr-kb-coverage.json`: E1 `notDeliverable` (anlam değişti, alan adı aynı);
  E2 ve E8'e `deliverable: true` EKLENDİ. Gerekçeler senaryoların `changed` alanında.
- `evals/kb-retrieval-paired.json`: `acknowledgeAbsenceWhenGoldMissing` →
  `notDeliverableWhenGoldMissing` (R1/R2/R3/R6/R7/R8).
  ⚠️ Bu dosyada **senaryo başına `changed` alanı YOK** (tip de taşımıyor); gerekçe
  dosya düzeyindeki `notes` girdisindedir.

Kaldırılan ya da zayıflatılan beklenti YOK (anlamsal JSON karşılaştırmasıyla
doğrulandı; dosya ayrıca compact→pretty yeniden biçimlendirildi, o yüzden ham diff
anlamsal değişiklikten çok daha büyük görünüyor).

## 6. Neden bu, "eşiği düşürmek" DEĞİL

Alternatif, E1'in beklentisini silmek olurdu — o, ürünün gerçekten gönderip
göndermediğini bir daha hiç ölçmemek demekti. Yeni sözleşme iki eksenle birlikte
eskisinin kapsadığı her şeyi kapsar ve üstüne pozitif yönü ekler.

⚠️ **Dürüst kayıt:** TEK BAŞINA teslimat ekseni, `notDeliverable` ekseninde eskisinden
GEVŞEKTİ — kapı, yokluk itirafını KAPSAYAN bir üst kümeyi bloklar, dolayısıyla
"itiraf etmeyen ama uyduran" cevap geçerdi. Bu incelemede ÖLÇÜLDÜ ve uydurma ekseni
eklenerek kapatıldı. "Daha sıkı" iddiası ancak İKİ EKSEN birlikteyken doğrudur.

## 7. Bilinen sınırlar (düzeltilmiş liste)

Harness YALNIZ `suggestReply` (TASLAK) çağırır; rota, DB, outbox yok. Ölçülen şey
"gönderildi" değil **"ürünün kapısı bu taslağı ne yapardı"**.

Kapıda eval'de ULAŞILAMAYAN dallar:

- `guest_name_injection` — kapı üçüncü argüman olarak `guestName` ister, dataset
  misafir adı taşımaz. (MESAJ injection taraması TAM çalışır. `history` /
  `pendingGuestMessages` bu kapının **parametresi bile değildir** — belgenin ilk hâli
  onları "eksik bacak" diye sayıyordu, YANLIŞTI.)
- `informational_low_confidence` ve `unsourced_claim` — ikisi de
  `QR_INFORMATIONAL_BAND_ENABLED` bandının içinde; bayrak eval config'inde set
  edilmez → dallar ulaşılamaz.
- `model_unavailable` — iki harness da `source !== "openai"` satırını `check()`ten
  ÖNCE `invalid` sayıp eler.

⚠️ **Kapının BLOKLAMA GEREKÇESİ bugün rapora YAZILMIYOR.** `Row`/`PairedRow`
gerekçe kolonu taşımıyor; `d.reason` yalnız `deliverable` dalının hata metninde
görünüyor. Belgenin ilk hâli "hangi dal kapattı raporda görünür" diyordu — bu YANLIŞTI.
(Gerekçe kolonu eklemek ayrı, küçük bir iş; rapor biçimini değiştirir.)

## 8. İncelemede düzeltilenler (09-11, ölçümlü ajan)

| # | ilk hâlde yazan | gerçek |
|---|---|---|
| B1 | Codex'in reddi hiç anılmamış | §0 eklendi; karşı gerekçe + geri alma yolu yazılı |
| B2 | "Yeni sözleşme **daha sıkı**" | Tek eksenle GEVŞEKTİ (R6 uydurması yeşil geçiyordu) → uydurma ekseni eklendi |
| B3 | "hangi dal durdurdu raporda görünür" | Bloklamada gerekçe hiçbir yere yazılmıyor (§7) |
| B4 | "`history`/`pendingGuestMessages` verilmiyor" | Bu kapının parametresi değil; eksik olan `guestName` (§7) |
| B5 | Kod bloğu "aynen" gibi sunulmuş | Parafrazdı, RAKAM bacağı atlanmıştı → §1'de işaretlendi |
| B6 | "güven eşiğini … hiç okumuyor" | Harness okuyabiliyor; E1'in sözleşmesi kullanmıyordu (§2) |
| B7 | "Her senaryonun `changed` alanına gerekçe" | Eşleştirilmiş dataset'te böyle bir alan YOK (§5) |
| B8 | "altı satırı kırmızı yaptı" | 6 senaryo / 7 SATIR (§1) |
| B9 | `riskType: null` sabitlenmişti | `r.riskType` geçilir; `model_risk_type` dalı artık çalışıyor |
