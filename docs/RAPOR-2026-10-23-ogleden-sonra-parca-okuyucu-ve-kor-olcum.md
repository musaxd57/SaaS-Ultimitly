# Rapor — 10-23 öğleden sonra: Soru 9 / 10 / 11, Codex'in "anlam ilişkisi" önerisi, son kontrol ve kör ölçüm

> Kurucu (10-23 sabah): Soru 9 (genel kural + istisna), Soru 10 (sessiz kalan gerçek açık ihtiyaç için tek e-posta), Soru 11 (okuyucu anlam
> üzerinden ayırsın, gönderilecek SON parçaları görsün, "evet"i tek başına izin olmasın, belirsizde tutsun) · "Parça kipi, son kodla uçtan uca
> kör ölçüm geçene kadar kapalı kalsın. Hem yanlış gönderimleri hem gereksiz tutmaları ölçsün." · Codex (10-23): "kaynak destekliyor mu" ile
> "ihtiyacı karşılıyor mu" ayrı · okuyucu son metni görsün · A / B / C kolları · ince ayar yok.
> Tasarım: `docs/TASARIM-2026-10-23-soru-9-10-11-istisna-bildirim-parca-okuyucu.md` (§5 Codex karşılığı, §6 ölçümler).
> **Canlıda hiçbir şey değişmedi:** Railway kapalı; parça kipi (`AI_ANSWER_PARTS_ENABLED`) ve okuyucu (`AI_SENIOR_READER_ENABLED`) KAPALI.

## 0. Bir dakikalık özet

- **Kör ölçüm (mühürlü set, ayrı yazar, bir kez):** §1 — SONUÇ BURAYA.
- **Yanlış gönderim:** geliştirme setinde bugünkü her koşuda 0. Okuyucu + kod iki katman: okuyucunun bir koşuda kaçırdığı "bugün kapanıyor"
  cevabını kod zaten tutuyor; kodun parantez açığını okuyucu tutuyor.
- **Gereksiz tutma hâlâ yüksek:** geliştirme setinde 38 cevabın 10–12'si gereksiz tutuluyor. Kaynakları §3'te ayrı ayrı; açmadan önce sırada.
- **Son kontrolde iki ciddi açık bulundu ve kapandı** (Opus): okuyucu kapalıyken parça kipi Soru 9'u hiç sınamadan gönderiyordu; parantez
  düzeltmem "(şu anda bakım nedeniyle kapalı)" kaydını değerden koparıyordu. İkisi de eski kodda kırmızı testle pinli (§2).
- **Kararınızı bekleyen sorular** §5'te, örnekli.

## 1. Kör ölçüm (mühürlü set — yalnız toplu sayı)

SONUÇ BURAYA (yeni akış + okuyucu · bugünkü akış).

## 2. Ne yapıldı

| konu | kodda | not |
|---|---|---|
| Soru 9 genel kural + istisna | Okuyucuda (`exception_without_rule`); kod yalnız YAPIYI sınar | Sözcük tabanlı ilk sürüm Opus'ta 7 bulgu verdi → kaldırıldı ("kelime listesi büyütmek değil, anlam"). |
| Soru 10 tek e-posta | Satır başına kalıcı kayıt (1 yıl) + mevcut "Misafir cevabınızı bekliyor" yolu | Cevaplanmış / vazgeçilmiş / bitmiş satıra e-posta yok; yeniden işlemede ikinci e-posta yok; bugünkü e-posta giden turda satır "bildirildi" sayılır. |
| Soru 11 okuyucu | Yalnız TUTAR; dört ayrı soru (cevaplıyor mu · kaynakta yazıyor mu · bağ doğru mu · tek başına istisna mı) + "emin değilim" | Düşerse / satır eksikse / not kesildiyse / okuyucu kapalıysa BÜTÜN parçalar tutulur. |
| Codex madde 4 | Onaylanan parça gönderilecek son metinde aynen durmuyorsa tur tutulur | Harf / boşluk farkı değişiklik sayılmaz; selamdan ibaret parça sayılmaz. |
| Opus son kontrol G1 | Okuyucusuz parça kipi → hepsi tutulur | Soru 9 yalnız okuyucuda olduğu için. |
| Opus son kontrol G2 | Parantez yalnız kendi değerini taşıyorsa yan cümle sınırı | "(şu anda bakım nedeniyle kapalı)", "(hafta sonu ücretsiz)" değerden kopmuyor. |
| Opus G3 / G4 / G6 | Tek karşılaştırma biçimi · not tavanı 6000, sığmayan parça tutulur · ölçer düzeltmeleri | |
| Haiku | Selamdan ibaret parça son metin denetimini geçiyordu → kapandı | |
| Mutasyon | 21 mutant, 2 yaşayan → pinlendi → 21/21 | |

