# Söz → görev OTOMATİK (kurucu kararları 10-17 gece)

Kaynak: kurucu cevapları (AskUserQuestion, 10-17 gece) + tartışma ajanı (Opus) + web araştırması. Bu belge tek liste; kod bu belgeye göre.

## Kurucu kararları (aynen özet)

| Soru | Karar |
|---|---|
| Onay | **YOK.** "Onayla host uğraşmasın; host yapıcam yazdıysa saati ile kaydetsin." |
| Saat | **UYDURMA SAAT YOK.** "Saati belirtilmemiş saati söyleyemez, bilgi uyduramaz." "Akşam yazmışsa akşam olarak tutsun." |
| Saatsiz söz | Gün olarak açılır ("yarın, saat belirtilmedi") — "ama hostu sürekli rahatsız etmesin". |
| Kapatma | Gecikende **kendiliğinden kapatma YOK** — hatırlat. |
| Ayar / sınır | İşletme kapatabilsin (Ayarlar) + **günlük 20** (sınır dolunca o gün yeni görev açılmaz, öneri olarak kalır). |
| Saat değişti | "Aynı görevin saati güncellensin AMA aynı görevden bahsedildiği BAĞLAMDAN anlaşılsın — başka bir şeyi değiştirmemeli." |
| Konaklama bitti | Havlu / temizlik / eksik eşya kapanır (iz kalır); **arıza açık kalır**. |
| Açılış | **Herkese birden** (Railway açılınca anahtar "1"). |
| Söz kimden | Yalnız ev sahibinin yazdığı mesaj (yapay zekâ cevabı + kanal şablonu söz üretmez; yapay zekâ söz veremez — çıktı vetosu). |
| "Düzeldi" | Saat geçince hiçbir şey "düzeldi" sayılmaz; misafir söyler, ev sahibi kapatır. |

## Davranış (UYGULANDI — kod: `lib/guest-commitments-auto.ts`, `ai-suggestions/core.ts` `promiseWindow`, `load.ts`, `act.ts`)

1. **Ne zaman:** (a) Lixus'tan gönderilen ev sahibi mesajı kanala TESLİM edilince hemen (`host-send.ts`, en iyi çaba); (b) kanaldan doğrudan
   yazılıp senkronla gelen mesaj için HER senkron turunda son etkinliği 15 dk içinde olan konuşmalar; (c) SAATLİK telafi 48 saat (sağlayıcı
   arızası sonrası geç gelen mesaj). Sayfa görüntülemek bir şey oluşturmaz. İdempotent: öneri anahtarı (mesaj + sıra) + karar kaydı.
   Kalıcı kuyrukta olup henüz TESLİM EDİLMEMİŞ mesajdan söz açılmaz (misafire ulaşmamış olabilir; teslim olunca sonraki tur).
2. **Zaman kesinliği** (`duePrecision`): `time` (açık saat ya da açık süre "30 dakika içinde") · `part` (gün dilimi: sabah / öğle / öğleden sonra /
   akşamüstü / akşam / gece / gece yarısı / kısa süre içinde) · `day` (yalnız gün). Görünen: "yarın 10:00" · "bugün akşam" · "yarın (saat
   belirtilmedi)". Gecikme hesabı için son an = pencerenin SONU (gösterilmez): sabah 12:00 · öğle 14:00 · öğleden sonra 18:00 · akşamüstü 19:00 ·
   akşam 23:59 · gece yarısı ertesi 01:00 · gece ertesi 06:00 · kısa süre içinde → günün sonu · gün → 23:59. Bugünkü erken dilim (sabah / öğle /
   öğleden sonra / akşamüstü) geçtikten sonra yazıldıysa yarın. Açık saatte 30 dk pay ("zamanı geldi"; "gecikti" ondan sonra). "Birazdan /
   hemen / soon" artık saat değil ("kısa süre içinde"; eskiden şimdi + 60 dk uyduruluyordu). Görev vadesi: açık saatte o an; dilim / gün
   sözünde yalnız-tarih çapası (görev panosu saat göstermez), dilim görev başlığında ("Misafire söz: Havlu / çarşaf · akşam").
