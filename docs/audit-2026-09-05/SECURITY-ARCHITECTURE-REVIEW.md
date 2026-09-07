# Lixus: Güvenlik, AI ve Bağımsız PMS Mimari Denetimi

İncelenen commit: `73dbfb4c039a28c23ace4ce2ab838559028a3bf2`.
Rapor tarihi: 5 Eylül 2026. Bu commit, kullanıcının inceleme hedefidir; bugün uzak dalda daha yeni commit bulunmadığı iddia edilmiyor.

## Yönetici Özeti

**Önce düzeltilmesi gereken gerçek sorunlar var.** Özellikle AI çıktısına güvenme, QR bilgi sınırı, silme sonrası mesaj gönderimi, OAuth bağlantısının iptali ve yarış durumlarında konuşma statüsünün korunması üzerinde çalışılmalı. Daha büyük modele geçmek veya promptu uzatmak bunları çözmez.

**Temel mimari atılacak durumda değil.** Lixus'un zaten kendi Property, Reservation, Conversation, Message, Task kayıtları; tenant kontrolleri; mesaj kuyruğu; OAuth; veri silme mekanizmaları ve entegrasyon testleri var. Bağımsız PMS için bunları koruyup sağlayıcıya özgü kimlik, yetki ve teslimat varsayımlarını ayrıştırmak gerekiyor. Sırf başka promptta yazıyor diye paralel tablolar veya ikinci bir mesaj sistemi kurulmasını önermiyorum.

**Airbnb API almaya kesin hazır / hatasız / güvenlik denetiminden geçti demiyorum.** Teknik hazırlık, işletim kanıtı ve API programına kabul ayrı şeyler. Bu rapor bir pentest sertifikası veya canlı sistem uygunluk belgesi değildir.

### Kanıtın Sınırı

- 786 dosyanın boyut, satır ve SHA256 envanteri çıkarıldı; 676 TS/TSX/MJS dosyası AST üzerinden tarandı. Bunların 352'si uygulama kaynak kodu, 82'si API rota dosyasıdır.
- Kritik dosyalarda hedefli elle kod okuması ve çağrı zinciri incelemesi yapıldı. **786 dosyanın her satırını tek tek elle doğruladım demiyorum.** Envanter, AST taraması, elle inceleme ve davranış kanıtı farklı seviyelerdir; [coverage.md](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/coverage.md>) bunları ayırır.
- 15 çevrimdışı davranış/kontrat kanıtı çalıştırıldı. Gerçek kaynak fonksiyonları bellekte transpile edildi; DB, HTTP, model ve dosya işlemleri kontrollü sahtelerle değiştirildi. Çoğunda aksi yöndeki kontrol de var. Bunlar deponun entegrasyon süitinin yerine geçmez ve 15 güvenlik kontrolünün başarılı olduğu anlamına gelmez: **15 sorun davranışı yeniden üretildi.**
- PostgreSQL üzerinde gerçek eşzamanlılık testi, canlı model sorgusu, gerçek mesaj, prod sorgusu, bucket erişimi, credential okuma veya deploy yapılmadı.
- Ortam Node `24.16.0`; proje Node 22 istiyor. Transpiler mevcut yerel araç kurulumundan kullanıldı; incelenen kaynak yalnız hedef commit'tir. Quality-audit kanıtında kullanılan Zod `3.25.76`, hedef lockfile ile aynı sürümdür.
- Tam test, build, lint, typecheck ve güncel registry audit bu turda çalıştırılmadı. Özellikle test hazırlığı harici DB'ye veri kaybettiren işlem yapabildiği için körlemesine `npm test` çalıştırılmadı.
- Ana deponun HEAD'i değişmedi, çalışma ağacı temiz kaldı. Rapor ve kanıtlar ana deponun dışında oluşturuldu. Hiçbir dosya silinmedi.

## Bulgular

P1: geniş müşteri açılışı veya ilgili yeteneğin etkinleştirilmesinden önce ele alınmasını önerdiğim yüksek öncelik. P2: takip eden sertleştirme/işlevsel doğruluk işi. Bunlar CVSS puanı değildir; ön koşul ve etki her maddede ayrıdır.

### F01 · P1 · Eksik AI güvenlik alanları otomatik gönderime uygun sayılıyor

**Yer:** [src/lib/ai/index.ts:247](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/ai/index.ts:247>), [src/lib/ai/index.ts:256](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/ai/index.ts:256>), [src/lib/ai/index.ts:276](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/ai/index.ts:276>), [src/lib/automation.ts:72](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/automation.ts:72>).

Parser yalnız yanıt metninin varlığını esas alıyor. Eksik `riskLevel` → `none`; `Number(parsed.confidence)` ise boolean `true` değerini `1` yapıyor. Güvenlik kapısı bu yüksek güven değerini kullanıyor. JSON üretmek, zorunlu tip ve güvenlik sözleşmesini doğrulamak değildir.

**Kanıt:** Sentetik model cevabı `{intent:"parking", reply:"Yes, there is free parking.", confidence:true}` gerçek parserdan `confidence=1`, `riskLevel=none`, `usedSources=[]` olarak çıktı. Gerçek otomatik yanıt kapısı `true` döndü. Aynı cevabın `riskLevel=high` kontrolü reddedildi. Bu, canlı modelin gerçekten bu cevabı verdiğinin veya gönderildiğinin iddiası değildir; autosend uygunluk açığıdır. İşletim saati/plan gibi sonraki kapılar ayrıca uygulanabilir.

**Düzeltme:** Zorunlu alanları, enumları, sonlu sayısal güven değerini ve uzunlukları strict şemayla doğrula; boolean/string coercion kullanma. Eksik veya hatalı güvenlik metadatası insan incelemesine düşsün. Modelin kendi güven puanı tek başına yetki vermesin. Somut tesis/ücret/müsaitlik iddiasında, doğrulanmış bilgi veya araç sonucu aransın. Zararsız teşekkür yanıtına zorla KB kaynağı isteme.

**Test:** Eksik risk, boolean/string/null/NaN-benzeri güven, bilinmeyen intent, kesilmiş yanıt ve doğru şema. Parser permissive yapılınca saldırı testi kırmızı; bütün cevapları reddeden değişiklikte meşru cevap testi kırmızı. Gerçek gönderici spy'ı uygun olmayan durumda hiç çağrılmamalı.

### F02 · P1 · QR sır filtresi, geçerli uzunluktaki bilginin ortasını taramıyor

**Yer:** [src/lib/guest-chat.ts:290](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/guest-chat.ts:290>), [src/lib/guest-chat.ts:334](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/guest-chat.ts:334>), [src/lib/validators.ts:241](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/validators.ts:241>), [src/lib/guest-chat.ts:653](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/guest-chat.ts:653>).

8.000 karakteri aşan içerikte yalnız ilk ve son 4.000 karakter taranıyor; filtre güvenli derse tam özgün içerik model bağlamına veriliyor. KB giriş sınırı 20.000 karakter olduğundan ortadaki taranmayan bölüm normal uygulama girdisiyle ulaşılabilir.

**Kanıt:** 18.019 karakterlik KB içeriğinin ortasındaki sentetik kapı kodu filtreden geçti. Aynı kod kısa girdide engellendi. Bu, QR modeline verilmemesi amaçlanan verinin sınırı aşmasıdır; canlı modelin misafire kod sızdırdığı gösterilmedi.

**Düzeltme:** Kabul edilen sınırlı içerik bütünüyle incelensin; incelenemeyen içerik özgün haliyle geçirilmesin. Asıl çözüm, sır güvenliğini kelime listesine bırakmamak: public, doğrulanmış aktif konaklama ve host-only bilgi görünürlükleri açık veri politikası olsun. Kapı kodu gibi değerler ayrı, yetkili servis tarafından dönsün; genel RAG indeksine girmesin. Mevcut QR rezervasyon/PIN/tombstone kontrolleri korunmalı.

**Test:** Sır başlangıçta/ortada/sonda; tam sınır ve sınır üstü; Unicode; farklı yazımlar; sır olmayan posta kodu/adres kontrolü. Filtreyi kaldırmak kadar her şeyi bloke etmek de test bozmalı.

