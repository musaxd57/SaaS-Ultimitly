# TASARIM 2026-11-13 gece — Özerklik akışı ("işi bana bırakın" tablo olmadan) + değer satırı önerisi (KOD YOK)

> Kurucu 11-13 gece, öneri 3 için: "Küçük tablo 4-5 satır olabilir ama daha iyi bir fikir için uzun uzun düşün; en mantıklı akış, görsel olarak
> güzel; host sürekli siteye girip manuel sisteme benzetme; ML platform bazında." Öneri 6 için: "Sen kendi önerini yaz, ben Codex'e soracağım."
> Bu belge iki öneriyi yazar. Kod yok; misafire giden davranışı değiştiren her adım kurucu onayıyla. Görsel taslaklar (telefon + masaüstü)
> kurucuya ayrıca gönderildi; ekranlar gerçek uygulamanın bileşenleri ve renkleriyle çizildi.

## 0. Kısa cevap
- **Tablo yerine "yerinde devir":** ev sahibi özerkliği bir ayar sayfasında AÇMAZ; sistem, ev sahibinin aynı türden kararı birkaç kez aynı
  şekilde verdiğini görünce, **o kararın verildiği yerde** tek cümleyle sorar: "Bu tür soruları bundan sonra ben cevaplayayım mı? [Evet]
  [Sormaya devam et]". Ayar sayfası yok, matris yok, ön tahmin yok.
- **Ne bırakıldığı tek yerde, cümleyle:** Panel'de "Asistanın üstlendikleri" kartı — sistemin kendi yazdığı 3–6 cümle ("Wi-Fi, giriş saati, yol
  tarifi sorularını ben cevaplıyorum · Temizliği Ayşe'ye atıyorum, gelemezse Fatma'ya"). Her cümlenin yanında tek düğme: **[Bana sor]**.
- **Güven iner kendiliğinden, çıkar yalnız onayla:** ev sahibi sistemin işini düzeltirse (ya da misafir "yanlış" derse) sistem o işi
  KENDİLİĞİNDEN geri verir ve söyler. Yukarı çıkmak hep ev sahibinin "Evet"iyle.
- **Düzeltmeden öğrenme:** ev sahibi bir taslağı hep aynı şekilde düzeltiyorsa (ör. hep otopark bilgisini ekliyorsa) sistem bilgi tabanına
  eklemeyi önerir — bir dokunuş.
- **Platform öğrenmesi (ML) dürüst sınırıyla:** işletmeler arası yalnız SAYILAR öğrenilir (hangi konu türü genelde düzeltilmeden onaylanıyor),
  misafir metni asla; bu sayılar yeni ev sahibine **ne zaman ve hangi sırayla** teklif edileceğini belirler, hiçbir işi kendiliğinden açmaz.
  Bugün tek işletme olduğu için bu katman ancak birkaç işletmeden sonra anlamlı — ilk sürüm işletmenin kendi kararlarıyla çalışır.
