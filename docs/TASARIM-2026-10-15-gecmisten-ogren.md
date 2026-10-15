# Geçmişten öğren — geçmiş mesajlardan bilgi tabanı taslağı + cevap karşılaştırma (tasarım, 10-15)

Kurucu 10-15: "AI bütün mesajları okusun, verilen cevaplardan bilgi tabanını kendisi oluştursun; bunu web sitemizin özelliği olarak düşündüm";
inceleme yeri "Lixus panelinde"; ilk deneme "300 mesajla". Bu belge KOD YAZILMADAN önce akışı, maliyeti ve açık soruları sabitler.

## 1. Bugün elimizde olan

- Geçmiş soru ↔ ev sahibi cevabı eşleştirmesi (Bacak B, `api/kb/suggestions`, `KB_HISTORY_SUGGESTIONS_ENABLED` KAPALI — kurucu 09-11):
  modelsiz, fail-closed eşleştirme (12 saat penceresi, araya giren giden mesaj, gerçek çift). Geri açma ön koşulları `docs/claude/acik-isler.md`.
- Bilgi tabanı onay alanları (A1, migration 53): `source` (`extracted_draft` var) + `reviewState` (`draft` modele GİTMEZ).
- KB sır kapısı (kapı kodu / kutu kodu kalemi QR'a gitmez), ad / telefon / e-posta maskesi (`redactForSemanticModel`), geçmişte kapı kodu
  gizleme (`redactDoorCodes`).
- Gerçek veriyle salt-okunur ölçüm altyapısı (`scripts/eval-real-stats.ts`, Set B: sıra kimliği, metin rapora girmez).

## 2. Akış (her müşteri için ürün özelliği)

Bilgi Tabanı sayfasında "Geçmişten öğren" (sahip + yönetici):

1. **Kapsam:** mülk seç → "son N misafir sorusu" (ilk sürüm en çok 300; tahmini ücret ve süre BAŞLAMADAN gösterilir).
2. **Okuma (arka plan işi):** konuşmalar eşleştirilir (Bacak B kuralları + otomatik şablon mesajı cevap sayılmaz, K7); misafir adı / telefon /
   e-posta / kapı kodu modele gitmeden maskelenir; konuşmalar paketlenip modele verilir: "ev sahibinin TUTARLI verdiği mülk bilgilerini
   çıkar (Wi-Fi, otopark, giriş, kurallar, yakın yerler …); her olgu için kaç konuşmada geçtiği; çelişen iki cevap varsa ikisini de çelişki
   olarak işaretle; kapı / kutu kodu ASLA".
3. **Taslaklar:** her olgu `source=extracted_draft`, `reviewState=draft` kalem → modele GİTMEZ. Sır kapısı taslağa da uygulanır.
4. **İnceleme ekranı:** her taslak için "12 konuşmada böyle cevaplamışsınız" + örnek (maskeli) + Onayla / Düzenle / Reddet. Onay = A1
   sözleşmesi (`approved` + gerçek `approvedAt`). Çelişkili taslak onaylanmadan önce seçim ister.
5. **Cevap karşılaştırma (aynı 300 soru):** sol: sizin o zamanki cevabınız · sağ: bugünkü yapay zekânın cevabı (GÖNDERİLMEZ, yalnız ekran) ·
   altta İyi / Düzelt / Kötü + "böyle yapsın" notu.

## 3. Maliyet (kaba, 300 misafir sorusu)

| İş | Çağrı | gpt-5.1 tahmini |
|---|---|---|
| Okuma + taslak çıkarma (konuşma paketleri) | ~30–60 | ~0,5–1 $ |
| Cevap karşılaştırma (soru başına bir cevap) | 300 | ~2–3 $ |

Bütün geçmiş (kurucu org, 17.462 mesaj): okuma ~10 $, her soruya cevap ~50–60 $. Günlük yapay zekâ kotasından ayrı sayaç; müşteri başına
üst sınır (ör. ayda 2 çalıştırma) — karar sorusu.

## 4. Veri ve KVKK

- İşlem müşterinin kendi verisi üzerinde, kendi panelinde; bugün oto-yanıtın kullandığı aynı model sağlayıcısına MASKELİ metin gider.
- Kurucu org için: Railway açılınca orada koşar (09-19 yedeğini yerele yüklemek eski kararı açar — gerekmez).
- Taslak / not satırları müşterinin dışa aktarma + hesap silme kapsamına girer (değişmez 14 listesi).

## 5. Kurucu kararları (10-15)

- **Migration ile, "en sağlamı / en güçlüsü".**
- **"Böyle yapsın" notları HEM bilgi tabanına HEM mülke özgü talimata yazılır** (talimat cevap istemine girer → ev sahibi metni istem
  sayılır: KB talimat-ele-geçirme süzgeci, sır kapısı, uzunluk tavanı ve ödeme yöntemi kapısı talimata da uygulanır).
- **Model Luna 6.0** ("5.1 çok pahalı, müşteriler için de"): okuma, taslak çıkarma ve karşılaştırma cevabı Luna; ayrı katman değişkeni
  (`AI_HISTORY_LEARN_MODEL` / `_REASONING_EFFORT`, varsayılan `gpt-6-luna` / `low`).
- İlk deneme 300 misafir sorusu; inceleme Lixus panelinde.

## 6. Eski açık sorular (yanıtlandı ↑)

1. "Böyle yapsın" notları ne olsun? (a) yalnız bilgi tabanı taslağına dönüşsün (en güvenli) · (b) mülke özgü "ev sahibi talimatı" olarak
   cevap istemine girsin (güçlü ama ev sahibi metni = istem değişikliği, ayrı güvenlik kapısı ister) · (c) yalnız bizim ölçümümüze girdi.
2. Not / karşılaştırma için yeni tablo = migration. Railway kapalıyken hazır yama mı, ana dala anahtar arkasında mı?
3. İlk dilim: (i) okuma + taslak + inceleme ekranı, (ii) cevap karşılaştırma — ikisi birlikte mi, önce (i) mi?