### F03 · P1 · Konuşma silinince bekleyen mesajın dışarı gönderilmesi engellenmiyor

**Yer:** [src/app/api/conversations/[id]/route.ts:36](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/conversations/[id]/route.ts:36>), [src/app/api/properties/[id]/route.ts:83](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/properties/[id]/route.ts:83>), [prisma/schema.prisma:1002](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/prisma/schema.prisma:1002>), [src/lib/outbox/worker.ts:352](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/outbox/worker.ts:352>), [src/lib/outbox/worker.ts:417](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/outbox/worker.ts:417>).

Normal konuşma silme yolu Message ve Conversation kayıtlarını siliyor, MessageOutbox kaydını iptal etmiyor. Kuyruk kendi hedef ve gövde snapshot'ını tutuyor. Gönderim öncesi kontrolde Message bulunamazsa `null`, yani veto yok, dönülüyor; kayıp mesaj yanlışlıkla manuel gönderim gibi ele alınıyor. Holding-ack yolu da bu varlık kontrolünü yapmıyor.

**Kanıt:** Gerçek veto fonksiyonu kayıp Message + kayıp Conversation için gönderimi durdurmadı. Message mevcut, Conversation kayıp kontrolünde `conversation_gone` döndü. Gerçek sağlayıcıya gönderim yapılmadı. Ön koşul: durable outbox kullanımda ve ilgili bekleyen kayıt var. Canlı bayrak durumu bu turda doğrulanmadı.

**Düzeltme:** Normal silme, mülk silme, açık silme ve retention için ortak yaşam döngüsü sözleşmesi oluştur. İlgili kuyruk kayıtlarını aynı DB transaction'ında iptal/redakte et; göndericide de hedefin hâlâ var, aynı tenant ve aynı bağlantıya ait olduğunu doğrula. Kayıp kayıt hiçbir zaman "host mesajıdır, geçsin" anlamına gelmesin. Kaydı silmek yerine teslimat denetimi için gereken asgari metadata tutulabilir.

**Önemli sınır:** `erasure.ts` ve `data-retention.ts` zaten kuyruk redaksiyonu yapıyor; onları yok saymıyorum. Buradaki açık normal DELETE yolları ve son gönderim kontrolüdür. Claim edilmiş işin bellekteki eski snapshot'ı ayrıca sınanmalı. Sağlayıcının kabul ettiği bir mesaj geri alınamaz; atomik DB iptali bunu geriye çeviremez.

**Test:** Enqueue → normal DELETE → worker → sağlayıcı çağrısı sıfır. Aynısı mülk silme, holding-ack, manuel yanıt, erasure ve retention için. Deferred provider ile claim sonrası silme penceresi ayrıca ölçülmeli; meşru sıradaki mesajın teslimi kontrol olarak korunmalı.

### F04 · P1 · Geç dönen OAuth refresh, kaldırılmış bağlantıyı yeniden canlandırıyor

**Yer:** [src/lib/hospitable-credentials.ts:140](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/hospitable-credentials.ts:140>), [src/lib/hospitable-credentials.ts:225](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/hospitable-credentials.ts:225>), [src/lib/hospitable-credentials.ts:329](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/hospitable-credentials.ts:329>).

Başarılı refresh'in kaydı yalnız `organization.id` ile koşulsuz güncelleniyor. Refresh başlarken bağlı olan hesabın hâlâ aynı hesap olduğu kontrol edilmiyor. Hata dalında eski refresh token'a bağlı koşullu temizleme var, fakat başarı dalında aynı sahiplik koruması yok.

**Kanıt:** Gerçek credential fonksiyonlarıyla refresh cevabı kontrollü promise üzerinde bekletildi. `clearOrgHospitableToken` ile tokenlar temizlendi; bekleyen refresh serbest bırakılınca tokenlar yeniden yazıldı. Aynı sınıf yarış yeni hesabın OAuth bağlantısı sırasında eski hesabın sonucunun sonradan yazılması için de önemlidir; o varyant bu pakette ayrıca koşturulmadı.

**Düzeltme:** Bağlantıya kalıcı kimlik, generation/version ve durum ata. Refresh lease'i ve yazması beklenen generation'a bağlı olsun. Disconnect/reconnect generation'ı ilerletsin. Eski refresh sonucu hem DB'ye yazılmamalı hem de çağıran işe kullanılabilir aktif token gibi verilmemeli. Süreç içi tek promise yeterli değil; birden fazla instance için DB seviyesinde sahiplik gerekir.

**Test:** Refresh ↔ disconnect, refresh ↔ reconnect, iki instance refresh, token rotasyonu sonrası DB yazma hatası. Gecikmiş sonuç bağlantıyı diriltmemeli, doğru güncel refresh çalışmalı. Node süreç içi testi ardından izole PostgreSQL üzerinde iki bağlantılı kontrollü yarış testi.

### F05 · P1 · Eski gönderimin tamamlanması yeni şikâyeti kapatabiliyor

**Yer:** [src/lib/outbox/worker.ts:332](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/outbox/worker.ts:332>), [src/lib/outbox/worker.ts:334](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/outbox/worker.ts:334>).

Teslim sonrası `status != closed` olan konuşma koşulsuz `answered` yapılıyor. Gönderim öncesi kontrol ile sağlayıcı cevabı arasında yeni mesaj gelip konuşmayı `problem` yaparsa eski gönderimin tamamlanması yeni sorunu kapatabiliyor. `lastMessageAt` de işin taşıdığı `now` ile yazılıyor.

**Kanıt:** Gerçek güncelleme predicate'i `problem` durumunu `answered` yaptı; `closed` kontrolünü korudu. PostgreSQL yarışını veya gerçek HTTP teslimini koşturmadım. Yarış penceresi kaynak akışından görülüyor; kanıt predicate seviyesindedir.

**Düzeltme:** Teslim durumu ile konuşmanın operasyonel durumunu ayır. Eski yanıtın delivery ACK'i yalnız kendi mesaja ait olsun. Konuşmayı kapatma/answered kararı beklenen son inbound veya revision'a bağlı koşullu güncelleme olsun. Son mesaj zamanını geriye taşıma. Aynı işlevin reply, automation ve lifecycle yollarını da kapsayan durum geçiş tablosu çıkar.

**Test:** Gönderimi beklet → yeni şikâyet yaz → eskisinin teslimini tamamla → yeni `problem` ve bekleyen trigger korunmalı. Şikâyet gelmeyen meşru akış hâlâ cevaplandı olmalı. Sadece m48'in altı alanının birlikte yazılması bu yarışı çözmez.

### F06 · P1, Koşullu · Sayfa kimlik kontrolü DB hatasında eski MFA iddiasını koruyor

**Yer:** [src/lib/auth/index.ts:116](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/auth/index.ts:116>), [src/lib/auth/index.ts:122](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/auth/index.ts:122>), [src/lib/admin-core.ts](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/admin-core.ts>), [src/app/(app)/admin/page.tsx:22](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/(app)/admin/page.tsx:22>).

`requireAuth` DB kontrolü hata verirse rolü `staff` yapıp oturumu döndürüyor. Ancak `isSuperAdmin`, tenant rolü yerine izinli e-posta ve MFA iddiasına bakıyor; bunlar hata dalında korunuyor. API'deki `requireSession` hatada kapalı davranıyor, bu fark sayfa tarafında.

**Kanıt:** İmzalı olduğu varsayılan, izinli kurucu oturumuyla DB lookup hatası sonrası `role=staff`, `mfa=true`, `isSuperAdmin=true` kaldı. Sağlıklı DB faktörün kaldırıldığını gösterdiğinde superadmin kontrolü reddetti.

**Ön koşul:** Mevcut geçerli imzalı/allowlist oturumu ve güncel oturum doğrulamasının başarısız olup sonraki veri sorgularının çalışabildiği pencere. Sıradan müşterinin süperadmin olabildiği veya imzanın kırıldığı iddia edilmiyor. Risk eski/iptal edilmiş ayrıcalığın doğrulanmadan kabul edilmesi.

