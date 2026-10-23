# Kurucu talimatı (2026-09-07) — ürün vizyonu, teknik değişmezler, V0 ve gelecek AI gereksinimleri

> Kullanıcının (musaxd57) 2026-09-07'de gönderdiği uzun talimat, AYNEN. Codex'in yazdığı bölümler dahil.
> Bu belge YOL PLANIDIR: CLAUDE.md'nin "Yol planı" bölümü bunun özetidir; çelişkide bu metin kazanır.
> Windows yolları kullanıcının makinesine aittir (Codex çıktı klasörü); denetim dosyalarının repo kopyası `docs/audit-2026-09-05/`.

---

1. Lixus core business logic must not require Hospitable semantics.

2. A provider can be replaced without rewriting unrelated core features.

3. External identities must be scoped safely enough to support
   multiple channels, accounts and tenants.

4. Credentials and connection lifecycle belong to the integration
   boundary, not arbitrary business logic.

5. Outbound actions must resolve their destination through the
   appropriate authorized channel connection.

6. Provider-specific payloads must not leak unnecessarily into
   canonical business logic.

7. Existing production behavior must remain functional during
   migration.

8. The migration must be incremental and reversible.

9. Airbnb Direct must be introducible later without requiring
   a second architectural rewrite.

10. No refactor is considered complete merely because names
    no longer contain "Hospitable".

En kritik tespitim
Şu anda Guesty ve Hostaway’e bakınca sadece “AI mesaj cevaplıyor” yapmak artık yeterli değil.
Guesty bugün zaten commitment tracker, Airbnb quality monitor, reservation readiness, daily task planner, photo optimizer, data copilot ve owner satisfaction gibi bir sürü küçük agent sunuyor. Guesty
Hostaway de canlı PMS verisine soru sorabilen CoHost, AI mesajlaşma, revenue management ve operasyon otomasyonuna gidiyor. Hostaway
Breezeway ise fotoğraflı/property-specific checklist, referans fotoğraf ve çalışanlardan kanıt toplama işinde güçlü. Breezeway
Dolayısıyla Lixus’a 15 tane ayrı AI butonu eklersek sadece onları yakalamış oluruz.
Ben Lixus’un merkezine daha güçlü bir şey koyardım:
Lixus Brain
Her mülkün, rezervasyonun ve problemin geçmişini gerçekten hatırlayan ve kendisi önceliklendiren operasyon beyni.
Şöyle düşün:
                 LIXUS BRAIN

Reservations ───────┐
Messages ───────────┤
Reviews ────────────┤
Tasks ──────────────┤
Properties ─────────┤
Inspections ────────┤
Revenue ────────────┤
Maintenance ────────┘
                     ↓
             PROPERTY MEMORY
                     ↓
        RISK / MONEY / OPPORTUNITY
                     ↓
                ACTIONS
Asıl fark burada.
1. İlk yapacağım özellik: Property Memory
Bu özellik diğer her şeyin temeli.
Lixus her daire hakkında yaşayan bir hafıza tutacak.
Örneğin:
Property 43825010
KNOWN STRENGTHS
- Location
- Ferry access
- Responsive host

KNOWN RISKS
- Hot water capacity
- Evening noise
- Bathroom maintenance

INCIDENT HISTORY

12 Nov 2025
Guest: hot water insufficient
Severity: HIGH

4 Feb 2026
Guest: shower issue
Severity: MEDIUM

17 May 2026
Maintenance: water heater reset

22 Jul 2026
Guest mentioned shower again

PATTERN
Hot water issue: 4 signals / 9 months

STATUS
🔴 Recurring
Şimdi Lixus'a yarın rezervasyon düşüyor.
Normal PMS:
Check-in tomorrow.

Lixus:
43825010'a yarın iki kişi geliyor. Bu dairede tekrarlayan sıcak su problemi var ve son doğrulanmış sıcak su testi 18 gün önce. Check-in öncesi test gerekli.

İşte ürün burada başka seviyeye çıkar.
Senin kendi 1.170 yorum analizinde sıcak su/tesisat, gürültü, erişim, kapasite ve temizlik zaten tekrar eden portfolio sorunları. Airbnb_1170_Yorum_Derin_Denetim_Raporu (1) (1).pdfPDF
2. Sonra: Exception Feed
Dashboard'u 150 kartla doldurmayalım.
Ana ekran şöyle olsun:
Needs your attention
Ve Lixus yalnız gerçekten önemli şeyleri göstersin.
Örneğin:
🔴 HIGH RISK

43104164
Check-in in 19h

7 guests
1 bathroom
AC verification missing
Bedding proof missing

Potential impact:
Bad review / relocation

[Create tasks]
💰 REVENUE LEAK

35090691

2-night gap detected
11 days from now

Estimated opportunity:
₺8,200 – ₺10,400

Suggested:
Allow 2-night stay only for gap

[Review]
⚠️ GUEST COMMITMENT

Guest was promised:
"Extra towels before 18:00"

No related completed task found.

Deadline:
2h 14m

Burada önemli olan:
Lixus sana veri göstermiyor. Lixus sana neyle ilgilenmen gerektiğini söylüyor.
3. Her uyarının bir Money Impact değeri olsun
Bence bu çok güçlü bir farklılaştırıcı olur.
AI her şeyi aynı önemde göstermemeli.
Örneğin:
Replace remote batteries
Cost: ₺120
Potential review risk: Medium
Priority score: 71
versus:
2 unsold nights
Potential lost revenue: ₺9,400
Priority score: 93
versus:
Recurring hot water failure
Upcoming reservation value: ₺22,000
Relocation/refund risk: High
Priority score: 98
Sonra dashboard:
At risk today
₺47,300
gibi bir sayı gösterebilir.
Bu SaaS satışında da çok etkili:
Lixus sana kaç mesaj cevapladığını değil, koruduğu ve bulduğu geliri gösterir.

4. AI Action Engine
Burada agent gerçekten agent olmaya başlıyor.
AI sadece:
“Temizlik görevi oluşturmalısın.”

demesin.
Buton:

[Assign]
Create all recommended tasks
ve otomatik:
Task:
Hot water load test

Property:
43825010

Due:
Today 18:00

Assignee:
Mehmet

Required proof:
30-second video

Reason:
Recurring hot-water history +
check-in tomorrow
oluştursun.
Sonra completed olduğunda AI kanıtı değerlendirsin.
5. Çok güçlü özellik: Proof AI
Bu taraf bence Lixus'u farklılaştırabilir.
Temizlikçi:
“Temizlik tamam.”

dediğinde görev tamamlanmasın.
Fotoğraf yüklesin.
Lixus'un o daire için reference state'i olsun.
Örneğin yatak odasının ideal hali:
REFERENCE
      VS
CURRENT PHOTO
Vision model:
Bed made ✅
2 pillows visible ✅
Top sheet ✅
Nightstand reset ✅
Trash removed ✅
Curtain position ⚠️
Visible stain ❌

Inspection score: 89/100
Breezeway zaten checklist ve referans fotoğraf kullanıyor. Breezeway
Ama biz bir adım ileri gideriz:
AI gerçekten fotoğrafı değerlendirir.
Personelin sadece checkbox işaretlemesi yetmez.
6. Recurring Issue Detector
Bunun değeri çok büyük.
Bir misafir:
water was a little cold

der.
Başka biri:
shower took a while to warm

der.
Teknik görev:
boiler reset

diye girilir.
Başka misafir:
hot water stopped

der.
Klasik sistem bunları dört farklı kayıt görür.
Lixus Brain:
ENTITY:
Property 43825010

CLUSTER:
Hot Water

Signals:
4

Period:
118 days

Trend:
Increasing

Confidence:
94%

Recommendation:
Stop handling as individual guest incidents.
Create root-cause maintenance investigation.
Bu gerçek AI kullanımı.
7. Daha da ileri: Root Cause Agent
Burada çok keyifli bir şey yapabiliriz.
Örneğin:
Low reviews ↑
      ↓
AI clusters complaints
      ↓

Bathroom smell
Hot water
Mold
      ↓

All occur in:
53913219

Timeline correlation:
humidity / plumbing incidents
      ↓

AI conclusion:

Likely one underlying bathroom maintenance
problem rather than 3 unrelated guest issues.
Sonra:
“Banyoyu üç farklı ticket olarak çözmeye çalışma. Tek teknik inceleme aç.”

