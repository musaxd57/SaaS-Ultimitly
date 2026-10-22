# E — İhtiyaç defteri ücretli ölçümü (kurucu 10-23: "yap")

**Kurucu kararı (E, aynen özet):** onaylı Luna yapılandırmasıyla iki kol — eski akış / yeni akış × okuyucu açık / kapalı / hata verdi;
hangi soru cevaplandı, hangisi açık kaldı, hangi kaynak kullanıldı ölçülsün.

- **Yapılandırma (onaylı Luna, 10-10 karar 7):** cevap `gpt-6-luna` düşünme `low` · bekçi / kıdemli okuyucu `gpt-6-luna` `low` · anlama +
  sıralayıcı `gpt-5.1` (ölçer sabitler) · embedding `text-embedding-3-small`. Açılış listesindeki anahtarlar iki kolda aynı
  (`AI_KB_FEE_RULE_ENABLED`, `AI_CODE_GREETING_ENABLED`, `AI_ACCESS_CODE_COMPLETE_ENABLED`, `AI_HOST_DECISION_HOLD_ENABLED`,
  `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED`, `AI_NO_APOLOGY_RULE_ENABLED`, `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED`, `AI_TOPIC_ABSENCE_ENABLED`).
- **Eski akış** = bugünkü öğe kipi (tek cevap metni, model "hangi istekleri cevapladım" der). **Yeni akış** = `AI_ANSWER_PARTS_ENABLED=1` +
  `AI_ASSISTANT_QUESTION_ITEM_ENABLED=1` (istek başına parça + birebir alıntı → kod doğrulaması → yalnız doğrulanan parçalar birleşir).
- **Okuyucu hatası kolu:** kıdemli okuyucu çağrısı ağa gitmeden 503 döner (`EVAL_LIVE_READER_FAIL=1`).
- **Set:** `evals/needs-2026-10-23.json` — 32 senaryo, 46 ihtiyaç (38'i cevaplanmalı, 8'i açık kalmalı: KB'de olmayan hamam / jakuzi /
  spor salonu, kaynak sorusu, erken giriş kararı …), Türkçe + İngilizce + Almanca + Rusça, olumsuz ve koşullu kalemler, "22:00 tuzağı".
- Ham raporlar: `docs/olcum/live-pipeline-2026-10-22-gpt-6-luna-needs-2026-10-23-e1023-<kol>.{md,json}`.

## 1. Altı kol (ilk koşu)

| kol | doğru değerle cevaplanan | açık kalması gereken açık kaldı | 🚨 yanlış değer / yanlış "cevaplandı" | 🚨 "bilgim yok" / iç kaynak sızıntısı | giden mesaj | öğe durumu uyumu | p50 | maliyet |
|---|---|---|---|---|---|---|---|---|
| eski · okuyucu açık | 30/38 | 7/8 | **1** | 0 | 24/32 | 31/39 | 10,7 sn | $0.10 |
| eski · okuyucu kapalı | 31/38 | 8/8 | 0 | 0 | 24/32 | 31/38 | 8,5 sn | $0.09 |
| eski · okuyucu hata | 31/38 | 8/8 | 0 | 0 | 24/32 | 31/38 | 8,8 sn | $0.09 |
| yeni · okuyucu açık | 24/38 | 8/8 | 0 | 0 | 21/32 | 27/40 | 9,5 sn | $0.10 |
| yeni · okuyucu kapalı | 23/38 | 8/8 | 0 | 0 | 19/32 | 25/40 | 8,0 sn | $0.09 |
| yeni · okuyucu hata | 23/38 | 8/8 | 0 | 0 | 20/32 | 27/41 | 8,2 sn | $0.09 |

Okuma:
- **Yeni akış kurucunun istediği ayrımı yapıyor:** "Çıkış saat kaçta? Bir de hamam var mı?" eski akışta bütün mesaj tutuluyordu (çıkış
  saati de gitmedi); yeni akışta yalnız "Çıkış saati 11:00." gitti, hamam ev sahibinde açık kaldı. Aynısı "anahtar + hamam".
  "Bilgim yok" cümlesi hiçbir kolda üretilip ayıklanmadı — yeni akışta hiç YAZILMIYOR (`no_info` iç kayıt).
- **Yanlış gönderim:** eski akışta okuyucu açık kolda 1, yeni akışta 0.
- **Ama yeni akış daha az cevaplıyor (23–24 / 38 ↔ 30–31 / 38).** Neden analizi (§2): reddedilen parçaların çoğu DOĞRU cevaptı —
  doğrulayıcı fazla katıydı.
- Okuyucu kapalı / hata kolları yeni akışta okuyucu açık kolla aynı düzeyde: parça doğrulaması okuyucuya dayanmıyor; okuyucu hata verince
  güvenli yönde kalıyor (yanlış gönderim 0, sızıntı 0).

## 2. Neden analizi (kurucu 10-11 döngüsü: açıklama → karşı deneme → katman → doğrulama)

