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

## 5. İstek 8 (11-04 öğle, commit `454b8fb`) — edilgen karar kuralından sonra

### 5a. Karar metni yazıcısı — 5.1 ↔ Haiku düşünme kapalı (bekçi iki kolda da planlı modelde)

| ölçü | 5.1 geliştirme | Haiku geliştirme | 5.1 kör | Haiku kör |
|---|---|---|---|---|
| yapay zekâ metni kullanıldı | 40/40 | 39/40 | 30/30 | 28/30 |
| bağımsız yeniden denetim / iç bilgi sızıntısı | 40/40 · 0 | 39/39 · 0 | 30/30 · 0 | 28/28 · 0 |
| gerekçeli ret: beklenen gerekçe anıldı (sezgisel) | 11/14 | 9/14 | 10/10 | 7/10 |
| gecikme p95 (yazıcı + bekçi) | 5,7 sn | 4,9 sn | 5,7 sn | 3,7 sn |
| maliyet | $0,0729 | $0,0067 | $0,054 | $0,0047 |

"Onayladık" sorunu edilgen kuralla KAPANDI (Haiku'da `promise_or_handoff` düşüşü yok). Kalan Haiku hataları (5.1'de yok):
1. 🚨 **Başka misafirin saati misafire yazıldı ve denetimden GEÇTİ** (kör set 2/30): "Önceki misafirin çıkışı 13:00 olarak beklenmektedir"
   (a1-16) · "da der vorherige Gast erst um 12:00 Uhr auscheidet" (a1-18). Kök neden iki katlı: (i) yazıcı isteminin gerekçe satırı "the
   previous guest checks out at a given time" diyordu — "başka misafirin saatini yazma" satırıyla çelişiyor, Haiku saati yazmaya izin gibi
   okudu; (ii) kod denetimi kontrol listesinin saatlerini İZİNLİ sayıyordu (10-07'de ev sahibinin kendi metni için bilinçli; o gün 5.1'in aynı
   hatası yalnız istemle kapatılmıştı).
2. Fransızca "13h00" (2/30, kör) → kod denetimi saati göremedi (`time_missing`) → onaylı şablon (güvenli düşüş).
3. İngilizce misafire Türkçe metin (1/40, geliştirme d-38) → dil denetimi tuttu → şablon (güvenli düşüş).
Üslup: iki model de ara sıra dolgu yazıyor (Haiku "Sizi karşılamayı dört gözle bekliyoruz", "Thank you for your understanding"; 5.1
"Gracias por su comprensión", "Thank you for planning your departure accordingly") — denetim bunu tutmuyor; model farkı değil.

**Düzeltme (kod, ölçüm bekliyor — istek 9):** taslak denetiminde YAZICI KİPİ (`checkDecisionText(…, { writer: true })`): yalnız kontrol
listesinde olan saat → `other_guest_time` → şablon; ev sahibinin kendi yazdığı metnin denetimi DEĞİŞMEDİ. İstem: gerekçe "saatsiz" (önceki
misafir o saatte henüz çıkmamış olacak), saat her dilde iki noktalı (13:00 — 13h00 değil), girdi "Write the whole message in <dil>." ile biter.
Ölçer bağımsız "başka misafirin saati" satırı da sayar. Bilinen sınır (pinli): kontrol listesinin saati kaydın kendi saatiyle aynıysa ayırt
edilemez.

### 5b. Anlama — 10-15 yamasının cümlesiyle (v1 kuralı, YALNIZ ölçümde istemde; 20 vaka × 2 tur)

| kol | canlı kip | temel kip |
|---|---|---|
| gpt-5.1 | 40/40 | 38/40 |
| Haiku adaptive high | 40/40 | 38/40 |
| Haiku adaptive low | 40/40 | 38/40 |
| Haiku düşünme kapalı | **40/40** | 39/40 |