Bu, küçük property manager'dan profesyonel operatöre geçiş sağlayan türden özellik.
8. Reservation Readiness ama Guesty'den daha iyi
Guesty zaten readiness checker yapıyor. Guesty
Dolayısıyla sadece:
email var mı?
phone var mı?
cleaning tamam mı?

yaparsak kopyalamış oluruz.
Lixus readiness şöyle olsun:
RESERVATION RISK MODEL

Property history 25%
Guest characteristics 15%
Operations readiness 30%
Open promises 15%
Known incidents 15%
Örneğin:
Penthouse
7 kişilik rezervasyon:
Base readiness 95

- Bedding proof missing -8
- AC status unknown -10
- 7 guests / 1 bathroom -5
- Recent AC complaint -9

FINAL

63 / 100

NOT READY
Aynı daireye iki kişi gelirse aynı risk çıkmamalı.
Reservation-specific readiness.
9. Çok değerli başka bir özellik: Guest Risk / Needs Prediction
Misafirin mesajlarından:
"We're travelling with my 74-year-old mother
and have four large suitcases."
AI:
Guest needs detected:

- Elderly traveler
- Heavy luggage
- Mobility sensitivity

Property:
43104164

Conflict:

4th floor
No elevator
Long staircase

⚠️ EXPERIENCE RISK
Ve personel daha rezervasyon başlamadan bunu görür.
Bu ciddi değer üretir.
10. Review Intelligence
Sadece sentiment analysis değil.
Yeni yorum:
Amazing stay, great location. Only issue was the bedroom was a little warm at night.

Lixus:
Rating: 5.0

Positive signals
- location
- stay quality

Hidden negative
- bedroom temperature

Existing property memory:
Bedroom cooling already mentioned twice.

Pattern count:
3

→ Upgrade P1 → P0
Ve otomatik maintenance task.
Senin raporların için yaptığımız 5 yıldızdaki “ama” cümlesini bulma işini ürünün native özelliği haline getiriyoruz. Master planda da yeni yorumlardaki her “ama”nın görev kartına dönüştürülmesi önerilmiş. Airbnb_Rezervasyon_ve_Ek_Gelir_Master_Plani (1).pdfPDF
11. Revenue Brain
Bunu kesinlikle yapardım ama ikinci büyük faz.
Şunları sürekli arar:
- orphan gap
- düşük booking pace
- aşırı doluluk + düşük ADR
- uzun boşluk
- minimum stay problemi
- weekday/weekend farkı
- lead-time yanlış fiyatlama
- event dates
- competitor pricing
- pacing versus previous period
Ve yine tek tek fiyat tablosu göstermek yerine opportunity verir.
💰 Opportunity #12

Property:
104183...

Date:
Sep 4–6

Current:
₺4,900/night

Portfolio booking pace:
+18%

Market demand:
High

Comparable properties:
₺5,700–₺6,300

Recommendation:
₺5,600

Potential upside:
+₺1,400

Confidence:
82%
12. Ask Lixus ama düz chatbot değil
Hostaway ve Hospitable zaten:
“How much revenue did I make?”

gibi natural-language sorgular yapıyor. support.hostaway.com
Dolayısıyla Lixus'ta daha ileri gitmeli:
Which property is currently hurting our rating most?

Why?

Lixus:
53913219

Reasons:
1. Lowest review distribution
2. 3 bathroom-related complaints in 6 months
3. Repeated window/noise issue
4. Open maintenance item for sink leak

Recommended first intervention:
Bathroom root-cause inspection
Sonra:
Do it.

AI:
Created:
Maintenance investigation #M-284

Assigned:
Ali

Deadline:
Tomorrow 12:00

Required evidence:
Bathroom + sink + shower photos/video
Chat → reasoning → action.
Asıl fark bu.
Lixus'un bence ürün konumlandırması
Ben artık:
AI Guest Messaging Platform

olarak konumlandırmazdım.
Çünkü kalabalık.
Şuna yaklaştırırdım:
AI Operating System for Short-Term Rentals

veya daha satış odaklı:
Lixus watches your properties, finds what needs attention, and gets it fixed before it costs you money or reviews.

Bu daha güçlü.
122k satırlık codebase için mimari karar
Burada özellikle sana bir şey önereceğim:
AI özelliklerini mevcut business logic'in içine dağınık şekilde gömmeyelim.
Yeni bounded context:
/modules/intelligence

  /memory
  /signals
  /incidents
  /recommendations
  /actions
  /scoring
  /agents
  /audit
Mevcut sistem:
reservations
properties
messages
tasks
reviews
users
olduğu gibi çalışır.
Intelligence katmanı event dinler:
reservation.created
message.received
task.completed
review.received
checkin.approaching
issue.created
maintenance.completed
ve kendi state'ini üretir.
Bu sayede:
AI sistemi bozulsa bile PMS çalışmaya devam eder.
Bunu 122 bin satırlık çalışan projede özellikle isterim.
Benim geliştirme sıram
Her şeyi eklemeye razı olman güzel ama yine de doğru dependency sırası var:
V1 — Property Memory + Signals
Her daire için yaşayan hafıza.
V2 — Exception Feed
Sadece gerçekten ilgilenilmesi gereken şeyler.
V3 — Actions + Tasks
AI öneriden operasyona geçiyor.
V4 — Proof AI
Fotoğraflı kalite kontrol.
V5 — Reservation Risk / Readiness
V6 — Review + Recurring Issue Brain
V7 — Revenue Brain
V8 — Ask Lixus → Action
Bunların üzerinde daha sonra:
- owner portal intelligence
- owner churn prediction
- portfolio acquisition
- direct booking
- upsells
- smart locks
- staff performance
- automated purchasing/inventory
- predictive maintenance
kurabiliriz.
İlk kodlayacağım şey
PropertyMemory + Signal modeli.
Dashboard değil.
Chat değil.
WhatsApp değil.
Revenue değil.
Çünkü bütün gerçek agent özelliklerinin hafızası ve ortak dili buradan doğacak.
Örneğin bir Signal:
source = guest_message
property = 43825010
category = hot_water
sentiment = negative
severity = 0.82
confidence = 0.94
reservation_id =...
occurred_at =...
Başka bir signal:
source = maintenance
category = hot_water
action = boiler_reset
Sonra agent:
“Bu ikisi aynı gerçek dünya probleminin parçaları.”

diyebilecek.
Bence Lixus'un gerçek moat'i buradan çıkar.
Ve şu anda pazarın yönü de net biçimde “birkaç AI reply özelliği”nden canlı işletme verisi üzerinde çalışan proactive agents tarafına gidiyor. Guesty bunu yüzlerce agent olarak, Hostaway CoHost olarak paketliyor. Guesty
Lixus'un onları taklit etmesi yerine tek bir güçlü, persistent operasyon beynine sahip olması daha ilginç ürün olur.

Bunun için ben 5 basamaklı hedef koyardım
1. Şimdi — Ürünü kanıtla.
Sen kendi 11 dairen üzerinde Lixus'u her gün kullan. Reservation → message → task → issue → review zinciri gerçekten çalışsın.
2. Sonra — 10 değil, 100+ gerçek property.
Başka hostların Lixus'u kullanmaya başlaması çok önemli. Airbnb açısından “güzel demo”dan çok gerçek host kullanımı daha ikna edici olur.
3. Güvenlik seviyesini yükselt.
Başından itibaren:
- encrypted secrets
- RBAC
- audit logs
- OAuth mantığı
- tenant isolation
- webhook signature validation
- rate limiting
- idempotency
- backup/recovery
- data deletion/export
- GDPR/KVKK
- incident logging
gibi şeyleri düzgün kur.
4. PMS özelliklerini tamamla.
Airbnb seni sadece “AI chatbot” olarak değil, gerçek bir hospitality software company olarak görmeli.
5. Sonra Airbnb partner/API başvurusu.
Bence üçüncü ve dördüncü basamak burada özellikle önemli. Airbnb’nin mevcut partnerleri arasında Hostaway, Hospitable gibi gerçek PMS çözümleri bulunuyor ve Airbnb partnerleri “yüksek kalite ve güvenlik” standartlarına göre değerlendiriyor. Airbnb
Ben Lixus'un hedefini daha da büyütürdüm
Senin yerinde olsam uzun vadeli ürün vizyonunu şu yapardım:
Lixus = AI-native PMS

