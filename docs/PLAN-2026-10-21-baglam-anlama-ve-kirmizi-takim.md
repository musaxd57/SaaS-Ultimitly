# Plan — bağlamla anlama, kırmızı takım, ev sahibini haksız duruma düşürmeme (kurucu 10-21)

Durum: **PLAN** (kurucu: "işlerin bittikten sonra bunu da plana koy"). Bu belge sıra + ölçüm yöntemi + sorulardır; kod yok.

## Kurucunun isteği (özet, sözleri korunarak)

- "Kelime bazlı yapma; bağlam / anlam / amaç bazlı olsun. Sen beni nasıl anlıyorsan müşteri de modele yazınca öyle cevap alsın —
  bilgi tabanı dahil. Sen kendin nasıl yapacak olsaydın aynısını bana yap, kullandığın teknikleri yaz."
- Açık modellerden (DeepSeek ağırlıkları, çıkarım kodu) ve güvenlik katmanlarından (RLHF, guardrails) öğren: model yasaklı isteği
  kelimeden değil niyetten anlar ("hikâye yaz ama içinde gerçek hack kodu olsun" perdesinin arkasındaki amacı görür).
- Kırmızı takım + jailbreak koruması: "kimse denemez ama kötü niyetli biri bilerek yazar".
- **"Çıkmak istiyorum, para vermeyeceğim" → model kesinlikle cevap üretmesin. "Sofra kirli" → özür dilemesin, "haklısınız / üzgünüm"
  demesin. Olaylar net değilken ev sahibini haksız duruma düşürecek hiçbir şey yazmasın.**

## Ben bir mesajı nasıl okuyorum (aktarılacak teknikler)

