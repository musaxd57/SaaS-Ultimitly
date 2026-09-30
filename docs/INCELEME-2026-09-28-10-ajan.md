# 10 inceleme ajanı — 2026-09-28 (öğleden sonra)

Kurucu: "10 debugging agent gönder, didik didik, satır satır; hataları düzelt, geliştirmeleri uygula". Ajanlar YALNIZ okudu
(dondurulmuş kopya RC37 `db60a59`), kodu Claude yazdı. Her bulgu kodda ÇALIŞTIRILARAK doğrulandı; düzeltmeler kırmızı-önce +
mutasyon (hayatta kalanlar pinlendi / ölü kod silindi). Müşteriye gideni değiştiren ve yorum gerektiren maddeler kurucuya
soruldu (↓ Karar).

Durum: **F** = düzeldi · **K** = kurucu kararı · **N** = bilinen sınır / not · **X** = doğrulanmadı / yanlış.

## Alanlar ve bulgular

| # | Alan | Bulgu (doğrulandı) | Durum |
|---|---|---|---|
| a1-1 | K8 bürünme | Süre dolunca "Kendi hesabıma dön" 401 alıyor, kabuk "tekrar deneyin" diyordu (hiç çalışmaz) | F — oturum kapatılır |
| a1-2 | K8 | `api.ts` / `audit.ts` yorumları yanlıştı (çıkış kapıdan geçer; başlangıç kaydı zorunlu) | F |
| a1-3 | K8 | Mekanik pin: `export *`, `route.tsx`, metin eşleşmesiyle kontrol — bugün kodda örnek YOK | F (`1a0fe4b`, `7f171e4`: `export *` ve temiz ayrıştırılamayan rota dosyası tanınmayan kayıt, route.tsx / .js taranır; mutasyon 5/5) |
| a1-4 | K8 | Operatör QR bağlantısını açarsa konaklamayı kendi tarayıcısına bağlar; `/api/admin/export` bürünmede çalışır; teşhis rotası token yeniler | K |
| a2-1 | K10-t | 8.000+ karakterlik zararsız mesajda tek "gas station" / "Acil değil ama" → Sorunlu + acil e-posta (kelime ağı alt dize) | K (kelime ağı kararıyla) |
| a2-2 | K10-t | "AI öner" cevap verdiği uzun mesajı, arkasında giden mesaj varsa modele TAM gönderiyordu | F |
| a2-3 | K10-t | Uzun acil mesaj + 6'dan fazla sonraki misafir mesajı → uyarı yolu görmez | N |
| a2-4 | K10-t | Sayfa uyarısı acil sebebini gizliyor, "Cevaplandı"da kalıyordu | F |
| a3-1 | Enjeksiyon | `\p{Cf}`nin 32 karakteri Default_Ignorable DEĞİL → acil + enjeksiyon ağı deliniyordu (canlı, orta) | F |
| a3-2 | Enjeksiyon | Anlam katmanı çiti: ≫ ⋙ 〉〉 U+FE65, biçim / birleşen işaretle ayrılmış ">>>" | F |
| a3-3 | Enjeksiyon | Ayraç adlarımızın tireli / noktalı / tek açılı / «» / ≪≫ yazımı, SAMPLES adı | F |
| a3-4 | Enjeksiyon | Ev sahibi bloklarının etkisizleştiricisi dar | F |
| a3-5 | Enjeksiyon | Etiket damgasında "·" dışı ayırıcılar ("[EV SAHİBİ - bugün]") | F ("EV-SAHİBİ" ayrı sınıfı ölü koddu — aday biçimler kapsıyor, mutasyonla ölçüldü) |
| a3-6 | Enjeksiyon | İki noktasız etiket kuralının yanlış pozitifi geçmiş penceresi boyunca tekrar tutar | N (sıklık 0/16.083) |
| a3-7 | Enjeksiyon | ASCII ikizi büyük harfe duyarlı kalıbı küçültüyordu → Fransızca "<<bonjour>>" enjeksiyon | F |
| a4-1..6 | Karşılama | "Welcome,!" · "Hi,, welcome" · "Merhaba👋" · başta boş satır / "!" · ‘ ´ NBSP · "Merhaba Eski," | F |
| a4-3 | Karşılama | "Sayın {isim}," → "Sayın," | K |
| a4-7 | Karşılama | Gelen kutusu `{{guestName}}` ham ad ("Merhaba Rezervasyon HM4K2,") — ev sahibi gönderimden önce görür | K |
| a4-8 | Karşılama | Çözülemeyen `{daire}` / bilinmeyen `{misafir}` misafire ham gidiyor | K (öneri: gönderme + mülk sayfasında uyarı) |
| a5-1 | Migration 57 | Hitap adı maskeleme listelerinde yok (denetçi, gölge, üslup, QR, eval) | F |
| a5-2 | Migration 57 | Selam adı ↔ silme anahtarı çelişkisi (güvenlik sözcüğü) | F (Codex değişikliği: ad her zaman anahtar) |
| a5-3 | Migration 57 | NUL karakteri → rezervasyon yazması her senkronda düşer | F (`canonicalStr`) |
| a5-4 | Migration 57 | `GUEST_NAME_SOURCES` yazma yerlerinde tip değil; iCal / dosya eski satırı damgalamıyor; anonim satır kökeni "channel" | F (tip: `2b7c276`, her yazma `satisfies GuestNameSource` + pin) · N (iCal güncellemesi zaten damgalar; değişmeyen satıra yazma yok — kural; anonim satırın kökeni bugün hiçbir yüzeyce okunmuyor) |
| a6-1 | D selam | "Ateş" / "Alev" adlı misafirin yangın bildirimi (kelime ağında ateş/alev yok) | K (ateş/alev kalıbı) — D açılmadan önce şart |
| a6-2..5 | D selam | Selam soyucu içerik siliyor ("Günaydın Steakhouse"), "¡Hola!" / "Good morning" / "Sayın misafirimiz" / yalnız-selam, Rusça "Здравствуйте, [Misafir]!", büyük harf yerel ayarı | F (`65e6c76`, anahtar KAPALI) — kapalı hitap listesi; tanınmayan hitap / içerik → dokunulmaz + kod selamı eklenmez |
| a6-6 | D selam | Ayarlar önizlemesi hitap adını hiç vermiyor (hep "Merhaba,") | Açık (D öncesi; önizlemede örnek ad mı, adsız mı — ürün sorusu) |
| a6-7 | D selam | 3 karakterden kısa hitap adı ("Su") giden mesajdaki selamda kalır, saklama süpürgesi silmez (KVKK kalıntısı) | K (D öncesi: selam satırını süpürgeye ekle ya da kısa adla selamlama) |
| a7-1 / a8-1 | Ad maskesi | İlk ad misafirin kendi metninden siliniyor: "Checkout Smith" → bekçi "late [Misafir]"; "15 Nisan'da" → tarih kaybı; "Can we" → "[Misafir] we" (anlam katmanları CANLI) | K (tasarım) |
| a7-2 / a8-8 | Ad maskesi | Türkçe I/İ/ı ve harf aileleri, esnek boşluk (canlı saklama süpürgesi dahil) | F |
| a7-3 | D istem | Üslup bloğunda "selamlama" talimatı kaldı (anahtar açıkken); "[Misafir]" istemde açıklanmıyordu | F (`65e6c76`) |
| a8-5 | QR | Cevap isteminde silme anahtarı yoktu (anahtar açıkken) | F (`guestIdentifier`) |
| a8-6 | D | 2 harfli ad ("Su") ve CJK ad anahtar olmuyor; selam onu her turda modele geri taşır | F (`65e6c76`: geçmişteki kodun selam satırı istemden çıkar) |
| a10-1 | Denetçi | Kasa / kapı / anahtar kutusu / keybox / Schlüssel / tuş takımı / Wi-Fi kodları; saat ve ücret fazla maskeleniyordu | F |
| a10-2 | Ad kuralı | "O´Brien" → "O" (´ ‛ tire çeşitleri, tam genişlik nokta, yumuşak tire, Han varyasyon seçicisi); "=" Latin metinde | F |
| E1 | Kelime ağı | "kaza / polis / düştü / hurt / emergency" alt dize: "Kazağımı unuttum", "tatil kazandık", "Polisiye", "fiyatlar düştü", "Hurtigruten", "Emergency exit nerede?" acil | K |
| E2 | Kelime ağı | "Mutfak alev aldı", "Evde ateş var" acil sayılmıyor | K |
| a9-1 | CPU | "AI öner" 8k kuralını arkasında giden mesaj varken atlıyordu | F (`d61e448`, a2-2 ile aynı) + sayfa uyarısı aynı kural (`fb04823`) |
| a9-2 | CPU (misafir metni) | `countGuestAsks` sondaki noktalama kalıbı karesel: 32k "…" 0,7 sn, 128k 11,5 sn | F (`5fb62c5`, geriye doğrusal; 445k kıyas fark 0) |
| a9-3 | CPU (ev sahibi metni) | Saat okuyucusu doğrusal ama pahalı: 60 kalemlik dizin 1,4 sn (2k), 10,6 sn (20k), kötü niyetli 19,7 sn; Bilgi Tabanı sayfası her açılışta | F (`5fb62c5`: içerik özetli LRU önbellek + saatsiz cümle atlama; 354k kıyas fark 0; yeniden kurulum 89 → 18 ms) |
| a9-4 | CPU (mülk adı) | `apartmentNumberOf` karesel: 16k harflik ad 4,9 sn | F (`5fb62c5`, 145k kıyas fark 0) |
| a9-5 | Ad maskesi | "Ateş" / "Alev" adlı misafirin yangın bildirimi anlam katmanlarında görünmez (kelime ağında ateş / alev yok) | K (E2 ile aynı karar) |
| a9-6 | CPU (iyileştirme) | `matchForeignConcepts` ~10 µs/karakter; eski bağlam mesajları redaksiyondan önce kırpılabilir | N (doğrusal, 8k tavanı içinde) |
| RC38 | Tam kapı | "[EV-SAHİBİ]:" sahte yetki etiketi — sınıf "ölü kod" sanılıp çıkarılmıştı, iki pinli test kırmızı | F (`e636dc9`, iki kalıpta; 6/6 mutant öldü) |

## Codex önerisi (ad maskesi + acil sinyal)

Uygulandı (`b8c3338`): ad her zaman silinir; silme bir acil sözcüğünü de götürdüyse (tek sözcüklük ad eşleşmesi, tam adın kendisi değil)
anlama katmanına ve cevap istemine KOD NOTU. İki ayrı test: "Adım Yangın Kaya" (not yok) · "Dairede yangın var" (not var). Anahtar
kapalıyken anlam katmanlarında hitap adı da siliniyor (D'nin getirdiği tek fark) — ayrı test. Sinyal yalnız kelime ağının tanıdığı
sözcüklerde üretilir: "ateş / alev" ağda olmadığı için bu adlarda not çıkmaz (↑E2).
