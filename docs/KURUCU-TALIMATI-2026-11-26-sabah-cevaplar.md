# Kurucu talimatı — 26 Kasım sabah (cevaplar, AYNEN)

Bağlam: gece turu bitti (K27 yayında `721d4873`, CI 1859 yeşil). Ana oturum "Railway'i açalım mı" sorusuna "açılabilir; önce OpenAI kredisi,
taze yedek, Paddle anahtarı" dedi ve dört soru sordu. Kurucunun cevapları aşağıda AYNEN.

## Kurucunun mesajları (AYNEN)

> railwayi açalım mı sence? ve sorularını sor

**Giriş bilgisi mesajının saati (GM-1) sorusuna:**

> OPENAI KREDİSİ GELDİ ÖZÜR DİLERİM SÖYLEMEYİ UNUTTUM TESTLERİNİ ÇALIŞTIR. bana hemen taze veritabanını aldır o zaman ve hatırlıyorsan şifre ile
> gizlediğimiz dosyalar vardı onlarıda bana açtırırmısın görmek istiyorum,  yo gece 3'de gitmesin 4 gün önceden alınmışsa saat tam 10'da gitmiş
> olsun. önerin gibi

**Sohbet ekranı (K2-S) sorusuna:**

> burda bence tamamı gelsin ama şöyle olsun hemen ilk 50 tane göstersin yani hız olarak iyi olsun arkada mesajlar yüklenmeye devam etsin anladın mı
> ne demek istediğimi kuyruk gibi mi oluyor burda çok bilgim yok ama müşteri mesajı hemen görmüş gibi bile olabilir bir bakıma sohbete girince
> anladın mı ne demek istediğimi yada dediğinde mantıklı son 60 mesaj gözüksün üstte daha eski mesajları göster tuşu olsun öyle yapalım hem bu
> hızlandırırda dimi bizi. burda doğru şekilde kur kuyrukları falan

**Fotoğraftaki konum bilgisi (K11-1) sorusuna:**

> burdaki amacı anlamadım bence konum bir kanıtta olur kötü birşey değilse kalabilir sence daha mantıklı bir fikrin var mı

**Dışa verilen takvimin başlığı (K16-1) sorusuna:** "Genel ad (Önerilen)".

Gece boyunca verilen çalışma talimatları (AYNEN):

> bana soru olarak sorma o anlamda diyorum mal mısın iznin var ve ben sana uyandırıcı için öyle yap demedim soru sorma sadece dediğim saatte uyan

> agentları didik didik kontrol et ha sürekli kırmızı vermeye başladın o beni gıcık etmeye başladı

> durabilirler bu turları bittikten sonra dursunlar

> he bu arada kırmızı olmasın derken kırmızı olduğu için sakın testleri kolaylaştırma, sırf yeşil çıkması için sorun yok ben daha dikkatli ol
> anlamında söylüyorum onu

## Ana oturumun okuması (kurucunun metni DEĞİL)

| # | Karar | İş |
|---|---|---|
| 1 | OpenAI kredisi geldi → bekleyen ücretli ölçümler koşulsun | Görülmemiş (kör) set kolları (`docs/INCELEME-2026-11-12-istem-denetimi.md` §6.4) ve kredi bekleyen öteki ölçümler |
| 2 | Taze veritabanı yedeği kurucuya aldırılacak | Adımlar kurucuya yazılır (`scripts/ops-backup-prod.ps1`); yedek kurucunun makinesinde kalır |
| 3 | Şifreyle saklanan dosyalar kurucuya açtırılacak | 09-19 yedek arşivi (7-Zip, şifreli — `docs/OPS-2026-09-19-DURAKLATMA-VE-LOCAL-GELISTIRME.md`); açma adımı kurucuya yazılır |
| 4 | GM-1: giriş bilgisi mesajı gece gitmez; 4 gün önceden sırası gelmişse işletme saatiyle 10:00'da gider | Kod + test |
| 5 | K2-S: sohbet ekranı son 60 mesajla açılır, üstte "Daha eski mesajları göster" düğmesi | Kod + test (kurucunun ilk fikri — hepsi arkada yüklensin — yerine kendi seçtiği ikinci yol) |
| 6 | K11-1: fotoğraftaki konum bilgisi KALIR (kanıt değeri; kurucu görüş sordu → ana oturum da "kalsın" dedi: fotoğraflar yalnız işletmenin kendi ekibine, imzalı adresle açılıyor) | Kod yok |
| 7 | K16-1: dışa verilen takvimin başlığı genel ad | Kod + test |
| 8 | İzin sorusu çıkaran komut yazılmaz; uyandırıcı yalnız kurucunun söylediği saate kurulur; test gevşetilmez | `docs/claude/calisma-ortami.md` |

