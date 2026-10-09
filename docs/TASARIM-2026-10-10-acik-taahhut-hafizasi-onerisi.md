# Açık taahhüt hafızası — öneri (kurucu kararı bekliyor; KOD YOK)

> Kurucu talimatı 09-07: "Açık konu/taahhüt hafızası: 'Havlular 18:00'de gelecek' bilgisi son 25 mesajdan düşse de unutulmasın;
> tamamlanınca da kapanabilsin." Aynı talimat §7: "yalnız gerekçelendiğinde … çözülmemiş taahhütler … canlı müsaitlik / fiyat / ödeme /
> rezervasyon durumu / tamamlanan eylem için otorite olamaz" ve "Gelecek AI özelliklerini şimdi topluca uygulama". V2 örnek kartı:
> "⚠️ GUEST COMMITMENT — Guest was promised: 'Extra towels before 18:00' · No related completed task found · Deadline: 2h 14m".
>
> Kurucu yokken (10-10) bu maddeyi KODLAMADIM: yeni tablo (migration) ister, misafire söz verilen metni yorumlamak ürün kararıdır ve
> talimat "gerekçelendiğinde" diyor. Aşağıdaki öneri kurucu dönünce tek soruyla karara bağlanabilsin diye yazıldı.

## Bugün ne var

| Parça | Ne tutuyor | Taahhüdü tutuyor mu |
|---|---|---|
| Konuşma öğeleri (`ConversationItem`, migration 56) | Misafirin İSTEĞİ (havlu, IBAN, şikâyet…) + durum `open / pending_host / answered / done` | Hayır — "istek var" der, "ne söz verildi, ne zamana" demez |
| Dikkat Gerektirenler `held_request` | Ev sahibine bırakılan istek | Sözü değil, cevapsızlığı gösterir |
| Görevler (`Task.dueAt`, `sourceMessageId`) | Yapılacak iş + son tarih | Misafire söz verildiğini bilmez |
| Yapay zekânın kendi sözü | YOK — kural: misafire bekleme / "ileteceğim" sözü gitmez (çıktı vetosu) | — |

Yani "söz" bugün yalnız EV SAHİBİNİN elle yazdığı cevapta doğar ("Havlular 18:00'de gelecek") ve hiçbir yerde tutulmaz.

## Seçenekler

**A — Yapılandırılmış kaynaktan (önerim, metin yorumu YOK):** söz yalnız kodun BİLDİĞİ yerden doğar: (1) ev sahibi cevap yazarken
panelde "Misafire söz ver: ☐ havlu ☐ temizlik … saat [18:00]" seçer (tek tık; isteğe bağlı) ya da (2) karar kartı onaylanınca (erken giriş
13:00 gibi) söz otomatik oluşur. Söz bir görevle bağlanır; görev `done` olunca söz kapanır; süre geçip kapanmadıysa Dikkat Gerektirenler'de
"⚠️ Misafire söz verildi: havlu, 18:00 — ilgili görev tamamlanmadı (2 sa 14 dk kaldı / 30 dk gecikti)".
Örnek: misafir 15:10 "Havlu bitti" → ev sahibi "18:00'e kadar getiriyoruz" yazıp "söz: havlu, 18:00" işaretler → görev açılır →
18:00'de görev hâlâ açıksa kart kırmızı. Yapay zekâ cevabına girdi: "Açık söz: havlu, 18:00'e kadar (ev sahibi verdi)" — misafir "havlular
nerede?" diye sorarsa model sözü bilir ama "geldi / tamamlandı" DİYEMEZ (talimat §7: tamamlanan eylem için otorite değil).
Bedel: yeni tablo `GuestCommitment` (konuşma, tür kapalı küme, son an, görev bağlantısı, durum; METİN YOK) = migration + panel düğmesi.

**B — Ev sahibinin metninden model çıkarır:** ev sahibinin giden mesajını küçük bir model okur, "söz + saat" çıkarır. Ev sahibine iş
düşmez ama yanlış okuma riski var ("18:00'den sonra gelebilirsiniz" söz değil); her ev sahibi mesajında model çağrısı (maliyet + gecikme);
ölçüm seti ister.

**C — Şimdilik yapma:** talimatın "gerekçelendiğinde" şartı — bugün 25 mesajlık pencere + öğe kayıtları sözlerin büyük kısmını zaten
taşıyor; gerçek bir "unutulan söz" vakası ölçülünce başlanır.

**Önerim:** A — söz, yapay zekânın yorumuna değil ev sahibinin açık işaretine dayanır (yanlış "söz verildi" alarmı olmaz; ürünün "riskli
şey insanda kalır" ilkesiyle aynı). İlk dilim migration'sız yapılamaz; migration 60 itildikten sonra ayrı paket (61) olarak hazırlarım.
Karar: A / B / C?
