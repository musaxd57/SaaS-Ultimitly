# Kurucu talimatı — 25 Kasım: fikir ajanları + üç küçük iş (AYNEN)

> Bu işte her dilimden ÖNCE okunur. Kurucunun sözleri değiştirilmeden.

## 1. Fikir ajanları
"public yaptım. sende bana fikir bulacak geliştirme önerileri bulacak 2 tane fable 5.2 ajanı çalıştır 2'si karşılıklı birbirlerine mesaj atsın
konuşarak önerilerini eklenebilecek özellikleri benim V 'LEREDE bakarak bir plan kursunlar."

Sonuç: `docs/PLAN-2026-11-25-urun-fikirleri-iki-ajan.md` + `docs/PLAN-2026-11-25-urun-fikirleri-sira-tablosu.md` (20 öneri; 15 "bugün yok /
var" iddiası kodda doğrulandı).

## 2. Üç küçük iş
Ana oturumun sorusu: "bu üç küçük işi yazmaya başlayayım mı?" — örnekleriyle:
- Misafir çıkmadan bir gün önce size "Lale 3 yarın çıkıyor, sıcak su konusu hâlâ açık" demek.
- Arıza tekrarlayınca "bu dairede geçen sefer şu yapılmıştı" notunu göstermek.
- Temizlikçiye o gün hangi daireden başlayacağını önermek ve ay sonunda "Ayşe 23 temizlik yaptı" saymak.

Kurucunun cevabı: **"3'ünüde ekle"**

Şartlar (planın sözü, aşılmaz): veritabanı değişikliği yok · yeni anahtar yok · misafire giden hiçbir şey değişmez · model çağrısı yok.
Ortak kurallar ve ajan görevleri oturum kaydında (`k26`); tasarım notları `docs/TASARIM-2026-11-25-*.md`.

## Uygulama durumu
Üç iş de yazıldı (üç Opus 5.5 ajanı, ayrı çalışma ağaçları; ana oturum satır satır okudu, düzeltti; Opus sert inceleme: P1 yok, 1 P2
düzeltildi — `docs/INCELEME-2026-11-25-uc-kucuk-is-sert-kontrol.md`). Veritabanı değişikliği, yeni anahtar, model çağrısı YOK; misafire giden
hiçbir şey değişmedi. Mutasyon: 42 mutanttan 40'ı ilk koşuda, kalan 2'si + düzeltmelerin 8 mutantı eklenen testlerle.

- **Çıkıştan önce açık konu** (`docs/TASARIM-2026-11-25-cikistan-once-acik-konu.md`): "Dikkat Gerektirenler"de çıkışı 24 saat içindeki
  konaklamanın bırakılan isteği / açık sözü / "Sorunlu" durumu TEK satırda: "Lale 3 yarın 11:00'de çıkıyor" · "sıcak su (söz bugün 18:00)
  konusu açık · misafir 3 saattir cevap bekliyor". O konaklamanın ayrı satırları kalkar. Acil istek ve karar kartı ayrı kalır. Saat: onaylı
  geç çıkış varsa o; saat geçmişse yazılmaz.
- **Son bakım işi notu** (`docs/TASARIM-2026-11-25-son-bakim-isi-notu.md`): Görevler panosunda açık bakım kartında (yalnız yönetici)
  "Bu dairede son bakım işi: 17 Mayıs — 'reset yapıldı' (Ahmet)"; bakım kapanırken not kutusu "Ne yapıldı? (isteğe bağlı)".
- **Temizlikçi gün sırası + ay sayımı** (`docs/TASARIM-2026-11-25-temizlikci-gun-sirasi-ve-ay-sayimi.md`): Girişler'de "Temizlik sırası
  önerisi" kartı (aynı gün birden çok temizliği olan kişi için; görevleri değiştirmez); Raporlar'da "Temizlikler (ay)" — "Ayşe — 23 temizlik".

Kurucuya sorular: `docs/claude/acik-isler.md` "11-25 (2)".