- **Değer satırı (öneri 6):** Panel'de ay başında tek satır: "Kasım'da sizin yerinize: 214 misafir sorusu cevaplandı (81'i gece) · 31 giriş
  mesajı zamanında gitti · 38 temizlik görevi açılıp atandı · 12 konuyu size bıraktım." Tahmini "kazandırılan saat / lira" YOK.

## 1. Neden tablo değil
Tablo (iş × "kendim yaparım / hazırlarım / size bırakırım") üç yerde ev sahibini yanlış işe sokar:
1. **Ön tahmin ister.** Ev sahibi, sistemin henüz hiç cevaplamadığı bir iş türü için "kendisi yapsın mı?" kararını boşlukta verir. Doğru karar
   ancak sistemin o işi nasıl yaptığını GÖRDÜKTEN sonra verilebilir.
2. **Ayar sayfasına gitmeyi ister.** Kurucunun sözü: "host sürekli siteye girip manuel sisteme benzetme". Tablo, ev sahibinin özerkliği
   yönetmek için ayrı bir yere gitmesini zorunlu kılar.
3. **Bayatlar.** Bir kez doldurulan tablo sistemin gerçek başarısını yansıtmaz; sistem kötüleşse de "kendim yaparım" olarak kalır.
Büyük ürünlerin yönü de aynı (`docs/TASARIM-2026-11-13-aaas-yonu.md` §2): kademeli seviye, işe / daireye göre açma; ama Lixus'un farkı şu olur:
**seviye ayar sayfasından değil, ev sahibinin kendi kararlarından ve kodun doğruladığı kanıttan doğar; teklif kararın verildiği yerde gelir.**

## 2. Akış — dört an

### 2.1 An 1: karar anında teklif ("yerinde devir")
**Ne zaman:** aynı iş türünde ev sahibi son 14 günde en az 10 karar verdi ve %90'ını sistemin hazırladığını DEĞİŞTİRMEDEN onayladı (bugünkü
`promotionReadiness` ölçütü, `src/lib/ai-suggestions/core.ts:27-29`, kurucu 10-12 "2 hafta ≥ %90"). Kilitli türler (şikâyet, para / iade,
güvenlik, kural ihlali, kapı kodunu ilk kez öğreten değişiklik — `HIGH_STAKES_RISK_TYPES`) HİÇ teklif edilmez.
**Nerede:** ev sahibinin o türden bir sonraki kararı verdiği yerde — onayladığı taslağın hemen altında, "Bugün" kartında, ileride WhatsApp'ta.
**Örnek (önce → sonra):**
- *Önce:* 02:10 "Wi-Fi şifresi ne?" → taslak hazırlanır, sabah ev sahibi [Gönder]'e basar. On birinci kez.
- *Sonra:* ev sahibi onuncu Wi-Fi taslağını değiştirmeden gönderdiği anda, taslağın altında: "Son 2 haftada Wi-Fi ve giriş sorularına
  hazırladığım 11 cevabı hiç değiştirmeden gönderdiniz. Bundan sonra bu soruları ben cevaplayayım mı? [Evet, bana sormadan] [Sormaya devam et]".
  Ev sahibi "Evet" der → o gece 02:10'daki soru kendiliğinden cevaplanır, sabah "Bugün" kartının altında "1 soru cevaplandı" görünür.
- "Sormaya devam et" → aynı tür 30 gün boyunca yeniden teklif edilmez (ısrar yok).
**Kural:** teklif bir kez, tek cümle, tek dokunuş; ev sahibine yeni e-posta YOK (kurucu: "zaten yeterince mail").

### 2.2 An 2: "Asistanın üstlendikleri" — sistemin yazdığı görev tanımı
Panel'de, "Bugün" kartının altında küçük bir kart (ayar sayfası değil). Satırlar sistemin cümleleri; matris, radyo düğmesi, seviye numarası yok:
- "Wi-Fi, giriş / çıkış saati ve yol tarifi sorularını **ben cevaplıyorum**." · son 30 günde 64 cevap · **[Bana sor]**
- "Giriş bilgisi mesajını girişten bir gün önce **ben gönderiyorum**." · **[Bana sor]**
- "Yeni rezervasyonda temizliği **Ayşe'ye atıyorum**; gelemezse **Fatma'ya** soruyorum." · **[Değiştir]** (daire sayfasına gider)
- "Erken giriş isteklerinde **cevabı hazırlıyorum, siz onaylıyorsunuz**." · son 30 günde 6 istek
- Sabit son satır (düğmesiz): "Şikâyet, para / iade ve güvenlik konularını **her zaman size bırakıyorum**."
**[Bana sor]** → o iş anında taslağa döner, kart "Tamam, bu soruları yine size soracağım." der. Geri almak bir dokunuş; tekrar açmak yine
An 1'deki teklifle (ya da bu satırın yanında beliren "[Yine ben yapayım]" ile — yalnız daha önce verilmiş bir yetki için).
Kurucunun "4–5 satır olabilir" sınırı burada doğal olarak tutulur: kart yalnız İŞLETMEDE GERÇEKTEN olan işleri listeler, boş tür yazılmaz.