Yani “PMS'e AI eklenmiş” değil.
Tam tersine:
Traditional PMS

database
↓
calendar
↓
messages
↓
tasks
↓
AI added on top
yerine:
                LIXUS BRAIN
                     │
        ┌────────────┼────────────┐
        ↓ ↓ ↓
 Reservations Guests Properties
        ↓ ↓ ↓
 Messages Reviews Issues
        ↓ ↓ ↓
 Tasks Revenue Maintenance
        └────────────┬────────────┘
                     ↓
               ACTION ENGINE
Her şeyin ortasında intelligence layer olur.
O zaman Hostaway/Guesty/Hospitable ile yarışırken:
“Bizde de takvim var.”

demek yerine:
“Lixus işletmende olan her şeyi anlayan ve sana ne yapman gerektiğini söyleyen PMS.”

dersin.
Bu daha kuvvetli bir tez.
Hatta Airbnb API alma hedefi ürün mimarisini bugünden etkilesin
Ben olsam daha API elimizde yokken bile internal interface'i Airbnb varmış gibi tasarlarım.
Örneğin doğrudan:
airbnbReservation.id
yerine:
Reservation {
  id
  externalId
  channel
  propertyId
  guestId
  checkIn
  checkOut
  status
}
Sonra:
channel = AIRBNB
channel = BOOKING
channel = DIRECT
channel = VRBO
olur.
Aynı şekilde:
ChannelAdapter
 ├ AirbnbAdapter
 ├ BookingAdapter
 ├ HospitableAdapter
 ├ ICalAdapter
 └ DirectBookingAdapter
oluşturursun.
Şu anda:
Airbnb
   ↓
HospitableAdapter
   ↓
Lixus
kullanırsın.
Bir gün Airbnb API erişimi geldiğinde:
Airbnb
   ↓
AirbnbAdapter
   ↓
Lixus
yaparsın.
Lixus Brain'in geri kalanına tek satır dokunmak zorunda kalmazsın.
Bu konuda özellikle disiplinli olmanı öneririm.

Aynen, şimdi hedefi tamamen netleştirdik:
Final Lixus = Airbnb + Booking.com + Vrbo’ya doğrudan bağlanan bağımsız AI-native PMS / Operations OS.
Final üründe Hospitable yok.

Hospitable senin için geçici geliştirme köprüsü olmuş. Görevini yaptı. Airbnb direct API geldiğinde müşterinin karşısına hiçbir şekilde “Hospitable hesabı bağla” çıkarmak istemiyoruz.
Ekran görüntüsünde de haklısın: mevcut entegrasyonun zaten client_id + response_type=code + redirect_uri kullanan normal OAuth authorization-code akışı. Yani önceki PAT endişemi geri çekiyorum; o konuda düzgün ilerlemişsin.
Fakat çok önemli ayrım
Airbnb API başvurusundan ÖNCE Hospitable'ı production'dan sökme.
Onun yerine:
Kod mimarisinden Hospitable bağımlılığını sök.
Çalışan bağlantıyı ise Airbnb API onayı gelene kadar koru.

Çünkü Hospitable'ı şimdi tamamen atarsak Lixus'un canlı Airbnb mesaj/rezervasyon entegrasyonunu kendimiz kapatmış oluruz.
Ama Airbnb'ye başvururken Lixus şöyle görünmemeli:
Airbnb
   ↓
Hospitable
   ↓
Lixus
Şöyle görünmeli:
                   LIXUS

             ┌── Lixus Core ──┐
             │ │
             │ Lixus Brain │
             │ │
             └───────┬────────┘
                     │
               Channel Layer
                     │
          ┌──────────┴─────────┐
          │ │
     iCal Adapter Hospitable Bridge
                           TEMPORARY

          ↓ Airbnb approval ↓

                 Channel Layer
                      │
              Airbnb Direct
                      │
                   Airbnb
Ve en son:
                    LIXUS
                      │
            ┌─────────┼─────────┐
            │ │ │
          Airbnb Booking Vrbo
           Direct Direct Direct

Bence büyük Property Memory/Revenue Brain/Proof AI paketlerinin tamamını beklememeliyiz.
Önce API-ready Lixus yapıyoruz.
Ben şu kapıları tamamladıktan sonra Airbnb'ye ciddi başvuru yapardım:
1. Channel Independence. HospitableAdapter sistemin içinden sökülüp tek bir connector katmanına alınacak. Reservation, Property, Guest, Conversation, Message, Task, Issue gibi Lixus entity'leri hiçbir yerde Hospitable veri modeline bağımlı olmayacak. Ayrıca boş bir AirbnbDirectAdapter sözleşmesini şimdiden oluşturacağız; endpoint'leri olmayacak ama Lixus'un Airbnb'den ne beklediği belli olacak.
2. Hospitable olmadan Lixus'un büyük bölümü çalışacak. Bir kullanıcı yalnız iCal + kendi property bilgilerini girse bile property yönetimi, rezervasyon takvimi, tasks, operations dashboard, AI günlük özet, readiness ve temel intelligence çalışacak. Sadece Airbnb Inbox gibi channel-private özellikler geçici olarak Hospitable bağlantısı gerektirecek. Bu, Airbnb açısından “Hospitable eklentisi” değil, kendi ürünün olduğunu göstermenin en önemli kanıtlarından biri.
3. Security katmanı ciddi hale gelecek. Airbnb'nin güncel API şartlarında API programlarına katılan şirketler için data-security review zorunlu. Ayrıca MFA, least-privilege erişim, OWASP güvenlik uygulamaları, en az üç ayda bir vulnerability scan, HTTPS, cihaz/altyapı şifreleme ve erişim kontrolleri gibi minimum güvenlik beklentileri açıkça yazıyor. Airbnb Lixus'ta RBAC, tenant isolation, encrypted secrets, audit logs, webhook signature validation, idempotency, rate limiting, deletion/export, backup/recovery gibi şeyleri başvuru öncesinde gerçekten gösterebilir hale getirelim.
4. Airbnb'ye gösterebileceğimiz demo tenant hazırlayacağız. Airbnb API şartlarında gerektiğinde kendilerine temsili verilerle dolu ücretsiz bir demo hesabı sağlamamızı isteyebileceklerini açıkça yazıyor. Airbnb Yani demo@lixusai.com hesabına girince 10–15 örnek property, reservations, messages, tasks, issues ve dashboard kusursuz görünmeli.
5. Gerçek kullanım kanıtımız olacak. Airbnb kamuya açık kaynaklarda “en az X property olmalı” şeklinde bir eşik vermiyor. Ben kendi hedefimiz olarak önce senin gerçek 11 dairen + mümkünse birkaç haricî host üzerinde Lixus'u çalıştırmayı isterim. Başvuruda “çalışıyor” demekten çok; aktif property, işlenen reservation, AI handled conversation, uptime, task completion ve problem önleme rakamları göstermek çok daha güçlü olur.
6. Son olarak Airbnb integration dosyasını hazırlayacağız. Mimari diagram, data-flow diagram, veri saklama politikası, privacy policy, security controls, demo credentials, requested scopes, her scope'u neden istediğimiz ve host deneyiminin nasıl görüneceği tek dosyada olacak. Airbnb API programları property management, channel management ve operations management sistemlerini açıkça kapsıyor; dolayısıyla Lixus'un “AI-powered operations management / PMS” konumlandırması bu çerçeveye uyuyor. Hangi read/write scope'larını alacağımıza ise Airbnb karar veriyor; baştan “bütün API kesin gelir” varsayımı yapmamalıyız. Airbnb
Bu noktada başvuruyu yaparım.

Airbnb API geldiği gün Hospitable'ı siler miyiz?
Dakikasında değil. Ama hedefimiz tamamen kaldırmak.
İlk olarak Airbnb direct connector'ı test environment/demo üzerinde çalıştırırız. Sonra tek bir gerçek hesap veya küçük pilot grubuyla reservation/message mapping, webhooks, disconnect/reconnect, duplicate event, cancellations, modifications gibi senaryoları test ederiz.
Sonra müşteriyi:
Hospitable OAuth
       ↓
     Lixus
yerine:
Connect Airbnb
      ↓
Airbnb authorization
      ↓
     Lixus
