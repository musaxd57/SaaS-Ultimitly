# ARAŞTIRMA — Rakip UX (Guesty · Hostaway · Hospitable · Uplisting · Turno · Breezeway)

> Kurucu isteği 09-11: *"guesty.com da çok güzel böyle UX tasarımları var pagelerde uzun uzun bak"*
> ve *"görevler panelini 0dan yapmalıyız… kimse mal gibi tamamlandıya tıklamakla uğraşmaz"*.
>
> ⚠️ **YÖNTEM SINIRI — dürüstçe:** bu oturumun çıkış ağ geçidi rakip alan adlarının **hepsini
> 403 ile reddetti** (guesty.com, hostaway.com, hospitable.com, uplisting.io, help.* alt alanları,
> Reddit/G2/Capterra/YouTube dahil). **Tek bir ekran görüntüsü GÖRÜLMEDİ.** Aşağıdaki her şey
> WebSearch sonuç özetlerinden (o sayfaların METNİNDEN) geliyor. Doğrulanamayanlar ayrıca işaretli:
> Guesty'nin widget kataloğu · renk paleti/yoğunluk/dark mode · mobil ekran düzenleri.
> Repo tarafı birinci eldendir (dosyalar okundu).

---

## 🚨 ANA BULGU: "kimse Tamamlandı'ya tıklamaz" sorununu piyasa ÜÇ YOLLA birden çözüyor

**Ve hiçbiri Kanban kullanmıyor. Dördünden hiçbiri.**

### ① İŞİ YAPAN tıklıyor, host değil
- **Guesty:** görev "Unassigned" durur, ekip üyesi mobil uygulamadan **kabul eder**; temizlikçi
  çalışırken checklist'i tikler, sonra **"End task"** → durum otomatik Completed. Görev günlüğü
  kabul edeni ve checklist güncelleyeni kaydeder.
- **Hostaway:** temizlikçi mobil uygulamada checklist'i işaretler, **önce/sonra fotoğrafı** yükler,
  sorun varsa (hasar, eksik eşya) uygulamadan **bayrak kaldırır**. Bitince pano "guest-ready" gösterir.
- **Breezeway:** görevler rezervasyon takviminden otomatik doğar ve temizlikçiye **SMS/e-posta/push**
  ile dağıtılır.

### ② Tıklama BİR ŞEY KAZANDIRIR
- **Turno:** proje "tamamlandı" işaretlendiği anda **ÖDEME otomatik başlar**. Ayrıca host
  checklist'i **zorunlu** yapabilir — temizlikçi tüm maddeleri tiklemeden tamamlayamaz.

### ③ Durum OLAYLARDAN TÜRETİLİR — kaçan tıklama mezarlık yaratmaz
- **Guesty:** operasyonel gerçek görevde değil **İLANDA** durur: *Not set / Unknown / Clean /
  Waiting For Inspection / **Dirty***. Çıkış → **Dirty**; temizlikçi görevi bitirince → **Clean**.
  Multi-calendar'dan tek tıkla düzeltilebilir.
- **Hostaway:** aynı kavram, "Listing Cleanliness Status".

### ④ Görevin ZAMAN PENCERESİ var, biten/geçen iş BAŞKA YERDE yaşar
- **Guesty:** her görevde **"Can start from"** ve **"Must finish before"**; ve 🚨 **tamamlanan VE
  vadesi geçmiş-tamamlanmamış görevler "My tasks" içindeki AYRI bir "History" bölümünde** — çalışma
  panosunda DEĞİL.
- **Hostaway:** temizlik görevi **çıkış saati geçince** otomatik tetiklenir, mülke göre boyutlanır,
  sonraki girişten önce tampon bırakılır.
- **Uplisting:** program rezervasyon hareketinden doğar ve aynı gün devirlere **kendiliğinden uyarlanır**.

### 🚨 BİZDEKİ DURUMUN TEŞHİSİ
`task-board.tsx`'teki **WhatsApp paylaşımı** ipucunun kendisi: **temizlikçimizin hesabı YOK ve paneli
hiç açmıyor.** Yani "Tamamlandı"ya tıklayabilecek tek kişi host — dairede değil, tıklamaktan hiçbir
şey kazanmıyor ve makul olarak görmezden geliyor. Üç mekanizmanın **üçü de** bizde sıfır.
Kodun kendi yorumu "sınırsız büyüme Tamamlandı sütununda" diyor ama gerçek büyüme **Yapılacak**'ta —
çünkü oradan hiçbir şey ÇIKMIYOR.