### 2.3 An 3: kendiliğinden geri çekilme (güven iner)
Sistem bir işi üstlendikten sonra şu işaretlerden biri gelirse o işi **kendiliğinden** ev sahibine geri verir ve "Bugün" kartında tek satırla
söyler — yeniden açmak yine ev sahibinin "Evet"iyle:
- ev sahibi, sistemin cevabından sonra aynı konuşmada **aynı konuyu düzelten** bir mesaj yazdı (ör. sistem "Otopark yok" dedi, ev sahibi
  "Düzeltme: arkada otoparkımız var" yazdı);
- misafir sistemin cevabından sonra **"yanlış / çalışmıyor / olmadı"** dedi (Wi-Fi şifresi çalışmıyor);
- cevabın dayandığı bilgi tabanı kalemi cevaptan sonra **değiştirildi** (bilgi eskiydi);
- aynı tür işte yeni bir kilitli sinyal (şikâyet) cevaptan sonra 24 saat içinde açıldı.
*Örnek satır:* "Wi-Fi sorularını size geri verdim: dün gece verdiğim şifre için misafir 'çalışmıyor' dedi. Bilgi tabanındaki şifreye bir göz
atın. [Bilgi tabanını aç]".
**Neden kendiliğinden:** güveni düşürmek güvenli yöndür (iş insana döner, misafire hiçbir şey gitmez); güveni yükseltmek misafire gideni
değiştirir — o yüzden yalnız onayla.

### 2.4 An 4: düzeltmeden öğrenme
Ev sahibi taslakları aynı şekilde düzeltiyorsa (ör. son 5 otopark taslağına "arkada ücretsiz otoparkımız var" cümlesini ekledi) sistem:
"Otopark cevaplarına hep aynı bilgiyi ekliyorsunuz: 'Arkada ücretsiz otoparkımız var.' Bilgi tabanına ekleyeyim mi? [Ekle] [Hayır]".
[Ekle] → bilgi tabanı kalemi önizlemeyle yazılır (bugünkü "Bilgi tabanına ekle" önizlemeli onay deseni, migration 89). Böylece taslak bir
dahaki sefere zaten doğru gelir ve An 1'in teklifi hak edilmiş olur. Kapı kodu / Wi-Fi şifresi gibi gizli değerler bu yoldan ÖNERİLMEZ
(bugünkü kural: `host-channel/kb-save.ts`).

## 3. Platform öğrenmesi (ML) — ne öğrenilir, ne öğrenilmez
**Öğrenilir (işletmeler arası, yalnız sayılar):** iş türü başına "değiştirmeden onay oranı", "geri çekilme oranı", "misafirin 'yanlış' deme oranı".
Bu sayılar üç şeye yarar: (a) yeni ev sahibine teklifin SIRASI (en güvenli tür önce — çoğu ev sahibinin ilk bıraktığı iş), (b) teklifin ZAMANI
(platformda düzeltilme oranı yüksek bir türde eşik daha yüksek), (c) bir türün platformda kötüleştiğini erken görmek (ör. bir model
güncellemesinden sonra "giriş saati" cevaplarında düzeltme artarsa o tür bütün işletmelerde teklif edilmez ve operatöre alarm gider).
**Öğrenilmez:** misafir metni, ev sahibi metni, kişi adı işletmeler arasında hiçbir yere taşınmaz (KVKK; kanarya / saklama kuralları aynen).
Sayılar işletmeyi tanıtmayacak büyüklükte toplanır (en az N işletme; N kurucu ile).
**Hiçbir zaman:** platform sayısı tek başına bir işi açmaz — her işletmede açan, o işletmenin "Evet"idir. Kilitli türler platform ne derse desin
kilitli kalır. Modelin "eminim"i ya da benzerlik puanı dayanak sayılmaz (`docs/TASARIM-2026-11-12-anlamsal-karar-mimarisi.md` §1.3).
**Dürüst durum:** bugün canlıda tek işletme var ve Railway kapalı → platform katmanı ilk sürümde YOK; tasarım onun için yer bırakır (kayıtlar
iş türü + sonuç olarak tutulur), istatistik birkaç işletmeden sonra açılır.

