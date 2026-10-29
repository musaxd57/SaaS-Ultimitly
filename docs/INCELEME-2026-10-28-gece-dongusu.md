# Gece döngüsü — derin hata ayıklama bulguları (10-28 / 10-29 gece)

> Kurucu (aynen): "soru sormadan ilerle, debugging yap ama sadece kendin oku, her 30 dk'da 1 derin ve geniş çapta didik didik debugging".
> Alt ajan yok; her bulgu kodda ölçülür. Yalnız TUTMA yönündeki düzeltmeler ve iç hatalar uygulanır; müşteriye gideni gevşeten ya da yeni
> davranış kuran bulgu önce / sonra örnekli SORU olarak buraya yazılır.

## Tur 1 — `ai/host-contact-filler.ts` (bu gece yazılan R13-b/c silicisi) × konuşma öğeleri kipi (canlı)

### GD1 — P1 (kendi kodum, tutma yönünde düzeltme) — misafirin sorduğu varsayımsal durumun cevabı silinince istek sessizce "cevaplandı" kapanıyor
- Mesaj: "Otopark var mı? Wi-Fi bozulursa ne yapmalıyım?" · model: "Otopark arkada. Wi-Fi bozulursa ev sahibinize yazın." · model beyanı: iki
  istek de cevaplandı (`answeredRequests`).
- Silici "yazın" cümlesini çıkarır (kurucu: hiçbir koşulda gitmez) → misafire yalnız otopark gider; ama öğe kipinde Wi-Fi isteği modelin beyanıyla
  "cevaplandı" kapanır → ev sahibi o soruyu GÖRMEZ.
- Düzeltme: çıkarılan cümle misafirin TAM sorduğu duruma cevapsa (`guestAskedThisSituation`) cümle silinmez, bütün cevap tutulur
  (`hostContactOnly`) — ev sahibi yanıtlar. Genel kapanış (soruyla ilgisiz) silinmeye devam eder.
- Durum: ✅ 10-29 — kırmızı-önce test (`host-contact-filler.test.ts` GD1), mutasyon 3/3, ilgili 107 test yeşil.

### GD2 — P3 (bilinen sınır, düzeltilmedi) — koşul eki sezgisi yer adlarına takılabilir
- `asksHypotheticalSituation`: "Bursa'dan geliyoruz" → "Bursa" "-rsa" koşul eki gibi okunur. Etkisi dar: koşullu "arayın" cümlesinin KALMASI için
  ayrıca konu örtüşmesi + bilgi tabanı dayanağı gerekiyor. Yazıldı, değiştirilmedi.

### GD3 — P3 (bilinen sınır) — önceki cevapsız mesaj varsayımsal, son mesaj yaşanan olay
- "Anahtarı kaybedersem?" (cevapsız) → "Anahtarı kaybettim" (yeni): silici iki metni birlikte okuduğu için "kaybederseniz ev sahibinizi arayın"
  (dayanaklıysa) KALIR. Tek mesajda ("Anahtarı kaybettim") silici cümleyi çıkarır, içerik kalmazsa tutar (ölçüldü). İlk taslakta "sözcük ağı bunu
  zaten tutar" yazmıştım — ÖLÇÜM YANLIŞLADI (↓GD4); düzeltildi.

### GD4 — P2 — SORU (davranış değişikliği) — kayıp anahtar sözcük ağında sorun sayılmıyor
Ölçüldü (kapı, model niyeti "genel", cevap "Anahtarı kaybederseniz ev sahibinizi arayın."):

| misafir | sözcük ağı | bugün |
|---|---|---|
| "Anahtarı kaybettim" | `checkin`, şikâyet değil | kapı GEÇİRİR (silici "arayın"ı çıkarır → içerik yoksa tutulur) |
| "I lost the key" | `checkin`, şikâyet değil | aynı |
| "Anahtarı kaybettim, ne yapmalıyım?" | `checkin`, şikâyet değil | aynı |