3. **Söz sayılmayan:** soru · koşul / teklif · olumsuz / iptal · **kararsız** ("belki, galiba, sanırım, umarım, muhtemelen, emin değilim, maybe,
   perhaps, hopefully, probably, not sure") · **aktarılan eski söz** — söz fiilinin parçasında ("demiştim, söylemiştim, dediğim gibi, gelemedi,
   gelmedi, getiremedim, yapamadı, as I said, I told you") · tanınmayan gün ("pazartesi", "haftaya") · misafirin mesajı · kanalın kendi otomatik
   mesajı · yapay zekâ cevabı.
4. **Bağlamla saat güncelleme** (aynı konuşma, bu mesajdan ÖNCE açılmış, AÇIK, görevli, aynı türde, saati farklı söz):
   - Yeni cümlede KONU var (klima) → aynı konuda TEK açık söz → saati taşınır (iz `previousDueAt`, görev aynı, yeni görev yok). Aynı konuda
     birden çok → seçim kartı. Başka konulu söz → DOKUNULMAZ, ayrı söz.
   - Konusuz + **değişiklik sözcüğü** ("11'e kaydı / kaydırıldı / alındı", "ertelendi", "saat değişti", "rescheduled / postponed / pushed back /
     moved to") → aynı türde TEK aday → taşınır; birden çok → seçim. "Ertelendi" tek başına (yeni zaman yok) → hiçbir şey. "Teknisyen saati
     değişti, 15:00'te gelecek" sağdaki konusuz söz parçasının saatini alır. "Rezervasyon kaydı alındı", "Klima değişti" değişiklik DEĞİL.
   - Konusuz, sözcüksüz yeni saat ("Teknisyen yarın 11'de gelecek") aynı türde açık söz varken → kart: **"Bu saat hangi söze ait?"
     [Saatini güncelle: Arıza / bakım — yarın 09:00] [Ayrı söz olarak kaydet]** — kendiliğinden ne değiştirir ne ikinci görev açar.
   - "yerine / instead" sözcükleri ilk dilimde YOK (yanlış eşleşme riski — "havlu yerine çarşaf"); ölçümle eklenebilir.
5. **Belirsiz bağlama:** konusuz söz + aynı saatte iki farklı konulu söz → mevcut "Hangi söze bağlansın?" kartı (değişmedi). Belirsiz her kart
   otomatik UYGULANMAZ (öneri olarak kalır).
6. **Gecikme (Dikkat Gerektirenler, e-posta YOK, kendiliğinden kapatma YOK):** açık saat / dilim sözü son an + pay sonra "gecikti"; 24 saat
   sonra aynı satır "Söz 1 gündür açık: …" + "yapıldıysa görevi tamamlayın, yapılmayacaksa iptal edin" (48 saatten eski söz panel penceresinden
   çıkar — söz ve görev açık kalır). **Saatsiz (gün) söz gün bitmeden satır olmaz**, gün geçince altta (önem 60) — kurucu "hostu sürekli rahatsız
   etmesin" (yorum: rozet / öne çıkarma yok; görev panosunda görünür).
7. **Konaklama bitince** (çıkış günü — tek tarih kuralı `calendarDateOf` — bugünden önce; saatlik iş): havlu / malzeme / temizlik sözü
   `cancelled` + `closedReason = "stay_ended"` (denetim kaydı `commitment.stay_ended`). Görev: **kimse dokunmadıysa** (yapılacak + otomatik başlık)
   silinir — ayrılmış misafir için panoda açık iş kalmasın; üzerinde çalışılan / başlığı değiştirilmiş görev KALIR. Arıza sözü açık kalır.
   ⚠️ Görevin silinmesi kurucunun "kapansın" kararının yorumu — kurucuya soruldu (KURUCU-SORULARI §S); alternatif: görev kalır.
8. **Ayar:** Ayarlar → "Misafire verdiğiniz sözleri görev olarak kaydet" (varsayılan AÇIK; yalnız anahtar açıkken görünür). Kapalıyken hiçbir şey
   açılmaz, söz önerisi de çıkmaz. Değişiklik denetimli (`/api/settings`, alan adı).
9. **Günlük sınır:** işletme başına (işletme saatiyle) günde 20 OTOMATİK söz (elle / öneriden açılan sayılmaz; saat taşıma sayılmaz); dolunca o
   gün öneri kartı olarak kalır.
10. **Yanlış, kaldır:** konuşma panelindeki söz satırı "Mesajınızdan kaydedildi" der; "Yanlış, kaldır" (`PATCH … reason: "wrong"`, yalnız
    `source = "auto"`) sözü kapatır (`closedReason = "wrong"`, denetim `commitment.removed_wrong`), sistemin açtığı görevi kimse dokunmadıysa
    siler. Karar kaydı durduğu için aynı mesajdan söz bir daha açılmaz. Saat düzeltme: görevin saati değiştirilince söz de taşınır (mevcut
    `syncCommitmentsForTaskDueAt`) — kartta ayrı "Saati düzelt" düğmesi ilk dilimde YOK.

## Veri (migration 75 — yalnız ekleme, nullable / varsayılanlı)

`GuestCommitment`: `duePrecision` (NULL = eski satır, "time" sayılır) · `dayPart` · `source` ("auto" | "suggestion" | "manual"; NULL = bu
kolondan önceki satır) · `sourceMessageId` (düz kimlik, FK yok — mesaj saklama süresiyle silinebilir) · `previousDueAt` (saat taşıma izi) ·
`closedReason` ("stay_ended" | "wrong" | NULL) · (`organizationId`, `createdAt`) dizini (günlük sınır sayımı). `Organization.autoCommitmentsEnabled
Boolean @default(true)`. KVKK dışa aktarımı yeni kolonları taşır (metin yok). Saklama: mevcut söz saklama süpürgesi (`purgeExpiredGuestCommitments`).

## Anahtar

`HOST_COMMITMENT_AUTO_ENABLED` (yalnız "1"; `STRICT_ONE_FLAGS`). Kurucu "herkese birden" → Railway açılış listesine "1"
(`docs/RAILWAY-ACILIS-2026-10-15.md` §5). Kapalıyken bugünkü öneri + onay düzeni (ayar yüzeyde yok, öneri ayardan etkilenmez).

## Opus dilim sonu (10-17 gece, 21 bulgu — hepsi işlendi; ayrıntı `scratchpad/opus-sg-review.md` özeti)

- **O1 (P1) sözü YAPAN:** "Klima için teknisyen yarın 10'da" açıkken "Klima kumandasının pilini akşam getireceğim" teknisyen sözünü TAŞIYORDU.
  Artık `actor` (ziyaret: teknisyen / usta / temizlikçi / ekip · teslim: getir / gönder / bırak): farklı yapan → ayrı söz; yapanı bilinmeyen
  (elle kayıt, kaynak mesaj pencerede yok) aynı konulu söz → kendiliğinden taşınmaz, kart sorar. Kesin taşıma = tek aday ∧ (değişiklik
  sözcüğü ∨ aynı konu + aynı bilinen yapan).
- **O2** el değmemiş görev = yapılacak + otomatik başlık + atanmamış + açıklamasız + güncelleme / not / fotoğraf yok (silinen görevde yetim
  dosya kalmaz). **O3** "…, uygun mu / olur mu?" söz değil. **O4** gün sözcüksüz değişiklik ("11'e kaydı") eski sözün gününe. **O5** "Arıza
  kaydınız bugün alındı" değişiklik değil (yönelme eki şart). **O6** "iki ayrı / bir ayar" gün değil; "umarım" yalnız sözün kendisinde.
- **O7** yükleyici yalnız istenen türü üretir (görev önerileri 5 yerlik tavanı doldurmaz; onay yolu da). **O8** konusuz eski söz + konulu yeni
  saat → kart. **O9** mesajda birden çok saat → kendiliğinden kaydedilmez, kart. **O10** tarama tavanı yorumu düzeltildi (imleç yok, bugünkü
  ölçekte sınır uzak). **O11** dikkat paneli 200 aday okur. **O12** dilim / gün sözünde kalan süre gösterilmez ("açık" / "gecikti").
- **O13** gün düzenlemesi takvim aritmetiğiyle. **O14** konaklama kapatması işletme ayarı açıkken ve görev el değmemişken (üzerinde çalışılan
  söz açık kalır). **O15** konuşma kilidi (gönderim kancası + senkron turu aynı konuşmayı aynı anda işlemez; süresi dolan kilit devralınır).
- **O16 anahtar KAPALIYKEN bugünkü görünüm:** 30 dk pay ve "Söz 1 gündür açık" yalnız anahtar açıkken. ⚠️ Açılış notu: anahtar ilk açıldığında
  saatlik telafi son 48 saatin ev sahibi mesajlarındaki (hâlâ vadesi gelmemiş) sözleri görev yapar ve bitmiş konaklamaların el değmemiş havlu /
  temizlik / eşya sözlerini kapatır — Railway açılış listesinde yazılı.
- **O17** demo hesabı hariç. **O18** Paddle anahtar olayı inceleme kaydı (e-posta kısılsa da iz kalır). **O19** "bu mesajdan önce" kıyası
  sözün KAYNAK mesaj anıyla (gecikmeli gelen saat değişikliği gizlenmez). **O20** aynı an + aynı kesinlik (gün sözü ≠ akşam sözü). **O21**
  otomatik sözde "İptal" (görev kalır) + "Yanlış, kaldır".

## Mutasyon (10-17 gece, 40 mutant)

36/40 ilk koşuda öldü; `SG-night-gecen` eksik pindi (virgülsüz "geçen" vakası eklendi). Gerekçeli EŞDEĞER üç mutant (savunma katmanı,
kaldırılmadı — kuralın tek yere bağlı kalmaması için):
- `SG-org`: otomatik yoldaki işletme ayarı kontrolü — ayar kapalıyken öneri yükleyicisi söz önerisi zaten üretmez; kontrol gereksiz sorguyu önler.
- `SG-ambiguous`: seçim isteyen öneriyi atlama — `decideSuggestion` seçimsiz onayı zaten reddeder (`MOVE_CHOICE_REQUIRED` / `ATTACH_CHOICE_REQUIRED`);
  "belirsizde kart sorar" kuralı onay yolundaki doğrulama değişse de korunur.
- `SG-wrong-source`: "Yanlış, kaldır"da okumadaki `source: "auto"` süzgeci — yetki atomik `updateMany` koşulundadır, okuma erken çıkıştır.

## Kaynaklar (araştırma)

- Bakım / iş emri yazılımları gecikeni kapatmaz, yükseltir: oxmaint (tesis iş emri yükseltme), mangoapps (gecikme oyun kitabı), ServiceNow (yalnız
  tamamlanmış iş emirleri arşivlenir).
- Microsoft Smart To-Do araştırma prototipi (gönderilen e-postadaki taahhüt → yapılacak); Viva Briefing "söz verdikleriniz" (görev açmaz,
  listeler); Superhuman Auto Reminders (onaysız takip); Guesty misafir mesajından görev ÖNERİR (insan onaylar).
