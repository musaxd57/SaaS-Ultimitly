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