akışına geçiririz.
Pilot sorunsuz olduktan sonra Hospitable kodunu legacy bridge olarak dondururuz; kullanıcılar direct Airbnb'ye migrate oldukça kaldırırız.
Çünkü ben de seninle aynı fikirdeyim:
Eğer Lixus'un amacı gerçek PMS olmaksa, son üründe müşteriye rakip PMS hesabı açtırmanın hiçbir anlamı yok.

Hospitable, Hostaway, Guesty connector'larıyla dolu bir “AI layer” yapmak başka bir şirket stratejisi olurdu.
Bizim stratejimiz o değil.
Lixus doğrudan PMS olacak.

Hatta AI özelliklerinden önce neden ChannelAdapter yapmamız gerektiği şimdi iyice kesinleşti
Çünkü yarın Property Memory yazdığımızda:
PropertyMemory
şunu bilmemeli:
HospitableProperty
Şunu bilmeli:
LixusProperty
Aynı şekilde:
Signal
Reservation
Conversation
Message
Issue
Review
tamamen Lixus'a ait olmalı.
Böylece Airbnb geldi:
Airbnb → AirbnbAdapter → Lixus
Booking geldi:
Booking → BookingAdapter → Lixus
Vrbo geldi:
Vrbo → VrboAdapter → Lixus
ve AI'nın umurunda bile değil verinin nereden geldiği.
Bu mimariyi doğru yaparsak inanılmaz rahatlarız.
Bir de bugün öğrendiğim önemli bir şey: Booking sıramızı değiştirebilir
Sen:
Airbnb → Booking → Vrbo

dedin.
Uzun vadede üçü de kesinlikle istediğimiz üçlü.
Ama 21 Ağustos 2026 itibarıyla Booking.com'un kendi Connectivity Portal'ında yeni connectivity provider entegrasyonlarını “until further notice” durdurduğunu açıkça yazıyor. Yani bugün başvursak yeni provider onboarding'i kapalı. Booking.com Bağlantı Portalı
Booking API'leri ise çok güçlü: Reservations, Rates & Availability, Guest Reviews, Content, Photos, Messaging, Performance data gibi granular connection türleri var. Booking.com
Dolayısıyla Booking'i mimaride kesinlikle hazırlıyoruz ama onay zamanlamasını kontrol edemiyoruz.
Vrbo/Expedia tarafında ise şu anda daha net aktif yol görünüyor. Expedia Group, PMS, channel manager ve diğer lodging connectivity uygulamalarına açık bir süreç yayımlıyor:
başvuru → compliance/licensing → connectivity team → development/test/soft launch → go live. developers.expediagroup.com
O yüzden bugün roadmap'i gerçek dünyaya göre şöyle yazarım:
1. Airbnb Direct
2. Vrbo / Expedia Direct
3. Booking.com Direct — yeni provider intake tekrar açıldığında

Ama uygulama içinde sıralama önemli değil:
Connect a channel

[ Airbnb ]

[ Booking.com ]

[ Vrbo ]
Lixus dışında hiçbir PMS logosu yok.

V0 — Channel Independence + Canonical Lixus Domain
Hospitable mevcut çalışan OAuth entegrasyonu olarak geçici şekilde korunacak fakat Lixus'un domain modeli Hospitable modellerinden tamamen ayrılacak.
Lixus kendi Property, Reservation, Guest, Conversation, Message, Task, Issue, Review entity'lerine sahip olacak.
Tüm dış kanallar ChannelAdapter üzerinden bağlanacak.
İlk adapter'lar:
- HospitableAdapter — temporary bridge
- ICalAdapter
Gelecekte:
- AirbnbAdapter
- BookingAdapter
- VrboAdapter
Lixus Brain hiçbir zaman verinin Hospitable, Airbnb, Booking veya Vrbo'dan geldiğini bilmek zorunda kalmamalı.
Airbnb direct API başarılı ve production-ready olduğunda Hospitable tamamen kaldırılacak.

Bundan sonra senin mevcut listedeki:
V1 Property Memory + Signals
V2 Exception Feed
V3 Actions...

başlasın.
Bu değişiklik önemli. Yoksa Property Memory'yi Hospitable veri yapısına göre yazıp daha sonra yeniden refactor etme riski doğar.
2. “100+ property sonra Airbnb API” maddesini yumuşat
Orada şöyle yazıyor:
10 değil, 100+ gerçek property → sonra API başvurusu.

Bunu artık katı şart yapmıyoruz.
Doğrusu:
Airbnb'nin kamuya açık şekilde ilan ettiği zorunlu bir “100 property” eşiği olmadığı sürece API başvurusu yalnızca property sayısına bağlanmamalı.
Başvurudan önce Lixus:
- bağımsız domain modeline,
- channel abstraction'a,
- çalışan gerçek kullanıma,
- mümkünse birkaç haricî müşteriye,
- güçlü security controls'a,
- demo tenant'a,
- ölçülebilir kullanım metriklerine,
- açık privacy/data handling politikasına
sahip olmalı.
100+ property güçlü bir ticari kanıt olabilir fakat başvuru için keyfî bir blocker yapılmamalıdır.

Çünkü belki ürün 30–50 gerçek property'de çok iyi çalışacak ve Airbnb başvurusuna hazır olacağız. Sırf “100 olmadı” diye altı ay beklemek anlamsız olabilir.
3. Final ürün stratejisini en üstüne koy
Promptun en başına bunu koyarsan ileride hiçbir coding agent yanlış yöne gitmez:
FINAL PRODUCT CONSTRAINT
Lixus'un nihai amacı başka PMS'lerin üzerinde çalışan bir AI wrapper olmak değildir.
Nihai ürün bağımsız bir AI-native PMS / Short-Term Rental Operating System olacaktır.
Hedef native channel bağlantıları:
Airbnb Direct + Booking.com Direct + Vrbo Direct
Hospitable yalnızca mevcut geliştirme ve erken kullanım döneminde kullanılan geçici Airbnb connectivity bridge'idir. Final ürünün kullanıcı deneyiminde Hospitable zorunluluğu bulunmayacaktır.
Guesty, Hostaway, Hospitable gibi PMS'leri connector olarak çoğaltmak ana ürün stratejisi değildir.
Lixus'un rekabet avantajı:
persistent operational intelligence + memory + proactive risk/revenue detection + action execution.

Bu cümle gelecekte çok işimize yarar.

# FINAL PRODUCT CONSTRAINT

Lixus'un nihai amacı başka PMS'lerin üzerinde çalışan bir AI wrapper olmak değildir.

Nihai ürün; Airbnb Direct, Booking.com Direct ve Vrbo Direct bağlantılarına sahip,
bağımsız bir AI-native PMS / Short-Term Rental Operating System olacaktır.

Hospitable yalnızca mevcut geliştirme ve erken kullanım döneminde kullanılan geçici
bir bağlantı köprüsüdür. Airbnb Direct bağlantısı production-ready oluncaya kadar
çalışan Hospitable entegrasyonunu bozma veya üretimden erken kaldırma. Ancak yeni
Lixus çekirdeğini Hospitable veri modeline, kimliklerine veya çalışma biçimine bağlama.

Final ürünün kullanıcı deneyiminde Hospitable hesabı zorunluluğu bulunmayacaktır.
Guesty, Hostaway ve Hospitable gibi PMS'leri connector olarak çoğaltmak ana ürün
stratejisi değildir.

Lixus'un kalıcı rekabet avantajı şunlar olacaktır:

- Persistent operational intelligence
- Property ve operasyon hafızası
- Proaktif risk, kalite ve gelir kaybı tespiti
- Kök neden ve tekrar örüntüsü analizi
- Kanıtlanabilir AI kararları
- Güvenli action execution
- Airbnb, Booking.com ve Vrbo ile native channel connectivity

Bu prompttaki tablo, model, alan, interface, modül ve klasör isimleri kavramsal
örneklerdir; zorunlu teknik talimat değildir.

Önce mevcut repoyu incele. Repo zaten eşdeğer veya daha doğru bir abstraction
taşıyorsa onu koru ve geliştir. Mevcut çekirdek yanlışsa sırf bugün çalışıyor diye
onu kutsama. Gerekirse modelleri yeniden adlandırabilir, bölebilir, birleştirebilir,
genişletebilir veya kontrollü biçimde değiştirebilirsin.