Kayıp anahtar bir ERİŞİM / GÜVENLİK olayıdır (kilit değişimi, yedek anahtar, ücret). Bugün tek koruma modelin niyeti. Önerim: "anahtar(ı) kaybettim /
kayboldu / bulamıyorum / lost (my) key / locked out" yaşanan olay kalıbı sözcük ağında erişim sorunu sayılsın → cevap ne olursa olsun ev sahibine
kalır (yedek anahtar bilgisi bilgi tabanında olsa bile ilk cevap ev sahibinden). Önce: model "genel" derse bilgi tabanındaki "yedek anahtar
resepsiyonda" cevabı gidebilir. Sonra: her kayıp anahtar bildirimi ev sahibinde. **Böyle yapalım mı?**

## Tur 2 — aynı silici, cümle içi karışım + koşul sezgisi

### GD5 — P1 (kendi kodum, tutma yönünde düzeltme) — bilgiyle AYNI cümledeki talimat silinirken bilgi de gidiyor
Ölçüldü (tsx deneme betiği, sonra silindi):

| misafir | model cevabı | bugün misafire giden |
|---|---|---|
| "Havlu nerede? Otopark var mı?" | "Havlular yatak odasındaki dolapta, bir sorun olursa ev sahibinize yazın. Otopark binanın arkasında." | "Otopark binanın arkasında." — havlu cevabı KAYBOLUR |
| "Klima nasıl açılır? Otopark?" | "Kumanda komodinin üstünde, çalışmazsa ev sahibinizi arayın. Otopark arkada." | "Otopark arkada." — klima cevabı KAYBOLUR |

Silici cümle bazında çalışıyor; virgülle bağlanmış bilgi yan cümlesi talimatla birlikte siliniyor. Öğe kipinde model havlu isteğini "cevaplandı"
beyan ettiği için istek ev sahibine hiç görünmeden kapanır (GD1 ile aynı sınıf).
- Düzeltme (TUTMA yönü): silinecek cümlenin başka bir yan cümlesi bilgi taşıyorsa (anlamlı, koşul yan cümlesi değil, yalnız genel "sorun /
  herhangi / any issue" sözcüklerinden ibaret değil) cümle silinmez, BÜTÜN cevap tutulur — ev sahibi yanıtlar. Koşul yan cümlesi + talimattan
  ibaret genel kapanış ("Bir sorun olursa, ev sahibinize yazın.") silinmeye devam eder.
- **SORU (sabah, müşteriye giden metin):** tutmak yerine yalnız talimat yan cümlesini silip bilgiyi göndermek mümkün:
  önce (bu düzeltmeyle) → cevap tutulur, ev sahibi yanıtlar · sonra (öneri) → misafire "Havlular yatak odasındaki dolapta. Otopark binanın
  arkasında." gider. "Talimat yok" silicisi (`no-instruction-filler.ts`) bunu yan cümle düzeyinde zaten yapıyor; aynı yöntem. **Böyle yapalım mı?**

### GD6 — P2 (iç hata, tutma yönü) — koşul eki sezgisi İngilizce sözcüklere takılıyor
`asksHypotheticalSituation` Türkçe koşul ekini (`-rsa / -rse`) sözcük sonunda arıyor; İngilizce "of course", "worse", "nurse", "horse" de
eşleşiyor. Ölçüldü: "Of course, the wifi is not working" (YAŞANAN olay) → varsayımsal sayılıyor. Etkisi: konu örtüşür ve bilgi tabanı dayanağı
varsa koşullu "ev sahibinizi arayın" cümlesi sorunu bildiren misafire GİDER (kurucu: "savrulmasın"). Düzeltme: bilinen İngilizce "-rse"
sözcükleri ve "Bursa" (GD2) koşul aranmadan önce silinir → bu durumda cümle çıkar / cevap tutulur.

### GD7 — P1 (kendi kodum, iç hata) — `hostContactOnly` işareti yeniden yazma ve kod metni birleşiminde yanlış metne yapışıyor
- `mergeSeniorRewrite` (kıdemli okuyucu "bir kez yeniden yaz", kanal + QR): sonuç İLK taslağın alanlarını yayıp metni yeni çağrıdan alıyor;
  `hostContactOnly` ilk taslaktan kalıyor, yeni çağrınınki DÜŞÜYOR. Yeni metin yalnız "Bir sorun olursa ev sahibinize yazın."dan ibaretse
  (silici içerik bulamadı → metin aynen + işaret) kapı işareti görmez → cümle misafire GİDER (kurucu: "kesinlikle bu gidemesin"). Ters yönde
  ilk taslağın işareti yeni, düzgün metni gereksiz tutar.
- `codeBuiltResult` (doğrulanmış erken giriş / müsaitlik / uzatma / politika KOD metni): model taslağının işaretini koda taşıyor → kodla kurulan
  onaylı metin `reply_host_contact_only` ile gereksiz tutuluyor.
- Düzeltme: işaret METNE aittir — birleşimde yeni çağrıdan alınır (`verifiedPartsOnly` ile aynı kural), kod metninde düşer.

**Tur 2 durumu:** GD5 / GD6 / GD7 ✅ 10-29 — kırmızı-önce (4 test), mutasyon 12/12 (ilk koşuda 3 yaşayan → sayı taşıyan, genel ve nezaket
yan cümlesi pinleri eklendi), ilgili 343 test yeşil. Not: "Herhangi bir sorunda, ev sahibinize yazın." / "Should anything go wrong, message
your host." koşullu talimat SAYILMIYOR — "bilgim yok" yönlendirmesi olarak `refersGuestToHost` yakalıyor ve kapı bütün cevabı tutuyor (bugünkü
davranış, güvenli yön). Kurucunun "genel kapanış çıkar" kararı bu iki kalıpta silme değil tutma üretiyor — sabah sorusu GD8.