Şema panodan daha iyi durumda: `Task.status`'te **`awaiting_review` zaten tanımlı** ama pano onu
bilerek gizliyor; `TaskUpdate` zaten olay başına fotoğraf+not+durum tutuyor. **İkisi de migration'sız
kullanılabilir.**

---

## Diğer bölümler (özet)

**Dashboard.** Dördünden hiçbiri "bugün paneli"ni başa koymuyor. Guesty'nin operasyonel evi
**Multi-Calendar**: rezervasyon + blok + **temizlik durumu** + fiyat + kanal AYNI SATIRDA, ve eylemler
takvimin İÇİNDE yapılıyor. Yapısal fikir: *sabah taraması bir ZAMAN EKSENİ, sayaç kümesi değil.*
Hostaway kanal-renk kodlu takvim + Pro'da **yapılandırılabilir** KPI widget'ları (yani onlar da tek bir
doğru düzen bulamamış). 2026 cevapları layout değil **AI CoHost**: canlı veri üstünde ajanlar.
→ Bizim iki gerçek açığımız: **giriş/çıkış iki ayrı liste** (host aynı-gün devri kafasında birleştiriyor —
oysa `stats.sameDayTurnovers` zaten hesaplı), ve **hiçbir yerde temizlik durumu yok**.

**Inbox.** Dördü de aynı: liste | thread | sağ bağlam paneli. Guesty sağ panelde konaklama, kanal,
**misafir ruh hali**, **AI konuşma özeti**, etiketler. Hostaway inbox'ı SADELEŞTİRMEK için AI Replies /
Automations / Templates'i sol menüye TAŞIDI; yan panele sekmeler koydu; üstte **snooze / escalate /
archive**. 🚨 Arşivlenen thread **misafir yazınca döner, host yazınca dönmez**. Hospitable: misafir
kırılımı + misafire görünmeyen **Conversation Note** + son 5–10 yorumdan **AI özeti**.
🚨 **Kimsenin pazarlamadığı şey: mesaj başına RİSK ROZETİ + devir GEREKÇESİ.** Piyasanın çerçevesi
"duygu analizi"; bizimki "bu mesaja kim cevap verebilir". Bizimki daha dürüst olanı — **eksik değil,
FARK.**

**Bilgi tabanı.** Hospitable = **rehber kitapçığı YÜKLE** + 20+ tanınan konu + **Airbnb'den kural
setlerini İÇE AKTAR**. Guesty = saved replies, **tek ilan / filtre / TÜM ilanlar** kapsamıyla.
🚨 Piyasada **"bilginiz eksik" uyarısı YOK** — bizim `KbGapsPanel` (A3) kamuya açık belgelenmiş
hiçbir şeyin dengi değil, GENUINE bir yenilik.

**Onboarding — rahatsız edici bulgu:** Guesty ve Hostaway self-serve onboarding'i ÇÖZMÜYOR, üstüne
**insan atıyorlar** (Guesty uzmanı, Onboarding Hub, Academy). Bizim ICP'miz (₺449, 2 daire) asla uzman
almayacak → **Guesty burada kopyalanamaz.** Kopyalanabilir tek model Hospitable'ınki:
**içe aktarılabilecek her şeyi içe aktar, yalnız gerçekten aktarılamayanı sor.**
🚨 Bu, "boş form duvarı" sorununu yeniden çerçeveliyor: **formlar boş, çünkü zaten çekebileceğimiz
veriyi soruyoruz.** Onboarding adım 3 yeni host'u BOŞ bir textarea'ya yolluyor, oysa `Property`
satırlarımızda ad/adres/şehir/giriş/çıkış saati senkrondan ZATEN var.

**Görsel dil (doğrulanan azı).** Guesty navigasyonu **sola değil ÜSTE** taşıdı (dikey alan için) —
⚠️ ama bizde bu yol KAPALI: kullanıcı sidebar gruplarını ve yatay tab-strip'i zaten geri aldırdı
("TEKRAR ÖNERME"). **Renk bir VERİ KANALI**: Hostaway kanala göre (Airbnb yeşil, Booking mavi, Vrbo
turuncu), Guesty inbox'ta durum renkleri, Uplisting "renk kodlu rezervasyon" ile öğrenme süresini
kısaltmakla övülüyor. → Bizde kanal ve temizlik durumu **metin**, renk değil; `Badge tone` ise
*konuşma durumunu* kodluyor (iş akışı), rakipler *kanal* ve *aciliyet* kodluyor.
**Mobil kimsede iyi değil** (Guesty 2.5★ Play / 3.4★ App Store; Hostaway 3.4★/4.2★) → **açık şerit.**