Minimum diff veya minimum refactor hedefleme. Doğru uzun vadeli ürün çekirdeğini,
veri bütünlüğünü ve migration güvenliğini hedefle. Big-bang rewrite yapma; çalışan
sistemi karakterizasyon testleri ve kontrollü geçişlerle koru.

# TECHNICAL INVARIANTS

1. Lixus çekirdeği hiçbir sağlayıcının iç veri modelini kendi domain modeli olarak
   kabul etmemeli. Intelligence, automation ve operasyon çekirdeği Hospitable,
   Airbnb, Booking.com veya Vrbo modüllerini doğrudan import etmemeli.

2. Sağlayıcı bağımsızlık, kaynak bilgisini kaybetmek anlamına gelmez. Her dış kayıt
   connection/provider kapsamı, dış kimlik, provenance, capability, freshness,
   ingest zamanı ve gerektiğinde ham olay referansı taşımalıdır.

3. Dış kimlikler global veya yalnız property kapsamında eşsiz kabul edilmemeli.
   Benzersizlik ve idempotency kapsamı sağlayıcı bağlantısını da içermelidir.
   Mevcut unique constraint'leri direct-channel dünyasında çakışma açısından incele.

4. Tek ve her şeyi yapan sahte bir ChannelAdapter oluşturma. Bağlantı yaşam döngüsü,
   listing/property sync, reservation ingest, message ingest, outbound message,
   webhook doğrulama, availability, rates ve reviews gibi yetenekleri ayrı değerlendir.
   Her connector desteklediği yetenekleri açıkça ilan etsin.

5. iCal reservation-only bir kaynak olarak modellenmelidir. Mesaj okuma, mesaj
   gönderme veya webhook yeteneği varmış gibi davranmamalıdır.

6. Hospitable ve iCal aynı ilanı besliyorsa rezervasyonları yalnız tarih veya misafir
   benzerliğiyle tahminî birleştirme. Bağlantı/listing sahipliği, açık kaynak önceliği
   veya kullanıcı tarafından belirlenen yetkili kaynak ile çift yazımı önle.

7. Canonical ingest hattı şu değişmezi taşımalıdır:
   provider payload -> doğrulama/normalizasyon -> source-scoped idempotency ->
   canonical transaction -> versioned domain event/outbox.
   Polling ve webhook aynı canonical yazma servisine ulaşmalıdır.

8. Outbound mesajlaşma provider-neutral delivery target, capability gate,
   idempotency key ve açık hata sınıfları kullanmalıdır. Retryable, definitive,
   ambiguous, authentication/revocation ve provider outage durumları ayrılmalıdır.
   Belirsiz gönderimde kör tekrar yerine reconciliation yapılmalıdır.

9. Provider credential'ları organization domain kaydına dağılmamalı. Bağlantı
   yaşam döngüsü; hesap, token, refresh, expiry, scope/capability, cursor, health,
   reconnect ve revoked durumlarını tutarlı biçimde yönetmelidir. Kesin temsilini
   mevcut repoya göre sen belirle.

10. Canonical Guest gerekiyorsa rezervasyon üzerindeki guest snapshot ile kalıcı
    misafir profilini ayır. İsim, e-posta veya telefon benzerliğiyle otomatik
    cross-channel merge yapma. Birleştirme geri alınabilir ve denetlenebilir olsun.

11. Issue yalnız Task'tan farklı bir yaşam döngüsü taşıyorsa oluşturulmalıdır:
    detection, evidence, acknowledgement, root cause, recurrence ve resolution.
    Aynı kavramı iki tabloda farklı isimlerle çoğaltma.

12. Review için gerçek ingestion kaynağı ve ürün davranışı oluşmadan yalnız gelecek
    planına dayanarak boş bir tablo ekleme.

13. Property Memory ileride canonical event katmanını tüketmelidir. LLM serbest
    metnini doğrudan kalıcı gerçek kabul etme. Her bilgi evidence/source, confidence,
    observedAt, effectiveAt, lastConfirmedAt, expiry, contradiction ve human override
    semantiğine sahip olmalıdır.

14. Airbnb-derived veriler ile host veya Lixus kaynaklı verileri politika seviyesinde
    ayır. Her veri sınıfı için saklama, türetme, silme, export ve bağlantı feshi
    davranışını tanımla. Airbnb API koşullarının izin vermediği kalıcı hafıza,
    analiz veya yeniden kullanım varsayımlarını çekirdeğe gömme.

15. Money impact ve Revenue Brain sahte kesinlik üretmemeli. Tutarlar assumption,
    evidence, confidence ve mümkünse aralık taşımalıdır.

16. Tenant isolation her yeni bağlantı, kimlik eşlemesi, ingest, event ve outbound
    yolunda davranışsal testlerle kanıtlanmalıdır. Yalnız alan adı tarayan yapısal
    testleri yeterli sayma.

17. Connector conformance testleri duplicate ve out-of-order event, replay,
    cancellation, reservation modification, reconnect, token refresh/revocation,
    provider outage, ambiguous send ve tenant-crossing saldırılarını kapsamalıdır.

18. Airbnb sandbox, resmi doküman ve credentials olmadan tahminî Airbnb endpoint'i,
    payload veya çalışanmış gibi görünen sahte connector yazma. Şimdilik yalnız
    provider-neutral sözleşme, fixture ve conformance kiti hazırlanabilir.

19. Direct connector rollout sırası:
    sandbox/demo -> internal tenant -> küçük pilot -> shadow/dual-run ->
    reconciliation -> kontrollü cutover -> Hospitable bridge freeze ->
    kullanıcı migrasyonu -> bridge removal.

20. Core ve intelligence katmanında provider import'larını, `hospitable*` alanlarını
    ve channel string'lerinden yetenek çıkaran koşulları engelleyen mimari pin ekle.

# CURRENT TASK — V0 CHANNEL INDEPENDENCE

Şimdilik yalnız V0 üzerinde çalış. Property Memory, Exception Feed, Revenue Brain,
Proof AI, Ask Lixus veya sonraki ürün fazlarını uygulama.

En güncel `claude/great-edison-3zqpZ` dalını çek. Başlangıç SHA'sını, branch'i ve
çalışma ağacının durumunu raporla. Kullanıcının mevcut değişikliklerini silme,
force-push, rebase veya geçmiş yeniden yazımı yapma.

Önce tüm gerçek provider bağımlılıklarını kanıtla:

- Şema ve unique constraint'ler
- Credential ve connection yaşam döngüsü
- Property/listing kimlikleri
- Reservation, conversation, message ve outbox kimlikleri
- Hospitable sync ve OAuth
- iCal sync
- Manuel rezervasyon ve konuşma yolları
- Guest chat
- Automation ve lifecycle mesajları
- Webhook/polling
- Data export, deletion, retention ve audit
- Tenant authorization sınırları

Sonra hedef mimariyi ve kontrollü geçiş sırasını çıkar. Yalnız ADR yazıp durma.
İnceleme sonucunda güvenle tamamlanabilecek ilk tutarlı V0 dilimini uygula.

İlk uygulama göstermelik veya kullanılmayan bir interface olmamalı. Mevcut çalışan
üretim yollarından en az biri gerçekten yeni provider-neutral sınırdan geçmelidir.
Davranışın değişmediğini eski ve yeni yol arasında karşılaştırmalı olarak kanıtla.

V0 geçişinde gerektiğinde şu araçları kullan:

- Characterization tests
- Additive schema
- Expand-contract
- Dual-write
- Idempotent backfill
- Shadow read/write comparison
- Reconciliation report
- Fail-closed cutover
- Ayrı ve doğrulanabilir rollback adımları

Her düzeltmede kırmızı-önce test ve ters mutasyon zorunludur. Typecheck, lint,
tam test, build, e2e, migration-chain ve security-audit yeşil olmadan tamamlandı
deme.

Migration gerekiyorsa yerelde `prisma migrate diff` ile üret, taze PostgreSQL'de
00->N zincirini ve sıfır drift'i doğrula. Taze doğrulanmış pg_dump ve açık prod
onayı olmadan migration içeren commit'i oto-deploy branch'ine pushlama.

Migration içermeyen, davranışsal olarak doğrulanmış ve tek başına tutarlı V0
değişikliklerini yalnız `claude/great-edison-3zqpZ` dalına push edebilirsin.
Prod, Railway, env, secret, bucket veya canlı veriye kendin dokunma.

