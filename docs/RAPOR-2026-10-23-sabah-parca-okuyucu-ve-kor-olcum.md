# Rapor — 10-23 sabah (2): Soru 9 / 10 / 11, Codex'in "anlam ilişkisi" önerisi, son kontrol ve kör ölçüm

> Kurucu (10-23 sabah): Soru 9 (genel kural + istisna), Soru 10 (sessiz kalan gerçek açık ihtiyaç için tek e-posta), Soru 11 (okuyucu anlam
> üzerinden ayırsın, gönderilecek SON parçaları görsün, "evet"i tek başına izin olmasın, belirsizde tutsun) · "Parça kipi, son kodla uçtan uca
> kör ölçüm geçene kadar kapalı kalsın. Hem yanlış gönderimleri hem gereksiz tutmaları ölçsün." · Codex (10-23): "kaynak destekliyor mu" ile
> "ihtiyacı karşılıyor mu" ayrı · okuyucu son metni görsün · A / B / C kolları · ince ayar yok.
> Tasarım: `docs/TASARIM-2026-10-23-soru-9-10-11-istisna-bildirim-parca-okuyucu.md` (§5 Codex karşılığı, §6 ölçümler).
> **Canlıda hiçbir şey değişmedi:** Railway kapalı; parça kipi (`AI_ANSWER_PARTS_ENABLED`) ve okuyucu (`AI_SENIOR_READER_ENABLED`) KAPALI.

## 0. Bir dakikalık özet

- **Kör ölçüm yapıldı (mühürlü set, ayrı yazar, 45 senaryo / 62 ihtiyaç, bir kez — set artık yandı):** yeni akış yanlış gönderimi **9'dan
  1'e** indirdi ama doğru cevabı da **27'den 14'e** düşürdü (§1). Yani bugünkü hâliyle parça kipi "çok temkinli": misafire yanlış bilgi
  neredeyse hiç gitmiyor, ama doğru cevabı olan soruların yarısı ev sahibine kalıyor.
- **Önerim:** parça kipi KAPALI kalsın (sizin şartınız: "kör ölçüm geçene kadar kapalı"). Gereksiz tutmanın ana kaynakları belli (§3) —
  müşteriye gideni değiştirdikleri için önce size soruyorum (§5), sonra YENİ bir kör setle yeniden ölçerim.
- **Son kontrolde iki ciddi açık bulundu ve kapandı** (Opus): okuyucu kapalıyken parça kipi Soru 9'u hiç sınamadan gönderiyordu; parantez
  düzeltmem "(şu anda bakım nedeniyle kapalı)" kaydını değerden koparıyordu. İkisi de eski kodda kırmızı testle pinli (§2).
- **Canlıda hiçbir şey değişmedi.** Kapı yeşil (4533 + 10933 test, build), push edildi (§6).

## 1. Kör ölçüm (mühürlü set — yalnız toplu sayı)

Set: 10-23 mühürlü ihtiyaç kör seti (`evals/sealed/`) — ayrı bir ajan yazdı (kodu, istemleri, geliştirme setini görmedi); ben açmadım, yalnız sayıları
görüyorum. Aynı commit (`b47f246f`), aynı onaylı Luna yapılandırması, iki kol; set bu koşuyla yandı (`SEALS.json`).

| ölçü | bugünkü akış | yeni akış (parça kipi + okuyucu) |
|---|---|---|
| cevaplanması gereken ihtiyaç: doğru değerle giden | 27 / 40 (%68) | 14 / 40 (%35) |
| 🚨 **yanlış gönderim** (yanlış değer / yanlış "cevaplandı") | **9** | **1** |
| açık kalması gereken ihtiyaç: açık kaldı | 18 / 22 | 21 / 22 |
| gereksiz tutma (cevabı olan ihtiyaç gitmedi / eksik gitti) | 8 | 26 |
| "bilgim yok" / iç kaynak anlatımı giden | 0 | 0 |
| misafire giden mesaj | 27 / 45 | 14 / 45 |
| maliyet | $0,16 | $0,15 |

Raporlar: `docs/olcum/live-pipeline-2026-10-23-gpt-6-luna-kor-e1023-new-on-kor.md` · `…-old-on-kor.md`. Kör set kuralı gereği hangi senaryonun
nerede düştüğünü görmüyorum (yalnız toplu sayı) — neden analizi geliştirme setinden (§3).

**Okuma:** yeni akış güvenlik tarafında açıkça daha iyi (9 → 1 yanlış), kapsama tarafında açıkça daha kötü (27 → 14 doğru). Kör setteki tek
yanlış gönderimin ne olduğunu bilmiyorum; geliştirme setinde bugün hiç görülmedi.

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