**Düzeltme:** Ayrıcalıklı sayfa için doğrulayamama erişim vermesin; geçici 503 veya oturum kontrolü hatası kullan. Page ve API aynı güncel oturum doğrulayıcısını paylaşsın. Geçici altyapı arızasını yanlışlıkla kalıcı parola/hesap iptali gibi işletme.

**Test:** User/actor sorgusu ayrı ayrı hata; epoch farkı; MFA kaldırma; allowlist kaldırma; sağlıklı yetkili kullanıcı. Reddin yalnız HTTP statüsü değil hassas veri sorgusunun hiç çalışmamasıyla ölçülmesi gerekiyor.

### F07 · P1, Veri Yaşam Döngüsü · Retention bayrağı tam yeniden-temizleme sağlamıyor

**Yer:** [src/lib/data-retention.ts:102](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/data-retention.ts:102>), [src/lib/data-retention.ts:379](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/data-retention.ts:379>).

Yeni message-age seçimi, eski rezervasyonu anonim olmayan ad veya eski temizlenmemiş inbound gövde üzerinden tekrar seçiyor. Adı zaten anonim olan, eski inbound gövdesi kalmayan kayda sonradan telefon/e-posta/not veya görev notu bağlanırsa bunlar tek başına seçilme sebebi değil. Öksüz dalda da seçici benzer derecede dar.

**Kanıt:** `RETENTION_MESSAGE_AGE_ANCHOR=1` ile gerçek fonksiyonun ürettiği Prisma predicate'i yakalandı: yalnız iki OR bacağı var; yeniden eklenen telefon veya TaskUpdate üzerinden giriş yok. Gerçek DB satırı anonimleştirilmedi. Bu, tam süpürgenin değil seçim sözleşmesinin kanıtı.

**Düzeltme:** Message-age düzeltmesiyle tam yeniden-temizleme hedefini ayrı tanımla. Son hassas veri değişimi/son temizleme sürümü gibi bir işaret veya tüm ilgili varlıkları kapsayan iş kuyruğu tasarla. Kontrolsüz her satırı sonsuza kadar tekrar seçmek de doğru değil: sınırlı partide ilerleme ve sonlanma korunmalı. Gizlilik kararı yalnız `guestName == ANON_NAME` olmasın.

**Test:** Önce anonimleştir → yalnız telefon ekle / yalnız e-posta / yalnız görev notu / yalnız outbound PII / yalnız AI türevi ekle → uygun politika bunları tekrar ele alsın. Taze meşru mesajların korunması ve dört tekrar geçişin gereksiz yazma yapmaması ters kontrollerdir.

**Operasyon:** Bu rapor bayrak açma onayı değildir. Yaş-temelli kapsam, dry-run sayıları, doğrulanmış yedek, geri dönüş sınırı ve mevcut prod yetkilendirmesi olmadan gerçek anonimleştirme çalıştırılmamalı. "Bayrağı kapatınca silinen veri geri gelir" denmemeli.

### F08 · P1, Geliştirme Güvenliği · Test hazırlığı yanlış DB üzerinde veri kaybettirebilir

**Yer:** [tests/global-setup.ts:26](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/tests/global-setup.ts:26>), [tests/global-setup.ts:28](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/tests/global-setup.ts:28>).

Herhangi bir `TEST_DATABASE_URL` varsa, disposable/test DB olduğu kanıtlanmadan `prisma db push --accept-data-loss` çağrılıyor. Testlerin sonraki temizleme yardımcıları da yazıyor. Uzak veya adı production olan URL'yi engelleyen bu girişte bir koruma yok.

**Kanıt:** Tamamen sentetik `example.invalid/production` hedefiyle gerçek setup çalıştırıldı; child-process çağrısı yakalanıp yürütülmedi. Tehlikeli komuta ilerlediği görüldü. DB'ye bağlanılmadı; hiçbir dosya silinmedi.

**Düzeltme:** Varsayılan, teste özel disposable DB olsun. Harici test DB için açık test modu, beklenen DB kimliği ve test harness'in ürettiği işaret doğrulansın. DB kullanıcısının prod'a erişimi olmasın. URL'de yalnız "test" kelimesi görmek tek koruma sayılmasın. Bütün reset, seed, migration prova ve e2e setup yolları aynı kontrolü kullansın; secret URL loglanmasın.

**Test:** Prod-benzeri hedef, eksik işaret, yanlış rol/DB ve eksik env durumunda hiçbir destructive subprocess/SQL çağrısı olmamalı. Gerçek disposable DB'yi toptan yasaklayan değişiklik de kontrol testini bozmalı.

### F09 · P2 · CSP raporu URL yolundaki token'ı loga taşıyor

**Yer:** [src/app/api/csp-report/route.ts:60](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/csp-report/route.ts:60>), [src/app/api/csp-report/route.ts:116](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/csp-report/route.ts:116>), [src/app/api/csp-report/route.ts:123](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/csp-report/route.ts:123>).

`safeUrl` query ve fragment'i temizliyor ama pathname'i aynen bırakıyor. `/c/<chatToken>` gibi bir yolun bearer değeri korunuyor. URL olmayan veri parse edilemezse ham metnin ilk 120 karakteri dönüyor. Directive/disposition alanları da yalnız uzunluk/kontrol karakteri filtresinden geçiyor; kapalı bir değer kümesi değil.

**Kanıt:** Gerçek POST ile sentetik `/c/SYNTHETIC_QR_SECRET?token=QUERY_SECRET` raporu işlendi. Query değeri temizlendi, path token console.warn'a yazıldı. Canlı CSP ihlali/log sızıntısı gözlenmedi; endpoint'in log kontratı sınandı.

**Düzeltme:** Document alanını rota şablonuna çevir (`/c/:token`) veya yalnız güvenli origin/kategori tut. Geçersiz URL'yi özgün metin olarak döndürme. Directive/disposition ve `inline`, `eval` gibi özel kaynak etiketlerini allowlist ile işle. Merkezi logger redaksiyonunu bu sink'e de uygula. PII taşımayan örnekleme ve kardinalite sınırı korunsun.

**Test:** Path/query/fragment/userinfo sırları, URL olmayan PII, büyük alanlar, forged report, meşru directive. Sadece query'nin yokluğunu pinlemek yeterli değil.

### F10 · P2 · Merkezi redaksiyon bütün log çıkışlarını kapsamıyor

**Yer:** [src/lib/audit.ts:114](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/audit.ts:114>), [src/lib/rate-limit.ts:67](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/rate-limit.ts:67>).

Audit yazma hatasında merkezi `reportError` öncesinde ham error console.error'a basılıyor. Rate-limit hata mesajının da ayrı doğrudan log yolu var. `reportError` içindeki başarılı yapısal redaksiyon, onu kullanmadan yazan bir sink'i korumaz.

**Kanıt:** Audit DB yazımı sentetik kişisel alan içeren hata verdiğinde gerçek `writeAudit` bu özgün alanı console.error'a taşıdı. Belirli bir gerçek Prisma hatasının bu metni içerdiği iddia edilmiyor.

**Düzeltme:** Uygulama log çıkışları yapılandırılmış ve merkezi olsun; izinli hata kodu, correlation ID ve güvenli metadata dışında ham exception/request/model cevabı yazılmasın. `console.*` kullanım denetimi bu mimariyi desteklesin ama tek test metin taraması olmasın.

**Test:** Aynı sentetik hassas değer tüm log/Sentry/e-posta kanallarında aranmalı; meşru tanı kodları korunmalı. Audit yazılamamasının işlemi durdurup durdurmayacağı eylem bazında açık politika olmalı; superadmin hassas veri okumasında izsiz erişim sessizce kabul edilmemeli.

### F11 · P2 · Mülk silme yüklenen nesneleri sahipsiz bırakıyor

**Yer:** [src/app/api/properties/[id]/route.ts:83](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/properties/[id]/route.ts:83>), [src/app/api/tasks/[id]/route.ts:165](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/tasks/[id]/route.ts:165>), [src/app/api/storage/photo/[...key]/route.ts:24](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/storage/photo/[...key]/route.ts:24>).

Görev silme yolunda fotoğraf temizleme kuyruğu mevcut. Mülk silme ise düz cascade; fotoğraf nesneleri için aynı temizleme hazırlığını yapmıyor. Fotoğraf GET yolu tenant/key kontrolünden sonra DB'de nesnenin ilgili görevinin varlığını denetlemeden imzalı URL üretiyor.