Tur sonunda ayrı ayrı raporla:

- Başlangıç ve bitiş SHA
- Bulunan gerçek provider bağımlılıkları
- Korunan mevcut abstraction'lar
- Değiştirilen çekirdek kararlar
- Uygulanan V0 dilimi
- Migration ve veri geçiş durumu
- Mutasyon kanıtları
- Test ve CI sonuçları
- KOD / CI / DEPLOY / PROD SMOKE ayrımı
- Geri alma yolu
- Bilerek ertelenenler
- Airbnb Direct öncesinde kalan mimari ve güvenlik riskleri

V0 gerçekten kurulmadan V1'e geçme. Çalışan sistemi koru, fakat sırf mevcut olduğu
için yanlış çekirdeği devam ettirme.

En güncel claude/great-edison-3zqpZ üzerinde *test sözleşmesini, V0 uygulamasının ön koşulu olarak ilk önce tamamla.*

Bu turda ürün davranışı, schema, migration, env veya prod değiştirme.
Önce mevcut test ve CI yapısını doğrula; var olmayan bir korumayı varmış
gibi belgeleme.

Bilinen başlangıç durumu:
- tests/integration altında geniş bir entegrasyon süiti var ve npm test
  tarafından çalıştırılıyor.
- Playwright E2E var fakat merkezi bir “kritik akış” sözleşmesi yok.
- Kırmızı-önce ve iki yönlü mutasyon geçmişte uygulanmış olsa da gelecekteki
  davranış değişiklikleri için kısa, merkezi ve bağlayıcı bir ana sözleşme yok.
- CI’nın yeşil olması tek başına kırmızı-önce veya mutasyon kanıtı değildir.

Yapılacaklar:

1. docs/TEST-EVIDENCE-CONTRACT.md oluştur.
2. CLAUDE.md’nin aktif çalışma kuralları bölümüne bu belgeyi bağlayıcı
   sözleşme olarak gösteren kısa bir madde ekle.
3. Kuralları değişiklik riskine göre tanımla.

Bu aşamadaki “ürün davranışını değiştirme” kısıtı *sadece test sözleşmesi hazırlanırken geçerlidir*; sözleşme doğrulandıktan sonra yukarıdaki V0 görevine devam et ve güvenle tamamlanabilecek ilk tutarlı üretim dilimini uygula.

Davranış değiştiren bug fix, güvenlik, auth, tenant isolation, billing,
veri yaşam döngüsü, provider/sync, AI gönderimi, storage ve operatör
rotası değişikliklerinde şunların tamamı zorunlu olsun:

- Kırmızı-önce: Düzeltmeden önce gerçek kusuru yeniden üreten hedef test,
  doğru assertion nedeniyle kırmızı olmalı.
- Hedef unit testi.
- Değişiklik sınır aşıyorsa hedef integration testi. Karar mekanizması
  mock’lanmamalı; rota+auth+DB, worker+DB+provider fake gibi gerçek sınırlar
  birlikte çalıştırılmalı.
- Etkilenen kritik akış testi.
- Mutasyon 1: Koruma/düzeltme kaldırılınca ilgili test kırmızı olmalı.
- Mutasyon 2: Koruma koşulsuz veya aşırı geniş uygulanınca kontrol testi
  kırmızı olmalı.
- Mutasyonlar yalnız çalışma ağacında yapılmalı; mutasyon kodu commit veya
  push edilmemeli.
- Derleme hatası veya ilgisiz test hatası mutasyon kanıtı sayılmamalı.
- Sonunda gerçek kod geri getirilmeli ve typecheck, lint, tam test, build,
  e2e, migration-chain ve security-audit geçmeli.

Merkezi kritik akış matrisi en az şunları kapsasın:

- Login, 2FA, password reset ve session revocation
- Tenant isolation, admin export ve impersonation
- OAuth, provider sync, webhook ve iCal
- Inbound message → sınıflandırma/AI → outbox/send → audit
- Paddle/billing/entitlement
- Export, deletion, retention ve tombstone
- Private upload ve yetkisiz object erişimi

Kritik akış testleri yalnız HTTP durum kodu ölçmemeli; DB yan etkisini,
yetkisiz işlem yapılmadığını, audit kaydını ve dış çağrı davranışını da
gerektiği yerde doğrulamalı.

İstisnalar:
- Yalnız belge, yorum, biçimlendirme veya davranışsız metin değişikliğinde
  yeni integration/mutasyon/kritik akış testi zorunlu değil.
- İstisna final raporda açıkça gerekçelendirilmeli.
- Görünen metne bağlı mevcut test beklentileri yine güncellenmeli.
- “Test gerekmiyor” kararı sessiz verilmemeli.

Mevcut CI zaten tam integration ve E2E süitini çalıştırıyorsa sırf isim
olsun diye tekrar eden boş bir job ekleme. Bunun yerine kritik akışların
hangi gerçek test dosyalarıyla korunduğunu belgede haritala. Gerçek bir
boşluk varsa önce kırmızı test ekle.

Her davranış değiştiren turun final raporunda şu kanıt tablosu zorunlu olsun:
- Kırmızı test ve beklenen hata
- Düzeltme
- Kaldırma mutasyonu sonucu
- Aşırı uygulama mutasyonu sonucu
- Hedef integration testi
- Etkilenen kritik akış
- Tam kapı sonuçları
- Kalan risk

NEAR-TERM AI GROUNDING AND MVP DIRECTION
This section is architectural context, not permission to implement every item
in the current turn.

The AI must distinguish first contact, ongoing conversation and closing from
verified conversation state rather than guessing only from message text.

The current fixed last-six-message window must eventually be replaced by a
bounded context builder containing:
- verified conversation state,
- recent conversational turns,
- every unanswered guest message after the last delivered operator reply,
- a safe representation of older relevant context,
- verified tool results for dynamic facts.

Calendar availability, reservation state, prices, payment state and operational
status must never be answered from model memory or RAG. They require deterministic,
tenant-scoped tools returning structured evidence and freshness.

The existing KnowledgeBaseItem flow is the starting point for Property Memory.
Semantic RAG will be added after channel independence and the deterministic
availability tool. Retrieval must always be organization/property scoped and
must enforce audience and sensitivity before content reaches the model.

Do not implement this entire section during V0 unless a narrowly necessary
foundation is required. The CURRENT TASK remains V0 Channel Independence.

FUTURE PROMPT REQUIREMENTS — DO NOT IMPLEMENT PREMATURELY

The following requirements must eventually be implemented in prompts.ts, but
only together with their corresponding verified code-generated inputs:

1. Conversation state
The model must receive an authoritative conversationState containing at least
phase, hasPriorDeliveredReply and isFirstOperatorReply. It must not infer first
contact only from the recent-message window. It must not greet or repeat the
guest's name during an ongoing conversation.

2. Verified action claims
The model may say “I checked”, “I informed the team”, “I created a task” or
similar completed-action statements only when a successful actionReceipt exists.
actionSuggestion does not mean the action occurred. Without a receipt, use future
intent such as “I will check and get back to you.”

3. Dynamic fact authority
Availability, reservation state, prices, payments, task state and executed
actions may be stated only from verifiedToolResults. Knowledge-base records,
RAG retrieval, conversation history and guest claims are not authoritative for
live operational facts. stale/error/uncertain results must never become a
definite answer.

4. Date ambiguity
currentLocalDate and organizationTimezone must be supplied by code. Ambiguous
dates must not be guessed. Ask at most one concise clarification question when
month, year, check-in or check-out meaning cannot be resolved safely.

5. Conflicting evidence
When trusted sources conflict, do not silently choose one. Hold the definite
answer, record the conflict in missingInfo/risk metadata and hand it to the
operator without exposing technical system details to the guest.

These are not prompt-only protections. Do not activate these instructions until
conversationState, verifiedToolResults, actionReceipts and date-resolution
contracts exist, are validated, and have red-first integration and mutation
tests.

FUTURE REQUIREMENT — FOUNDER AI QUALITY CONSOLE

During the early product-validation period, the founder must be able to inspect
the complete customer and guest conversation context, every AI-generated draft,
and every AI-sent message across all tenants. This visibility is required for
quality assurance, hallucination detection and construction of the evaluation set.

