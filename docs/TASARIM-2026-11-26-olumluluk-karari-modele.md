# Olumluluk ("var / yok") kararı: hangisi kodda, hangisi modelde — öneri (26 Kasım)

Durum: ÖNERİ. Ürün kodu değişmedi. Kanıt: `docs/olcum/olumluluk-ve-model-gucu-2026-11-26.md` (ücretsiz tablo + ücretli okuyucu ölçümü).
Kurucu kararları: S-2 "önce kontrol et" · "yanlış eksik cevaplar gitmemeli, modelin anlama bağlam gücünü test et" · 11-18 kalıcı kural
"anlam kararı modele, kod yalnız doğrular".

## 1. Ne bulundu (kısa)

1. **Kodun "var / yok" denetimi iki yönde de yanılıyor ve ikisi aynı okumadan geliyor.** 99 satırlık tabloda 53 doğru cevabın 28'ini
   tutuyor, 46 ters cevabın 6'sını geçiriyor. "Binanın önünde ücretsiz sokak parkı var. Kapalı otopark yok." kalemini bütünüyle "yok" diye
   okuyor: doğru "sokak parkı var" cevabını tutuyor, ters "sokak parkı yok" cevabını geçiriyor.
2. **"Kod yalnız emin olduğunda tutsun" adaylarından hiçbiri, kodun tek başına ters cevap kaçırmamasını sağlamıyor** (dört aday; en iyisi 28
   doğru cevabı geri kazanıyor ama 34 ters cevabı okuyucuya bırakıyor). Kodun emin olamadığı biçim, ters cevabın da biçimi.
3. **Okuyucu (parça okuyucusu, bugünkü istem, `gpt-5.1`) olumluluk tablosunda çok güçlü:** 46 ters cevabın 46'sını üç koşunun üçünde tuttu,
   doğru cevapların hepsini geçirdi (maske hatası dışında). Hiçbir aday + okuyucu birleşiminde ters cevap misafire gitmedi.