**Etki:** Bucket'ta kalan nesne, eski anahtarı bilen aynı tenant kullanıcısına erişilebilir kalabilir; fiziksel veri silme politikası eksik uygulanır. Çapraz-tenant erişim iddiası yok; o kontrol mevcut. Canlı bucket deneyi yapılmadı.

**Düzeltme:** Mülk silmede görev/fotoğraf anahtarlarını kaybetmeden, tek transaction'da nesne-silme işleri üret. Upload tamamlandı fakat göreve bağlanamadı durumuna staging TTL ve orphan reconciliation ekle. Sağlayıcı silmesi tekrar çalıştırılabilir olsun. Görev silme sırasında eşzamanlı fotoğraf ekleme penceresini de kapsa.

**Test:** Fotoğraflı mülk sil → DB referansları giderken tüm object-delete işleri oluşmalı; başarısız bucket silmesi tekrar denenmeli. Başka mülk/tenant fotoğrafı silinmemeli. İmzalı URL'nin kısa TTL'si fiziksel silmenin yerine geçmez.

### F12 · P2 · Audit job koşma hatasında kapanıyor, fakat kabul/veri formatında iki boşluk var

**Yer:** [scripts/audit-check.mjs:54](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/scripts/audit-check.mjs:54>), [scripts/audit-check.mjs:146](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/scripts/audit-check.mjs:146>), [scripts/audit-check.mjs:207](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/scripts/audit-check.mjs:207>).

Registry erişim hatasının yeşil olmaması düzeltilmiş; bu iyi. Ancak baseline kaydının `expires` alanı yoksa kayıt süresiz kabul ediliyor. Ayrıca advisory URL'sinde GHSA kimliği bulunmayan kayıt sessizce düşüyor; yüksek zafiyet sayacı ile çıkarılan advisory kümesinin tutarlılığı zorlanmıyor.

**Kanıt:** Sentetik GHSA kaydı expires olmadan exit 0, süresi geçmiş tarihle exit 1 üretti. Sentetik GHSA dışı advisory + high=1 ise exit 0; GHSA biçimi kontrolünde exit 1. Bu, mevcut npm registry'nin gerçekten böyle yanıt verdiği iddiası değil, fail-closed sözleşmesinin format dayanıklılığıdır.

**Düzeltme:** Baseline JSON şeması: zorunlu geçerli tarih, kimlik, package, gerekçe ve inceleme kaydı; duplicate/invalid kayıtlar hata. Bilinmeyen advisory şekli "incelenemedi" diye kırmızı olsun. npm advisory ID/URL biçimini sürümlü parserla işle; dependency transitive kayıtlarını doğru çözmeden kaba sayaç eşitliği dayatma. Dev/build supply-chain riskini prod-only job'dan ayrı değerlendir.

**Test:** Missing/invalid expiry, bozuk tarih, bilinmeyen advisory URL, anlamlı sayaçla boş advisory map, ağ hatası, başarılı retry, temiz lockfile. Haftalık işin gerçek çalışması son başarılı scheduled run üzerinden kanıtlansın; yalnız YAML bulunması yeterli değil.

### F13 · P2 · Organizasyonun üslup profili mülke özgü gerçeğe dönüşüyor

**Yer:** [src/lib/automation.ts:2663](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/automation.ts:2663>), [src/lib/ai/index.ts:331](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/ai/index.ts:331>), [src/lib/ai/prompts.ts:914](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/ai/prompts.ts:914>).

Son 40 host cevabı organizasyon genelinden, property bağlamı alınmadan toplanıyor. Üslup özetleyicisi yalnız tonu değil, otopark/bagaj gibi FAQ cevaplarını da çıkarıyor. Son prompt, KB eksikse bunları temel almayı söylüyor; aynı bölümde yalnız üslup için kullan diyen çelişkili talimat da var.

**Kanıt:** A mülküne ait otopark cevabı taşıyan org profili, B mülkü için oluşturulan gerçek prompta girdi. Bu bir tenantlar-arası kaçak değil; aynı host'un mülkleri arasında yanlış bilgi taşınması riski. Gerçek modelin yanlış cevap verdiği ölçülmedi.

**Düzeltme:** Organizasyon profili ton/selamlama/cümle yapısı ile sınırlansın. Gerçek tesis bilgisi property kapsamlı, kaynaklı ve sürümlü bilgi kaydında olsun. Host geçmişinden çıkarılan aday bilgi, doğrulanmış gerçek statüsüne otomatik yükselmesin. Eski styleProfile kayıtlarının güvenli geçişi de planlansın; promptu değiştirmek birikmiş veriyi sınıflandırmaz.

**Test:** Aynı tenant'ta A ücretsiz otopark/B otopark yok, farklı giriş saatleri ve eski/yeni bilgi. Ton ortak kalmalı, gerçekler taşınmamalı. Yanıtın üslup kaydından olgusal kaynak üretmesi engellensin.

### F14 · P2 · Sohbet hafızası ve zaman semantiği ürün beklentisinin gerisinde

**Yer:** [src/lib/ai/index.ts:34](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/ai/index.ts:34>), [src/lib/ai/prompts.ts:629](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/ai/prompts.ts:629>), [src/lib/ai/prompts.ts:842](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/ai/prompts.ts:842>), [src/lib/automation.ts:1298](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/automation.ts:1298>), [src/app/api/chat/[token]/route.ts:627](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/chat/[token]/route.ts:627>).

Model geçmişi direction/body ile alıyor; timestamp, author ve gerçek teslim durumu bu kontratta yok. Prompt son altı mesajı kullanıyor; QR üretim çağrısında geçmiş tamamen boş. Automation bu sırada bütün konuşma mesajlarını çekebiliyor: DB maliyeti büyürken modele giren bağlam hâlâ dar. Timeline ise rezervasyon tarihini saatiyle karşılaştırıp "check-out gerçekleşti" diyebiliyor; takvimdeki çıkış günü gerçek çıkış eylemiyle aynı şey değil.

**Kanıt:** 25 sentetik geçmiş mesajından yalnız son altısı promptta yer aldı; gönderilen timestamp kayboldu. QR `history: []` ve timeline davranışı statik kodda doğrulandı. Önemli: cevapsız mesaj güvenlik penceresi ayrı; "iade + 30 masum mesaj kesin kapıyı atlatır" sonucu bu bulgudan çıkmaz.

**Düzeltme:** Son 25 mesaj başlangıç bütçesi olabilir; ayrıca token tavanı kullan. Sıralama `(timestamp,id)` gibi kararlı olsun. Mesajın kaynaktaki zamanı, sisteme geliş zamanı ve teslim zamanı karıştırılmasın. Cevapsız sorun/taahhütler pencerenin dışında kalınca düşmesin; kalıcı açık konu durumu ve kanıtlı özet kullan. Host/AI/system ayrımı korunsun. QR da yalnız doğrulanmış aynı konaklama kapsamındaki geçmişi alsın.

**Test:** İlk selam, tekrar selam, "buldum teşekkürler", ardından saatler sonra yeni selam; aynı olayı üç mesajda anlatma; host sonradan yanıtladı; eski kapanmış şikâyet; 25 pencere dışına itilen açık iade; UTC/gece yarısı/DST/çıkış günü. Property veya org timezone seçimi açık olmalı; gerçek check-out yokken tamamlandı olayı uydurulmamalı.

### F15 · P2 · AI kalite denetimi değerlendirememeyi sıfır bulguya çevirebiliyor

**Yer:** [src/lib/quality-audit.ts:70](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/quality-audit.ts:70>), [src/lib/quality-audit.ts:256](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/quality-audit.ts:256>), [src/lib/quality-audit.ts:272](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/quality-audit.ts:272>).

Kalite denetimi zaten var; sıfırdan ikinci bir "AI denetçisi" kurmaya gerek yok. Ancak gördüğü veri son inbound/AI çifti ve kısaltılmış metin; üretimde kullanılan gerçek KB sürümü, araç sonucu, prompt snapshot'ı ve generation anındaki risk kararı değil. Üstelik `{}` raporu şemadan geçip sıfır findings oluyor; hatalı bulgular sessiz filtrelenebiliyor.

