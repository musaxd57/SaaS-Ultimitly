# TASARIM 2026-11-20 — Güncel kayda bağlı gönderim (kurucu E-3; "son karar sende, en iyi uzun vadeli fikir")

> Kurucu cevabı AYNEN: `docs/KURUCU-TALIMATI-2026-11-20-sabah-cevaplar.md` §E-3 (Codex görüşü + "son karar sende").
> Karar: Codex'in yönü doğru. Ölçmeden gönderim değişmez. Uzun vadeli parça "son gönderimi kaydın sürümüne bağlamak" İLK somut adım olarak
> yazılır. Bu adım deterministiktir: model gerekmez, kredi beklemez. Önce gölgede ölçülür.

## 1. Bugün ne oluyor (kodda doğrulandı)

- **İstem kurulurken bilgi tabanı:** her turda veritabanından taze okunur. Vektörler içerik adreslidir. Eski içerik İSTEME GİREMEZ; EMB'nin 11 testi bunu gösteriyor.
- **İstem kurulduktan SONRA ne olduğuna kimse bakmıyor.** İki pencere var:
  - (a) model düşünürken (2–10 sn) ev sahibi Wi-Fi şifresini değiştirir;
  - (b) cevap kuyruğa girdikten sonra, gönderilmeden önce değiştirir (kuyruk anahtarı açıkken; işçi gecikmesi saniyeler–dakikalar, kapalı dönemde saatler).

  İkisinde de ESKİ şifreyi taşıyan cevap gider. Rezervasyon iptali için bu açığı 11-20'de kapattık; bilgi tabanı için aynı açık duruyor.
- **Cevabın dayandığı kayıtlar ZATEN kayıtlı:** `RiskEvent.kbEvidenceJson` → `retrieved: [{type:"kb_item", id, v: updatedAt}]` (`ai/grounding.ts` `buildKbEvidence`). Yani "hangi kaydın hangi sürümü" bilgisi elde var, yeni şema gerekmez.

## 2. Önerilen yapı (üç parça, sırayla)

### P1 — Kaynak sürümüne bağlı gönderim (gölgede başlar)
- **Bağlama:** cevap üretilirken isteme giren kalemlerin `(id, updatedAt)` listesi cevapla birlikte taşınır.
  - Satır içi yolda değişken olarak.
  - Kuyruk yolunda satırın kendisinde, yeni kolon olmadan: bugün kuyruk satırının bağlı olduğu `RiskEvent` var mı, bakılacak. Yoksa en sade taşıma yolu P1 kodlanırken seçilir.
- **Son kontrol:** gönderim talebinden HEMEN önce aynı kalemler tek sorguyla yeniden okunur. Bayat sayılan durumlar:
  - herhangi biri silinmiş, pasife alınmış ya da `updatedAt` değişmiş.
- **Gölge kipi (ilk dilim):** gönderim DEĞİŞMEZ. Yalnız sayılır ve kayda yazılır: "bu cevap bayat kaynakla gidecekti". Ölçülen: haftada kaç cevap, hangi kategori (Wi-Fi, giriş, kural…).
- **Uygulama kipi (ölçümden sonra, kurucu onayıyla):** bayat kaynaklı cevap gitmez. Konuşma bir sonraki geçişte GÜNCEL bilgiyle yeniden modellenir. Tutulmaz, yeniden üretilir; misafir gecikmeli de olsa doğru cevabı alır. Bu, "yeni misafir mesajı geldi → bayat cevap gitmez" kuralının (C2) aynısıdır.
- **Neden en iyi uzun vadeli adım:**
  - Kelimeye, vektöre ya da modele bağlı değil; kaydın kendisine bağlı.
  - Şifre değişimi, kuyrukta ikinci değişiklik ve daire değişimi (kalem başka daireye taşındı) vakalarının hepsini AYNI kural kapatır.
  - Model kredisi beklemez.

### P2 — Güncel kaydı vektörden bağımsız bulmak (ölçümle)
- Codex'in "doğru dairenin güncel, yetkili kaydını vektörsüz bulmayı deneyelim" önerisi.
- Bugün vektörsüz yol sözcüksel aramadır (BM25 + sözlük). Kelimesiz parafrazda ("İnternete bağlanmak için ne yazmam gerekiyor?") eşleşme yoksa en yeni 30 kayıt isteme girer.
- **Öneri:** anlama katmanının istek listesindeki KONU (model okuması, kelime listesi değil — kurucu 11-18 kuralı) bilgi tabanı KATEGORİSİNE eşlenir (wifi → `wifi` kalemleri). O kategorinin güncel kalemi isteme kesin girer.
  - Bu "kelimeye takılma" kuralına uyar: anlamı model okur, kod yalnız kategoriyi eşler.
- **Ölçüm (gönderim değişmeden):** dört vaka ailesi — şifre değişimi, kelimesiz parafraz, başka daire, kuyruktayken ikinci değişiklik. Her ailede üç sayı:
  - korunan doğru cevap;
  - engellenen yanlış / eski cevap;
  - gereksiz tutulan doğru cevap.

  Anlama katmanı ücretli model çağrısıdır. Düzenek ve vakalar şimdi yazılır, sayılar kredi gelince koşulur.

### P3 — Dayanak yoksa / çelişkiliyse tahmin gönderilmez
- 11-12 genel dayanak işi: cevap parçaları kayıttan birebir alıntıya dayanır (`AI_ANSWER_PARTS_ENABLED`, kör ölçüm kredi bekliyor).
- P1 ve P2 bunun önkoşullarını sağlar: güncel kayıt bulunur, sürüm bağlıdır.
- Kurucu: "Sonucu görmeden otomatik gönderim davranışını değiştirmeyelim" → P3 ölçümsüz açılmaz.

## 3. Dilimler

| Dilim | İçerik | Şema | Misafire etkisi |
|---|---|---|---|
| D1 | P1 gölge: kaynak listesini taşı + gönderim öncesi yeniden oku + say / kaydet (satır içi + kuyruk + QR) | yok (taşıma yolu P1'de seçilir; şema gerekirse soru) | yok |
| D2 | P2 düzeneği + dört vaka ailesi (anlama çıktısı kayıtlı / taklit) | yok | yok |
| D3 | P1 uygulama kipi (bayat → yeniden modelle), anahtarla | yok | var — kurucu onayı + önce / sonra örneği |
| D4 | P2 ücretli ölçüm (kredi) | yok | yok |

**Önce / sonra (D3, ileride kurucuya sorulacak):** misafir 14:02:05'te "Wi-Fi şifresi ne?" yazar, ev sahibi 14:02:07'de şifreyi değiştirir, model 14:02:10'da biter.
- **Bugün:** "Wi-Fi ağımız LaleNet, şifresi ESKİ-ŞİFRE." gider.
- **D3 ile:** bu cevap gitmez. Bir sonraki geçişte (≤2 dk) "Wi-Fi ağımız LaleNet, şifresi YENİ-ŞİFRE." gider.

## 4. Açık noktalar
- Kuyruk satırında kaynak listesinin taşınması: var olan bağ (`RiskEvent` ↔ mesaj) mı, yoksa satırın kendi alanı mı? D1'de koda bakılıp karar yazılır. Yeni kolon gerekirse migration sorusu.
- QR: kayıt işlemi tek turdur. Pencere yalnız (a), model düşünürken. Aynı kural `record()` içinde, Ö-1'in yanında.
- Yer tutuculu (`{isim}`) kalemlerde sürüm, kalemin `updatedAt`'ıdır; doldurma çıktısı değil.
