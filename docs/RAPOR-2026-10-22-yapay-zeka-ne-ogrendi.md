# Rapor 10-22 — Yapay zekâya bugün ne öğrettik, akış nasıl işliyor, eski / yeni cevaplar

> Kurucu isteği (10-22): "neler ekledin, neleri AI'a öğrettik, akışı / kontrolleri tam olarak anlaşılır şekilde yaz … eski yeni mesajı göster,
> en sık sorulan soruların eski cevapları yeni cevapları, onu bu karara iten şeyin ne olduğunu, hangi dosya olduğunu".
> Ölçümler GERÇEK model (gpt-5.1) ve ÜRÜNÜN KENDİ akışıyla (`applyChannelAutoReply`, gerçek veritabanı, gerçek kapılar) yapıldı; misafire
> hiçbir şey gitmedi. Eski = bugünkü kurucu kararlarından ÖNCEKİ kod (`ebc20009`) + canlıdaki bayraklar. Yeni = bugünkü kod + açılmaya
> onaylanan yeni anahtarlar (özür yok · kıdemli okuyucu · konu bazlı "bilgim yok" · başka misafirin bilgisi).
> ⚠️ 135 senaryoluk setin "yeni" kolu `06d7d381`'de koştu (kanıt şartı / yeniden yazma kapısı / yeniden okuma düzeltmelerinden ÖNCE);
> 22 senaryoluk hedefli set son kodla (`d4956157`) yeniden koşuldu (§6). Sık sorular bu düzeltmelerden etkilenmez (okuyucu yalnız tutar).

## 1. Kısaca

| ne | eski | yeni |
|---|---|---|
| Şikâyet taslağında özür / üzüntü cümlesi (135 senaryoluk set) | **16 / 16** | **0 / 16** |
| Gitmemesi gerekirken misafire giden (şikâyet, acil, iade, enjeksiyon…) | 0 | 0 |
| En sık sorulan sorular: misafire giden / doğru bilgiyle | 50 / 55 | 50 / 55 |
| "Şikâyetim yok, her şey harika! Çöpler kaçta toplanıyor?" | ⏸ tutuluyordu | ✅ gidiyor |
| Mizah / mübalağa ("açlıktan ölüyoruz haha, market kaçta açılıyor?") | ✅ 6 / 6 | ✅ 6 / 6 |
| Ev sahibine IBAN / nakit ödeme, başka misafirin adı | ⏸ tutuluyor | ⏸ tutuluyor (artık okuyucu da bakıyor) |
| Gerçek tehlike (gaz, prizden duman — şaka cümlesiyle bile) | 🚨 Sorunlu + e-posta | 🚨 Sorunlu + e-posta |

Ölçüm dosyaları: `docs/olcum/live-pipeline-2026-10-22-gpt-5.1-ba1022-{old,new}.md` (135 senaryo) ·
`docs/olcum/live-pipeline-2026-10-22-gpt-5.1-before-after-2026-10-22-ba1022-{old,new}.md` (22 hedefli senaryo) · karşılaştırıcı
`scripts/review/before-after-report.py`.

## 2. Bir misafir mesajı geldiğinde sırayla ne oluyor (yeni akış)

1. **Anlama katmanı** (`src/lib/ai/semantic/understand.ts` + `understanding-schema.ts`) mesajı isteklere böler: "Wi-Fi şifresi", "çöp saati", "şikâyet: duş soğuk"…
   Her istek bir **öğe** olur; şikâyet / acil / iade / başka misafirin bilgisi (U9) öğesi ev sahibine kalır, cevaplanabilir olanlar cevaplanır.
2. **Bilgi tabanı** seçilir (`src/lib/ai/kb-retrieve.ts`): soruya en uygun kalemler (anlamsal + sözcüksel + yeniden sıralayıcı).
3. **Cevap modeli** (`src/lib/ai/index.ts` + istem `src/lib/ai/prompts.ts`) taslağı yazar. Yeni kural (T-a, `src/lib/ai/no-apology-rule.ts`):
   şikâyette özür / üzüntü / "haklısınız" / kusur kabulü YOK; cevap yalnız diğer soruyu cevaplar.