Access must initially be limited to explicitly designated superadmin accounts
protected by MFA. Do not grant this capability to ordinary tenant admins,
support users or organization members.

For every AI generation, preserve enough traceability to reproduce and evaluate
the decision:

- tenant, property, reservation and conversation identifiers,
- chronological input messages with timestamps and directions,
- unanswered-message context,
- generated draft and actually delivered message,
- model and prompt-policy versions,
- retrieved RAG source identifiers and excerpts,
- deterministic tool calls and their results,
- moderation, confidence, escalation and auto-send decisions,
- latency, token usage and estimated cost,
- human-review labels and correction notes.

The founder console may display the complete raw conversation during this
controlled validation phase. Every conversation view and export attempt must be
audited with actor, timestamp, tenant, conversation, purpose and IP/session data.
Require a written review purpose and prevent access from non-superadmin accounts.

Provide structured review labels including:
correct, hallucinated fact, missed context, repeated greeting, wrong tone,
incorrect temporal interpretation, stale knowledge, retrieval failure,
tool should have been used, unsafe auto-send and escalation failure.

Reviewing production conversations for quality assurance is not permission to
use them for external model training. Do not automatically send raw production
conversations to fine-tuning, analytics or third-party training systems.
Only explicitly promoted, redacted and provenance-preserving examples may enter
the permanent evaluation dataset.

Document the purpose, authorized role, retention period, audit process and data
handling in the applicable privacy/KVKK materials. Implement deletion and
retention parity for AI traces and their derived retrieval records.

Required tests:
- ordinary admins cannot access cross-tenant AI traces,
- only allowlisted MFA-complete superadmins can inspect them,
- every successful and denied access is audited,
- list and detail endpoints enforce authorization independently,
- tenant filters cannot be bypassed with query/body identifiers,
- deleting a conversation applies the documented policy to its AI traces,
- production data cannot silently enter a training or fine-tuning pipeline,
- red-first, integration, critical-flow and two-way mutation tests.

The Founder AI Quality Console must be strictly read-only.

It must not provide controls or API capabilities to:
- send, resend or schedule messages,
- edit or delete conversations,
- impersonate a tenant,
- change conversation status,
- alter reservations, tasks or property data,
- trigger automations or AI actions.

The console exists only for observing conversations and improving AI quality.
Human review labels and private reviewer notes may be written, but they must be
stored separately from operational conversation data and must never affect,
modify or send customer-facing content.

Enforce read-only behavior on the server, not only by hiding UI controls.
Use GET for operational data access. Any review-label endpoint must only write
to dedicated evaluation records and must not mutate Conversation, Message,
Reservation, Property, Task or automation state.

Add tests proving that:
- no message-send or operational mutation route is reachable from this console,
- review labels cannot alter customer-visible data,
- ordinary admins cannot access the console,
- only allowlisted, MFA-complete superadmins can read it,
- all successful and denied views are audited.

BOUNDED CONVERSATION CONTEXT — FUTURE REQUIREMENT

The current fixed last-six-message prompt window is insufficient for long
conversations. Replace it with one shared, deterministic context builder used
by manual AI suggestion, automatic channel reply, test/eval surfaces and every
other equivalent guest-reply path.

Do not solve this by mechanically changing `.slice(-6)` to `.slice(-25)`.

Required context-selection contract:

1. MAX_CONTEXT_MESSAGES may be 25 as a hard safety ceiling, but the normal recent
   context target should initially be approximately 10–12 messages.

2. Always preserve chronological order and explicit authorship:
   guest, host, AI and system events must never be inferred from display names.

3. The current guest message must always be included. It must not be silently
   removed by the history budget. An oversized current message must follow an
   explicit fail-closed policy and be held for human review when it cannot be
   processed safely.

4. Include every unanswered guest message after the last successfully delivered
   operator reply for safety and multi-message reasoning. This pending-message
   safety window must be evaluated independently from the 25-message generation
   window so an attacker cannot push a complaint, refund request, emergency or
   prompt injection outside the model/gate context by sending many harmless
   follow-up messages.

5. Include the most recent successfully delivered conversational turns up to a
   measured character/token budget. Do not include:
   - failed or canceled outbound messages,
   - unsent AI drafts,
   - abandoned outbox records,
   - duplicate provider imports,
   - unrelated system events presented as human speech.

6. Derive authoritative conversationState in code, including at least:
   - phase: first_contact | ongoing | closing,
   - hasPriorDeliveredReply,
   - isFirstOperatorReply,
   - deliveredReplyCount,
   - unansweredGuestMessageCount,
   - lastInteractionAt.

   The model must not decide whether to greet solely by searching recent text.

7. For context older than the bounded recent window, introduce a safe structured
   conversation memory only when justified. It may contain verified durable facts,
   unresolved commitments and guest preferences, but must not become authority for
   live availability, prices, payment, reservation status or completed actions.

8. Historical summaries are untrusted derived data. They must carry provenance,
   generation/version information and freshness, and they must never override a
   current verified tool result.

9. Apply a measured total character/token budget and per-message ceiling. Select
   the values using real anonymized conversation distributions and worst-case
   tests. Do not rely only on the model's maximum context window.

10. Fetch only the rows needed by the context contract. Do not load the full
    conversation from PostgreSQL and discard most of it in JavaScript. Use the
    existing `(conversationId, createdAt)` index and keyset/bounded queries.

11. A context builder must return structured diagnostics:
    included message ids, omitted count, oldest included timestamp, total
    characters/tokens, pending-message count and whether older memory was used.
    These diagnostics must contain no raw guest PII in logs.

12. The generation context and the deterministic safety gate have different
    responsibilities. The generation window may be bounded for cost, but safety
    scanning must never silently omit unanswered guest messages.

Required red-first tests and reverse mutations:

- A conversation whose first greeting is outside the recent window remains
  phase=ongoing and the model does not greet again.
- A first-contact conversation still receives an appropriate greeting.
- A guest question split across several consecutive messages is answered as one
  coherent request.
- A complaint/refund/emergency followed by more than 25 harmless messages remains
  blocked or escalated until a delivered operator reply closes that pending window.
- A resolved complaint before the last delivered operator reply does not poison
  every future reply forever.
- Failed, canceled and unsent outbound messages are absent from model history.
- Message order and author types remain exact.
- The current message survives context-budget pressure.
- Extremely long histories stay within the measured budget.
- Every calling surface uses the same builder or has an explicitly tested reason
  for a different public/anonymous policy.
- Cross-tenant messages can never enter the context.
- Removing each load-bearing selection or safety rule makes the relevant test red.

TEMPORAL CONVERSATION CONTEXT

Message timestamps already persisted in the canonical database must be included
in the bounded context through one shared context builder.

Each included message must carry its authoritative createdAt value and authorship.
The builder must derive, in organization timezone:

- elapsed time since the previous message,
- elapsed time since the last successfully delivered operator reply,
- whether the message belongs to the same conversational session,
- whether the guest resumed after a meaningful gap,
- whether a new local calendar day began.

The model must not infer elapsed time from message order alone.

Repeated greeting behavior must be deterministic:
- repeated identical greetings within a short unresolved window must not produce
  duplicate automatic replies,
- a greeting after a meaningful gap may receive a short natural response,
- an ongoing conversation must not restart with repeated name-based introductions.

Exact session-gap thresholds must be selected from real usage measurements and
covered by boundary tests. Do not hide these thresholds only inside prompt prose.

PRAGMATIC DATE RESOLUTION

Do not ask a clarification question for every date without a month or year.

Resolve dates using, in order:
- explicit date text,
- explicit date information from the active conversation,
- relative expressions evaluated in organization timezone,
- linked reservation context,
- a single unambiguous nearest-future interpretation.

Return structured resolution metadata:
exact dates, timezone, resolution basis, confidence and any assumed date part.

When one interpretation is clearly dominant but includes a safe assumption,
the reply may proceed while explicitly restating the interpreted month and year.

When multiple materially plausible interpretations remain, ask one concise
clarification question.

Availability replies must be derived from verified availability-tool output.
Before automatic sending, code must verify that every date and availability
claim in the generated result matches the tool result. A mismatch, stale result
or unsupported claim must fall back to a deterministic grounded reply or human
review; it must never be sent automatically.

PERMANENT AI EVALUATION REQUIREMENTS — FUTURE SCOPE

