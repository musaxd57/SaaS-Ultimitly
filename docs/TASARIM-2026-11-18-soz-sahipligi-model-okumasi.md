# Tasarım 2026-11-18 — Ev sahibinin sözünü MODEL okur (kelime ağı değil): anlam + hızlı kod doğrulaması + neden kaydı

> Kurucu 11-18 akşam (AYNEN `docs/KURUCU-TALIMATI-2026-11-18-aksam-kararlar-ve-anlam-yonu.md`): "KELİME BAZLI DEĞİL … CÜMLEDEKİ ANLAMI,
> AMACI, NİYETİ MODEL GÜÇLERİNE BIRAK AMA ARKADA ÇOK HIZLI ŞEKİLDE KONTROLLER sağlansın, doğru anlandığına dahil tutulsun anlama şekli ve
> nedeni, burada kesinlikle test yapalım kredi gelince … LLM'lerin gücünü test ederek avantaja geçiyorsak kullan."
> Bu belge, gündüz yazılan `docs/TASARIM-2026-11-18-alintilanan-soz-gorev-acmasin.md` önerisinin YERİNE geçer (o öneri tırnak / iki nokta
> yapısına dayanıyordu — geri çekildi; ölçülmüş "bugün ne oluyor" tablosu orada duruyor ve bu işin ölçüm setine girdi).
> Durum: aşama 0 (gölge) kodu yazıldı, anahtar KAPALI. Davranış değişmedi.

## 1. Sorun

Ev sahibinin giden mesajındaki söz ("teknisyen yarın 10'da gelecek") görev açar (`HOST_COMMITMENT_AUTO_ENABLED`, açılışta açık). Sözü bugün
sözcük ağı tanıyor (`ai-suggestions/core.ts detectHostPromises`). Ağ fiili görür ama SÖZÜN SAHİBİNİ göremez. Ölçüldü (18 Kasım):

| Ev sahibinin mesajı | Bugün | Doğrusu (kurucu) |
|---|---|---|
| Misafir şöyle yazdı: "Teknisyen yarın gelecek" | kesin söz → bakım görevi | görev de kart da yok |
| Havlu yarın getirilecek demişsiniz, öyle bir kaydımız yok. | kesin söz → havlu görevi | görev de kart da yok |
| Teknisyen yarın 10'da geleceğini yazdı. | kesin söz → görev | inceleme kartı, otomatik görev yok |
| Randevuyu teyit ettik, teknisyenimiz yarın 10'da gelecek. | kesin söz → görev | görev (bugünkü akış) |

Sahiplik, aktarma, ret, koşul sözcük sorusu değil anlam sorusudur. Kelime kökü listesi büyütülmez (kurucu).

## 2. Çözüm: iş bölümü

**Model anlar, kod doğrular.**

1. **Okuma (model, tek kısa çağrı / mesaj):** `ai/semantic/host-commitment-reader.ts`. Mesaj veri olarak çitlenir (içindeki talimat izlenmez),
   adlar maskelenir. Model her söz adayı için kapalı kümeden bir okuma seçer — "anlama ve bağlama göre, tek sözcüğe ya da tırnağın varlığına
   göre değil":

   | Okuma | Anlamı | Karar |
   |---|---|---|
   | `host_commits` | ev sahibi (ben / biz / ekibimiz) üstleniyor ya da teyit ediyor | görev (bugünkü akış) |
   | `host_relays_unconfirmed` | başkasının dediğini aktarıyor, üstlendiği belli değil | inceleme kartı |
   | `host_conditional` | koşula bağlı / kararsız | inceleme kartı |
   | `guest_words` | misafirin sözünü aktarıyor / anıyor | hiçbir şey |
   | `denial` | planlanmadığını söylüyor | hiçbir şey |
   | `question_or_other` | soru, geçmiş, genel bilgi | hiçbir şey |

   Her ifade için: metinden AYNEN alıntı, konu, gün, saat (yoksa boş — saat uydurulmaz) ve **tek cümlelik neden**.

2. **Hızlı kod doğrulaması (`host-commitment-verdict.ts`, saf, doğrusal, mikrosaniyeler):**
   - alıntı modelin gördüğü metinde gerçekten geçiyor mu → geçmiyorsa ifade karara girmez (uydurma alıntıyla görev açılmaz);
   - modelin saati alıntıdaki bir rakamdan mı geliyor → gelmiyorsa otomatik görev karta iner;
   - alıntı tırnak içinde ya da iletilmiş (`>`) satırda mı → ilk aşamada otomatik görev karta iner (temkin payı; sahipliği BELİRLEMEZ,
     ölçümle gevşetilir).

   Doğrulama yalnız TUTAR (görev → kart). Hiçbir zaman görev açmaz, kartı yükseltmez.