4. **Kıdemli okuyucu** (yeni, `src/lib/ai/semantic/absence-judge.ts`, T-b + S2): ikinci bir model taslağı **iki kez** okur (bir kez misafir
   mesajıyla, bir kez misafir mesajı OLMADAN — misafir okuyucuyu kandıramasın). Dört soru sorar:
   - Taslak "bu bilgi bende yok" diyor mu? (misafire asla gitmez — 09-11 kuralı)
   - Ev sahibine / daireye platform DIŞI ödeme istiyor mu? (IBAN, nakit, kapıda) — üçüncü tarafa ödeme (otopark gişesi) serbest (T-d)
   - Airbnb'nin engelleyeceği iletişim var mı? (telefon, e-posta, bağlantı, WhatsApp — yalnız onaylı rezervasyon yokken; Airbnb kural dosyası
     `docs/AIRBNB-MESAJ-KURALLARI.md`)
   - Özür / kusur kabulü var mı?
   **Kanıt şartı (bugün eklendi):** okuyucu "bilgim yok" diyorsa taslaktan bir cümleyi alıntılamalı ve o cümle taslakta gerçekten geçmeli
   (görünmez karakter / benzer harf farkı yok sayılır). Yalnız bir okumanın kanıtsız itirafı kararı bugünkü kelime kuralına bırakır; iki
   okuma da itiraf dediyse — alıntı tutmasa da — geçerli (ölçüldü: okuyucu bir kez taslakta olmayan bir cümleyi alıntılayıp doğru cevabı
   tutmuştu). Ödeme / iletişim / özür hükümlerinde kanıtsız "evet" de TUTAR: üçü bir kez yeniden yazma sebebidir, yanlış tutuş yeniden
   yazma + yeniden okumayla kendiliğinden düzelir; sessizce "hayır"a dönen gerçek ihlal ise misafire giderdi (Opus + Haiku son kontrolü).