4. **Okuyucunun bugün HİÇ bakmadığı iki şey var:** misafirin dili (yanlış dilli 16 parçanın 16'sını geçirdi) ve notların kendi arasındaki
   çelişki (23 vakanın 5'inde geçirdi, çöp örneği dahil). İkisi de tek bir ek soruyla büyük ölçüde kapanıyor (dil 16/16; çelişki 5 → 2).
5. **Maske hatası (yeni, analizden daha ağır):** İngilizce "password:" taşıyan bir kalem notlara girince okuyucuya giden notların TAMAMI
   `[REDACTED_UNPARSEABLE_JSON]` oluyor (`src/lib/redact.ts` yapısal temizleyicisi "- [WIFI]" köşeli parantezini JSON adayı sanıyor). Okuyucu
   doğru şifreyi de, aynı notlara düşen sigara kuralını da göremiyor ve tutuyor.

## 2. Öneri: hangi karar nerede

| karar | bugün | önerilen | gerekçe (ölçüm) |
|---|---|---|---|
| Parçanın sayısı / saati / tutarı alıntıda var mı (`value_not_in_evidence`), alıntı kalemde mi, iki kaynak değerde çelişiyor mu | kod | **kodda kalır** | yapısal; dil / anlam gerektirmiyor |
| Ücretsiz ↔ ücretli (sayı taşıyan kalemde) | kod | kodda kalır, yalnız TUTAR (geçirme kararı vermez) | tabloda 3 doğru tutuş, haksız tutuş 0 |
| "Var / yok", "izin / yasak" (değersiz parça, dallar 2279 · 2288 · 2296) | kod tutar, okuyucu serbest bırakamaz | **anlam kararı okuyucuya; kod yalnız dar ve kesin durumda tutar (aday A2: iki taraf da yan cümle düzeyinde tek yönlü ve yönler ters)** — A2'nin geçirdiği her parçayı okuyucu okumaya devam eder | A2 + okuyucu: 99 satırda yanlış geçir 0, haksız tutma 3 (üçü de maske hatası) — bugün 28 |
| Misafirin dilinde mi | kısa metinde kimse (kod "iki taraf da eminse" tutar) | **okuyucuya tek ek soru** | ek soruyla 22/22 doğru, haksız tutma 0 |
| Notlar kendi arasında çelişiyor mu (sıklık / gün / yer gibi değer olmayan çelişki) | kimse (kod yalnız değer aralığında bakar) | **okuyucuya tek ek soru**; çöp tipi için ayrıca ölçüm | 5 → 2 yanlış geçir; çöp birleşimi (cf-cop-1) yine geçti |
| Okuyucuya giden notların maskesi | yapısal temizleyici (kalem satırını bütünüyle siliyor) | **kurucu sorusu** (gizlilik): bilgi tabanı metni okuyucuya maskesiz gitsin mi, ya da temizleyici kalem satırını JSON sanmasın mı | maskesiz: 6/6 doğru şifre geçti, 4/4 yanlış şifre tutuldu |

A2 seçimi: A1 / A2 / A3 birleşik hatta aynı sonucu verdi; A2 kodda en dar olanı değil ama haksız tutma 0 ve kod hâlâ 12 ters cevabı tek
başına tutuyor (okuyucu düşerse ya da yanılırsa ikinci kemer). A3 (aynı dil şartı) ürünün dil tanıyıcısı kısa kalem metninde karar
veremediği için fiilen "kod hiç tutmaz" demek → önerilmez. A4 9 haksız tutma bırakıyor.

**Ne değişmez:** okuyucu düşerse / kapalıysa bütün parçalar tutulur (bugünkü kural). Okuyucunun "evet"i yine tek başına izin değildir — kodda
kalan değer / alıntı / çelişki denetimleri geçmeden parça okuyucuya bile gelmez.

**Bilinen gerilim:** Opus 10-23 B1 kararı ("izin ↔ yasak tek bir model hükmüne bırakılmaz") bu öneriyle ters düşer. Ölçüm, bu tabloda
okuyucunun 46 / 46 ve kararlı olduğunu gösteriyor; tabloyu ben yazdım. Karar kurucunun.

## 3. Kurucuya önce / sonra örnekleri

(Misafire giden metinler ev sahibinin ağzından; "önce" = bugünkü parça kipi hattı, "sonra" = öneri. "Sonra" davranışları bu ölçümün okuyucu
hükümleridir; hat bütünüyle uçtan uca koşulmadı.)

1. *"Kapalı otopark var mı?"* (bilgi: "Binanın önünde ücretsiz sokak parkı var. Kapalı otopark yok.")
   - Önce: hiçbir şey gitmiyor; soru panelde açık (doğru cevap "ters" sanılıyor).
   - Sonra: *"Binanın önünde ücretsiz sokak parkımız var, ancak kapalı otoparkımız yok."*
   - Ters cevap ("Kapalı otopark da var.") önce de sonra da gitmiyor; sonra onu okuyucu tutuyor (üç koşunun üçünde).
2. *"Darf man auf der Terrasse rauchen?"* (bilgi: "Smoking is not allowed anywhere, including the terrace.")
   - Önce: hiçbir şey gitmiyor (virgülden önceki yan cümle "olumlu" okunuyor).
   - Sonra (maske düzeltilirse): *"Rauchen ist in der gesamten Unterkunft, einschließlich der Terrasse, nicht erlaubt."*
   - Maske düzeltilmezse sonra da gitmiyor: aynı bilgi tabanındaki Wi-Fi kalemi okuyucuya giden notların hepsini siliyor.
3. *"Où se trouve la télécommande de la climatisation ?"*
   - Önce: *"Klima kumandası TV ünitesinin çekmecesinde bulunuyor."* — Fransız misafire Türkçe gidebiliyor (ölçülen koşuların birinde gitti).
   - Sonra: Türkçe parça tutulur; Fransızca yazıldığında gider: *"La télécommande de la climatisation se trouve dans le tiroir du meuble TV."*
4. *"Çöpler hangi günler toplanıyor?"* (bir not "salı ve cuma akşamı toplanır", öbürü "her akşam alınır, kapının önüne bırakın")
   - Önce: *"Çöpler salı ve cuma akşamı toplanıyor; her akşam çöpü kapının önüne bırakabilirsiniz."* gidiyor.
   - Sonra (ek soruyla): üç koşunun ikisinde hâlâ gidiyor. **Bu sınıf çözülmedi.** Soru: bu iki not sizce çelişiyor mu (bina görevlisi her
     akşam kapıdan alıyor, belediye salı / cuma topluyor olabilir)? Çelişiyorsa doğru yol bilgi tabanı uyarısı (ev sahibine "bu iki not
     çelişiyor" göstermek) olabilir — yeni sistem, önce soru.

## 4. Açmadan önce gereken ek ölçüm
1. **Başka birinin yazdığı, görülmemiş bir set** (olumluluk + çelişki + dil + eksik; diller arası ağırlıklı); kol başına en az 2 koşu. Bu
   ölçümün vakalarının çoğunu ben yazdım.
2. A2 + okuyucu ve iki ek soru **uçtan uca hatta** (parça kipi, okuyucu aynı turun bütün parçalarını birlikte görürken); okuyucu kapalıyken
   davranışın değişmediği (hepsi tutulur) birim testiyle.
3. Çelişki ek sorusunun cümlesi test vakasına benzeyen örnek taşımadan yeniden yazılıp ölçülmeli (bu ölçümde sızıntı var).
4. Maske düzeltmesinin (kurucu kararından sonra) ürünün öteki anlam katmanlarında da aynı silmeyi yapıp yapmadığı ücretsiz ölçülmeli
   (`redactForSemanticModel` ayrıca anlama katmanı, bekçi, "bilgi yok" hakemi, yeniden sıralayıcı ve `kb-retrieve.ts` içinde çağrılıyor —
   oralarda da kalem satırı silinip silinmediği ölçülmedi; yeniden sıralayıcıda olursa Wi-Fi kalemi aday listesinde görünmez olabilir, emin
   değilim).
5. "Kayıtlarımda yok" türü anlatımı okuyucu cevap sayıyor (eks-13, 3/3): parça kipinde bu parçanın koddan / "bilgim yok" kapısından geçip
   geçmediği ayrıca ölçülmeli.
