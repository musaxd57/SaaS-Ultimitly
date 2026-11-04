# Haiku 5.5 ↔ rakipleri (açılış planındaki modeller) — 11-04, istek 7

Kurucu 11-04: "rakiplerine karşı yap testleri" · iki anahtar aynı koşuda (Actions, iş 126463678491, commit `4dc0640`). Köprü YALNIZ ölçülen
katmanın çağrısını Claude'a çevirir (`EVAL_CLAUDE_ONLY`); diğer bütün çağrılar iki kolda da gerçek OpenAI. Ham raporlar Actions günlüğünde.

## 1. Cevap katmanı — Luna (plan: `gpt-6-luna`, low) ↔ Haiku (135 senaryo; anlama / bekçi bu ölçerde kapalı)

| ölçü | Luna | Haiku düşünme kapalı | Haiku adaptive low |
|---|---|---|---|
| 🚨 sızıntı (gitmemesi gereken gitti) | 0/52 | 0/51 | 0/51 |
| doğru olgu — katı | 49/55 | **55/55** | 52/55 |
| olgu eksik (devir dahil) | 6/55 | **0/55** | 3/55 |
| doğru olgu + otomatik gitti | 45/55 | **48/55** | 48/55 |
| uydurma (bilgi soruları) | 0/82 | 0/82 | 0/82 |
| dil uyumu TR dışı / TR | 57/59 · 74/76 | 56/58 · 76/76 | 58/58 · 76/76 |
| selam tekrarı | 0/14 | 1/14 | 0/14 |
| yedeğe düşen | 0 | 1 (base64 enjeksiyonunu reddetti → güvenli yedek) | 1 (aynı) |
| gecikme p50 / p95 | 2,7 / 5,0 sn | **1,8 / 3,3 sn** | 4,6 / 7,2 sn |
| maliyet / 1.000 mesaj | **$0,59** | $0,95 | $1,25 |

Okuma: Haiku olguyu daha eksiksiz veriyor ve düşünme kapalıyken daha hızlı; güvenlik eşit (sızıntı / uydurma 0). AMA bu katmanda Luna
**~%40 daha ucuz**: Claude'un sayacı aynı Türkçe istemi ~1,75 kat token sayıyor (girdi 4,9M ↔ 2,8M). Haiku kapıların tuttuğu yasak cümleleri
yazmaya devam ediyor ("ev sahibinizin kararına bırakıyorum", "özür dileriz", "bildirdik" — hepsi tutuldu, misafire gitmedi). Öneri: cevap
katmanında geçiş için "gözle görülür" eşik henüz yok (+3 doğru gönderim, tek koşu); ikinci tekrar + kör set sonra karar. Luna kalır.

## 2. Anlama katmanı — 5.1 ↔ Haiku (arıza bildirimi ↔ kullanım sorusu, 20 vaka × 2 tur)

| kol | canlı kip toplam | arıza bildirimi | kullanım sorusu | temel kip |
|---|---|---|---|---|
| **gpt-5.1** | 39/40 | **22/22** | 17/18 | 31/40 |
| Haiku adaptive high | 39/40 | 21/22 | **18/18** | 21/40 |
| Haiku düşünme kapalı | 34/40 | 16/22 | 18/18 | 28/40 |

İki ayrı koşuda (10-31 + 11-04) Haiku high canlı kipte 5.1 ile eşit (39/40). **Neden (vaka vaka):** Haiku'nun bütün hataları aynı tür —
bozuk cihaz bildirimini "nasıl kullanılır" (`appliance_help`) sayıyor ("Tost makinesi hiç ısınmıyor, Wi-Fi şifresi neydi?" → `appliance_help
+ wifi`; şikâyet öğesi oluşmuyor = ev sahibinde tutulması gereken iş kayboluyor). 5.1 de temel kipte aynı hatayı yapıyor. Bu sınır için 10-15'te
hazırlanmış istem yaması var (`docs/hazir-yamalar/2026-10-15-anlama-ariza-kullanim-ayrimi.patch`, kurucu kararı BEKLİYOR): "bozuk / çalışmıyor
bildirimi, nasıl düzelir diye sorsa da complaint_issue'dur; appliance_help yalnız bozuk olmayan şeyin kullanımı". Öneri: yamayı uygula →
iki modelde yeniden ölç → Haiku high 5.1'i geçerse geçiş (düşünme yüksekken gecikme ölçülmeli; anlama cevaptan önce koşar).

## 3. Karar metni yazıcısı — 5.1 ↔ Haiku düşünme kapalı (bekçi iki kolda da planlı modelde)

| ölçü | gpt-5.1 | Haiku düşünme kapalı |
|---|---|---|
| yapay zekâ metni kullanıldı | 37/40 | **38/40** |
| bağımsız denetim / sızıntı / uydurulan gerekçe | 37/37 · 0 · 0 | 38/38 · 0 · 0 |
| gerekçe anıldı (sezgisel) | 9/12 | 8/14 |
| gecikme p50 / p95 | 4,3 / 8,4 sn | **3,6 / 5,2 sn** |
| maliyet (40 karar) | $0,068 | **$0,0066 (10× ucuz)** |

**"Lütfen bekleyin" sanılan şeyin gerçek nedeni (reddedilen metin raporda):** Haiku'nun iki reddedilen metni de DOĞRU metin:
"Erken giriş talebinizi **onayladık**; 14 Kasım günü saat 13:00 itibarıyla giriş yapabilirsiniz." Çıktı vetosu birinci çoğul "onayladık"ı
yapay zekânın yapmadığı bir eylemi beyan etmesi (`unverified_commitment`) sayıyor; edilgen "talebiniz **onaylandı**" geçiyor (yerelde
doğrulandı; İngilizce "We have approved" de geçiyor → tutarsızlık). 5.1 edilgen yazdığı için takılmıyor. Düzeltme: yazıcı istemine
"kararı edilgen bildir (talebiniz onaylandı / mümkün değil); 'onayladık / kabul ettik' yazma" kuralı — veto GEVŞETİLMEZ.
5.1'in reddedilenleri ise kontrol listesini kopyalama ("çıkış temizliği henüz bitmedi" — iç bilgi) ve bekçi uyuşmazlığı.

## 4. Kararlar / sıradakiler
- Karar metni yazıcısı: istem düzeltmesi → yeniden ölçüm → **Haiku düşünme kapalı** (kurucu onayı 11-04). Ürün kodunda Anthropic
  bağdaştırıcısı (anahtar kapalı) + açılış listesine `AI_DECISION_TEXT_PROVIDER=anthropic` / model. ⚠️ Anthropic yeni bir veri işleyen olur
  (yazıcı girdisinde misafir metni yok; ama ev sahibinin iç kontrol listesi satırları gider) → gizlilik / KVKK işleyen listesi güncellenmeli.
- Anlama: hazır yama + yeniden ölçüm (kurucu onayı gerekir: arızalı cihaz mesajı şikâyet olarak ev sahibinde tutulur).
- Cevap katmanı: Luna kalır; ikinci tekrar + kör set ile yeniden bakılır.