## 3. Gereksiz tutmaların kaynağı (geliştirme seti, son kod b47f246f)

Son koşu: 38 cevaplanacak ihtiyacın 26'sı doğru değerle gitti, açık kalması gereken 8/8 açık kaldı, **yanlış gönderim 0**. Gitmeyen 12'nin
kaynağı (her biri cevap kaydıyla tek tek okundu):

| kaynak | sayı | örnek | çözüm yönü |
|---|---|---|---|
| Okuyucu doğru parçayı tuttu | 3 | "Kahvaltı kaça kadar?" → "Hafta içi 10:30'a, hafta sonu 11:00'e kadar" ("tek başına istisna" dedi) · "Havuz kaçta kapanıyor, sauna kaçta kapanıyor?" iki parça da | Okuyucuya isteği anlama katmanının genişlettiği sorgu ("kahvaltı saatleri kahvaltı kaça kadar") yerine misafirin kendi sözcükleriyle göstermek; aynı vakalarda tekrar ölçmek. |
| Kodun sözcük denetimi | 4 | "Çöpleri … konteynere atabilirsiniz" (kaynak "atılır") · "Breakfast is not included. It costs 250 TL per person." ("It" konuyu taşımıyor) · Rusça iki parça (konu / "−2" yazımı) | Bu denetimler sözcük eşleştiriyor; anlamı okuyucuya bırakma yönü (Soru 9'da yaptığımız gibi) — müşteriye gideni değiştirir, önce sorulur (§5). |
| Kayıt kuralı (tasarım) | 2 | Köpek / balkonda sigara → ev sahibi kararı | Bugünkü kural; değişmez. |
| Anlama katmanı yanlış okudu | 1 | "Bisiklet ücretsiz mi?" → "bisiklet park yeri" | Anlama katmanı işi. |
| Tur düzeyinde tutma | 1 | "Giriş saati kaçta? Erken giriş mümkün mü?" → giriş saati doğruydu, tur erken giriş yüzünden tutuldu | Soru 6 / kısmi gönderim kararı. |
| **Doğru tutma** (model yanlış parça yazdı) | 1 | "(Havuz var mı?) Peki kaçta kapanıyor?" → "Hafta sonu havuz 23:00'e kadar açıktır." — okuyucu "tek başına istisna" diye tuttu | Soru 9 tam istendiği gibi çalıştı. |

Koşudan koşuya oynama büyük: aynı kodla okuyucu açık 28 · 31 · 26 / 38 (cevap modelinin taslağı her koşuda farklı).

## 4. Okuyucu karşılaştırması (A / B / C)

`evals/part-reader-dev.json` (35 soru–kaynak–parça), her vaka iki kez:

| kol | yanlış geçiş | gereksiz tutma | düşen | ort. süre |
|---|---|---|---|---|
| B (Luna, düşük çaba) — son istem | 1 / 70 okuma (aynı vaka öteki okumada tutuldu; kod da tutuyor) | 0 | 0 | ~2,1 sn |
| C (Luna, yüksek çaba — yalnız okuyucu) — ilk istem | 0 | 2 | 3 | ~3,0 sn |

C daha iyi değil → bırakıldı. Bu set istemi ayarlamak için kullanıldı; gerçek sınav §1.

## 5. Kararınızı bekleyen sorular

SORULAR BURAYA.