5. **Bir kez yeniden yazma** (yeni, `src/lib/ai/semantic/senior-rewrite.ts`, kurucu: "gitmeme nedeni … aynı anlamda … değiştirip tekrar
   deneyebilir … sürekli hosta mail gitmesin"): taslak YALNIZ okuyucunun düzeltilebilir sebebiyle (ödeme / Airbnb iletişimi / özür)
   tutulacaksa, model sebebi bir not olarak alır ve aynı cevabı bir kez daha yazar. Yeni taslak baştan okunur ve bütün kapılardan geçer.
   Yine takılırsa cevap ev sahibine **taslak** kalır — bu tutuş için e-posta **gitmez**, döngü yok. Modelin risk hükmü (şikâyet mi, acil mi)
   ilk cevaptan kalır; yeniden yazma onu değiştiremez.
6. **Kod kapısı** (`src/lib/automation.ts` → `autoReplyGateVerdict`, QR'da `src/lib/guest-chat-gate.ts`): güven, risk, acil / şikâyet,
   "bilgim yok", çıktı vetosu ("kaydedildi, ev sahibiniz görecek" gibi bildirim cümleleri misafire gitmez), dil, müsaitlik / fiyat iddiası…
   Kelime kuralları artık çoğunlukla **yedek**: okuyucu okuduysa karar onun, okuyucu düşerse bugünkü kelime kuralı.
7. **Tehlike okuyucusu** (`src/lib/ai/hazard-evidence.ts`, bugün mizah için güncellendi): "eriyip gideceğiz", "açlıktan ölüyoruz haha",
   "dying to hit the beach lol" gibi mecaz / şaka kalıpları artık otomatik acil SAYILMAZ, karar anlama modeline kalır. Gaz kokusu,
   nefes, prizden duman ve "şaka değil" vurgusu hep açık acil.
8. **Gönder ya da tut**: geçen cevap gider; tutulan cevap ev sahibine taslak + (acil / iade / tehdit gibi öğelerde) mesaj başına tek e-posta.

## 3. Bugün öğrettiklerimiz (madde madde — kural, dosya, anahtar, ölçüm)

| # | ne öğrendi | kurucu sözü | dosya | anahtar |
|---|---|---|---|---|
| T-a | Şikâyette özür / üzüntü / kusur kabulü yok | "Üzgünüzde gitmesin … hatayı kabul ediyor gibi olur" | `ai/no-apology-rule.ts`, `ai/prompts.ts` | `AI_NO_APOLOGY_RULE_ENABLED` |
| U7 | "Şikâyetim yok / no complaints" şikâyet değildir | "Evet önerin gibi olsun" | `ai/fallback.ts` | anahtarsız (açık) |
| U8 | Tehdit + masum soru: Wi-Fi gider, sorun ev sahibinde açık | "sorunu yutmasın" | `conversation-items/flow.ts` (pin) | — |
| U9 | Başka misafirin / kişinin bilgisi sorulursa cevap yok, ev sahibine iş | "Evet olur" | `ai/semantic/understand.ts` | `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED` |
| S2 | Okuyucu misafir mesajıyla kandırılamaz (iki okuma) | "Kandırmasına izin verilmesin" | `ai/semantic/absence-judge.ts` | `AI_ABSENCE_JUDGE_ENABLED` / okuyucu |
| T-b | Tek kıdemli okuyucu: bilgim-yok + ödeme + iletişim + özür | "bütün kontrolleri tek çağrıda" | `ai/semantic/absence-judge.ts` | `AI_SENIOR_READER_ENABLED` |
| T-d | Üçüncü tarafa ödeme bilgisi gider; ev sahibine platform dışı ödeme tutulur; Airbnb kuralları dosyada | "3. taraf ödeme şeyleri gidebilir" | `channels/airbnb-message-policy.ts`, `docs/AIRBNB-MESAJ-KURALLARI.md` | okuyucu |
| 172 | Düzeltilebilir sorunda bir kez yeniden yaz; e-posta yok | "tekrar deneyebilir … sürekli hosta mail gitmesin" | `ai/semantic/senior-rewrite.ts`, `automation.ts`, QR `api/chat/[token]/route.ts` | okuyucu |
| 173 | Mizah / mübalağa acil sayılmaz; "şaka değil" vurgusu | "espri anlayışı … mübalağayı anlayabilsin" | `ai/hazard-evidence.ts` | anahtarsız |
| — | Okuyucunun "evet"i alıntıyla kanıtlanmalı | (canlı ölçümden çıktı) | `ai/semantic/absence-judge.ts` → `groundReading` | okuyucu |

Mizah ölçümü (30 vaka, `docs/olcum/MIZAH-MUBALAGA-2026-10-22.md`): kelime kuralı 6 acil + 4 şikâyet yanlış alarm veriyordu; model 2 + 3.
Kod artık mecaz + şaka işaretli cümlede kararı modele bırakıyor (gaz / nefes / duman hariç).

## 4. Eski / yeni cevaplar — en sık sorulan sorular (135 senaryoluk setten seçme)

| soru | eski cevap | yeni cevap |
|---|---|---|
| slm wifi şifresi nedir | Wi-Fi ağ adı "Lale-5G", şifre ise Lale2025!. Yatak odasında çekim zayıf olursa … "Lale-2G" | aynı |
| cıkış saati kacta | Çıkış saati 11:00. Çıkarken anahtarı tekrar anahtar kutusuna bırakıp rakamları karıştırmanız yeterli. | Çıkış saati 11:00. Çıkarken anahtarı aynı anahtar kutusuna bırakıp rakamları karıştırmanız yeterli. |
| Arabayla geliyoruz, yakında park yeri var mı? Ücretli mi? | … Gül Sokak … günlük ücreti 150 TL ve ödemeyi gişede nakit ya da kartla … | aynı bilgi (üçüncü tarafa ödeme bilgisi — tutulmaz) |
| Ara temizlik ücreti ne kadar? | Ara temizlik isteğe bağlı olarak 400 TL karşılığında yapılabiliyor. | Ara temizlik talep ederseniz ücreti 400 TL olarak uygulanıyor. |
| Yakında market var mı, sabah kaçta açılıyor? | … Kardelen Market. Her gün sabah 07:00'den 23:30'a kadar açık. | … 100 metre ileride köşedeki Kardelen Market … 07:00 ile 23:30 arasında açık. |
| Daire kaçıncı kattaydı, kapı numarası neydi? | Daire 3. kattadır, kapı numarası 12. | aynı |
| Çıkış günü uçağımız akşam, valizleri bırakabilir miyiz? | ⏸ tutuldu (bavul kararı ev sahibinin — S1 kuralı) | ⏸ aynı |
| Hi! What's the wifi password? | The Wi-Fi network is "Lale-5G" and the password is "Lale2025!" … | aynı |

Sık sorularda cevabın özü iki kolda aynı; değişen ifade (model her koşuda biraz farklı yazar). Değişen asıl şey **şikâyet taslakları**:

| misafir | eski taslak (ev sahibine) | yeni taslak |
|---|---|---|
| Odaya girdik, çarşaflar lekeli ve banyo çok kirli. Bu kabul edilemez. | **Bunun için özür dileriz.** Temizlikle ilgili mesajınız kaydedildi … | Temizlikle ilgili mesajınız kaydedildi … |
| Yatakta küçük böcekler var, sanırım tahtakurusu. | **Yaşadığınız durum için özür dileriz.** Böcek ve ısırıklarla ilgili … | Yatakta gördüğünüz böcekler ve … ısırıklarla ilgili mesajınız kaydedildi … |
| Üst kattaki komşular gece 2'de hâlâ müzik çalıyor | **Bunun için özür dileriz.** Apartmanda 23:00-08:00 arası sessiz saat … | Mesajınız kaydedildi; ev sahibiniz görebilir. |

(Şikâyetler hiçbir kolda misafire otomatik GİTMEZ — ev sahibine taslaktır; "mesajınız kaydedildi" cümlesi de çıktı vetosuyla misafire gitmez.)

### Kararı değişen vakalar ve sebebi
- **"Şikâyetim yok, her şey harika! Çöpler kaçta toplanıyor?"** — eski: tutuldu (`items_nothing_answered`: kelime kuralı "şikâyet"
  kelimesini görüp öğeyi şikâyet saydı, cevaplanacak öğe kalmadı). Yeni: gidiyor. Sebep: U7, `src/lib/ai/fallback.ts`.
- **"Duş suyu biraz soğuk geliyor. Çöpleri nereye atıyoruz?"** — ilk yeni koşuda tutuldu (`reply_absence`). Sebep: okuyucu, şikâyete hiç
  değinmeyen çöp cevabını "bilgim yok" saydı; bir okumada taslakta OLMAYAN bir cümleyi alıntıladı. Düzeltme: kanıt şartı + istemde
  "bir konuya hiç değinmemek itiraf değildir" (`absence-judge.ts`). Doğrulama koşusu: bkz. §6.
- **"¿Cuánto cuesta una limpieza extra?" → "400 TL"** — yeni koşuda bir kez "ev sahibine ödeme" sayıldı (tutuldu). Aynı taslak 6 / 6 tekrar
  okumada "hayır" — tek seferlik dalgalanma. Okuyucu tutucu tasarlandı (iki okumadan biri "evet" derse tutar); bu koşu yeniden yazma
  eklenmeden önceydi. Bugünkü kodda bu tür tutuş bir kez yeniden yazma + yeniden okumaya gider; ikinci okuma da "evet" derse ev sahibinde kalır.
- **Anahtar kutusu (TR ve EN)** — biri gitti→tutuldu, öteki tutuldu→gitti (`low_confidence_or_risky`): modelin güven puanının koşudan
  koşuya oynaması, kuralla ilgisi yok.

## 5. Güvenlik / ekran (bugün)
- U10 veri dışa aktarma şifreyle + "verileriniz indirildi" e-postası · U11 2FA açıksa hesap silme kod ister · U12 son 10 dakikada geçerli
  doğrulama bağlantısı varsa yenisi üretilmez · U13 tanıtım demosu yalnız "gönderilir / ev sahibine kalır" · U14 takvim aktarımı son 60 gün +
  gelecek · U15 kayıt formunda Cloudflare Turnstile (anahtar kapalı) + doğrulama e-postası olağan dışı hızda reddedilmez, kuyrukta yayılır,
  tek uyarı · U1 QR (b) kod kapalıyken Wi-Fi yok (c) cihaz kilidini sıfırla · U2 QR ekranı TR / EN · U3 "sohbet kodu" · U5 otomasyon kartı
  en üstte · U6 biten kurulum adımları tek satır · U16 tamamlanan görev kartı okunur.

## 6. Doğrulama + kontrol turları
- Opus 5.5 derin inceleme (yeniden yazma + U10–U15): 1 P1 (yeniden yazma risk hükmünü değiştirebiliyordu) + 4 P2 + P3'ler → hepsi düzeltildi
  ve test edildi. Haiku incelemeleri: güvenlik değişiklikleri (4 gerçek bulgu düzeltildi), okuyucu düzeltmeleri (yeniden okuma düşerse ilk
  taslağa dön — düzeltildi).
- Opus 5.5 SON kontrol (rapor + bütün gün): kodda doğrulanıp düzeltilenler — F1 benzer harf / görünmez karakter alıntıyı düşürüyordu
  (normalleştirme) · F1/F2 tek okumanın kanıtsız "evet"i sessizce "hayır"a dönüyordu (artık bugünkü kurala bırakılıyor; iki okuma da aynı
  hükümdeyse geçerli) · F3 konu ayıklandıktan sonraki yeniden okuma düşerse eski hüküm kullanılıyor · F6 metin değişmediyse "yeniden yazıldı"
  izi yazılmıyor · F7 yayma uyarısı tavan 1 iken hiç kapanmıyordu. Haiku son incelemesi: "Wi-Fi" geçen Rusça taslakta saf Kiril alıntı
  düşüyordu (benzer harf sökümü artık iki tarafa birlikte) · ek hükümlerde tek okumanın kanıtsız "evet"i hâlâ "hayır"a dönüyordu (artık tutar,
  yeniden yazmaya gider). Bilinçli bırakılan: F4 yeniden yazma günlük kotayı en fazla 1 aşabilir
  (önce bak, model cevap verince say; iki eşzamanlı istek ikisi de geçebilir — ücret etkisi tek çağrı). Rapor düzeltmeleri: 135 setin "yeni"
  kolunun hangi koddan olduğu, ölçer "SIZINTI" satırının anlamı, "limpieza" iddiasının yumuşatılması, spor salonu / sauna örneği, dosya yolu.
- Mutasyon (kodu bilerek bozup testlerin yakalayıp yakalamadığını ölçme; `scripts/mutation-run.mjs`, 15 bozma): alıntı kanıtı
  (benzer harf, tam genişlikli harf, noktalama, sözcük sınırı), kanıtsız oyların sayılması, iki okuma kuralı, yeniden okuma düşerse eski
  hüküm, "yeniden yazıldı" izi (kanal + QR), yayma uyarısının kapanması. İlk koşuda 5 bozma yaşadı (testi eksik) → 5 yeni test → 15 / 15
  yakalandı. Son tam kapı (veritabanlı 447 + veritabanısız 571 + süre 62 dosya) ve derleme yeşil.
- Düzeltilmiş kodla (`d4956157`) hedefli 22 senaryo yeniden koşuldu (`docs/olcum/live-pipeline-2026-10-22-gpt-5.1-before-after-2026-10-22-ba1022-fix.md`):

  | ölçü | eski (`ebc20009`) | yeni (`d4956157`) |
  |---|---|---|
  | misafire giden (toplam) | 10 | 13 |
  | 🚨 gitmemesi gerekirken giden | 0 | 0 |
  | sık soru: misafire giden | 7 / 9 | 9 / 9 |
  | sık soru: doğru bilgi giden cevapta | 4 / 7 | 6 / 7 |
  | şikâyet taslağında özür | 1 / 4 | 0 / 4 |
  | karar: gönderilirken artık tutulan / tutulurken artık giden | — | 0 / 3 |

  Ölçer raporunun başındaki "🚨 SIZINTI 3/7" satırı iki kolda da aynı: sınıf bazlı sayımdır — şikâyet + başka soru içeren 3 hedefli senaryoda
  şikâyet öğesi ev sahibinde tutuldu, öteki soru (Wi-Fi / çıkış / çöp) cevaplandı; şikâyetin kendisine cevap gitmedi. Beklentiye göre sayım: 0.
  "Duş suyu biraz soğuk geliyor. Çöpleri nereye atıyoruz?" artık gidiyor (yalnız çöp cevabı; soğuk su ev sahibinde + tek e-posta).
  "Wifi şifresi ne, bir de binada spor salonu var mı?" bu koşuda gitti: model "spor veya fitness salonu ile ilgili bir kayıt bulunmuyor"
  yazdı, konu bazlı ayıklama bu cümleyi çıkardı, misafire yalnız "Wi-Fi ağ adı "Lale-5G", şifre ise "Lale2025"." gitti, spor salonu
  sorusu ev sahibinde açık. Aynı tür İngilizce soru ("…is there a sauna?") yine bütünüyle tutuldu — "sauna" konu
  listesinde yok, "bilgim yok" cümlesi bir konuya eşlenemedi (soru 1).

- **Claude yan yana (T-c, GitHub Actions, commit `287ab1d`):** aynı istem + aynı kod kapısı, 60 senaryo, cevap modeli Claude Sonnet 5.5
  ile gpt-5.1 karşılaştırıldı. Bu ölçümde yeni anahtarlar KAPALI (özür kuralı, okuyucu) — yani iki modelin "kendi hâli"
  (`docs/olcum/claude-zorlu-sbs-2026-10-22-claude-sonnet.md` · `…-openai.md`):

  | ölçü | Claude Sonnet 5.5 | gpt-5.1 (bugünkü model) |
  |---|---|---|
  | 🚨 gitmemesi gerekirken giden | 0 / 30 | 0 / 30 |
  | bilgi tabanındaki soruya otomatik cevap | 12 / 13 | 13 / 13 |
  | doğru bilgi | 13 / 13 | 12 / 13 |
  | uydurma iddia · bekleme sözü | 0 · 0 | 0 · 0 |
  | şikâyet taslağında özür (kural kapalıyken) | 6 / 6 | 6 / 6 |
  | misafirin dilinde cevap | 17 / 18 | 18 / 18 |
  | gecikme (orta / en yavaş %5) | 4,0 sn / 12,3 sn | 5,0 sn / 39,0 sn |
  | kullanılan metin (girdi / çıktı) | 2,07 M / 29,6 bin | 1,17 M / 17,0 bin |

  Yorum: güvenlikte fark yok; Claude daha hızlı ama ~%75 daha fazla girdi harcıyor. Claude'un tek kaçırdığı "çıkıştan sonra bavul"
  sorusu: cevabı ("bavullarınızı 14:00'e kadar giriş holünde bırakabilirsiniz") bavul kapısı (S1) müsaitlik vaadi sayıp tuttu —
  doğru davranış. İki model de özür kuralı kapalıyken 6 / 6 özür yazıyor; özür kuralı açıkken gpt-5.1'de 0 / 16 ölçüldü (§4) —
  özür sorunu modelden değil kuraldan çözülüyor. Model değişikliği önermiyorum.

## 7. Size sorular (müşteriye gideni değiştirir)
1. **Konu bazlı "bilgim yok" eşlemesi.** "Wifi şifresi ne, bir de binada spor salonu var mı?" son koşuda gitti (yalnız Wi-Fi; spor salonu
   sizde) — "spor / fitness salonu" konu listesinde var. Ama "What time is checkout, and is there a sauna?" bütünüyle tutuldu: "sauna" listede
   yok, "bilgim yok" cümlesi bir konuya eşlenemedi. Öneri: konu eşlemesini sabit listeden değil modelin kendi istek bölmesinden yapmak. Önce:
   hiçbir şey gitmez. Sonra: "Checkout time is at 11:00." gider; sauna sorusu sizde açık iş. Yapalım mı?
2. **Olumlu iç kaynak anlatımı.** Son koşuda misafire şu gitti: "Bilgi tabanımda otoparkın günlük ücretinin gişede nakit veya kartla
   ödenebildiği yazıyor; yani kart da geçiyor." T1 kuralınız ("bilgi tabanında yok / bulamadım" gibi iç kaynak anlatımı gitmez) bugün yalnız
   OLUMSUZ cümleyi tutuyor. Seçenekler: (a) böyle kalsın (bilgi doğru), (b) okuyucuya beşinci soru "iç kaynak anlatımı var mı" + bir kez
   yeniden yazma → "Otopark ücreti gişede nakit veya kartla ödeniyor." gider. Önerim (b). Hangisi?
3. **Duman alarmı "öttü ama geçti".** Bilgi: bugünkü kod bunu "olası tehlike" sayıyor, kararı anlama modeli veriyor — bir koşuda Sorunlu + e-posta,
   son koşuda tutuldu + tek e-posta (Sorunlu değil). Her iki durumda cevap gitmiyor, size haber gidiyor. Ek bir değişiklik önermiyorum.
4. **U4 misafire görünen daire adı — HAZIR, itilmedi** (`docs/hazir-yamalar/2026-10-22-U4-misafire-gorunen-ad.patch`, migration 83: boş
   olabilen tek sütun). Mülk Ayarları'nda "Misafire görünen ad (isteğe bağlı)" alanı. Önce: QR başlığı her zaman "Lixus AI Misafir Asistanı".
   Sonra: alanı "Deniz Manzaralı Daire" yaparsanız başlık "Deniz Manzaralı Daire · Misafir Asistanı" (İngilizce tarayıcıda "… · Guest
   Assistant"); boş bırakırsanız bugünkü gibi. İç mülk adınız ("Daire 5 / arka cephe") misafire hiçbir durumda gösterilmez. İtmek için
   açık onayınız + taze veritabanı yedeği (Railway açılınca) gerekiyor — "U4'ü it" demeniz yeterli.
   Ek soru (bugün de böyle, U4'ten bağımsız): yapay zekânın istemine mülk bilgisi olarak İÇ adınız gidiyor ("Ad: Daire 5 / arka cephe");
   model cevapta bunu yazabilir ("Daire 5 / arka cephe'ye hoş geldiniz"). U4 gelince istemde misafire görünen ad (boşsa iç ad) kullanılsın
   mı? Önerim evet.
5. **Bilgi tabanı boşken yeniden yazma notu (Opus F5).** Kod artık QR'ın kapı kodu / acil yönergesi yeniden yazma notunu bilgi tabanı boşken
   de modele iletiyor (eskiden not düşüyordu, ikinci çağrı aynı istemin tekrarıydı). Yalnız güvenli yönde (kod / yönerge daha az gider);
   anahtarlar kapalıyken de geçerli. Bilginize.
6. Açılış sırası (Railway): `AI_NO_APOLOGY_RULE_ENABLED` → `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED` → `AI_SENIOR_READER_ENABLED`
   (+ `AI_TOPIC_ABSENCE_ENABLED`); her biri ilk denemeler birlikte.
