# TASARIM 2026-11-13 — AaaS yönü: envanter, dış araştırma, öneriler (KOD YOK)

> Kurucu (aynen): "Ürünümüzü klasik SaaS'lardan çok AaaS modeline yaklaştıralım; otomasyon ve gelişmiş şekilde, elle girilen, çok web
> sitesinde gezmek yerine Host'a kolaylık ve otonom özelliği gerçekten hissettiren bir sistem."
> Bu belge KARAR DEĞİL, öneridir ("SORMADAN SİSTEM KURULMAZ"). Kod satırları worktree `wt-dev` (`f7d4b5f3`) üzerinden okundu; hiçbir dosya
> değişmedi, test / derleme koşulmadı, mühürlü / kör / kabul dosyası açılmadı. Önceki belgeyle ilişki: `docs/TASARIM-2026-11-11-otomasyon-yol-haritasi.md`
> (OT-1…OT-10) **cevap hattının içini** otomatikleştirir; bu belge **ev sahibinin deneyimini** (ekran, bildirim, yetki, kurulum, fiyat) ele alır.
> ⚠️ Dış kaynak sınırı: bu oturumda sayfa açma (WebFetch) `prnewswire.com` ve `hostaway.com` için ağ tarafından engellendi; dış iddiaların
> hepsi arama sonuçlarının özetinden ve bağlantılarından geliyor. Çoğu **şirketin kendi pazarlama metni**; bağımsız ölçüm bulunamadı.

## 0. Kısa cevap
1. **Ajan altyapısının çoğu zaten yazılmış ama ev sahibi bunu hissetmiyor**, çünkü (a) parçaların yarısı kapalı anahtar arkasında (§1.2),
   (b) "sizi bekleyen" işler 14 menüye dağılmış (`src/lib/nav.ts:25-40`), (c) ajanın **ne yaptığı** tek yerde görünmüyor (Gönderilenler yalnız
   mesajları gösteriyor, `src/app/(app)/sent/page.tsx:343-345`), (d) güven ölçülüyor ama gösterilmiyor (`promotionReadiness` üretimde
   çağrılmıyor, `src/lib/ai-suggestions/core.ts:1381`), (e) sabah özeti hiç yok (`scheduled-sync.ts`te yalnız alarm e-postaları var).
2. Sektör aynı yöne gidiyor: Guesty "her işe değil **istisnalara** bakarsınız" diyor; Hostaway / ProhostAI / Hospitable özerkliği **kademeli**
   ve **daire / mesaj türü başına** açtırıyor; Hospitable otomatik cevabı 1 dk **bekleterek** ev sahibine önce yazma şansı veriyor (§2).
3. Lixus'un farkı şu olmalı: özerklik **modelin "eminim"inden değil**, ev sahibinin ölçülmüş onay oranından + kodun doğruladığı kanıttan
   açılır; riskli sınıflar (şikâyet, para, güvenlik) **hiçbir seviyede** otomatiğe geçmez (`HIGH_STAKES_RISK_TYPES`, `src/lib/automation.ts:286`).
4. En yüksek değer / en düşük risk: **"Bugün" ekranı** (istisna kutusu + "sizin yerinize yaptıklarım") ve **sabah özeti** — ikisi de salt
   okuma, misafire dokunmaz, büyük ölçüde migration'sız. Sonra **iş türü başına yetki tablosu + güven rampası**, sonra **kurulum sohbeti**.
5. Fiyat: sonuç başına ücret (Fin $0,99 / çözüm) Lixus'un çekirdek ilkesiyle **çıkar çatışması** yaratır (devretmek = gelir kaybı). Önerim:
   düz fiyat kalsın, ajanın yaptığı iş **değer raporu** olarak gösterilsin (§4-7).

## 1. Envanter — bugün kodda ne var