3. **Neden kaydı:** her okumanın modeli, istem kimliği, süresi, ifadelerin okuması / kararı / doğrulama sonucu ve modelin nedeni saklanır
   (§4). "Model bunu neden böyle anladı" sorusu kayıttan cevaplanır.

## 3. Aşamalar (her geçiş ölçüm + kurucu onayı ister)

| Aşama | Ne yapar | Misafire / panoya etkisi |
|---|---|---|
| 0 — gölge (yazıldı) | okuma kaydedilir, sözcük ağının kararıyla kıyaslanır (`agree` · `model_holds` · `model_opens`) | yok |
| 1 — model TUTAR | sözcük ağı "görev" derken model "aktarma / ret / misafirin sözü" diyorsa görev açılmaz (kart ya da hiçbir şey) | yanlış görev azalır |
| 2 — model AÇAR | sözcük ağının göremediği gerçek sözü model okur → önce kart, sonra (ayrı onayla) görev | kaçan söz azalır |
| 3 — sözcük ağı yedeğe iner | karar modelin; ağ yalnız model düştüğünde (anahtar yok / zaman aşımı) | — |

Model düşerse (anahtar yok, zaman aşımı, bozuk cevap) her aşamada bugünkü sözcük ağı davranışı sürer — söz kaybolmaz.

## 4. Kayıt ve gizlilik

Gölge kaydı için yeni tablo gerekir (migration; kurucu onayı var — "migrationları yapabilirsin"): mesaj başına bir satır; modelin ifadeleri
(okuma, konu, gün, saat, alıntının metindeki KONUMU, neden), sözcük ağının kararı, kıyas, model, istem kimliği, süre. Alıntı metni
saklanmaz (konum yeter — metin mesaj satırında zaten var); modelin nedeni kısa serbest metindir (≤ 240 karakter) ve mesajı yeniden
anlatabilir → satır konuşmayla birlikte silinir / anonimleştirilir (veri saklama ve silme kapsamına girer). Maliyet: mesaj başına bir kısa
çağrı; işletme başına günlük tavan + genel anahtar.

## 5. Ölçüm (kredi gelince) ve örneklerle besleme

- **Geliştirme seti** (açık): `evals/host-commitment-dev.json` — Türkçe ağırlıklı, altı okumanın hepsi, karışık cümleler, tırnaklı üstlenme /
  tırnaksız aktarma (yapının yanılttığı vakalar), saat uydurma tuzakları. Gündüz ölçülen dokuz örnek dahil.
- **Kabul seti** (kör): ayrı yazılır ve mühürlenir; geliştirme sırasında açılmaz. Açma ölçütü: yanlış "görev" 0, gereksiz tutma oranı kurucuyla
  belirlenir.
- **Ölçer:** sözcük ağı · model · model + doğrulama kollarını aynı sette kıyaslar; hata olursa neden analizi döngüsü
  (`tests/eval/failure-analysis.ts`) bağlanır.
- **Örneklerle besleme (kurucu: "modeli örneklerle beslemeliyiz, fine-tuning"):** iki yol, sırayla ölçülür —
  (a) isteme benzer örnek ekleme: mesaja en benzer etiketli örnekler (var olan gömme altyapısıyla seçilir) isteme eklenir; ucuz, hemen;
  (b) ince ayar: aynı örnek bankasından eğitim dosyası üretilir (`eğitim` / `ölçüm` ayrı; ölçüm örneği eğitime girmez). Kullanılan modelin
  ince ayarı destekleyip desteklemediği kredi gelince doğrulanacak (bugün bilinmiyor).
  Örnek bankası tek biçimde tutulur ki iki yol da aynı veriden beslensin; erken giriş pilotu (H-3) aynı düzeni kullanır.

## 6. Kurucuya sorular

- **SM-1:** Aşama 0 → 1 geçişi için ölçüt: kör sette "model yanlış tuttu" (gerçek sözü kaçırdı) en çok kaç olabilir? Önerim: 0 kaçan kesin
  söz; kararsız vakada kart kabul.
- **SM-2:** Tırnak / iletilmiş satır temkin payı aşama 1'de kalsın mı, yoksa model "üstleniyor" diyorsa doğrudan görev mi? Önerim: ölçüme
  kadar kalsın.
- **SM-3:** Neden kaydı ev sahibine gösterilsin mi ("Bu mesajı söz saymadım çünkü misafirin cümlesini aktarıyorsunuz")? Önerim: önce yalnız
  operatör teşhisinde; ev sahibine göstermek ayrı karar.