---

## SIRALANMIŞ 10 İŞ (etki ÷ efor)

| # | İş | Migration | Boyut |
|---|---|---|---|
| 1 | **Görev ekranının varsayılanı: güne göre gruplu operasyonel liste**; Kanban `Pano/Liste` anahtarına insin; Tamamlandı varsayılandan çıkıp "Geçmiş" olsun (Guesty History deseni) | YOK | ~1 gün |
| 2 | **Mezarlığı pencere kuralıyla kapat:** sonraki misafir GİRİŞ YAPMIŞ bir temizlik görevi ya yapılmıştır ya konusuzdur → `awaiting_review` ("Doğrulanmadı") + iki tuş "Yapıldı"/"Yapılmadı". 🚨 ASLA sessizce `done` (sahte tamamlanma kaydı) | **YOK** (`awaiting_review` zaten var) | 2 gün |
| 3 | **Köşeli parantez şablonlarını ÖLDÜR:** `KB_PRESETS` paragraf yerine küçük ALAN ŞEMASI olsun (Wi-Fi → "Ağ adı" + "Şifre"); cümleyi KOD kursun; boş alan **atlanır**, yer tutucu olarak YAZILMAZ | YOK | 2–3 gün |
| 4 | **Temizlikçiye girişsiz "Bitti" linki** (WhatsApp'la): görev başına HMAC imzalı token → checklist + kamera + tek "Bitti". Emsal bizde: `app/c/[token]` QR + `api/calendar/[token]` | **YOK** (imzalı token, kolon değil) | 3–4 gün |
| 5 | **Inbox varsayılanı "Sizi bekleyen"** (son mesaj gelen) + sidebar rozeti | YOK | 1–1,5 gün |
| 6 | **Dashboard'da tek zaman-sıralı "Bugün" kolonu**, aynı-gün devir ÇİFTİ görsel olarak bağlı | YOK | 1 gün |
| 7 | **Mülk başına temizlik durumu TÜRET** (Kirli/Temiz/Bilinmiyor) — #2 ve #4'ün emniyet ağı | YOK (türetilmiş) | 2 gün |
| 8 | **"AI hazır" rozetini listede göster** (🚨 listeye GÖNDER tuşu KOYMA — kapıya yeni bypass yüzeyi olur) | YOK | 1,5–2 gün |
| 9 | **Bir KB cevabı birden çok daireye** (mevcut COPY rotası; onay soyunu devralıyor) | YOK | 1 gün |
| 10 | **Üç panelli inbox** (liste ekranda kalsın) | YOK | 2–3 gün |

### AÇIKÇA YAPILMAYACAK İKİ ŞEY
- **Navigasyonu üste taşımak / sidebar'ı yeniden gruplamak** — Guesty'nin modül sayısı bizde yok ve
  kullanıcı bunu ZATEN geri aldırdı (CLAUDE.md: "TEKRAR ÖNERME").
- **Guesty'ye benzesin diye "duygu/ruh hali" rozeti** — bizde daha güçlüsü var (`riskType` +
  `RiskEvent` + gerekçeli kod kapısı). Duygu dekoratif; "buna kim cevap verebilir" ÜRÜN.
  Değiştirmek değil, **daha yüksek sesle etiketlemek** gerek.

## 🚨 Kurucunun şablon şikâyetinin TAM TEŞHİSİ

"Şablonla doldur" → `fillFromGap` şunu yapıştırıyor:
```
Ağ adı (SSID): [AĞ ADI]
Şifre: [ŞİFRE]
Modem salonda, TV ünitesinin yanındadır…
```
Host şimdi paragrafın İÇİNDE parantezleri bulacak, silecek, üzerine yazacak — **sıfırdan iki kelime
yazmaktan DAHA ÇOK İŞ**, ki kurucu tam olarak bunu söyledi. Üstelik **host'un hiç yapmadığı bir iddiayı
üretiyor** ("Modem salonda, TV ünitesinin yanındadır"). Ve `[ŞİFRE]` sınıfının tamamını — E4 eval
düşüşünü, `packKnowledgeBase` yer-tutucu notunu, hâlâ uygulanmamış veto önerisini — **bu şablon
doğurdu. Şablon bug'ın kendisi.**