### 1.1 Bugün kendiliğinden çalışanlar (anahtar + varsayılan)
| İş | Kod | Anahtar / ayar | Varsayılan | Not |
|---|---|---|---|---|
| Güvenli misafir sorusuna otomatik cevap | `automation.ts:2032` `applyChannelAutoReply`; kapı `:938`; tur `:5179` | genel `AUTO_REPLY_ENABLED` (`:5195`) + işletme `autoReplyHospitable` (`prisma/schema.prisma:129`) + saat penceresi (`:130-131`) | genel açık (canlı), işletme **kapalı** doğar | özerklik bugün **tek düğme + saat**; konu / daire başına seviye yok |
| Karşılama / giriş bilgisi / çıkış mesajı | `automation.ts:5853` · `:6073` · `:6439` | `autoWelcome` / `autoCheckin` / `autoCheckout` (`schema.prisma:134-136`) | **kapalı** | metin her dairenin "Otomatik mesajlar" kartında (`docs/claude/fiyat-ve-ozellikler.md:15`) |
| Rezervasyon gelince temizlik görevi | `automation.ts:1398` `createReservationTasks` | — | açık | |
| Dairenin temizlikçisine otomatik atama | `src/lib/tasks/default-cleaner.ts` (`AutomationRule`) | daire başına bir kez "Kaydet" | yok (seçilince) | kişiye haber `STAFF_NOTIFY_ENABLED` **kapalı** (`src/lib/tasks/notify.ts:23`) |
| Şikâyet / acil → konuşma "Sorunlu" + e-posta | `automation.ts:6662` `sendDueAlerts`; `scheduled-sync.ts:631` | — | açık | kelime ağıyla (anlamsal mimari belgesi §2.1 #1) |
| Mesajdan görev | `automation.ts:1766` | `autoTaskFromMessageEnabled` (`schema.prisma:109`) | **kapalı** | |
| Ev sahibinin sözünden görev | `src/lib/guest-commitments-core.ts:127` | `autoCommitmentsEnabled` (`schema.prisma:174`) + `HOST_COMMITMENT_AUTO_ENABLED` | ayar açık, anahtar **kapalı** | |
| "Teşekkürler"e kısa nezaket cevabı | — | `autoClosingReplyEnabled` (`schema.prisma:90`) | **kapalı** | |
| Doğrulanmış erken giriş (kural + temizlik kanıtı + takvim) | `src/lib/early-checkin/workflow.ts:2-6` | daire kuralı `off / draft / auto` (`early-checkin/core.ts:30`, `rules.ts:134`) | kural yoksa ev sahibine | **bugünkü tek "iş türü başına özerklik seviyesi" örneği** |
| "Dikkat Gerektirenler" (12 tür istisna) | `src/modules/intelligence/incidents/attention.ts:77-90, :274`; panel `dashboard/page.tsx:110, :225` | `ATTENTION_GAP_ENABLED` (yalnız boşluk satırı, `:144`) | açık; en çok 8 satır (`:137`); sakin günde basmaz | istisna kutusunun **çekirdeği hazır** |
| Giriş hazırlığı listesi | `src/lib/readiness-list/evaluate.ts:365`; `arrivals/page.tsx:48-50` | — | açık | eksik veri asla "hazır" değil (`evaluate.ts:5-10`) |
| 2 dakikalık senkron + otomatik işler | `src/lib/scheduled-sync.ts:700-703` | — | açık | |

### 1.2 Yazılmış ama kapalı / yüzeye bağlanmamış ("bekleyen ajan parçaları")
| Parça | Kod | Durum |
|---|---|---|
| Eylem önerileri (görev · Wi-Fi düzeltmesi · söz) + tek tıkla onay | `src/lib/ai-suggestions/core.ts:6-11`, `load.ts:51` | `AI_ACTION_SUGGESTIONS_ENABLED` kapalı (kurucu 10-12 onaylı) |
| **Güven rampası ölçüsü** (14 gün · ≥10 karar · ≥%90 düzenlemesiz onay) | `ai-suggestions/core.ts:27-29, :1381` | yalnız testler çağırıyor — **ekranda yok** |
| Ev sahibi karar kartı (erken giriş / geç çıkış [Onayla] [Reddet]) | `src/lib/decisions/core.ts:2-12`, `flag.ts:7` | `HOST_DECISIONS_ENABLED` kapalı |
| WhatsApp ev sahibi döngüsü (soru · karar düğmesi · acil bildirim · bilgi tabanına kaydet) | `src/lib/host-channel/routing.ts:54-55`, `kb-save.ts:34`, `ask.ts` | `HOST_CHANNEL_*` / `HOST_QUESTION*_ENABLED` kapalı; Meta kurulumu bekliyor |
| Geçmişten öğren (eski cevaplardan bilgi tabanı taslağı + daire talimatları) | `src/lib/history-learn/service.ts:24-36` | `HISTORY_LEARN_ENABLED` kapalı (migration 65 dalda) |
| Geçmiş cevaplardan bilgi önerisi | `src/lib/kb-suggestions-flag.ts:34` | kapalı |
| Doğrulanmış cevap tekrarı (modelsiz) | `src/lib/answer-reuse/store.ts:34` | yalnız gölge |
| Doğrulanmış müsaitlik / uzatma / tarih okuma | otomasyon belgesi §2.1 | kapalı, ölçüm yok |
| Dosyadan bilgi tabanı taslağı | `src/lib/kb-import/document.ts:2-5` | saf; **hiçbir ekrana bağlı değil** |
| Metin yapıştırarak bilgi çıkarma | `src/lib/kb-extract.ts:2-13`; bileşen `components/knowledge/kb-import-text.tsx` | bileşen hiçbir sayfada kullanılmıyor (A5 yüzeyi kurucu 09-11 kararıyla kaldırıldı — `docs/claude/acik-isler.md:141`) |
| Bilgi tabanı boşlukları ("yüzlerce alan doldurtmak yerine ölçülen boşluk") | `src/modules/intelligence/recommendations/kb-gaps.ts:7-9, :108` | **hiçbir yerde çağrılmıyor** (A3 yüzeyi aynı kararla kaldırıldı; `attention.ts:63-64` yorumu "zaten /knowledge'te var" diyor → **bayat**) |
| Bilgi tabanı taraması (aynı kod iki dairede, evcil hayvan "yasak") | `src/lib/kb-scan/same-value.ts:2-6`, `pet-rule.ts` | saf; "kalıcı soru kaydı migration ister" diye bağlanmadı |

### 1.3 Hâlâ elle girilen / sayfa sayfa gezilen işler
| Aşama | İş | Bugün nerede | Var olan otomasyon zemini |
|---|---|---|---|
| Kurulum | Rezervasyonları bağlamak | Ayarlar › Bağlantılar ya da daire sayfası (`dashboard/page.tsx:123-131`) | kanal bağlanınca daireler gelir |
| Kurulum | Takvim (iCal) için daireyi elle eklemek | Mülkler (`dashboard/page.tsx:137`) | — |
| Kurulum | Bilgi tabanı (Wi-Fi, giriş, otopark, kurallar) | Bilgi Tabanı formu (`dashboard/page.tsx:142-146`) | şablondan öneri canlı (`kb-from-templates.ts`); metin / dosya / geçmiş kaynakları kapalı ya da yüzeysiz (§1.2) |
| Kurulum | Kapı kodu / anahtar kutusu | bilgi tabanı kalemi; hazırlık listesi yalnız "kalem var mı"ya bakar (`readiness-list/load.ts:257-258`) | — |
| Kurulum | Karşılama / giriş / çıkış metinleri | **her daire** sayfasında ayrı kart | şablon önizleme + sürüm |
| Kurulum | Erken giriş kuralı · temizlikçi | **her daire** sayfasında ayrı | `AutomationRule` JSON kalıbı |
| Kurulum | Ses + imza · otomatik cevap + saat · 3 yaşam döngüsü anahtarı · uyarı adresi · WhatsApp numarası | Ayarlar'ın farklı sekmeleri (`schema.prisma:74, 129-136`) | — |
| Günlük | Taslak onayı / sorunlu konuşma | Mesajlar (konuşma konuşma) | otomatik cevap |
| Günlük | Bugün giriş hazır mı | Girişler | `evaluateStay` |
| Günlük | Görev / malzeme | Görevler · Hazırlık | otomatik görev |
| Günlük | Karar bekleyen talep · eylem önerileri | (kapalı) panel kartı · konuşma paneli | §1.2 |
| Günlük | QR sohbetleri · iptaller · gönderilenler | üç ayrı sayfa | — |

**Teşhis:** zekâ var, **toplayıcı yok**. Ev sahibi "bana bugün ne lazım?" sorusunun cevabını en az beş sayfadan (Panel, Mesajlar, Girişler,
Görevler, Misafir Sohbetleri) kendisi birleştiriyor; ajanın gece ne yaptığını görmek için Gönderilenler'e gitmesi gerekiyor ve orada görev /
atama / söz görünmüyor.

## 2. Dış araştırma — ajan ürünleri özerkliği nasıl sunuyor
| Desen | Kim, nasıl | Kaynak |
|---|---|---|
| Kademeli özerklik (öner → onayla → otomatik) | Hostaway INTO: "Agent Assist / Copilot / Autopilot" üç seviye | [hostaway.com/marketplace/into_ai](https://www.hostaway.com/marketplace/into_ai) |
| Daire / mesaj türü başına açma | ProhostAI: ev sahibi Autopilot'u daire ya da mesaj türü başına açana kadar taslak; Hospitable (GuestReply AI entegrasyonu): daire başına | [prohost.ai/integrations/hostaway](https://prohost.ai/integrations/hostaway) · [help.hospitable.com/…/18233905](https://help.hospitable.com/en/articles/18233905-connect-hospitable-with-guestreply-ai-to-answer-guest-messages-around-the-clock) |
| Güven eşiği + kapsam + devir kuralı | Guesty ReplyAI Autopilot (22 Nis 2026): eşik, daire + mesaj türü seçimi; eşik altı, uzun, olumsuz duygulu ya da tanımsız senaryo ekibe; "You see a flag, not a sent reply" | [guesty.com/blog/communication-agent-pms](https://www.guesty.com/blog/communication-agent-pms/) · [mannpublications…/2026/04/22](https://www.mannpublications.com/mannreport/2026/04/22/guesty-launches-replyai-autopilot-and-ai-task-creation/) |
| Gönderim gecikmesi = geri alma penceresi | Hospitable: otomatik cevap varsayılan 1 dk bekler, ev sahibi önce yazabilir; Inbox AI'da gecikme seçeneği | [help 18233905](https://help.hospitable.com/en/articles/18233905-connect-hospitable-with-guestreply-ai-to-answer-guest-messages-around-the-clock) · [changelog.hospitable.com](https://changelog.hospitable.com/91232-weekly-product-updates) |
| "Yalnız istisnaya bak" | Guesty: "You review exceptions instead of every task" | [guesty.com/blog/ai-agents-run-operations](https://www.guesty.com/blog/ai-agents-run-operations/) |
| Sabah özeti | Guesty: önümüzdeki 24 saatin rezervasyon özeti (şirket sayfası); Jurny: gece işler, sabah özet okunur (rakip karşılaştırma pazarlaması) | [guesty.com/lp/ai-agents-lp](https://www.guesty.com/lp/ai-agents-lp) · [blog.jurny.com](https://blog.jurny.com/jurny-vs-hostaway-agentic-ai-vs-approval-first-ai-for-property-managers) |
| Ajan merkezi (çalıştı mı, düştü mü, süresi geçen onay) | Guesty AI agent hub: çalışma durumu, başarısız koşu, cevapsız süresi dolan onaylar | [help.guesty.com/…/37246700705821](https://help.guesty.com/hc/en-gb/articles/37246700705821-Using-the-AI-agent-hub) |
| Mesajdan "atanmaya hazır" görev | Guesty AI Task Creation (aciliyetle); Hospitable Issue Alerts (sızıntı, gürültü, kilit) | [mannpublications](https://www.mannpublications.com/mannreport/2026/04/22/guesty-launches-replyai-autopilot-and-ai-task-creation/) · [hospitable.com/ai-for-vacation-rentals](https://hospitable.com/ai-for-vacation-rentals) |
| Prosedür içinde insan onayı | Intercom Fin: iade / istisna / veri silme gibi adımlarda süreç durur, ekip arkadaşı onaylar; devir kuralları ayrı; Fin Operator'ın kural önerisi onaysız canlıya çıkmaz | [intercom 14468561](https://www.intercom.com/help/en/articles/14468561-human-in-the-loop-approvals-for-fin-procedures) · [12396892](https://www.intercom.com/help/en/articles/12396892-manage-fin-ai-agent-s-escalation-guidance-and-rules) · [14707474](https://www.intercom.com/help/en/articles/14707474-use-fin-operator-for-guidance-rules) |
| Düz dille yazılmış prosedür | Decagon "Agent Operating Procedures" (kod değil, düz İngilizce) + QA izleme | [featurebase.app/blog/decagon-pricing](https://featurebase.app/blog/decagon-pricing) |
| Önce salt-okuma asistan | Hospitable Copilot (27 May 2025): başlangıçta yalnız içgörü; görev atama / fiyat / iletişim "ileride" | [10minhotel](https://en.10minhotel.com/2025/05/27/hospitable-launches-copilot-the-ai-brain-setto-transform-short-term-rental-operations/) |
| Hassas eylemde zorunlu onay | Google Gemini ajanı satın alma / ödeme öncesi onay ister; Microsoft Copilot Studio ajan akışlarında insan onayı (Outlook'a giden istek) | [9to5google](https://9to5google.com/2025/12/08/gemini-chrome-agentic-security/) · [blog.google](https://blog.google/security/architecting-security-for-agentic/) · [learn.microsoft.com](https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-advanced-approvals) |
| Sıfır-yazma kurulum | Airbnb Smart Setup (20 May 2026): fotoğraf + adres → taslak ilan (ikincil kaynak) | [techcrunch 2026/05/20](https://techcrunch.com/2026/05/20/airbnb-gets-into-hotels-expands-ai-for-host-onboarding-and-customer-support/) |
| "Ortak ev sahibi" zihin modeli | Airbnb Co-Host Network (Eki 2024): mesajlaşma + rezervasyonu ortak ev sahibine devretmek kanıksanmış | [news.airbnb.com](https://news.airbnb.com/en-au/airbnb-2024-oct-release-introducing-co-host-network-the-best-local-host) |
| Pratik ilkeler | geri alması ucuzsa çalıştır, pahalıysa sor; özerklik güvenilirlikle kazanılır; devrin sahibi + cevap süresi olmalı | [hatchworks.com](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/) · [towardsai](https://pub.towardsai.net/designing-for-ai-agents-8-ux-patterns-that-build-trust-in-2026-713a0c926933) |

**Benimseme gerçeği:** Hostaway'in 2026 anketinde (700+ işletme) %88 bir biçimde yapay zekâ kullanıyor ama yalnız ~%20 ajan / otomatik iş
akışı çalıştırıyor ([hostaway.com/blog/2026-STR-AI-benchmark-report](https://www.hostaway.com/blog/2026-STR-AI-benchmark-report/)). Airbnb'nin
kendi destek ajanı ABD-Kanada'da sorunların ~1/3'ünü insansız çözüyor ([techcrunch 2026/02/13](https://techcrunch.com/2026/02/13/airbnb-says-a-third-of-its-customer-support-is-now-handled-by-ai-in-the-u-s-and-canada/));
3. çeyrek ~%40 iddiası tek ikincil kaynakta ([customerexperiencedive](https://www.customerexperiencedive.com/news/airbnb-reduces-customer-support-cost-per-booking-17/874307/)) — doğrulanamadı.
Enso Connect'in çok ajanlı "AutoPilot" duyurusu (Eki 2025) için birincil bağlantı **bulunamadı**. Hospitable MCP sunucusunun tarihi **bulunamadı**.

**Fiyat modelleri:**
| Model | Örnek | Kaynak |
|---|---|---|
| Çözüm başına | Intercom Fin $0,99 / çözülen konuşma | [preferences.intercom.com/pricing](https://preferences.intercom.com/pricing) · [featurebase](https://www.featurebase.app/blog/fin-ai-pricing) |
| Otomatik çözüm başına (sonuç bazlı) | Zendesk, Ağu 2024: "yalnız yapay zekânın kendi çözdüğü iş"; kullanım panosu | [zendesk newsroom](https://www.zendesk.com/newsroom/articles/zendesk-outcome-based-pricing/) |
| Sonuç bazlı, devirde ücret yok | Sierra: "çözülmezse çoğu durumda ücret yok"; oran sözleşmeyle | [Sequoia — Bret Taylor](https://inferencebysequoia.substack.com/p/how-ai-is-reinventing-software-business) |
| Eylem başına | Salesforce Agentforce Flex Credits: eylem başına $0,10 (May 2025) | [salesforce.com news](https://www.salesforce.com/news/press-releases/2025/05/15/agentforce-flexible-pricing-news/) |
| Konuşma ya da çözüm başına (açık değil) | Decagon | [featurebase](https://featurebase.app/blog/decagon-pricing) |
| Daire başına aylık | HostBuddy ~$7–12 / daire (üçüncü taraf; doğrulanamadı) | [bnbcalc](https://www.bnbcalc.com/reviews/hostbuddy-ai-review) |
| Plana dâhil | Hospitable: yapay zekâ ek ücretsiz | [hospitable.com/ai-for-vacation-rentals](https://hospitable.com/ai-for-vacation-rentals) |
| Geri ödeme garantisi | Enso: ek satış abonelik ücretini karşılamazsa ücretsiz devam (şirketin kendi karşılaştırması) | [ensoconnect.com](https://ensoconnect.com/resources/besty-ai-vs-enso-connect-str-tools-comparison) |

## 3. Lixus'a uyarlanmış ilke: "ölçülmüş özerklik + tek istisna kutusu + görünür iş günlüğü"
Sektörden **alınacak**: kademeli seviye, iş türü / daire başına açma, istisna kutusu, gecikmeli gönderim, sabah özeti, ajan merkezi.
**Alınmayacak:** Guesty tipi "model güven eşiği" — bizim kuralımız "benzerlik puanı ve modelin 'eminim'i kanıt değildir"
(`docs/TASARIM-2026-11-12-anlamsal-karar-mimarisi.md` §1.3). Lixus'ta seviye yükseltmenin dayanağı (i) kodun doğruladığı kanıt
(araç sonucu, temizlik kaydı, kural) ve (ii) ev sahibinin **ölçülmüş düzenlemesiz onay oranı** (`promotionReadiness`) olur.

| Seviye | Anlamı | Lixus'ta bugünkü örnek | Değişmez kapı |
|---|---|---|---|
| 0 Kapalı | ajan hiçbir şey yapmaz | yaşam döngüsü mesajları varsayılan | — |
| 1 Öner | taslak / öneri kartı; ev sahibi yapar | gelen kutusu taslağı; eylem önerileri (kapalı) | — |
| 2 Tek dokunuşla onay | ajan hazırlar, ev sahibi [Onayla] der (panel / WhatsApp) | karar kartı (kapalı); erken giriş `draft` | metni kod kurar |
| 3 Otomatik + iz | ajan yapar, günlüğe yazar, (mümkünse) geri alma penceresi | güvenli soru cevabı; erken giriş `auto` | `HIGH_STAKES_RISK_TYPES` (`automation.ts:286`), şikâyet, para / iade, güvenlik, kural ihlali **asla** 3 olmaz |

## 4. Öneriler (değer ÷ efor-risk sırasıyla)
| # | Öneri | Değer | Efor / risk | Migration | Misafire gideni değiştirir mi |
|---|---|---|---|---|---|
| 1 | "Bugün" ekranı: istisna kutusu + "sizin yerinize yaptıklarım" | çok yüksek | orta / düşük | yok (salt okuma) | hayır |
| 2 | Sabah özeti (önce e-posta, sonra WhatsApp) + tek dokunuşla onay | yüksek | orta / düşük | gönderim kaydı için muhtemel (ölçülmeli) | hayır (ev sahibine yeni metin → onay) |
| 3 | İş türü başına yetki tablosu + görünür güven rampası | yüksek | orta / orta | muhtemelen yok (`AutomationRule` JSON kalıbı, `schema.prisma:987`) | seviye değişimi evet → **kurucu onayı** |
| 4 | Ajan eylemi + geri alma penceresi (görev / atama / söz; gecikmeli gönderim) | orta-yüksek | orta / orta | görev için yok; gecikme kalıcı kuyruğa bağlı | gecikme zamanlamayı değiştirir → **kurucu onayı** |
| 5 | Sıfır-yazma kurulum: "kurulum sohbeti" | çok yüksek | yüksek / orta | 65, 88, 89 dalda; tarama soruları için yeni | dolaylı (bilgi tabanı; her kalem ev sahibi onaylı) |
| 6 | Ev sahibinin sorusuna salt-okuma cevap (WhatsApp "Ask Lixus") | orta | orta / düşük | yok | hayır |
| 7 | Fiyat: düz fiyat + değer raporu | orta | düşük / düşük | yok | hayır |

**4-1 "Bugün" ekranı.** *Var olan:* `findAttentionItems` 12 tür istisna (`attention.ts:77-90`) · `evaluateStay` (Girişler) · karar kartı ·
eylem önerileri · `AutomatedMessageSend` (`schema.prisma:1456`) ve `RiskEvent` (`:1204`) kayıtları · görev geçmişi. *Yeni:* tek toplayıcı:
üstte **"Sizi bekleyenler (N)"** (Dikkat Gerektirenler + hazır olmayan / bilinmeyen girişler + karar bekleyenler + bekleyen öneriler),
altında **"Bugün sizin yerinize"** satırı ("Gece 7 soru cevaplandı · 2 giriş mesajı gönderildi · 3 temizlik görevi açılıp atandı · 1 soru
size kaldı"); her satırda çözen ekrana tek bağlantı (Girişler'deki `FactorLink` deseni, `evaluate.ts:43-51`). Sakin günde istisna bölümü
**boş** basar. *Örnek (önce → sonra):* Önce: ev sahibi Panel → Mesajlar → Girişler → Görevler'i gezer. Sonra: Panel'in tepesinde "Sizi
bekleyen 2 iş: Daire 3 bugün 15:00 giriş — temizlik 'bitti' kaydı yok [Görevi aç] · Daire 5 misafiri 6 saattir cevap bekliyor [Konuşmaya git]".
*Risk:* panelde tekrar — 08-08'de "AI günlük özet" kartı tam bu sebeple kaldırıldı ve geri ekleme şartı yazılı: kutucukların
göstermediğini söylemeli, sakin günde hiç görünmemeli (`dashboard/page.tsx:232-249`). Bilgi tabanı boşlukları (A3) kurucu 09-11 kararıyla
kaldırılmıştı → kutuya **sorulmadan** konmaz. *İlk dilim:* salt-okuma toplayıcı + "Bugün sizin yerinize" sayacı (yalnız var olan kayıtlar,
yeni yazım yok); istisna satırları bugünkü `AttentionPanel`'in genişletilmesi. Ekran düzeni kurucu onayıyla.

**4-2 Sabah özeti.** *Var olan:* e-posta kuyruğu (`EMAIL_OUTBOX_ENABLED`, canlı), WhatsApp şablon altyapısı + karar düğmeleri (§1.2), uyarı
adresi (`schema.prisma:74`), geçiş tabanlı alarm durumu (`src/lib/alert-state.ts`). *Yeni:* işletmenin saat diliminde sabah tek mesaj,
4-1 ile **aynı toplayıcıdan** (ikinci kural yok); sakin günde "bugün sizi bekleyen iş yok" ya da hiç gönderilmez (soru). *Örnek ev sahibi
metni (sade, kurucu onayına):* "Günaydın. Bugün 3 giriş var; Daire 3'ün temizliği henüz bitti olarak işaretlenmedi. Gece 7 soruyu
cevapladım, 1'i size kaldı. 1 erken giriş isteği kararınızı bekliyor. [Panelde aç]". *Risk:* bildirim yorgunluğu (sakin gün kuralı);
e-postada misafir adı / mesajı **yok** (QR devir e-postasıyla aynı ilke: daire + sebep + bağlantı); WhatsApp için Meta şablon onayı gerekir;
günde bir kez garantisi için gönderim kaydı — mevcut tablolarla (alarm durumu / işlem izi) yapılabilir mi ölçülmeli, yapılamıyorsa küçük
migration (onay + taze yedek). *İlk dilim:* yalnız e-posta, yalnız kurucu org, metin onayından sonra.

**4-3 Yetki tablosu + güven rampası.** *Var olan:* erken giriş `off / draft / auto` (`early-checkin/core.ts:30`) `AutomationRule`'da;
`promotionReadiness` (`ai-suggestions/core.ts:1381`, eşikler `:27-29`, kurucu 10-12 "2 hafta ≥ %90"); işletme anahtarları
(`schema.prisma:90, 109, 129, 134-136, 174`). *Yeni:* Ayarlar'da tek tablo "Asistanın yetkileri": satır = iş türü, sütun = seviye 0–3,
her satırda ölçüm ("Son 14 günde 12 görev önerisi, 11'i değiştirilmeden onaylandı"). Rampa **öneri** verir ("Bu işi bana bırakabilirsiniz
[Otomatiğe al]"), kendiliğinden yükseltmez. Önerilen satırlar: bilgi sorusu cevabı · giriş bilgisi mesajı · karşılama / çıkış · temizlikçiye
atama · mesajdan görev · Wi-Fi düzeltmesi · söz kaydı · erken giriş · geç çıkış · (açılınca) müsaitlik / uzatma. Kalıcı olarak seviye ≤2:
şikâyet, iade / para, güvenlik, kural ihlali, kapı kodu değişikliği. *Örnek:* Misafir "Havlu bitti" yazar → bugün: kelime ağı şikâyet
sayarsa atanmamış genel görev; seviye 2: "Daire 3'e havlu — Ayşe'ye ata, bugün 14:00 [Onayla]"; seviye 3: görev açılır + atanır, sabah özetinde
"yaptım" satırı. *Risk:* ilk dilim yalnız mevcut düğmeleri **tek yerde göstermek** (davranış aynı) ise düşük; misafire giden satırların
seviyesini değiştirmek kurucu onayı ister. Rampa için gerçek karar verisi lazım → Railway kapalıyken kalibre edilemez.

**4-4 Ajan eylemi + geri alma penceresi.** *Var olan:* görev durum + geçmiş tek işlemde (C-17), "Yapamıyorum" akışı, claim-then-send,
kalıcı kuyruk (`DURABLE_OUTBOX_ENABLED` kapalı, `src/lib/outbox/flag.ts:8`). *Yeni:* mesaj DIŞI eylemlerde "Yaptım: Daire 3'e havlu
görevi açtım, Ayşe'ye atadım [Geri al]" (geri alma = görevi iptal + kişiye haber); misafir mesajında geri alma **gönderimden sonra imkânsız**
(Airbnb mesajı geri çekilmez) → pencere ancak **gönderim öncesi gecikme** olabilir (Hospitable'ın 1 dk deseni). *Risk:* gecikme gece
cevabını yavaşlatır; ev sahibi aynı anda yazarsa çift cevap riski — claim kuralı ile çözülmeli. *İlk dilim:* yalnız görev / atama geri alma
(misafire dokunmaz); gecikme ayrı soru.

**4-5 Kurulum sohbeti (sıfır-yazma).** *Var olan:* şablondan öneri (canlı), geçmişten öğren (`history-learn/service.ts`), WhatsApp soru +
"bilgi tabanına ekle" (`host-channel/kb-save.ts`; Wi-Fi / giriş bilgisi bilerek **teklif edilmez**), dosyadan taslak (`kb-import/document.ts`,
bağlı değil), boşluk ölçümü (`kb-gaps.ts`, çağrılmıyor), bilgi tabanı onay sözleşmesi (A1, onaysız kalem modele gitmez). *Yeni:* tek akış:
bağla → ajan geçmiş cevapları, şablonları, otomatik mesajları okur → "Mesajlarınızdan 14 bilgi çıkardım [Hepsini gözden geçir]" → yalnız eksik
kritik 4–5 soru sorulur (giriş saati, çıkış, otopark, temizlikçi, ev kuralları) → her cevap önizlemeyle kaydedilir. *Kural önerisi:* kapı kodu
ve Wi-Fi şifresi WhatsApp'tan **alınmaz** (panel bağlantısı); hiçbir kalem onaysız modele gitmez. *Risk:* model çıkarımı yanlış olgu üretebilir
→ alıntı kaynakta birebir şartı (anlamsal mimari §1); A3 / A5 yüzeyleri kurucu kararıyla kaldırılmıştı → geri getirmek **soru**. *İlk dilim:*
var olan kaynakları (şablon + otomatik mesaj metinleri) tek "bulduklarım" listesinde birleştirmek; model yok.

**4-6 Ask Lixus (salt-okuma).** Otomasyon belgesindeki AA-2'nin ev sahibi yüzü: WhatsApp'tan "bu hafta kaç giriş var?" → kapalı listeden
parametreli sorgu → kodun kurduğu cevap. Hospitable Copilot da salt-okumayla başladı (§2). Yol planında V8; önce 4-1…4-3.

**4-7 Fiyat.** Bugün düz ve daire bandına bağlı (₺449 / ₺899 / ₺1.699, özellik kilidi yok — `docs/claude/fiyat-ve-ozellikler.md:7-9`).
Sonuç başına ücretin üç sakıncası: (i) **çıkar çatışması** — Sierra modelinde devir ücretsiz; Lixus'ta devir *güvenli yol*, otomatik çözümü
paraya bağlamak "riskli mesaj hep insana" ilkesine karşı teşvik yaratır; (ii) "çözüldü" tanımı tartışması (Sierra'da sözleşme konusu);
(iii) ~10 daireli Türk ev sahibi için öngörülemeyen fatura. **Önerim:** düz fiyat kalsın; Panel ve aylık e-postada **değer raporu**
("Bu ay sizin yerinize 212 soruyu cevapladım, 38 görevi açıp atadım; 19 konu size kaldı") — yalnız kayıtlı olaylardan sayılır, tahmini
"kazandırılan saat / lira" yok (V2 para etkisi kuralı: sahte kesinlik yok). İleride istenirse "otonom paket" eki ayrı karar.

## 5. Bağlayıcı kurallarla çatışmalar ve aşamalama
| Kural | Çatışma | Aşamalama |
|---|---|---|
| "SORMADAN SİSTEM KURULMAZ" (CLAUDE.md Çalışma tarzı) | yetki tablosu, rampa, özet = yeni sistem | her biri §7 sorusuna bağlı; rampa **asla** kendiliğinden yükseltmez |
| Kurucu talimatı 09-07: geniş otonom davranış ancak yetki + korkuluk + dayanak + ölçüm doğrulanınca (`docs/KURUCU-TALIMATI-…md:1555-1557`) | seviye 3'ün genişlemesi | önce salt-okuma (4-1, 4-2), sonra ölçülmüş anahtarlar (OT-1), en son seviye 3 |
| Riskli mesaj hep insana · misafire doğrulanmamış iddia yok · ev sahibi sesi | sonuç bazlı fiyat teşviki; otomatik eylemin misafire yansıması | yüksek riskli sınıflar tabloda kilitli; misafir metni değişmez; sonuç bazlı fiyat önerilmez |
| Müşteriye giden metin sade | özet / WhatsApp metinleri | teknik terim yok; metinler kurucu onayıyla |
| Railway kapalı (`docs/claude/canli-durum.md`); OpenAI kredisi bitti (11-12) | rampa gerçek karar verisi ister; WhatsApp Meta kurulumu bekliyor | kod + kurgusal veriyle hazırlanır; açılışta kurucu org'da 2 hafta ölçüm |
| Migration kuralları (taze yedek + açık onay; dolu tabloya `@unique` / zorunlu kolon yok) | özet gönderim kaydı, tarama soru kaydı | önce migration'sız kalıp (`AutomationRule` JSON, var olan durum tabloları); gerekirse yalnız yeni tablo |
| KVKK / değişmez 14 (Airbnb kaynaklı veri ayrı politika) | e-posta / WhatsApp'a misafir verisi | özette misafir adı / mesajı yok; daire + saat + sebep |
| Kurucu kararları: AI özet kartı kaldırıldı (08-08), A3 / A4 / A5 yüzeyleri kaldırıldı (09-11) | "Bugün" ve kurulum sohbeti bunlara dokunur | geri ekleme şartları yazılı (`dashboard/page.tsx:246-249`); A3 / A5 yeniden açmak soru |
| Hospitable'a özgü ekran yapılmaz | — | hepsi sağlayıcıdan bağımsız kayıtlar üzerinde (`attention`, `ChannelConnection`) |
| Başka modelin / Codex'in önerisi karar değildir | kurucu ikinci görüş alacak | iki öneri kodda ölçülerek birleştirilir; çelişki kurucuya sorulur |

## 6. Önerilen sıra (her adım ayrı onay)
| Adım | İş | Misafire dokunur mu | Ön koşul |
|---|---|---|---|
| AS-1 | "Bugün" toplayıcı (salt okuma) + "sizin yerinize" sayacı | hayır | ekran onayı (AAS-1) |
| AS-2 | Sabah özeti e-postası (kurucu org) | hayır | metin onayı (AAS-2); gönderim kaydı kararı |
| AS-3 | Yetki tablosu — ilk hâli bugünkü düğmelerin tek yerde **görünümü**; rampa ölçüsü görünür | hayır | AAS-3 / AAS-4 |
| AS-4 | Railway açılışı: OT-1 ölçümleri + `AI_ACTION_SUGGESTIONS_ENABLED` 2 hafta + karar kartı + WhatsApp | evet (ayrı onaylar) | Railway, Meta, kredi |
| AS-5 | Seviye 3 (görev / atama) + geri alma; özet WhatsApp'a | yalnız görev tarafı | AS-4 ölçümü |
| AS-6 | Kurulum sohbeti | dolaylı | AAS-5; A3 / A5 kararı |
| AS-7 | Değer raporu (Panel + aylık e-posta) | hayır | AAS-6 |

## 7. Kurucu soruları
- **AAS-1:** "Bugün" ekranı Panel'in tepesine mi gelsin (önerim), yoksa ayrı sayfa mı? Menü sadeleşsin mi (Hazırlık · İptaller · Gönderilenler
  ikincil menüye)?
- **AAS-2:** Sabah özeti: saat? Sakin günde hiç gönderilmesin mi, "bugün iş yok" mu yazsın? E-postada misafir adı olmasın (önerim) — uygun mu?
- **AAS-3:** Yetki tablosundaki iş türleri listesi ve "asla otomatik olmayanlar" (şikâyet, iade / para, güvenlik, kural ihlali, kapı kodu
  değişikliği) doğru mu?
- **AAS-4:** Güven rampası: sistem önersin, siz açın (önerim) mi; yoksa eşik dolunca kendiliğinden mi açılsın?
- **AAS-5:** Kurulum sohbeti panelde mi WhatsApp'ta mı? Kapı kodu / Wi-Fi şifresi WhatsApp'tan alınmasın (önerim). A3 (bilgi boşlukları) ve
  A5 (metinden bilgi çıkarma) yüzeylerini bu akışın içinde geri açalım mı?
- **AAS-6:** Fiyat: düz fiyat + değer raporu (önerim) / karma (pakete dâhil N çözüm + aşım) / sonuç bazlı?
- **AAS-7:** Otomatik cevaplara gönderim öncesi bekleme (ör. 1–3 dk, siz önce yazabilesiniz diye) eklensin mi?
- **AAS-8 (§8.2):** "Kontrol bekliyor" işaretli otomatik giriş mesajı: kontrol edilene kadar TUTULSUN mu (önerim), yoksa bugünkü gibi gitsin
  ve yalnız Girişler'de açıkça mı yazsın?

## 8. Claude'un ikinci okuması (kodda doğrulanan + eklenenler)
Araştırma bir alt ajanın; iddiaların dayanakları kodda yeniden okundu: `promotionReadiness` yalnız kendi modülünde ve testlerde
(`src/lib/ai-suggestions/core.ts`, `tests/unit/ai-suggestions-core.test.ts`, `tests/integration/ai-action-suggestions.test.ts`) ✓ ·
`kb-gaps.ts` hiçbir yerden çağrılmıyor (`kb-from-history.ts:35` yalnız yorumda anıyor) ✓ · `findAttentionItems` tek çağıran Panel
(`dashboard/page.tsx:110`) ✓ · `HIGH_STAKES_RISK_TYPES` `automation.ts:286` ✓ · menüde 15 bağlantı (`src/lib/nav.ts`).

### 8.1 Kurucunun 11-13'te onayladığı iki iş AaaS'ın ilk "tek dokunuş" adımlarıdır
UX-10 (a) Girişler'den doğrudan temizlikçi atama ve (b) "Giriş mesajını gönderin" düğmesi = seviye 2'nin ilk iki örneği: ajan sorunu
bulur (hazırlık değerlendirmesi), ev sahibi tek dokunuşla çözer, sayfa değiştirmez. "Bugün" toplayıcısı (AS-1) aynı eylem kalıbını
(`FactorLink` → eylem) kullanmalı; ikinci bir eylem sistemi yazılmamalı. (b)'nin ilk gerçek gönderimi kurucuyla yapılır.

### 8.2 Özerklik ilkesine ters düşen bugünkü bir davranış: "kontrol bekliyor" giriş mesajı
Migration 80 giriş mesajlarını bilgi tabanından daireye taşırken, birden çok farklı kalemi olan dairelerde EN YENİ metni seçip
`needsReview` işaretledi; daire kartı "Bu daire için birden fazla kayıt vardı; en son eklenen seçildi. Metni kontrol edip kaydedin." der.
Ama gönderici bu işarete BAKMAZ, mesaj otomatik gider. Örnek: eski kalem kapı kodu 1234, yeni kalem 5678; yeni kalem yanlışsa misafir yanlış
kodu alır. "Geri alması pahalıysa sor" ilkesi (§2 son satır) burada TUTMA'yı önerir: işaret kalkana kadar mesaj gitmez, Girişler'de
"Giriş mesajı kontrolünüzü bekliyor [Kontrol edin]" satırı çıkar. Misafire gideni değiştirdiği için karar kurucuda (AAS-8).

### 8.3 "Sizin yerinize yaptıklarım" sayacının kuralı
Sayaç yalnız kalıcı kayıtlardan sayılır (tahmin yok): otomatik cevap = mesajın `senderName` sihirli değeri VEYA `aiAssisted`
(rapor sayımıyla aynı kural, CLAUDE.md "DOKUNMA"); yaşam döngüsü mesajı = `AutomatedMessageSend`; görev / atama = görev geçmişi. Rapor
sayfasındaki sayıyla çelişen ikinci bir sayım yazılmaz — ekran ve sabah e-postası aynı fonksiyonu okur.

### 8.4 Sıralama önerisine katkı
AS-1'den önce, Railway kapalıyken bile yapılabilecek küçük bir adım: menüde "sizi bekleyen" sayısını tek yerde göstermek (bugünkü
rozetlerin toplamı) — yeni veri yok, salt okuma. Kurucunun Fable görüşüyle birleştirilecek; çelişen noktalar kodda ölçülüp sorulur.