## Öğleden sonra — ölçüm sonuçlarına cevap (AYNEN)

Bağlam: görülmemiş iki kabul seti koşuldu (`docs/INCELEME-2026-11-12-istem-denetimi.md` §6.4); ana oturum S-1 (okuyucuya maskesiz şifre),
S-2 ("var / yok" kontrolü yalnız emin olduğunda tutsun) ve S-3 (geç mesaj anahtarı parça kipiyle birlikte) sorularını sordu.

> daha planı almadım, 2. için dosyayı göremiyorum tam nerde ben zaten birde kapatmadan önce yedek aldığımı hatırlıyorum bu arada sende
> bakabilirsin tam kapatmadan önce yani. sen bol bol yapacağın testleri yap izin almana gerek yok izin veriyorum.

> olmuyor ben açiyim ya hepsi 0'lanır mı aq bi sorunda ki şuana kadar uygulamayı tek ben kullandım ve 1 müşterisi mesajları çekti sadece o
> otomatik mesaj gidemez haksız mıyım
>
> S-2: "var / yok" kontrolü yalnız emin olduğunda tutsun, emin değilse kararı modele bıraksın mı? Önerim evet; önce ücretsiz bir tabloyla,
> gerçekten ters cevapların hâlâ tutulduğunu görmeden değiştirmem. önce kontrol et
>
> salak salak hala yanlış eksik cevaplar gitmemeli modelin anlama bağlam gücünü test et
>
> s-3 öerin iyi gibi ama test niye burda hata oluyor onları öğren en ufak gitmeme nedeni hatanın sebeplerini tut bir dosyada biriksin datalar

### Ana oturumun okuması (kurucunun metni DEĞİL)

| # | Karar | İş |
|---|---|---|
| 9 | Ücretli / ücretsiz ölçüm için izin sorulmaz ("bol bol test yap") | — |
| 10 | S-2: önce kontrol (ücretsiz tablo); sonuç görülmeden kod değişmez | `docs/olcum/olumluluk-ve-model-gucu-2026-11-26.md` |
| 11 | Yanlış / eksik cevap gitmemeli; modelin anlama ve bağlam gücü ölçülsün (çelişkili not, ters cevap, dil, maske, eksik cevap) | aynı rapor + `docs/TASARIM-2026-11-26-olumluluk-karari-modele.md` |
| 12 | S-3: öneri (geç mesaj anahtarı parça kipiyle birlikte) uygun görünüyor; önce hataların nedeni öğrenilsin | neden defteri |
| 13 | NEDEN DEFTERİ: her "gitmedi" ve her "yanlış gitti" vakasının sebebi kalıcı bir veri dosyasında birikir | `docs/olcum/neden-defteri.jsonl` + araç |
| 14 | Railway: plan alınacak; açılışta önce `AUTO_REPLY_ENABLED=0`, yedek, sonra web servisi (ana oturumun önerdiği sıra — kurucu henüz onaylamadı) | `docs/RAILWAY-ACILIS-2026-10-15.md` §0 |
| — | S-1 (okuyucuya maskesiz şifre) cevaplanmadı — açık soru | — |

## Akşamüstü — okuyucu gücü ölçümüne cevap (AYNEN)

Bağlam: ana oturum "var / yok kararında model koddan belirgin biçimde daha iyi" dedi ve S-1, S-2 ile okuyucuya iki ek soruyu sordu.

> model koddan belirgin biçimde daha iyi.  bu ne demek tabiki modeli kullanmak demek aq ama herşeyi modele bırakmamlıyız gibide anlama
> katmanı önemli modeller orda gelişmiş bağlam anlam amaç anlam konusunda tekrar test S-1 MASKesiz olsun o zaman
>
> okuyucuya 2 soru koyabilirsin testte et

### Ana oturumun okuması (kurucunun metni DEĞİL)

| # | Karar | İş |
|---|---|---|
| 15 | S-1: kontrol eden model (parça okuyucusu) bilgi tabanı notlarını ve parçayı MASKESİZ görür | `ai/semantic/part-reader.ts` |
| 16 | S-2: "var / yok" anlam kararında model kullanılır; AMA her şey modele bırakılmaz — kod dar ve kesin durumda tutmaya devam eder (10-23 kararının güncellenmesi: tek hüküm değil, kod + okuyucu birlikte) | `ai/answer-binding.ts` (yalnız okuyucu koşarken) |
| 17 | Okuyucuya iki soru: cevap misafirin dilinde mi · notlar bu konuda kendi aralarında çelişiyor mu → "hayır / evet" ise tut | `part-reader.ts` + ölçüm |
| 18 | Anlama katmanı (bağlam / anlam / amaç) yeniden ölçülür | görülmemiş anlama seti |