**Kanıt:** Gerçek parser + lockfile ile aynı Zod sürümü `{}` girdisini kabul etti; sıfır bulgu ve değerlendirme verilmedi metni döndü. Geçerli high bulgu kontrolü korundu. UI'nın açıkça "tamamen güvenli" dediği ileri sürülmüyor; başarılı rapor tipiyle değerlendirememe ayrılmıyor.

**Düzeltme:** `evaluated / inconclusive / failed` durumlarını ayır; zorunlu alan ve messageId üyelik kontrolü yap. Kaynağı görülmeyen olgusal doğruluk "kanıt yok" olsun, otomatik halüsinasyon veya doğru etiketi olmasın. Generation trace kaydıyla evaluator aynı kanıtı görsün. Model-judge tek doğruluk ölçütü değil; deterministik beklenti ve insan etiketli setle ölçülsün.

**Test:** Boş/eksik rapor, tüm bulguları bozuk rapor, örneklemde olmayan messageId, gerçek hatalı ve doğru cevap, kaynak eksikliği. Bütün findings'i boşaltan mutasyon kırmızı olmalı.

### F16 · P2, Koşullu · iCal ayrıştırma eksik snapshot'ı başarılı liste gibi döndürüyor

**Yer:** [src/lib/import/ics.ts:118](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/import/ics.ts:118>), [src/lib/import/ics.ts:190](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/import/ics.ts:190>), [src/lib/import/ics.ts:214](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/import/ics.ts:214>), [src/lib/import/sync.ts:565](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/import/sync.ts:565>).

10.000 event tavanında parser sessizce kırılıyor ve yalnız array döndürüyor; kayıp/atlanmış event veya desteklenmeyen recurrence için completeness bilgisi yok. RRULE/EXDATE gibi recurrence genişletmesi bu parserda bulunmuyor. İçe alınan kaynak bu özellikleri kullanıyorsa takvim gerçeği eksik temsil edilebilir.

Disappearance reconciliation boş/ani küçülen feed, zaman ve source-binding korumalarına sahip; bunlar korunmalı. Fakat event sayısı heuristiği, parse'ın tam yapıldığını kanıtlamaz. Gerçek beslemelerde bu sınırların tetiklendiği ölçülmedi; reconciliation bayrağı da canlıda doğrulanmadı.

**Düzeltme:** Parser sonucunda `complete`, desteklenen özellikler, kapsanan zaman aralığı ve hata/atlanma nedenleri taşınsın. Eksik snapshot iptal ve "kesin müsait" kararına yetki vermesin. Bakımı yapılan iCalendar kütüphanesiyle uyumluluk değerlendirmesi yap; sınırsız recurrence expansion yerine pencere ve bütçe uygula. UID/RECURRENCE-ID/TZID/SEQUENCE alanları için kontrat testleri kur.

**Test:** Tavanın iki tarafı, tekrar eden event, istisna tarih, bozuk event, kısmi HTTP/parse, aynı UID güncellemesi, aynı kaynakta sıra dışı event. Eksik okumada eski rezervasyon yanlış iptal olmamalı; tam geçerli iptal yine işlenmeli.

### F17 · P2, Ölçek · Cron bütçesi son tenant'ları sürekli erteleyebilir

**Yer:** [src/lib/scheduled-sync.ts:301](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/scheduled-sync.ts:301>), [src/lib/scheduled-sync.ts:402](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/scheduled-sync.ts:402>); eski iş listesinde de kayıtlı.

Organizasyonlar kalıcı adil sıra/cursor olmadan topluca alınıp aynı geçişte işleniyor. Geçiş bütçesi biterse sonraki org'lar atlanıyor. SQL sırası garanti edilmiyor; ilerlemeyi garanti eden mekanizma da yok. İlk tenant'ların yükü tekrarlandığında sonrakilerin sürekli gecikmesi mümkün. Bu risk için canlı çok-tenant yük testi yapılmadı.

**Düzeltme:** Tenant/connection başına `nextDueAt`, son başarı, lease/fencing, retry/backoff ve gecikme metriği. Adil iş seçimi ve sağlayıcı bazlı kota uygula. Webhook öncelikli, polling uzlaştırma amaçlı olabilir; dış kanal desteklemiyorsa varmış gibi davranma. Ölçmeden yeni broker/mikroservis şart değil; PostgreSQL iş tablosu mevcut ölçeğe uygun bir başlangıç olabilir.

**Test:** Bir tenant sürekli yavaş/429/402 üretirken diğerleri ilerlesin; restart/lease kaybında iki worker aynı işi bitirmiş saymasın. En eski bekleyen iş yaşı ve sync freshness için açık SLO koy.

### F18 · P2, Savunma Tasarımı · Login hesap kotası parola tahminini durdurmuyor

**Yer:** [src/app/api/auth/login/route.ts:19](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/auth/login/route.ts:19>), [src/app/api/auth/login/route.ts:55](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/auth/login/route.ts:55>), [src/app/api/auth/login/route.ts:72](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/auth/login/route.ts:72>).

IP kotası önce çalışıyor; hesap kotası ise parola doğrulandıktan sonra yalnız hatalı parola dalında. Dolayısıyla dağıtık IP denemelerinde hesap kotası dolsa da sonraki parolalar doğrulanır; doğru parola sonucu başarısızlardan ayırt edilebilir. Bu, dokümanda hedefli hesap kilitlemeyi önlemek için yapılmış bir tercih; kota tamamen yok demiyorum.

**Düzeltme:** Kör hesap kilidi ekleme. IP + hesap + cihaz/sinyal bazlı progresif challenge, maliyet sınırı ve MFA/passkey yaklaşımı tasarla. Hesap kotasının gerçekte sağladığı korumayı doğru adlandır. Sırf response'u 429 yapmak doğrulama denemesini sınırlandırmak değildir. Mevcut enumeration ve meşru kullanıcı erişimi kontrollerini koru.

**Test:** Taze IP'ler, dolu hesap kovası, doğru/yanlış parola, saldırganın kurbanı kilitleme denemesi, MFA hesabı. Bu maddede canlı veya çevrimdışı tam login akışı çalıştırılmadı; bulgu branch sırasının statik incelemesine dayanıyor.

## Mevcut İyi Temeller

Bu liste "hiç kusur yok" hükmü değil, yeniden yazılmaması gereken yatırımın özeti:

- Tenant-bound `withAuth/withManage/withOwner` ve hassas admin API kapıları var. Admin/export ve impersonate için davranış testleri de var; eski metin taraması açığı güncel kodda düzeltilmiş.
- OAuth normal authorization-code akışı; org/user bağlı state ve şifreli credential saklama var. API yetkisi yokken Airbnb'ye giriş/scraping yoluna yönelmeye gerek yok.
- MessageOutbox, EmailOutbox, idempotency, claim ve belirsiz teslim durumları üzerinde ciddi çalışma yapılmış. F03-F05 bunların kaldırılmasını değil eksik yaşam döngüsü/yeni mesaj sınırlarının tamamlanmasını gerektiriyor.
- iCal HTTP hattında HTTPS/443, özel adres kontrolü, doğrulanan DNS adresine bağlanma, redirect takip etmeme ve byte/zaman bütçeleri var. Adapter refactor'u bunları bypass etmemeli.
- Private upload yolu tenant kontrolü ve sınırlı imzalı URL kullanıyor; storage yokken production'ın public/uploads'a sessiz düşmesi kapatılmış. Bucket'ın canlı politikası koddan kanıtlanamaz.
- Açık silme tombstone'u, erasure/export, retention, ayrı dallar için testler ve şema kapsam kanaryası mevcut. İsim silmek ile tüm kişisel veriyi anonimleştirmek aynı iddia olmamalı.
- m48 triage snapshot'ı ve stale göstergesi var. Değerli bir temel; teslimat yarışını veya generation tarihçesini tek başına çözmüyor.
- CSP tamamen kapalı değil: bazı temel direktifler enforce, geniş script/kaynak politikası report-only. Ölçüm verisini temizledikten sonra nonce tabanlı sıkılaştırma planlanmalı.
- Gerçek integration testler mevcut. Bu commit'te [tests/e2e](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/tests/e2e>) içinde iki spec dosyasında toplam yedi test tanımı var; bunlar ağırlıklı landing/login/security smoke. Ürünün bütün rezervasyon-mesaj-görev zincirinin browser-level kapsamı olduğu sonucuna varılamaz.
- Eski belgeler tarihsel kayıt: örneğin verify-email şu commit'te parola da istiyor. Eski "yalnız link ile hesap sahiplenme" anlatısını güncel açık diye raporlamadım. Durum belgeleri kod ve test kanıtıyla yenilenmeli.