Ölçer ham parçaları (metin + alıntı) kaydedecek biçimde genişletildi (`partsRaw`, yalnız ölçerde; üretim kararı metin taşımaz) ve
reddedilen 8 senaryo yeniden koşuldu (`…-e1023-new-on-diag`, $0.02). Her ret çevrimdışı birebir yeniden üretildi:

| senaryo | modelin parçası (alıntı kalemde birebir) | ret | gerçek neden | sınıf |
|---|---|---|---|---|
| otopark | "Otopark ücretsizdir; binanın -2. katındaki 12 numaralı yer size ayrılmıştır." | değer başka konuya bağlı | ";" sonrası yalnız yer anlatan devam cümlesi konuyu taşımıyordu | doğrulayıcı (yer sözcükleri) |
| Wi-Fi | "Wi-Fi şifresi Lale2025!." | değer başka konuya bağlı | şifrenin sonundaki "!" cümle sonu sayılmadı; ardındaki "Modem salondaki…" cümlesi değerin "ardı" okundu | doğrulayıcı (cümle sınırı) |
| kahvaltı | "Kahvaltı hafta içi 10:30'a kadar, hafta sonu 11:00'e kadar veriliyor." | değer başka konuya bağlı + koşul eklendi | "11:00'e kadar zemin kattaki kafede verilir" — yer bildiren ad ve yüklem özne sanıldı; "hafta içi" genel kuralın tümleyeni | doğrulayıcı (Türkçe söz dizimi + tümleyen) |
| havuz 22 tuzağı | "Havuz hafta içi 20:00'de kapanıyor; hafta sonu 23:00'e kadar açık." | koşul eklendi | "her gün 20:00 + hafta sonu 23:00" → "hafta içi 20:00" doğru tümleyen | doğrulayıcı (tümleyen) |
| pool Saturday | "The pool closes at 23:00 on Saturdays." | koşul düştü + eklendi | cumartesi hafta sonunun özeli; misafir cumartesiyi sordu | doğrulayıcı (gün ailesi) |
| çöp | "Çöpleri bina girişinin sağındaki konteynere atabilirsiniz." | dayanaksız içerik | "atılır" ~ "atabilirsiniz" kısa fiil kökü | doğrulayıcı (Türkçe çekim) |
| Rusça otopark | "Парковка бесплатная, на уровне -2 здания; за Вами закреплено место №12." | değer alıntıda yok + başka konuya bağlı | "№12" kod okundu (sayı 12); ";" devam cümlesi | doğrulayıcı (numara + yer) |
| breakfast included | (yeniden koşuda doğrulandı) | — | model değişkenliği | — |

**Karşı denemede ortaya çıkan ESKİ AÇIK (yanlış kabul):** "Havuz hafta sonu 20:00'de kapanır." kalem "her gün 20:00, hafta sonu 23:00"
derken DOĞRULANIYORDU — parça düzeyindeki koşul kümesi hangi değerin hangi güne ait olduğunu bilmiyordu. Düzeltme: koşul DEĞER BAŞINA
okunuyor (genel değer, kendi değişkesi olan güne verilemez; değerin günü kalemdeki yerinin günü ya da onun özeli olmalı).

**Düzeltilen sınıflar (hepsi testli; her birinin tehlikeli karşılığı ayrıca TUTULUR):**
1. Kodun sonundaki "!" / "?" cümleyi de bitirir — karşılık: "Wi-Fi şifresi: Lale2025! Kapı kodu: 4455." → "Wi-Fi şifresi 4455" tutulur.
2. Yer / tahsis sözcükleri (kat, numaralı yer, size ayrılmış, bina, zemin …) YALNIZ konu devralmasında nötr; içerik kıyasında içerik
   ("sağındaki" ≠ "solundaki") — karşılık: devam cümlesinde tesis adı (sauna / kafe / spa) ya da "Ayrılış" varsa devralma yok.
3. Türkçe kalemde son değerin ardındaki yer bildiren ad (-de / -deki) ve yüklem özne değil — karşılık: "11:00'e kadar KAFE açıktır" tutulur.
4. Gün ailesi: cumartesi / pazar hafta sonunun özeli; genel kuralın bir güne özel söylenişi yalnız misafir o günü SORDUYSA — karşılık:
   sorulmayan gün uydurulamaz; cumartesiye genel değer verilemez (hafta sonu değişkesi varken); hafta içi değeri cumartesiye taşınamaz.
5. Tümleyen: "hafta içi" ← genel kural + hafta sonu istisnası, değer başına doğrulanır — karşılık: ters bağ (hafta içi 23:00 / hafta sonu
   20:00) ve istisnasız kalemde "hafta içi" tutulur.
6. Kısa Türkçe fiil kökü ("atılır" ~ "atabilirsiniz") — karşılık: başka fiil ("bırakılır" ≠ "atabilirsiniz") içerik sayılır.
7. "№12" sayı 12 — karşılık: "№13" tutulur.

## 3. Düzeltme sonrası yeniden ölçüm

(aşağıda — yeni akışın üç kolu aynı set, aynı yapılandırma)