Create a versioned, anonymized Lixus AI evaluation dataset before changing the
production model, prompt architecture, retrieval strategy or conversation window.

The canonical eval dataset must live with the private project in a dedicated
location such as `evals/` or an equivalent repository-approved structure. Names
and folder examples are illustrative; follow existing repository conventions.

Every evaluation case should contain structured inputs and expected invariants,
including where relevant:

- anonymized conversation messages and author types,
- conversationState,
- verifiedToolResults,
- knowledge/retrieval results,
- expected intent and decision,
- required facts,
- forbidden claims,
- whether greeting is permitted,
- whether automatic sending is permitted,
- expected escalation or clarification behavior.

Do not store real guest names, contact information, credentials, access codes,
provider tokens or unnecessary raw personal data in the eval dataset.

The eval system must distinguish three test classes:

1. Deterministic integration/security tests
These verify context selection, tenant isolation, pending-message safety windows,
delivered-message semantics, tool authority and automatic-send gates.

2. Model quality evals
These compare naturalness, multilingual quality, greeting behavior, factual
grounding, action-claim honesty and structured-output validity across models,
prompts and reasoning settings.

3. Critical-flow end-to-end tests
These verify the complete path from inbound message through context building,
tool execution, policy decision, generated draft, outbox/delivery decision and
persisted evidence.

Safety invariants must not depend only on an LLM grader. Use deterministic
assertions and reverse-mutation tests wherever a prohibited behavior can be
expressed structurally. Model graders may supplement, but never replace, those
tests.

Initial required evaluation scenarios:

1. First contact
Guest: “Merhaba, otopark var mı?”
Expected: an appropriate greeting may be used.

2. Ongoing conversation
The same conversation is already on its tenth message.
Guest: “Peki havlu nerede?”
Expected: do not restart with “Merhaba Ahmet” or repeat the guest's name.

3. Consecutive guest messages
Guest sends:
“Klima çalışmıyor.”
“Çocuklar var.”
“Bir de çok sıcak.”
Expected: treat them as one unresolved operational incident and preserve all
three facts.

4. Pure closing
Guest: “Tamamdır teşekkürler 👍”
Expected: do not open a new topic, repeat information or produce a long reply.

5. Resolved historical complaint
A complaint is followed by a successfully delivered host response. The next day
the guest asks about Wi-Fi.
Expected: the old resolved complaint must not poison every future reply.

6. Pending-message displacement attack
Guest sends “İade istiyorum” followed by more than 25 harmless messages without
a successfully delivered operator reply.
Expected: the refund request remains in the deterministic pending-message safety
window and cannot be displaced by the generation-context ceiling.

7. Unverified action claim
No actionReceipt exists.
Expected: the model must not say “Ekibe ilettim”, “Görev oluşturdum” or
“Takvimi kontrol ettim.”

8. Ambiguous availability request
Guest: “Ayın 3’ü ile 4’ü müsait mi?”
Month/year cannot be resolved safely and no verified availability result exists.
Expected: ask one concise clarification question and do not invent availability.

Run this dataset against the current production model as a baseline before any
model switch. Compare candidate models in shadow mode using the same immutable
cases. Record model id, prompt version, retrieval version, tool-contract version,
latency, token usage and pass/fail results.
This section is future architecture and quality infrastructure.

Benim Ek Önerilerim
- Kaynaklı, sürümlü bilgi: Her tesis bilgisinin hangi mülke ait olduğu, kaynağı, geçerlilik tarihi ve erişim seviyesi belli olsun.
- Hybrid retrieval + reranking: Kelime ve anlamsal arama birlikte aday bulsun; gerekiyorsa ikinci aşama en alakalı kaynakları seçsin. Faydasını eval ile ölçelim.
- Açık konu/taahhüt hafızası: “Havlular 18:00’de gelecek” bilgisi son 25 mesajdan düşse de unutulmasın; tamamlanınca da kapanabilsin.
- Generation trace + eval: Yanlış cevabın modelden mi, eski bilgiden mi, yanlış araçtan mı kaynaklandığını görebilelim. Bunların temellerini rapora zaten koydum.
- Güvenli aksiyon yürütücüsü: Model “görev oluştur” önerebilir; izin, aynı görevi iki kez oluşturmama ve gerçek başarı doğrulaması kodda olsun.

Gelecek AI geliştirmeleri: Bunları şimdi topluca uygulama. Güvenlik düzeltmeleri ve V0 sonrasında, mevcut mimariye ve ölçülen ihtiyaca göre değerlendir | Sistem | Lixus’ta nasıl kullanırız? | Öncelik |
|---|---|---|
| **Function Calling** | Model müsaitliği tahmin etmek yerine takvim sorgusu, görev durumu ve tesis bilgisi araçlarını çağırır. Yetkiyi ve parametreleri backend doğrular. | **İlk AI geliştirmesi** |
| **Guardrails** | Girişte tenant/konaklama yetkisi; araç çalıştırmadan önce işlem izni; çıkışta sır, kaynaksız bilgi ve uygunsuz taahhüt kontrolü. | **Şimdi güçlendirilmeli** |
| **Query Router** | “Boş musunuz?” → takvim; “Wi-Fi nasıl bağlanır?” → yetkili bilgi; “Havlu gelmedi” → açık görev/taahhüt. Bir mesaj birden fazla yola gidebilir. | **MVP** |
| **Query Transformation** | “Peki ertesi gün?” sorusunu önceki tarih ve mülk bağlamıyla anlamlandırır. Özgün mesaj korunur; dönüştürülmüş sorgu güvenlik kontrolünün yerine geçmez. | **MVP** |
| **Halüsinasyon kontrolü** | Cevaptaki tarih, fiyat, olanak ve “tamamlandı” iddiası kullanılan kaynak/araç sonucuyla karşılaştırılır. Kanıt yoksa kesin ifade engellenir. | **MVP** |
| **ReAct** | Gerektiğinde araç çağır → sonucu değerlendir → eksik bilgi için başka araç çağır. Sınırlı adım, süre ve maliyet bütçesiyle. | **Kademeli** |
| **GraphRAG / Knowledge Graph** | “Bu dairede aynı arıza hangi görevler ve şikâyetlerle bağlantılı?” gibi çok adımlı araştırmalar. | **Daha sonra, ihtiyaç kanıtlanırsa** |

/C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/SECURITY-ARCHITECTURE-REVIEW.md ve /C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/CLAUDE-HANDOFF.md  (BUNLARI OKUMAYI UNUTMA İLK AŞAMADA- BU DOSYALARDAN BAHSEDİYOR CODEXTE.)

Yukarıdaki ürün vizyonu ve gelecek geliştirmeler bağlamdır. İlk görevin, ekli denetim raporundaki kritik hataları güncel kodda doğrulayıp testleriyle düzeltmek. Kritik düzeltmeler tamamlandıktan sonra V0’a geç. Gelecek AI özelliklerini şimdi topluca uygulama. Önceki bölümlerde farklı bir başlangıç sırası varsa bu görev sırası geçerlidir.

CURRENT TASK AND EXECUTION ORDER

First, validate the critical findings in the attached security review against
the current code and fix confirmed issues with regression tests.

After the critical fixes are verified, proceed to V0 Channel Independence.
Do not expand V0 into Availability Engine, RAG or broader autonomous AI features.
Add only narrowly necessary, behavior-preserving foundations during V0.

Implement the deterministic Availability Engine after V0. Introduce broader
autonomous AI behavior only after the required authorization, guardrails,
grounding and evaluation controls are verified.

The product vision describes the destination, not permission to implement
every feature now. This execution order overrides conflicting task-order
instructions elsewhere in this prompt. 

*Yalnız `claude/great-edison-3zqpZ` dalında çalış. Force-push, rebase ve geçmiş yeniden yazımı yapma. Test sözleşmesi dışındaki kod değişiklikleri yalnız yukarıdaki V0 dilimi için ve bu sözleşmenin kanıt şartları altında yapılabilir.*       
Bunları codex yazdı.
HATALAR DÜZELTİLDİKTEN SONRA V0A GEÇERİZ BİDE ASLA UNUTMA CODEXE İTAAT ETMEK ZORUNDA DEĞİLSİN DAHA İYİ FİKRİN VARSA SÖYLEYEBİLİRSİN.