v1 kuralıyla dört kol da canlı kipte tam (kuralsız istek 7'de Haiku düşünme kapalı 34/40 idi). AMA kurucu 11-04: kural "her zaman şikâyet"
sabit sözcük kuralına dönüşmemeli → genişletilmiş set v2 (37 vaka: varsayımsal / çözülmüş / olumsuzlanan / arıza + bağımsız soru / arıza +
tehlike / konuşma geçmişli) ve bağlamdan ayıran v2 kuralı. Yerel 5.1 (v2 set, canlı kip): bugünkü istem 65/74 → v2 kuralı 73/74 (çözülmüş
2/6 → 6/6, arıza + tehlike 0/4 → 3/4, geçmişli 10/10 → 10/10); temel kipte 64 → 72 (internet sıfırlama vakası temelde geriledi). Haiku v2
kolları istek 9'da.

## 6. İstek 9 (11-04 akşam, commit `c564be8`, iş 126540257353) — düzeltmelerden sonra

### 6a. Karar metni yazıcısı (bekçi iki kolda da planlı modelde)

| ölçü | 5.1 geliştirme | Haiku geliştirme | 5.1 kör | Haiku kör |
|---|---|---|---|---|
| yapay zekâ metni kullanıldı | 39/40 | **40/40** | 30/30 | 29/30 |
| bağımsız yeniden denetim · iç bilgi sızıntısı | 39/39 · 0 | 40/40 · 0 | 30/30 · 0 | 29/29 · 0 |
| 🚨 başka misafirin saati (bağımsız sayım) | 0 | **0** | 0 | **0** (istek 8: 2/30) |
| misafirin dili | 39/39 | 40/40 | 30/30 | 28/28 |
| gerekçesiz retlerde gerekçe UYDURULDU (düşük iyi) | **1/7** | 0/7 | 0/5 | 0/5 |
| gerekçeli ret: gerekçe anıldı (sezgisel) | 10/13 | 8/14 | 10/10 | 8/9 |
| gecikme p95 | 4,7 sn | 3,9 sn | 5,7 sn | 3,8 sn |
| maliyet | $0,0705 | **$0,0067** | $0,0558 | **$0,0049** |

Şablona düşüşler (güvenli): 5.1 d-11 iç satır kopyası (`internal_copy`); Haiku a1-28 kontrol listesindeki saati yazdı → yeni kod kuralı
(`other_guest_time`) tuttu. Bütün retlerde standart saat yazılı ("gerekçe saatsiz" kuralı saati düşürmedi). Kalite ayrıntısı iki yönlü:
5.1 d-18'de kontrol listesinde OLMAYAN gerekçe uydurdu ("temizlik hazırlıkları henüz tamamlanmadığı için"); Haiku d-35 Arapçada gerekçeyi
bozuk kurdu ("yeni misafirlerin ÇIKIŞI aynı gün"). **Sonuç: güvenlik ölçülerinde kayıp yok, kullanım eşit (69/70 ↔ 69/70), 10× ucuz,
daha hızlı → Haiku düşünme kapalı ÖNERİLİR.** Geçiş için kalanlar: istek 10 (ikinci tekrar, kararlılık) · ürün bağdaştırıcısı (ortak
şema-zorlamalı çağrıda `claude-` modeli → Anthropic SDK `output_config.format` json_schema; anahtar kapalı) · gizlilik sayfasında Anthropic
işleyen (kurucu kararı — müşteriye görünen hukuki metin).

### 6b. Anlama — genişletilmiş set v2 (37 vaka × 2 tur), canlı kip

| kol | toplam | çözülmüş | tehlike | geçmişli | temel kip |
|---|---|---|---|---|---|
| 5.1 bugünkü istem | 64/74 | 2/6 | 0/4 | 10/10 | 61/74 |
| **5.1 + v2 bağlam kuralı** | **73/74** | **6/6** | 3/4 | **10/10** | **72/74** |
| Haiku high + v2 | 67/74 | 6/6 | 0/4 | 8/10 | 71/74 |
| Haiku düşünme kapalı + v2 | 69/74 | 3/6 | 4/4 | 8/10 | 71/74 |

5.1 + v2 sabah yerel ölçümü BİREBİR tekrarladı (73/74). Haiku v2 kuralıyla da geride: çözülmüş arızayı yine açıyor ("Tamam boşverin,
fişi gevşekmiş, şimdi çalışıyor" — konuşma geçmişli), bir arızayı kullanım sorusu sayıyor ("Saç kurutma makinesi açılmıyor"), tehlikede
"kullanım" ekliyor. **Sonuç: anlama katmanı 5.1'de kalır; v2 kuralı ürüne anahtar arkasında girdi (`AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED`,
kurucu onayı bekliyor).**

## 7. İstek 10 (11-04 öğleden sonra, commit `24460f3`)

**Karar metni yazıcısı, Haiku ikinci tekrar (kararlılık):** kör 30/30 (istek 9: 29/30) · geliştirme 40/40 · bağımsız denetim, iç bilgi,
başka misafirin saati, uydurulan gerekçe hepsi 0 · p95 5,5–6,0 sn · $0,0052 + $0,0068. Geçiş (kurucu 11-04 "Haikuya geçelim") kararlı.

**Yeniden sıralayıcı (300 kalem, sentetik E4; ölçü: cevap cümlesi istem bloğunda):**

| grup | gömme (bugün) | + 5.1 sıralayıcı | + Haiku düşünme kapalı |
|---|---|---|---|
| ölçek (30) | 100% | 100% | 100% |
| parafraz (82) | 50% | **74%** (+20) | 72% (+18) |
| çok sorulu (39) | 31% | **74%** (+17) | 67% (+14) |
| kayıp | — | 0 | 0 |
| gecikme p50 / p95 | — | 1,4 / 2,1 sn | 1,4 / 2,3 sn |

Haiku bu katmanda hem geride (çok sorulu −7 puan) hem ucuz DEĞİL: aynı Türkçe aday listesini ~2,3 kat token sayıyor (714 bin ↔ ~310 bin) →
$0,075. **Sonuç: yeniden sıralayıcı 5.1'de kalır.** Üç 5.1 katmanının sonucu: karar yazıcısı → Haiku · anlama → 5.1 (+ v2 kuralı) ·
sıralayıcı → 5.1.