## 4. Ekranlar (görsel taslaklar — kurucuya gönderildi)
- **A — Yerinde devir kartı:** onaylanan taslağın altında / "Bugün" kartında; başlık "Bu işi bana bırakabilirsiniz", tek cümle gerekçe (sayıyla),
  iki düğme.
- **B — Asistanın üstlendikleri:** Panel'de küçük kart; her satır bir cümle + son 30 gün sayısı + [Bana sor]; son satır kilitli türler.
- **C — Geri çekilme satırı:** "Bugün" kartında sarı satır; neden + tek düzeltme bağlantısı.
- **D — Düzeltmeden öğrenme kartı:** taslak düzenleme sonrası; önerilen bilgi metni + [Ekle] [Hayır].

## 5. Ne değişmez
- Kilitli türler: şikâyet, para / iade, güvenlik, kural ihlali, ev sahibi kararı gerektiren konaklama istekleri (erken giriş / geç çıkış /
  evcil hayvan "kesin evet"i), kapı kodunu ilk kez öğreten değişiklik → hiçbir an bunları teklif etmez.
- Kod kapıları (`passesAutoReplySafetyGate`, çıktı vetosu, "bilgim yok" kuralı, ev sahibi sesi) otomatik cevapta da aynen çalışır; özerklik
  yalnız "kapıdan geçen cevap ev sahibine sorulmadan gitsin mi" sorusudur.
- Bugünkü işletme anahtarı (`autoReplyHospitable` + saat penceresi) acil durdurma olarak kalır: kapalıysa hiçbir üstlenilmiş iş çalışmaz.

## 6. Veri ve mimari (kısa)
- **Karar kaydı (yeni, migration):** iş türü · sonuç (değiştirmeden onay / düzenlenerek onay / ret / geri çekilme sebebi) · zaman · kaynak
  kimliği (metin YOK). Bugün eylem önerilerinde var (`SuggestionDecision`), cevap taslaklarında YOK: `AiGeneration.draftText` saklanıyor ama
  ev sahibinin sonunda gönderdiği metinle bağ kurulmuyor → "değiştirmeden gönderdi mi" ölçülemiyor. İlk adım bu bağ (gölge kayıt).
- **Yetki kaydı:** işletme · iş türü · seviye (hazırla / kendim yap) · veren kişi · veriliş / geri alınış zamanı · geri çekilme sebebi.
  Migration'sız yol: `AutomationRule` JSON kalıbı (erken giriş kuralı gibi); denetim kaydı alan adıyla.
- **İş türü listesi kapalı küme** (kodda): bilgi sorusu (Wi-Fi · giriş / çıkış · yol / otopark · olanaklar) · giriş mesajı · karşılama / çıkış ·
  temizlik ataması · mesajdan görev · erken giriş (yalnız "hazırla"). Yeni tür kod değişikliğiyle eklenir.
- **Platform sayıları:** gece toplu iş; işletme başına satır değil, tür başına toplam; en az N işletme şartı.

## 7. Aşamalama (her adım ayrı onay)
| # | Adım | Misafire gideni değiştirir mi | Migration |
|---|---|---|---|
| Ö1 | Gölge karar kaydı: taslak ↔ ev sahibinin gönderdiği metin bağı ("değiştirmeden" ölçüsü), ekranda hiçbir şey yok | hayır | evet |
| Ö2 | "Asistanın üstlendikleri" kartı — yalnız BUGÜNKÜ açık işleri cümleyle gösterir + [Bana sor] (bugünkü anahtarları kapatır) | hayır (yalnız kapatır) | hayır |
| Ö3 | Kendiliğinden geri çekilme (An 3) | hayır (güven indirir) | Ö1'e bağlı |
| Ö4 | Düzeltmeden öğrenme (An 4) | dolaylı (bilgi tabanı; her kalem onaylı) | hayır (migration 89 deseni) |
| Ö5 | Yerinde devir teklifi (An 1) | **evet** — kurucu onayı + ölçüm | Ö1'e bağlı |
| Ö6 | Platform sayıları | hayır (yalnız teklif sırası / zamanı) | evet; birkaç işletmeden sonra |