## V0: Bağımsız Domain İçin Doğru Mimari

### Çekirdeği yeniden kurma; sahiplik sınırlarını netleştir

Mevcut entity isimleri gayet kullanılabilir. Guest, Issue veya Review ayrı tablo olacaksa gerekçesi lifecycle ve sorgu ihtiyacı olmalı; vizyon listesini tablo listesi sanma. Başlangıç için modular monolith mantıklı: bağımlılık yönü belirgin modüller, tek transaction sınırları, tek yetkilendirme politikası. Mikroservis sayısı ürün olgunluğu ölçüsü değil.

Mevcut bağımlılıklar somut:

| Nokta | Bugünkü varsayım | V0 yönü |
|---|---|---|
| Organization credential alanları | Org başına doğrudan Hospitable kolonları | Connection sahipliği ve generation; tokenlar connector sınırında |
| `Property.hospitableId @unique` | Tek sağlayıcının kimliği global kolon | Sağlayıcı/hesap kapsamı doğrulanmış external mapping |
| Reservation `sourceReference` | `(propertyId,sourceReference)` benzersizliği | Kaynak namespace'i, hesap, external tür/id birlikte tanımlı |
| Conversation `externalReservationId` | Hem Hospitable teslim hedefi hem QR sentinel | Yerel konuşma kimliği ile dış delivery target ayrımı |
| `sendOnChannel` | Channel adı yerine external ID varlığına göre Hospitable | Gerçek connection + capability ile dispatch |
| Tombstone ve outbox | Provider ref ve snapshot'a bağlı | Geçişte eski ve yeni identity bağları kaybolmamalı |

**Üç kavram aynı alan değil:** rezervasyonun satış kanalı, veriyi getiren connectivity provider ve senkronizasyon protokolü. Airbnb rezervasyonu Hospitable üzerinden gelebilir; iCal bir protokoldür, başlı başına satış kanalı değildir. Bunları tek `channel` enum'una sıkıştırmak ikinci entegrasyonda yeniden kırılır.

External ID'lerin global benzersizliğini tahmin etme. Minimum doğru scope, ilgili sağlayıcının belgelenmiş kontratına ve connection/account bağlamına göre belirlenmeli. İki sağlayıcı aynı `123` kimliğini kullanabilir. Aynı sağlayıcıdaki iki hesabın ID kapsamı da kanıtlanmalı. Booking/Airbnb kayıtlarını misafir adı, e-posta veya tarihler benziyor diye otomatik birleştirme.

### Adapter yalnız HTTP wrapper olmasın

Kontrat adları örnektir; mevcut facade genişletilebilir. Gerekli davranışlar:

- Yetki/capability: reservations-read, messages-read, messages-send, availability-read/write vb. Gerçekten desteklenmeyen yetenek açık typed sonuç dönsün.
- Normalleştirme: provider payload → doğrulanmış kanonik olay; core içinde provider payload parse edilmesin.
- Kimlik: tenant + connection + external mapping; destination'ı request body'den güvenerek alma.
- Hatalar: rate-limited, authentication-expired, permanently-rejected, transient, outcome-unknown ayrı olsun.
- Teslim: local-only, queued, provider-accepted, delivered, failed, unknown birbirine karışmasın. Sağlayıcı delivery receipt sunmuyorsa "teslim edildi" diye uydurma.
- Senkronizasyon: cursor, snapshot completeness, observedAt, source event ordering, replay/dedupe ve deletion semantics.
- Disconnect/reconnect: eski token/iş/olay yeni connection generation'ına yazamamalı.

[src/lib/messaging.ts:36](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/messaging.ts:36>) zaten bir facade. Bugün `channel` dispatch belirlemiyor; externalReservationId varsa Hospitable çağrılıyor, yoksa/QR ise `ok:true,skipped:true`. Bu davranışı anlamadan yeni adapter koymak local bir kaydı dışarı gönderme veya gönderilmemiş mesajı teslim sayma riski taşır.

### Veri geçişi expand → backfill → compare → switch

1. Envanter: bütün identity reader/writer, unique constraint, auth, destination, webhook, import, outbox ve tombstone bağımlılıkları.
2. Gerekirse additive alan/mapping ekle. Yerel ID'leri ve ilişkileri koru. Yeni altyapı ilk anda eski davranışa uyumlu olsun.
3. Backfill dry-run: toplam, eşleşmeyen, çatışan, birden çok hedefe giden kayıt; tenant bazında rapor. Tahmine dayalı merge yok.
4. Eski/yeni okuma sonuçlarını yan etkisiz karşılaştır. Bu **iki sağlayıcıya mesaj göndererek shadow test yapmak** değildir.
5. Tenant/connection bazlı kontrollü dispatch. Bir dış yan etkiye tek yetkili yazar.
6. Bekleyen eski outbox satırlarının hangi connection ile gönderileceği açık kalsın; isim/kolon değişti diye yanlış hesaba yönlenmesin.
7. Geri dönüş, eski executable'ın yeni additive şemayla çalışması ve işlemekte olan kuyruğu yanlış tekrar göndermemesiyle kanıtlansın.
8. Hospitable ancak native connector gerçek pilotu, mapping/parity ve kopma/yeniden bağlanma senaryoları geçtikten sonra kaldırılır. Faz 4 ve kolon temizliği bu işin ön koşulu değil.

V0 kabul testi: Aynı kanonik rezervasyon/mesaj akışı Hospitable ve sahte bir farklı sağlayıcı kontratıyla core'a aynı sonucu vermeli. Gerçek Airbnb endpoint'i veya OAuth scope'u erişim olmadan icat edilmemeli. iCal-only tenant, desteklemediği inbox yeteneğini vaat etmeden takvim/görev/operasyon ekranlarını kullanabilmeli.

## AI: RAG, Araçlar ve Hafıza

### Hangi veri nereden gelmeli?

| Soru/veri | Doğru kaynak | Modelin rolü |
|---|---|---|
| "3-4 Eylül boş mu?" | Yetkili, güncel takvim/availability servisi | Tarih niyetini çıkar, sonuçtan cevap yaz |
| Kapı kodu | Aktif konaklama yetkili secret servisi | Kendi başına erişim kararı vermez |
| Otopark/cihaz kullanımı | Property-scope sürümlü KB/RAG | Kaynaklı açıklama |
| Temizlik tamamlandı mı? | Task/TaskUpdate kanıtı | Durumu özetle, eksikse tamamlandı deme |
| "Havlular 18:00'e kadar" | Açık taahhüt kaydı + ilgili task | Takibi ve gecikmeyi açıklama |
| Eski sohbetin özeti | Aynı tenant/konaklamaya ait kaynaklı hafıza | Geçmişi sıkıştır; yeni kural icat etme |

RAG, bütün veritabanını modele gönderme ihtiyacını azaltabilir; halüsinasyonu veya prompt injection'ı ortadan kaldırmaz. Yetki ve hangi aracın çalışabileceği model metninin dışında uygulanmalı. [OWASP Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) bu ayrımı destekler.

Bugünkü hat güncel KB kayıtlarını sınırlı sayıda alıyor ve kategori düzeyinde source bilgisi kullanıyor. Bu, sorguya göre retrieval + item/version provenance ile aynı şey değil. İlk adım dev bir vektör altyapısı değil: doğru kapsam, yapılandırılmış gerçekler, full-text/lexical arama ve küçük ölçülebilir retrieval seti. Embedding/hybrid arama gerçekten fayda sağladığı eval sonuçlarıyla eklenebilir.

### Müsaitlik sözleşmesi