### GD8 — SORU (sabah) — "Herhangi bir sorunda / Should anything go wrong" kapanışı çıkarılmıyor, bütün cevap tutuluyor
| misafir | model cevabı | bugün |
|---|---|---|
| "Otopark var mı?" | "Otopark arkada. Herhangi bir sorunda ev sahibinize yazın." | cevap TUTULUR (ev sahibi yanıtlar) |
| "Is there parking?" | "Parking is behind the building. Should anything go wrong, message your host." | cevap TUTULUR |

Öneri: bu iki kalıp da "koşullu kapanış" sayılsın → kapanış çıkar, "Otopark arkada." gider (R13-c'nin öteki kalıplarıyla aynı). Bu müşteriye
giden metni GEVŞETİR (bugün tutuluyor) → **böyle yapalım mı?**

### CI notu (10-29)
CI 1681 (`4465b0fd`) veritabanısız kolda bir kez kırmızı; aynı kodu içeren CI 1683 (`f4fb30eb`) altı işin hepsinde yeşil, yerel tam kapı da
yeşil → tek seferlik kararsız test (log sağlayıcı dışı adreste, test adı okunamadı). Tekrarlarsa adıyla izlenecek.

## Tur 3 — çıktı vetosu dış kabuğu + silicinin güvenlik uyarısı sözlüğü

- `output-veto.ts` dış kabuğu (yer tutucu → söz → devir sırası, görünmez karakter ayıklama, Türkçe küçük harf ikinci biçim) satır satır okundu:
  yeni bulgu yok (önceki 15 ajan / Codex turlarında ölçülmüş, süre pinleri yerinde).

### GD9 — P2 (kendi kodum, tutma yönü) — güvenlik uyarısı sözlüğü tehlike sözcüğüne benzeyen adlara takılıyordu
`SAFETY_WARNING` Türkçe gövdeleri ek sınırı olmadan eşliyordu: "Gazino tarafında bir sorun olursa ev sahibinizi arayın.", "Gaziantep'ten
gelirken sorun olursa …", "Polisaj makinesi bozulursa …" güvenlik uyarısı sanılıp KORUNUYOR, misafire gidiyordu (ölçüldü). Düzeltme:
gazete / gazino / gazoz / gazi-, polisaj / polisiye / polister, karbonat dışlandı; "gaz kokusu", "gazı", "polise", "karbon monoksit" korunur.
✅ kırmızı-önce, mutasyon 5/5, dosya 32/32. Bilinen sınır: büyük harfli "GAZI" (gazı) `/i` yüzünden dışlanır → cümle çıkar (tutma yönü değil
ama çok seyrek; model büyük harfle yazmaz).
