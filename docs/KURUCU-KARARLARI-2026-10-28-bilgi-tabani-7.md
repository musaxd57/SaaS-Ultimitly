# Kurucu kararları — 2026-10-28: bilgi tabanı tasarımı §7 (AYNEN)

Sorular: `docs/TASARIM-2026-10-23-bilgi-tabani-dosya-rag-ve-tarama.md` §7 (7-A … 7-G). Aşağıdaki metin kurucunun mesajıdır, AYNEN; altında
koda / tasarıma nasıl çevrildiği.

> 7-a için başta yükleme olsun dışarı aktarım sonuçta bizim sınıflandırmamızdan sonra olursa iyilik gibi olur ama bu özellik olarak olsun
> deneme sürümünde olmasın ve biz diyelim dosya yüklediler onu kategoriye mi ayırıyoruz bölerek metni yoksa direk tek metin sabit olarak mı
> koyuyoruz onu nasıl yapıyoruz açıklarsan sevinirim ama kesinlikle 2 ve 3ü ekleyebiliriz iyi olucaksa şimdiden kod bazında onları eklemeye
> başlayabilirsin hatta onlarda trialda olmasın
>
> 7b evet sayılsın
>
> 7c önerin mantıklı bide onayla düzenle böyle kalsın yazmışsın böyle kalsın yerine "vazgeç" yaz böyle kalsın belirsiz oluyor
>
> 7-Dde aklıma birşey yakıldı sonrası güzel host onay verirse hemen mesaj çok geçmemisine yeni soru gelmemesine veya konunun değişmemesine
> bağlı olarak mi göndersin buna ek olarak mesela 24 saat garip olabilir onu bence tam kural gibi değilde bağlama bir daha mı quick bakış
> yapıp gönderse bide bunları sen direk test et sonuçlarını karşılaştır banada sonuçları gösterebilirsin karar veririz, süre kısmı önemli
> mantıklı bir çözüm lazım milyarlık sistem nasıl olur sence en iyi, ve o bilgi tabanına kaydedeyimmi hemen hangi daire için olduğu sorulsun
> yanında bütün daireler için kaydet tuşu veya dairelerinden istediklerini seçebilecek ve o daireler içinde eklenecek bir özellik bence çok
> iyi olur. bu arada eksik bilgi döngüsünden ben korkmuyorum ilerde wpdan hostlara mesaj göndermek isteme fikrim var eposta çok çok az wpdan
> daha çok o yüzden ileride ama projeyi bitirmeye yakın
>
> 7-e yapabiliriz bizim için iyi olur ama dimi? ve çok fazla ücret gelir mi servisten sorun olmuycak gerçekten mantıklıysa yapalım.
>
> 7-f tamam
>
> 7-g uygundur
>
> bunları yapabiliyorsan paralelde yap şuan koşan kapı yeşil olduğu gibi push edersin bu prompttaki herşeyide subagentlarla kontrol ettirerek
> en didik şekilde yap sonra sana clear atmak istiyorum.

## Çeviri (karar → iş)

| Madde | Karar | İş |
|---|---|---|
| 7-A (1) yükleme | önce yükleme | S4 sunucu API + S6 ekran (çekirdek S0/S2 hazır, bağlı değil). Deneme sürümünde AÇIK (yalnız 2 ve 3 kapalı). |
| 7-A (2) şablon indir | ekle, deneme sürümünde YOK | kod: şablon üreticisi + indirme ucu, ücretli plan kapısı |
| 7-A (3) bilgi tabanını dışa aktar | ekle ("özellik"), deneme sürümünde YOK | kod: dışa aktarma ucu (şablonla aynı biçim → yeniden yüklenebilir), ücretli plan kapısı, denetim kaydı |
| 7-A soru | "kategoriye mi bölüyoruz, tek metin mi?" | cevap: rapor §1 (bölüyoruz; metin AYNEN, model yazmaz) |
| 7-B | dosyadan gelen konular plan sınırına SAYILIR | S4'te bugünkü sınır kuralı (taşan → "en çok N konu seçin") |
| 7-C | tarama + günde 3 soru, panel kartı; düğme "Böyle kalsın" → **"Vazgeç"** | tasarım metni düzeltildi; KbScanQuestion (migration 88, onaylı) |
| 7-D | gönderim zamanı sabit 24 saat değil; onay anında BAĞLAMA bir daha bakılsın — ölç, karşılaştır, sonuçları göster, karar birlikte. "Kaydedeyim mi?" → hangi daire + "Bütün daireler" + daire seçimi. Kanal şimdilik e-posta + panel; WhatsApp proje sonuna yakın | ölçüm: kural kolu ↔ bağlam kolu (ayrı rapor); daire seçimli kaydetme tasarımı |
| 7-E | mantıklıysa yap; ücret sorusu | maliyet hesabı rapor §1; S3 (migration 87, anahtar kapalı) |
| 7-F | değişiklik yok | gölge kip ölçümü Railway açılınca |
| 7-G | uygun | etiket biriktirme → ~500 örnekte okuyucu ince ayar denemesi (sonra) |