## 8. Kurucuya sorular
- **ÖZ-1:** "Tablo yerine yerinde devir + cümleli görev tanımı" yönü doğru mu?
- **ÖZ-2:** Teklif eşiği bugünkü "14 gün · ≥10 karar · ≥%90 değiştirmeden onay" mı kalsın?
- **ÖZ-3:** "Sormaya devam et" sonrası yeniden teklif 30 gün sonra mı, hiç mi?
- **ÖZ-4:** Kendiliğinden geri çekilme işaretleri (§2.3) tamam mı; eksik var mı?
- **ÖZ-5:** Platform sayıları için en az kaç işletme (N)?
- **ÖZ-6:** Ö1 (gölge karar kaydı) için migration onayı.

---

## 9. Öneri 6 — değer satırı (Codex'e gidecek öneri)
**Ne:** Panel'de, "Bugün" kartının altında, ayın ilk 7 günü geçen ayın; diğer günlerde bu ayın şimdiye kadarki satırı. Yeni e-posta YOK
(kurucu "zaten yeterince mail"). Fiyat düz kalır (₺449 / ₺899 / ₺1.699, daire bandı); satır fiyatı değiştirmez, işin görünür olmasını sağlar.
**Örnek:** "Kasım'da sizin yerinize: 214 misafir sorusu cevaplandı (81'i gece 23:00–08:00) · 31 giriş mesajı zamanında gitti · 38 temizlik
görevi açılıp atandı · 12 konuyu size bıraktım."
**Sayım kuralları (makbuzsuz iddia yok):**
- "cevaplandı" = kendiliğinden giden cevap (bugünkü `aiReplyWhere` — Raporlar ve "son 24 saatte sizin yerinize" ile AYNI yardımcı; onaylanan
  taslak sayılmaz, teslim edilemeyen sayılmaz).
- "gece" = işletmenin saat diliminde 23:00–08:00 arası gönderim zamanı.
- "giriş mesajı zamanında gitti" = otomatik gönderim kaydı `sent` (elle gönderim düşülür — bugünkü sayaçla aynı).
- "görev açılıp atandı" = sistemin açtığı (`origin: system`) ve bir kişiye atanmış temizlik / hazırlık görevi.
- "size bıraktım" = sistemin bilerek ev sahibine bıraktığı konu (kapıdan geçmeyen, kilitli tür). ⚠️ Bunun KALICI sayım kaynağı bugün tek
  değil (`RiskEvent` + konuşma durumu + öğe kayıtları); ölçülmeden satıra girmez. İlk sürüm bu parçasız çıkabilir.
- Tahmini "şu kadar saat / lira kazandınız" YAZILMAZ (V2 para etkisi kuralı: sahte kesinlik yok).
- Sakin ayda (hepsi 0) satır basılmaz.
**Neden düz fiyat:** çözüm başına ücret, sistemin ne kadar çok kendiliğinden gönderirse o kadar kazanması demek — "riskli mesaj hep insana"
ilkesine ters teşvik (`docs/TASARIM-2026-11-13-aaas-yonu.md` §4-7). "Size bıraktım" parçası bu yüzden önemli: satır yalnız otomasyonun
miktarını değil, güvenlik ilkesinin çalıştığını da gösterir.
**Codex'e sorular:** (1) Satır Panel'de mi, Raporlar'da mı daha doğru? (2) "Size bıraktım" için tek kalıcı sayım kaynağı ne olmalı — yeni
bir olay kaydı mı, var olan kayıtlardan türetme mi? (3) Ay sınırında işletme saat dilimi ve gece penceresinin tanımı yeterli mi? (4) Bu
satırı aylık e-posta yapmadan müşteriye "değer"i göstermenin daha iyi bir yolu var mı?