Kod tabanlı availability servisi property/tenant yetkisini kendi doğrulasın. Aralık yarı açık `[checkIn,checkOut)` olsun. Rezervasyon durumları, bloklar, hazırlık tamponu, unit kapasitesi, timezone ve kaynakların güncelliği hesaba katılsın. Sonuç `available / unavailable / unknown` ve `checkedAt`, veri kaynağı, coverage/freshness, gerekçe taşısın.

"Takvimde kayıt bulamadım" tek başına "boş" değildir. Kaynak senkronize değilse veya kapsanan tarih aralığı bilinmiyorsa `unknown`. Native write yetkisi yokken fiyat/rezervasyon kesinleştirme yapılıyormuş gibi davranma. Rezervasyon oluşturma ayrı işlem; availability okuması bir hold/garanti değildir. İleride write varsa inventory concurrency ve idempotency şarttır.

Belirsiz "3-4" ifadesinde her zaman soru sormak da her zaman bu ayı seçmek de yanlış. Konuşma/rezervasyon/bugünün property tarihinden güçlü çıkarım varsa açık ay-yılı cevapta teyit et. Geçmiş tarihe düşüyor, farklı aylar mümkün veya sonuç bir taahhüt doğuruyorsa tek kısa soru sor. Tarih varsayımının kendisi de trace'e kaydedilsin.

### Generation trace ve kalite konsolu

Her üretim için model/policy/prompt sürümü; tenant/property/reservation/conversation; giriş message ID'leri ve zamanları; seçilmiş kaynak ID/sürüm/alıntıları; araç parametreleri/sonuçları; risk ve gönderim kararı; taslak ve gerçekten gönderilen mesaj; latency/token/maliyet metadatası izlenebilir olmalı. Yalnız hash tutmak replay için yeterli değil; gereken snapshot veya sürümlü kaynak güvenli saklama politikasıyla tutulmalı. Modelin gizli düşünce zinciri istenmez/saklanmaz; kısa yapılandırılmış karar gerekçesi yeterli.

Kurucu kalite konsolu mevcut quality-audit üzerine kurulabilir: allowlist + güncel MFA/step-up ile yalnız açıkça yetkili superadmin. Tenant adminine çapraz erişim yok. Mesaj gönderme/guest adına işlem yapma API'si bu konsolda bulunmasın. Kalite etiketi ve iç düzeltme notu, misafire mesaj yazmaktan farklıdır. List/detail/export yetkisi ayrı doğrulansın; amaç ve başarılı/başarısız erişim kaydı zorunlu olsun.

Üretim sohbetini inceleme yetkisi, dış model eğitimi yetkisi değildir. Eval'e terfi bilinçli, redakte, kaynaklı ve geri izlenebilir olsun. Normal RAG/trace saklama süreleri, silme ve yedeklerden geri yükleme sonrası yeniden silme politikası kapsam içinde tasarlansın. Sadece KVKK metnine bir cümle eklemek teknik yetki ve veri kullanım koşullarını çözmez.

### İlk eval paketi

- Greeting ve zaman: ilk mesaj/10. mesaj/ertesi gün; iki kısa selam; kapanmış konu; zamanında teslim edilmeyen AI cevabı.
- Bağlam: ardışık üç mesaj, host araya girdi, 25 dışına taşan açık iade, çözülmüş eski şikâyet.
- Grounding: KB'de yok, iki KB çelişkili, eski bilgi, başka property'de doğru olan bilgi, araç kullanmadan müsaitlik iddiası.
- Yetki: yanlış tenant/property, doğrulanmamış QR, başka konaklamanın eski sohbeti, silinmiş kaynak, bağlantı kopması.
- Saldırgan metin: rol etiketi/başlık taklidi, KB içine talimat, Unicode, uzun gövde, çok dilli risk ve zararsız benzer kelimeler.
- Yan etki: çift webhook, provider timeout ardından retry, cancellation/new inbound yarışları, yanlış veya eksik tool output.

Ölçümler: desteklenmeyen olgusal iddia oranı, riskli autosend kaçırma, gereksiz escalation, retrieval recall@k, doğru tarih/araç seçimi, yanlış tenant verisi, p50/p95 latency ve konuşma başına maliyet. İlk release setinde tenant/sır ihlali ve test edilmiş kritik unsafe-send vakaları sıfır olmalı; bu, dünyadaki tüm girdiler için sıfır hata garantisi değildir. Model değişimi bu set üzerinden karşılaştırılsın, isim veya token penceresi üzerinden değil.

## Veritabanı ve Ölçek

1. Önce bounded query/cursor. Bütün konuşmayı DB'den alıp altıya indirmek yerine gerekli pencereyi, açık sorun durumunu ve summary'yi hedefli al. Büyük export'lar sayfalı/streaming ve sınırlı olsun.
2. Index'i sorgu planıyla seç. Property/status/date ve queue due-state iş yüklerini sentetik farklı tenant büyüklüklerinde `EXPLAIN` ile ölç. Mevcut indexleri tekrar ekleme; büyük prod indexleri için lock süresini planla.
3. Tenant-bound relational integrity. Cross-tenant foreign relation oluşmasını servis katmanında ve mümkün olan DB constraint'lerinde zorla. Her tabloya mekanik `organizationId` eklemek, backfill/consistency planı olmadan çözüm değildir.
4. Mesaj, outbox, sync event ve AI trace ayrı retention/büyüme profilleri taşısın. Arşiv/partition ancak ölçülen hacim gerektiriyorsa; baştan karmaşıklık yaratma.
5. Provider eventi durable kabul/dedupe sonrası işleyin; duplicate/out-of-order event `updatedAt` heuristiğiyle sessiz veri ezmesin. Kaynak revision ve domain revision ayrımı olsun.
6. Money için tek kanonik decimal/minor-unit + currency politikası. Float/Decimal ikiz kolonları canlı migration ve toplam-parite kanıtı olmadan temizleme. Kurlar farklı tarihliyse gelir metriğinde birleştirme kuralı açık olsun.
7. Tarih-only, planned check-out, actual check-out ve observedAt ayrı kavramlar. Tarih kolonlarının saat dilimi davranışı adapter kontratlarında pinlensin.
8. Connection bazlı token refresh, işler ve izinler; org başına tek provider token varsayımı büyümeyi engellemesin. Disconnect veriyi silme politikasıyla aynı olay değildir.
9. RLS savunma katmanı olabilir; connection pooling/Prisma ve job tenant context testleri olmadan tek hamlede zorunlu geçiş önermiyorum. Önce mevcut tenant kapılarının davranış kanıtı güçlensin.
10. Yedek: DB + nesneler + güvenli anahtar yedeği + migration sürümü + gerçek izole restore provası. `pg_restore -l` arşiv kataloğunun okunmasını, SHA256 bütünlüğünü gösterir; uygulamanın geri ayağa kalkabildiğini tek başına kanıtlamaz.

## İşletim ve Yayın Kapıları

- Ortam değişkenlerini doğrulama, şemaya dokunan başlangıç adımından önce gelsin. Docker başlangıcı `prisma migrate deploy` ardından uygulamayı açıyor; geç env hatası migration'dan sonra fark edilebilir. CI drift kontrolü prod migration kilit/geri dönüş provası değildir.
- Mutlak "nullable ADD COLUMN güvenlidir, kilit yok" denmesin. DDL yine lock alır; lock/statement timeout ve bekleyen işlem gözlemi planlansın.
- CI ve image bağımlılıklarında sabit sürüm/digest politikası, SBOM, secret scanning, prod bağımlılığı yanında build-chain taraması ve sahipli süreli risk kabulü olsun. Registry audit, container OS ve uygulama pentesti yerine geçmez.
- Repo'nun private olması güzel bir erişim sınırı; bilinen blacklist'in gizli kalmasına güvenlik dayandırma. Kod biliniyorken de yetki/sır sınırları çalışmalı.
- Prod smoke yalnız durum kodu olmamalı: yanlış tenant'ta veri/yan etki yokluğu, gerçekten korunan bucket, güncel proxy zinciri ve CSP sink gizliliği ölçülsün. Bu rapor bunların canlı yapıldığını söylemiyor.
- OAuth/webhook auth hataları PII'siz oran alarmı ve sağlayıcı drift ölçümüyle izlenmeli. Her sahte imzada pahalı e-posta göndermek alarm DoS'u yaratır.
- Billing için tek status matrix çıkarılsın. [src/lib/payments/paddle.ts:164](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/payments/paddle.ts:164>) ve [src/lib/billing/subscription.ts:126](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/lib/billing/subscription.ts:126>) birlikte okunduğunda paused/unknown → past_due → grace davranışı hâlâ var; gerçek dunning ile bilinmeyen provider durumunu ayırmak gerekiyor. Trial geçişi ve uygulama içi tahsilat onay kaydı için önceki belgeler koddan yeniden değerlendirilsin. Buna karşılık eski "geçersiz webhook imzası sessiz" maddesi aynen tekrar edilmemeli: [src/app/api/webhooks/paddle/route.ts:486](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/work/latest-linecount-73dbfb4/src/app/api/webhooks/paddle/route.ts:486>) biçimi uygun fakat yanlış imzaya artık alarm üretiyor. Bu tur ödeme işlemi/hesap ayarı değiştirilmedi.