Koşudan koşuya oynama büyük: okuyucu açık son üç geliştirme koşusu 31 · 28 · 26 / 38 (kod küçük farklarla; cevap modelinin taslağı her koşuda
farklı). Kör sette gereksiz tutma oranı geliştirme setinden çok daha yüksek (26 / 40) — geliştirme setine fazla uymuşuz.

## 4. Okuyucu karşılaştırması (A / B / C)

`evals/part-reader-dev.json` (35 soru–kaynak–parça), her vaka iki kez:

| kol | yanlış geçiş | gereksiz tutma | düşen | ort. süre |
|---|---|---|---|---|
| B (Luna, düşük çaba) — son istem | 1 / 70 okuma (aynı vaka öteki okumada tutuldu; kod da tutuyor) | 0 | 0 | ~2,1 sn |
| C (Luna, yüksek çaba — yalnız okuyucu) — ilk istem | 0 | 2 | 3 | ~3,0 sn |

C daha iyi değil → bırakıldı. Bu set istemi ayarlamak için kullanıldı; gerçek sınav §1.

## 5. Kararınızı bekleyen sorular

**S1 — Parça kipi şimdilik KAPALI kalsın mı?** Önerim: evet. Kör ölçüm "yanlış gönderim neredeyse yok" ama "doğru cevabın yarısı da ev
sahibine kalıyor" dedi. Bugünkü akış açık kalır; aşağıdaki iyileştirmelerden sonra **yeni** bir kör set (yine ayrı yazar) ile yeniden ölçerim.

**S2 — Okuyucu isteği misafirin KENDİ sözleriyle görsün mü?** Bugün okuyucu, anlama katmanının genişlettiği sorguyu görüyor.
- Örnek: misafir "Kahvaltı kaça kadar?" yazdı · anlama katmanı "kahvaltı saatleri kahvaltı kaça kadar" yaptı · cevap "Hafta içi 10:30'a, hafta
  sonu 11:00'e kadar." → **bugün:** okuyucu tuttu, ev sahibine kaldı · **önerim:** okuyucu "Kahvaltı kaça kadar?" görür → cevap gider.
- Böyle yapalım mı?

**S3 — Kodun sözcük denetimlerinden "anlam" olanlar okuyucuya geçsin mi?** (Soru 9'da yaptığımız gibi; değer / sayı / "kaynakta yazıyor mu"
denetimleri kodda KALIR.)
- "Çöpler nereye?" · kaynak "Çöpler bina girişinin sağındaki konteynere atılır." · cevap "Çöpleri bina girişinin sağındaki konteynere
  atabilirsiniz." → **bugün:** kod "kaynakta bu sözcüklerle yazmıyor" diye tutuyor · **önerim:** okuyucu "aynı bilgi" der → gider.
- "Is breakfast included?" · kaynak "Kahvaltı fiyata dahil değildir; kişi başı 250 TL." · cevap "Breakfast is not included in the price. It costs
  250 TL per person." → **bugün:** kod "It" sözcüğünde konuyu bulamıyor, tutuyor · **önerim:** gider.
- Rusça "Время выезда — до 11:00." (çıkış saati) → **bugün:** kod Türkçe konu sözcüğünü bulamayıp tutuyor · **önerim:** gider.
- Böyle yapalım mı?

**S4 — Okuyucu setini siz etiketler misiniz?** (Codex: "insan etiketleriyle karşılaştıralım".) 35 soru–kaynak–cevap örneğini bugün ben
etiketledim. İnceleme sayfasına "gitsin / tutulsun" seçimiyle koyarım; sizin işaretleriniz ölçümün doğru cevabı olur. Yapayım mı?

Önceki rapordan hâlâ açık: Soru 6 (kısmi cevap gittiğinde ev sahibine e-posta) — `docs/RAPOR-2026-10-23-gece-2-cevap-tekrari-ve-guvenlik.md` §6.

## 6. Kapı / push / CI

| adım | sonuç |
|---|---|
| Hedefli testler | 508 / 508 + yeni pinler |
| Mutasyon | 21 mutant → 19 öldü, 2 yaşayan (M4 ilgili kalem, M14 bildirim kaydı) pinlendi → 2 / 2 öldü |
| Tam kapı (`b47f246f`) | veritabanlı 4533 / 4533, veritabanısız 10933 geçti; build yeşil |
| Push | `20ade78e..f3bcf2be` (15 commit) · `f3bcf2be..44cecf90` (kör ölçüm sonucu) |
| CI | `f3bcf2be` #1639 yeşil · `44cecf90` yeşil |
