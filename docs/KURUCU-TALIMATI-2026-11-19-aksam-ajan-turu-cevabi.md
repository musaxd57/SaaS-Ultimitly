# Kurucu talimatı 2026-11-19 akşam — ajan turu sorularına cevap (AYNEN)

> Kurucunun mesajı aşağıda değiştirilmeden. Sorular: `docs/claude/acik-isler.md` "11-19 (3)" ve o günün soru dosyası (1 şablon, 2 anlamsal
> arama, 3 daire başlığı, 4 son kopya). Mesajın sonundaki "bir yazılım mühendisi dedi ki…" bölümü kurucunun aktardığı öneridir; kodda
> ölçülerek uygulanır. Bu işte her dilimden ÖNCE bu dosya okunur.

---

kapı yeşil çıkarsa push edersin, paralelde çalışmaya başlayabileceklerine başlayabilirsin bol bol düşün subagentlarla kontrollü ilerle uzun uzun didik didik
1. Mesaj şablonları: 30’lu liste, başlangıçta 500 sınırı
Son incelediğim kodda hem yönetim sayfası hem API şablonları topluca alıyor. Sadece ekranda 30 tanesini göstermek bellek sorununu çözmez; sunucu da en fazla 30 kayıt getirmeli. Yönetim ekranı ve mesaj yazarken açılan şablon seçici aynı sınırlı sorguyu kullansın. Arama işletmenin bütün şablonlarında çalışsın; ilk yükte başlık, kategori ve kısa önizleme gelsin, tam metin seçildiğinde alınsın.

500 özel şablon makul bir başlangıç; kalıcı ürün kuralı olarak koda gömmeyelim. Hazır Lixus şablonları sayılmasın, işletme genelinde kullanılan şablon bir kez sayılsın. Pasife alma sınırsız kayıt biriktirme yoluna dönüşmesin. Sınırı aşan mevcut işletmenin hiçbir şablonu silinmesin veya gizlenmesin; düzenleme ve kullanım devam etsin, yalnız yeni ekleme dursun. Limiti sunucuda eşzamanlı iki eklemenin de aşamayacağı şekilde uygularım.

2. Anlamsal arama: misafir sorgusunu belge işleme yükünden ayır
Burada önemli bir ayrım var: incelediğim kodda ortak saatlik sınır bilgi tabanı parçalarının arka planda vektörleştirilmesine ait. Sınır dolunca hazır ve güncel vektörler sırf bu yüzden kullanılamaz hâle gelmiyor. Asıl etki, vektörü eksik olan bilgi tabanlarının hazırlanmayı beklemesi ve o sırada sözcüksel aramaya düşmesi.

Uzun vadede işletme başına arka plan bütçesi, misafir sorgularına ayrılmış kapasite ve bunların üstünde sağlayıcı maliyet tavanı olsun. Bütçeyi uygulama kopyaları birlikte görsün. Host aynı Wi-Fi kaydını art arda düzenlerse her ara sürüm için para harcamayalım; kuyrukta güncel sürüm kalsın, değişmeyen parçalar yeniden işlenmesin. Güncel bilgi henüz vektörleşmediyse eski şifreyi getirmeyelim: güncel kayıtta sözcüksel arama yapılsın; sağlam dayanak bulunamazsa cevap otomatik gitmesin. İlk kabul testi de net: A işletmesi yoğun düzenleme yaparken B işletmesinin güncel bilgi tabanındaki anlamsal araması çalışmaya devam etmeli.
3. Daire başlığı: ek takmayalım
Öneri iyi. Ben şunu kullanırdım:
Aynı rezervasyon birden fazla dairede görünüyor
Sahil Evi · Lale 5
Kayıtları karşılaştır

Böylece daire adını değiştirmiyoruz, Türkçe ek sorunu kalkıyor ve üç daire varsa başlığı yeniden tasarlamak gerekmiyor.

4. Son kopya: “kaldırılamaz” yerine neden ve çıkış yolu
Mevcut metin yanlış değil ama “bu rezervasyon hiçbir yerden kaldırılamaz” gibi okunuyor. Daha açık metin:
Bu rezervasyon artık yalnızca bir dairede görünüyor. Son kaydı bu ekrandan kaldırmadık.

Ardından liste kendiliğinden güncellensin ve Rezervasyonu aç gösterilsin. Yanlış kopyayı kaldır ile Rezervasyonu iptal et ayrı işlemler kalsın. En önemli test: İki yönetici eski ekranlardan aynı anda farklı kopyaları kaldırmaya çalışırsa en az bir kayıt kalmalı. Güncel çakışmayı sunucu, kaldırma işlemiyle birlikte atomik denetlemeli; ekranın gösterdiği eski sayıya güvenmemeli.  

bir yazılım mühendisi dediki her soru için model veri tabanına gitmesine gerek yok “Wi-Fi şifresi ne?” Güncel bilgi tabanı sürümüne bağlı arama sonucu önbellekten gelebilir. Host şifreyi değiştirince eski sonuç artık kullanılmamalı.

* “Bugün 12’de girebilir miyiz?” Rezervasyon durumu, temizlik ve erişim bilgisi değişebilir. Burada güncel kayıtları okumak ve otomatik onaydan hemen önce yeniden doğrulamak doğru davranış. 

Önce temsilî bir misafir mesajında kaç veritabanı sorgusu ve kaç embedding çağrısı yapıldığını ölç. Gereksiz tekrarları kaldır; işletme, daire ve güncel kaynak sürümüne bağlı sonuçları yeniden kullan. Rezervasyon ve erişim gibi değişken bilgilerin son kontrolünü koru. Şablon kotasını ve son rezervasyon kaydı korumasını eşzamanlı veritabanı testleriyle doğrula. Misafire giden davranışı değiştirecek kararları önce örnekle göster. mesela çok temel merhaba nasılsın gibi bir mesajlardaki akış nasıl onada baktırt. uzun uzun didik didik çalış