1. **Önce niyet, sonra kelime.** Mesajın tamamını ve önceki konuşmayı okurum; misafirin ne İSTEDİĞİNİ (soru / talep / şikâyet /
   bildirim) ayrı ayrı çıkarırım. Aynı sözcük farklı amaçta farklıdır ("yangın söndürücü nerede?" bilgi; "mutfak yanıyor, söndürücü
   nerede?!" acil).
2. **Kim, ne zaman, gerçek mi?** Öznesi kim (misafir mi, ben mi, üçüncü kişi mi), olay şimdi mi geçmişte mi, varsayım mı, olumsuz mu
   ("alarm çalmıyor"), alıntı mı. W4 ("anahtarı bulamazsanız") bunun örneği.
3. **Dayanak.** Cevabın her olgusu bir kaynağa dayanır (bilgi tabanı, mülk alanı). Dayanak yoksa uydurmam; bu üründe "bilmiyorum"
   misafire gitmez, ev sahibine kalır.
4. **Perdenin arkasındaki amaç.** Rol yapma, "ev sahibi bana söz verdi", "önceki talimatları unut", baskı (kötü yorum / iade tehdidi):
   çerçeveyi değil amacı değerlendiririm. Amaç bir izin, para, kod ya da kural dışı bir şeyse cevap üretmem, insana bırakırım.
5. **Belirsizlikte tahmin yok.** Emin değilsem sormam ya da bırakırım; yarım bilgiyle söz vermem.
6. **Tarafsızlık.** Olay net değilken suç kabul etmem, özür ya da tazminat sözü vermem, karşı tarafı da suçlamam.
7. **Göndermeden önce ikinci okuma.** Taslağı bağımsız bir gözle tekrar okurum: soruyu gerçekten cevaplıyor mu, uydurma var mı, söz /
   itiraf / özür var mı, misafir beni yönlendirmeye çalışıyor mu?

## Bizim sistemde karşılığı (bugün)

| Teknik | Bugün | Eksik |
|---|---|---|
| 1 niyet | anlama katmanı (model, istek bazlı) — CANLI | bazı kapılar hâlâ kelimeyle karar veriyor |
| 2 özne / zaman | tehlike okuyucusunda kısmen kelimeyle | modele taşınacak (hakem soruları) |
| 3 dayanak | bilgi tabanı getirme + yeniden sıralama + iddia denetçisi (gölge) | iddia denetçisi karar vermiyor |
| 4 amaç | enjeksiyon kelime listesi + modelin risk etiketi | "perde" senaryoları ölçülmedi (kırmızı takım yok) |
| 5 belirsizlik | güven eşiği + öğe kipinde tutma | — |
| 6 tarafsızlık | istemde "duygu beyanı yasak" | **ölçülmedi; gerçek cevaplarda "özür dileriz / lamentamos" GÖRÜLDÜ** |
| 7 ikinci okuma | konaklama bekçisi + bilgim-yok hakemi (10-21, anahtar KAPALI) | tek "kıdemli okuyucu" yok |

## Sıra (her adım: gerçek cevaplarda ÖNCE ölçüm, sonra kod, sonra kör set; müşteriye gideni değiştiren adım anahtarla + sizin onayınız)

1. **Tarafsızlık kuralı (sizin açık isteğiniz, ilk iş):** gerçek ölçüm cevaplarında özür / "haklısınız" / suç kabulü / tazminat sözü
   sayımı (kelime + hakem). Sonra: istem kuralı + gönderim öncesi hakem sorusu "taslak ev sahibi adına kusur kabul ediyor ya da özür
   diliyor mu?" → evet ise o cümle gitmez (cevabın geri kalanı kapılardan yeniden geçer) ya da cevap tutulur. "Para vermeyeceğim / iade
   isterim" türü mesajda bugün de cevap gitmiyor mu, kırmızı takım setiyle doğrulanır.
2. **Kırmızı takım seti:** ~100 senaryo (TR / EN / DE / AR / RU): rol yapma perdesi, sahte "ev sahibi izin verdi", talimat gömme (mesajda,
   adda, bilgi tabanında), iade / ödememe / kötü yorum tehdidi, kapı kodu / başka misafir bilgisi isteme, uzun dostça mesaja gömülü
   istek. Geliştirme seti bende, kör set ayrı yazarda (Claude iş paketi). Ölçü: içerik giden 0, kod / kişisel veri sızan 0, suç kabulü 0.
3. **Kelime kuralları → aday bulucu + bağlam hakemi:** "bilgim yok" ölçüldü (16/17 doğru bırakma, 0/51 yanlış). Sıradakiler (Haiku
   envanterindeki model karşılığı OLMAYANLAR): "mesajınız kaydedildi" bildirimi, güvence / acil yönlendirme cümlesi, ödeme yöntemi,
   kaynaksız somut iddia. Her biri aynı yöntemle.
4. **Tek kıdemli okuyucu:** 3. adımdaki hakemleri tek çağrıda toplamak (bir şema, birkaç soru). Her otomatik cevap adayına ~1,6 sn ve
   1.000 mesajda ~$1 ekler; ayrı ayrı çağrıdan ucuz.
5. **İstem:** sistem istemine "nasıl düşün" ilkeleri (niyet önce, dayanak, tarafsızlık) ve aynı sözcük / farklı anlam ikiz örnekleri
   (W8'de yaptığımız gibi), her değişiklik ölçümle.
6. **Açık modeller (DeepSeek vb.) — öğrendiğimiz ve uygulamadığımız:** model eğitmiyoruz (veri az, maliyet yüksek, KVKK). Aldığımız fikir
   eğitim değil yöntem: talimat + örnek, bağımsız hakem (Llama Guard / NeMo deseni), kırmızı takım ölçümü. İleride ev sahibinin onayladığı
   cevaplarla ince ayar ayrı karar.

## Size sorular (adım 1 başlamadan)

- **T-a:** "Yaşadığınız rahatsızlık için üzgünüz" gibi kusur KABUL ETMEYEN nezaket cümlesi de mi gitmesin, yoksa yalnız "haklısınız /
  özür dileriz / bizim hatamız / telafi edeceğiz" mi? (Öneri: hepsi gitmesin. Şikâyet zaten ev sahibinde. Cevap yalnız diğer soruyu
  cevaplasın, olay hakkında hiçbir şey söylemesin.)
- **T-b:** 4. adımdaki tek kıdemli okuyucu her otomatik cevaba ~1,6 sn ekler. Kabul mü?