## Airbnb Başvurusu

5 Eylül 2026'da incelenen [Airbnb API Terms](https://www.airbnb.com/help/article/3418), 15 Ekim 2025 güncellemesini gösteriyor. §1.3 veri güvenliği incelemesi ve program/sözleşme koşulları; §1.5 istenirse temsili demo hesap; §2.3 MFA, asgari yetki, güvenlik taramaları ve işletim gerekliliklerini içeriyor. Taramalar en az üç aylık; düzeltme süreleri kritik/yüksek/orta/düşük için 7/30/90/180 gün. Bildirim süreleri olay türüne göre 1 veya 24 saat; hepsi için aynı süre denmemeli. API scope'larını Airbnb belirliyor; bunları tamamlamak kabul garantisi değil.

Aynı metindeki §2.1–2.2 ve §2.4 veri kullanımını sınırlıyor; partner-özel anlaşmalar önemli. Bu nedenle Revenue Brain, geniş analiz, kalıcı eval ve üçüncü taraf AI veri akışları otomatik izinli sayılmamalı. Benim önerim, ürünün kaynak bazlı amaç/izin politikasını mimariye eklemek ve başvuruda netleştirmek. İncelenen genel metinden zorunlu 100 property eşiği çıkarmıyorum; program koşulları ayrıca doğrulanmalı. Bu bölüm hukuki uygunluk onayı değildir. [Kaynak](https://www.airbnb.com/help/article/3418).

**Benim teknik hazırlık dosyası önerim** aşağıdadır; bu tablo Airbnb'nin ilan ettiği eksiksiz resmi kontrol listesi değildir:

| Dosya/kanıt | Beklenen içerik |
|---|---|
| Mimari ve data-flow | Provider → doğrulama → kanonik kayıt → AI/tools → outbox → alıcı; sır/PII sınırları |
| Erişim matrisi | Founder, tenant owner/manager/staff, guest, job; MFA ve çapraz erişim kanıtı |
| Kaynak/amaç matrisi | Host tarafından girilen, connector'dan gelen, türetilen veri; izinli kullanım ve retention |
| Güvenlik doğrulaması | Bu rapordaki P1 kapanışları; test/commit/CI kanıtı; kalan risk sahibi |
| İşletim | Secret rotation/disconnect, olay müdahalesi, yedek+restore, iş sürekliliği |
| Demo tenant | Sentetik ama temsili mülk, rezervasyon, sohbet, görev ve sorun; hiçbir gerçek sırrı içermez |
| Ürün kanıtı | Aktif kullanım, sync freshness, teslimat/yanlış gönderim, task completion, uptime ve müşteri geri bildirimi |
| API talebi | İstenen gerçek yetenekler, host akışı, desteklenmeyen scope'ta doğru ürün davranışı |

[OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) maddelerini bu kanıtlarla eşleştirmek, yalnız "OWASP uyumlu" yazmaktan daha işe yarar. Bu benim denetlenebilirlik önerimdir; tamamlanmış ASVS sertifikasyonu iddiası değildir.

## MVP'ye Giden Sıra

### A. Güvenli temel

F01–F08 öncelikli; F09/F10 log sınırı ve F12 audit kontratı bunlarla yakın ele alınabilir. Önce ilgili davranışı kırmızı testte göster, küçük kapsamlı düzelt, meşru kullanım kontrolünü koru. Ayrıcalık, silme veya yanlış gönderim sorununu güzel UI ile örtme.

### B. V0 kimlik ve bağlantı bağımsızlığı

Yukarıdaki identity mapping + connection generation + capability + dispatch sınırlarını kur. Eski/yeni parite, pending outbox, reconnect ve silme kanıtlarıyla ilerle. Hospitable canlı bridge kalsın. iCal-only akış gerçek yetenekleriyle çalışsın.

### C. Doğru cevap veren AI MVP

Property-scope onaylı KB, deterministik availability, structured history, açık sorun/taahhüt durumu, generation trace, read-only kurucu kalite konsolu ve eval release gate. Bunlar oturunca hybrid RAG/model seçimi ölçülerek geliştirilsin.

### D. Operasyonel zekâ

Property Memory kaynaklı ve zamanlı olsun; Exception Feed açık riskleri/taahhütleri birleştirsin. Task creation, mevcut dedupe/izin kurallarıyla idempotent action olarak çalışsın. Proof AI bir fotoğraftan işin tamamlandığını kesinleştirmesin; gözlem, insan beyanı ve doğrulama ayrı gösterilsin.

### E. Native kanal pilotu ve başvuru kanıtı

Gerçek kullanım ve güvenlik işletimini göster; yalnız mülk sayısını veya kod satırını hedefleme. Yetki verilince native bağlantı küçük pilotta mapping, reconnect, duplicate/out-of-order, cancellation ve delivery testlerinden geçsin. Bridge'i bu kanıt olmadan sökme.

### Sonraya bırakılabilecekler

Geniş Revenue Brain, otomatik fiyat değiştirme, gelişmiş cross-property tahminler, fine-tuning, çok sayıda PMS connector'ı, mikroservis dönüşümü ve dekoratif panel turu MVP'nin kapısı değil. Bunlar yasak özellikler değil; veri doğruluğu/izin/etki ölçümü henüz yokken erken yatırım olur.

WhatsApp/n8n ayrı opsiyonel bildirim taşıyıcısı kalabilir. Core business logic ve kaynak gerçekliği n8n'e taşınmasın; eventId, tenant-bound alıcı, opt-in tercihleri, imza/replay/dedupe, retry, az veri ve deep-link kullansın. Tam misafir sohbetini dış otomasyon loguna varsayılan olarak kopyalama. `lixus-automations` ile ana PMS deposunun yetkileri ayrı kalmalı.

## Kapanış ve Kanıt Dosyaları

[probe-results.json](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/probe-results.json>): 15 yeniden üretimin sonucu ve her birinin sınırı.
[probes.cjs](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/probes.cjs>): çevrimdışı kanıtların gerçek kaynak çağrıları ve sahteleri.
[static-scan.json](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/static-scan.json>): dosya başına AST sinyalleri; alarm listesi açık listesi değildir.
[inventory.json](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/inventory.json>) / [coverage.md](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/coverage.md>): hash envanteri ve inceleme seviyesi.
[CLAUDE-HANDOFF.md](<C:/Users/MUSA CINAR/Documents/Codex/2026-07-02/you-are-connected-to-this-repository/outputs/audit-73dbfb4-2026-09-05/CLAUDE-HANDOFF.md>): uygulanabilir görev ve doğrulama sözleşmesi.

**Sonuç:** Projeyi büyütmek için önce veri/yetki/teslimat sözleşmelerini sertleştirmek, sonra kanala bağımsız çekirdek ve kanıtlı AI hattı kurmak gerekiyor. Başka PMS'lerin üzerindeki bir wrapper olmama hedefi mantıklı. En büyük kazanç daha çok sınıf veya daha uzun prompt değil; aynı işin doğru tenant'ta, doğru veriye dayanarak, doğru zamanda ve yalnız bir kez yapılmasını kanıtlamak olacak.
