> Kaynak: Opus 5.5 ikinci dilim incelemesi (10-28), oturum notundan AYNEN taşındı (kurucu: ".md'ye yığma, taşı, silme"). Durum sütunu 10-28 sonu
> itibarıyla güncellendi: R1–R5/R9 `3c909217`/`91dd5edc`, R16/R18/R21 `ac4bfa66` (+ pin, mutasyon 9/9). Kalan AÇIK maddeler sıradaki dilimin işidir.

# Opus 5.5 derin inceleme — 8f45cb87 + 5f0b2ec2 (10-23 akşam dilimi)

Kapsam: `git diff 8f45cb87~1 5f0b2ec2`. Test koşulmadı; saf fonksiyonlar `npx tsx` ile ölçüldü.

## Bulgular (ilerledikçe)

Ölçüm yöntemi: eski hâl `git show 8f45cb87~1:src/lib/ai/absence.ts` ayrı kopyada, yeni hâl çalışma ağacında; aynı cümle iki sürümde
`refersGuestToHost` ile koşuldu (old / now). "HOLD" = yönlendirme sayıldı (misafire gitmez), "go" = gider.

### R1 — P1 — `src/lib/ai/absence.ts:756-767, 847-849` — VARIŞ muafiyeti yeni bir GERİLEME: bilgi yönlendirmesi "varınca / before arrival" ile geçiyor
A4 muafiyeti `ARRIVAL_INSTRUCTION && !INFO_VERB`. `INFO_VERB` yalnız "ask / sor / danış / öğren / teyit…" — "contact / message / write /
görüş / yaz / iletişime geç / mesaj at" yok. Cümlede konu ("otopark için", "for the pool hours", "about the parking") olsa da varış sözcüğü
bütün cümleyi muaf tutuyor. Ölçüldü (old → now):
- "For parking, please contact your host before arrival." HOLD → **go**
- "Regarding the parking, please message your host upon arrival." HOLD → **go**
- "Before your arrival, please contact your host about the parking." HOLD → **go**
- "For the pool hours, please message your host before arrival." HOLD → **go**
- "Please contact your host before arrival to confirm whether parking is available." HOLD → **go**
- "Otopark konusunda varınca ev sahibinizle görüşebilirsiniz." HOLD → **go**
- "Otopark için gelmeden önce ev sahibinize yazabilirsiniz." HOLD → **go**
- "Otopark ve havuz hakkında, girişten önce ev sahibinizle iletişime geçebilirsiniz." HOLD → **go**
- "Erken giriş mümkün olup olmadığı için gelmeden önce ev sahibinizle iletişime geçin." HOLD → **go**
- "Bebek yatağı için varış saatinizle birlikte ev sahibinize yazabilirsiniz." HOLD → **go**
- "Pls contact your host when you arrive about the parking spot." HOLD → **go**
Beklenen: hepsi HOLD (kurucu 4.5: bilgi için ev sahibine gönderen cümle gitmez). Testteki kontroller ("Please text your host when you
arrive", "…tahmini varış saatinizi yazın") konusuz. Düzeltme: muafiyet yalnız cümlede KONU / bilgi nesnesi yokken (ör. "için / hakkında /
konusunda / about / regarding / for the X / to confirm / whether" yoksa) ya da varış talimatının NESNESİ varış saati / ETA / "geldiğinizi"
ise; en basiti: varış muafiyetinde `INFO_CONDITION`'a ek olarak bir KONU işareti (`için|hakkında|konusunda|about|regarding|for (?:the )?\p{L}|whether|to confirm`) varsa muafiyet yok.

### R2 — P1 — `absence.ts:746-753, 848` — OLAY sözcüğü cümlenin HERHANGİ bir yerinde aranıyor; konu adı olan "alarm / fire / yangın / acil / çalışma (saatleri)" ihtiyaç koşulunu yeniden muaf yapıyor (A1 düzeltmesinin deliği)
`EVENT_CONDITION.test(f) && EVENT_WORDS.test(f)` — ikisi de bütün cümlede, birbirinden bağımsız. `[çc]al[ıi][şs]ma\p{L}{0,12}` ise
"çalışma saatleri" ADINI (açılış saatleri) yakalar, fiilin olumsuzunu ("çalışmıyorsa") yakalamaz. Ölçüldü (now; eski sürümde de gidiyordu —
A1'in kapatmayı iddia ettiği sınıf):
- "Spor salonunun çalışma saatlerini öğrenmek isterseniz ev sahibinize sorabilirsiniz." → **go**
- "Havuzun çalışma saatleri konusunda emin olmak isterseniz ev sahibinize danışabilirsiniz." → **go**
- "Yangın söndürücü konusunda emin olmak isterseniz ev sahibinize sorabilirsiniz." → **go**
- "Alarm şifresini öğrenmek isterseniz ev sahibinize sorabilirsiniz." → **go** (erişim sırrı!)
- "If you need the alarm code, please ask your host." → **go**
- "If you'd like to know whether there is a fire alarm, please ask your host." → **go**
- "If you'd like to use the fire pit, check with your host." → **go**
- "Acil çıkış kapısının yerini öğrenmek isterseniz ev sahibinize sorabilirsiniz." → **go**
- "Of course, for the alarm code please ask your host." → **go** ("course" `\p{L}rse` koşul ekine uyuyor — ayrıca bkz. R9)
- "Perdone, si quiere saber el horario de la piscina, pregunte a su anfitrión." → **go** (`perd\p{L}{0,6}` "perdone"yi yakalar)
- "If you want to know about the lost and found, ask your host." → **go**
Beklenen: HOLD. Düzeltme: (1) olay sözcüğü KOŞUL YAN CÜMLESİNDE aranmalı (koşul işaretinden sonraki ilk yan cümle / "-rsa" ekli sözcükten
önceki ≤4 sözcük); (2) olay sözcüğü olay YÜKLEMİ olmalı: "alarm" yalnız "goes off / çalarsa / öterse", "fire" yalnız "in case of fire / a fire
breaks out", "çalışma\p{L}" yerine `çal[ıi][şs]m(?:[ıi]yor|az)\p{L}*`; (3) koşulda bilgi İSTEME fiili ("öğrenmek / emin olmak / know /
saber / need the") varsa muafiyet yok (INFO_VERB'i olay dalına da uygula).

### R3 — P2 (b, gereksiz tutma, GERİLEME) — `absence.ts:746-753` — gerçek olay / arıza talimatlarının çoğu EVENT_WORDS'te yok → artık tutuluyor
Ölçüldü (old → now): "If you have a problem with the heating, call your host." go → **HOLD** · "Herhangi bir sorun olursa ev sahibinizi
arayın." go → **HOLD** · "Bir sorun yaşarsanız ev sahibinizi arayabilirsiniz." go → **HOLD** · "If anything goes wrong during your stay,
please contact your host." go → **HOLD** · "If there is any issue with the apartment, call your host." go → **HOLD** · "If the power goes
out, contact your host." go → **HOLD** · "If the boiler breaks, call your host." go → **HOLD** · "Elektrikler giderse ev sahibinizi arayın."
go → **HOLD** · "Kombi su akıtırsa ev sahibinizi arayın." go → **HOLD** · "Klima çalışmıyorsa ev sahibinize yazın." go → **HOLD** · "If you
can't open the door, call your host." go → **HOLD** · "Should the hot water stop, message your host." go → **HOLD**.
Ayrıca dosyadaki yorum "Wi-Fi çalışmazsa … ev sahibinizi arayın bilgi tabanındaki talimattır" diyor ama "Wi-Fi çalışmazsa ev sahibinizi
arayın." eski ve yeni sürümde **HOLD**: `EVENT_CONDITION` olumsuz koşul ekini (-mazsa / -mezse / -mazsanız: "çalışmazsa", "gelmezse",
"açamazsanız") tanımıyor (`\p{L}(?:rsan[ıi]z|rseniz|rsa|rse)` yalnız -rsa/-rse). Kurucu kuralı: olay / arıza koşullu talimat GİDER. "Bir sorun
olursa ev sahibinizi arayın" cevap sonlarında çok yaygın → bütün cevap tutuluyor. Düzeltme: EVENT_WORDS'e "sorun\p{L}{0,6} (?:olursa|yaşarsanız|çıkarsa)
· problem · issue · goes wrong · goes out · breaks? · stops? · can'?t open · elektrik gider · su akıt · -m[ıi]yorsa · -mazsa" ve EVENT_CONDITION'a
`\p{L}(?:zsa|zse|zsan[ıi]z|zseniz)(?![\p{L}])`. Bu kurucuya dokunan bir oran değişikliğidir — tutma oranı ölçülüp sorulmalı.

### R4 — P2 (b, GERİLEME) — `absence.ts:769-774, 834` — istenen telefonu veren cümle yan cümle / satır bölmesi yüzünden tutuluyor
`contactValueInReferralClause` virgül / "and / ve" ile böler; `lines` satır sonundan sonra RAKAM gelirse cümle sınırı koyar. Ölçüldü (old → now):
- "Ev sahibinize şu numaradan ulaşabilirsiniz:\n0532 123 45 67" go → **HOLD** (satır sonu + rakam = yeni cümle)
- "Ev sahibinize ulaşabilirsiniz, telefon: 0532 123 45 67" go → **HOLD**
- "You can call your host, the number is +90 532 123 4567." go → **HOLD**
- "You can reach your host on WhatsApp, +90 532 123 45 67." go → **HOLD**
- "Your host's number is +90 532 123 45 67 and you can call your host anytime." go → **HOLD**
Kurucu: "istenen telefon değerini veren cümle gider" (onaylı konaklamada). Misafir "ev sahibinin numarası?" diye sorduğunda model en çok bu
biçimleri yazar (iki nokta + yeni satır çok yaygın). Düzeltme: yönlendirme yan cümlesi iletişim değeri taşımıyorsa KOMŞU yan cümleye / bir
sonraki satıra bak — yalnız o komşu parça KONU taşımıyorsa (yalnız "telefon / number / WhatsApp / numara" + değer) muaf; satır sonu
bölmesinde rakamla başlayan satırı (telefon) önceki satıra bağla (`\p{N}` sınıfını madde işareti sayma ya da "1." / "1)" biçimine daralt).

### R5 — P2 (c) — `absence.ts:834` — satır sonu dönüştürmesi KARESEL; süre pini bunu ölçmüyor (yanlış güvence)
`/\n+(?=[^\S\n]*[-•*–\p{N}\p{Lu}])/gu`: `\n` dizisinin her başlangıcında `\n+` sona kadar yer, ileri bakış düşer, geri adım adım iner →
k uzunluklu satır sonu dizisinde O(k²). Ölçüldü (`"\n".repeat(n) + "a"`): n=4.000 → 127 ms · 20.000 → 1.726 ms · 50.000 → 10.528 ms;
`admitsMissingKnowledge` (iç çağrıyla) 4.000 → 188 ms, 50.000 → 10.804 ms. Pin (`absence-host-referral.test.ts`) yalnız `"\n ".repeat(25_000)`
(satır sonu + boşluk dönüşümlü) ölçüyor — o doğrusal (3,6 ms); saf `\n` dizisi ölçülmüyor. Erişim: model cevabı (4.000'e kadar saklanır →
~130–190 ms / çağrı, kapıda birkaç kez çağrılıyor) ve `decisions/text-check.ts:155` (ev sahibinin 10.000 karakterlik gövdesi, `trim` iç
satır sonlarını silmez → ~0,5 sn). Düzeltme: önce satır sonu dizilerini teke indir (`replace(/\n(?:[^\S\n]*\n)+/g, "\n")` doğrusal) ya da
`split("\n")` ile satır satır kur; pine `"\n".repeat(50_000) + "a"` ekle.

> Not: "R9" (yukarıda R2'de anılan "Of course" / `\p{L}rse` sahte koşul eki) koordinatörün düzeltmesinde ses uyumuyla kapatıldı (3c909217).

---
## İkinci tur — düzeltilmiş `absence.ts` (HEAD 91dd5edc) yeniden ölçüm
Satır sonu artık doğrusal: `"\n".repeat(50_000)+"a"` + `"a\n"` + `"1)\n"` dizileri toplam 34,8 ms (önce 10,5 sn). R1–R5'in kendi örnekleri geçiyor.
Yeni / kalan açıklar:

### R10 — P2 (a, R4 düzeltmesinin GERİLEMESİ) — `absence.ts contactValueInReferralClause` + `TOPIC_MARKER` — konu BELİRTME HÂLİNDE yazılınca ("Otoparkı / Havuz saatlerini / the pool hours") cümle "konusuz" sayılıyor, başka bir numara yönlendirmeyi kurtarıyor
`if (!TOPIC_MARKER.test(form) && containsContactValue(form)) return true;` — TOPIC_MARKER yalnız "için / hakkında / about / for X…" arar.
Türkçede konu çoğu zaman nesnedir. Ölçüldü (HEAD → go; 5f0b2ec2'de yan cümle bölmesiyle HOLD idi):
- "Otoparkı ev sahibinize sorabilirsiniz, resepsiyonun numarası 0212 555 66 77." → **go**
- "Havuz saatlerini ev sahibinize sorabilirsiniz; resepsiyon: 0212 555 66 77" → **go**
- "Please ask your host the pool hours; the front desk number is +90 212 555 66 77." → **go**
- "Kahvaltı saatlerini ev sahibinize iletebilirsiniz, ulaşamazsanız 0532 123 45 67." → **go**
Düzeltme: "konusuz" muafiyeti yalnız BİLGİ İSTEME fiili (sor / ask / danış / ilet / öğren — `INFO_VERB` + ilet) YOKKEN ve yönlendirme yan cümlesinin
dışındaki parça yalnız iletişim etiketi + değer ise ("telefon: / numara / number is / WhatsApp" + değer); yani "ulaşabilirsiniz / arayabilirsiniz /
call / reach" + değer → gider, "sorabilirsiniz / ask" + başka yan cümlede değer → tutar.

### R11 — P2 (a, R1 kalıntısı) — varış muafiyeti nesne biçimli konuda hâlâ geçiyor
- "Otopark yerini gelmeden önce ev sahibinizle görüşün." → **go**
- "Havuzun açılış saatini varınca ev sahibinizle konuşabilirsiniz." → **go**
`TOPIC_MARKER` ilgeç arar; belirtme hâli nesnesi + görüş / konuş / yaz / ara fiili muafiyeti alıyor. Düzeltme: varış muafiyeti yalnız nesne
varış bilgisinin kendisiyse (varış saati / ETA / "geldiğinizi" / "vardığınızı") ya da fiil "arayın / yazın / haber verin" + nesnesiz; aksi hâlde
tut. En güvenlisi: varış muafiyetine izin listesi (nesne ∈ {varış saati, tahmini varış, geliş saati, ETA, arrival time, "when you arrive" + ara/yaz}).

### R12 — P2 (a) — olay muafiyeti hâlâ CÜMLE düzeyinde: aynı cümledeki ikinci (olay) yan cümle bilgi yönlendirmesini kurtarıyor
- "Havuz saatlerini ev sahibinize sorabilirsiniz, herhangi bir sorun olursa da kendisine ulaşabilirsiniz." → **go**
- "Otopark için ev sahibinize sorabilirsiniz; anahtarı kaybederseniz de ev sahibinizi arayın." → **go**
(İngilizce eşi "For the pool hours please ask your host, and if anything breaks, call them." yalnız `WHETHER_IF` tesadüfen "ask … if"i
"whether" yaptığı için HOLD.) Bu, cevap sonuna eklenen en doğal Türkçe kapanış kalıbıdır. Düzeltme: muafiyet yan cümle düzeyinde —
`CLAUSE_SPLIT` ile bölünmüş her yönlendirme yan cümlesi KENDİ içinde olay / varış koşulu taşımalı (ya da koşul yan cümlesi doğrudan ondan önce
gelmeli); bir yan cümle bile koşulsuz bilgi yönlendirmesiyse tut.

### R13 — P2 (b, R2 düzeltmesinin yan etkisi) — `INFO_CONDITION` bütün cümlede aranıyor; "let them know / so they know / with the details" olay talimatını tutuyor
- "If you lose the key, call your host and let them know." → **HOLD** (beklenen go)
- "If anything breaks, please contact your host so they know." → **HOLD**
- "If the Wi-Fi stops working, message your host with the details." → **HOLD**
- "Bir sorun olursa ev sahibinizi arayıp bilgi verebilirsiniz." → **HOLD** (ayrıca VERB_TR "bilgi …verebilir" misafirin BİLGİ VERMESİNİ de yönlendirme sayıyor — eskiden beri)
Düzeltme: `INFO_CONDITION` yalnız KOŞUL yan cümlesinde (koşul işaretinden yönlendirme fiiline kadar) aranmalı; "let (?:them|your host|us) know"
silinip öyle okunmalı.

### R14 — P3 (a) — `EVENT_WORDS` geniş kalan iki biçim
- "If you need a break from the city, ask your host for tips." → **go** (`breaks?` tekil "break" adını yakalar)
- "If you have any issues with the check-in time, please ask your host." → **go** (`issues?` her "sorun" ifadesini olay sayar; konu "check-in
time" bilgi sorusudur)
Düzeltme: "break" yalnız "breaks / broke / breaks down / is broken"; "issues / problems" yalnız ardından "with the (cihaz / daire / Wi-Fi / kapı …)"
ya da "olursa" türünde; ya da R12'deki yan cümle düzeyi + `TOPIC_MARKER` olay dalında da uygulanır ("with the check-in time" konu).

---
## (b) `src/lib/ai/answer-binding.ts` — PLACE_SEP / closedIsNotPredicate / SITE_GENITIVE
(ölçüm `checkAnswerBinding({part, evidence: src, sourceText: src, needTerms: ["havuz"]})`; dosya 5f0b2ec2'den beri değişmedi)

### R15 — P2 (a) — E1 düzeltmesi yalnız YERLER arasında ayraç koyuyor; aynı yerin (cümlenin) içindeki tire / parantez / eğik çizgi / madde işareti / noktalamasız yazımda "kapalı" yine sonraki tesis adına SIFAT sayılıyor → "Havuz açık." DOĞRULANIYOR
Ölçüldü (issues boş = parça doğrulandı, misafire gider):
- "Havuz şu an kapalı - havuz havluları dolaptadır." → `[]`
- "Havuz şu an kapalı (havuz havluları dolapta)." → `[]`
- "Havuz şu an kapalı / havuz havluları dolaptadır." → `[]`
- "Havuz Ekim'de kapalı • Havuz havluları dolaptadır." → `[]`
- "Havuz şu an kapalı havuz havluları dolaptadır." → `[]`
(Kontrol: nokta / satır sonu / noktalı virgül / virgül olan biçimler `polarity_mismatch` veriyor.) Ev sahibinin elle yazdığı / içe aktarılan
madde listeli bilgi tabanında tire ve "•" çok yaygın. Kök: `closedIsNotPredicate` "kapalı + INDOOR_NOUN" → sıfat; tesis adı "kapalı"dan ÖNCE
aynı yan cümlede geçmişse (özne zaten söylendi) "kapalı" o öznenin yüklemidir. Düzeltme: `tokens[0..i-1]` içinde INDOOR_NOUN / konu adı varsa
(ve aralarında başka yüklem yoksa) `false` döndür (yüklem); ayrıca `tokenize` öncesi " - ", "(", "/", "•", "–" yan cümle ayracı sayılsın.
Yeni `SITE_GENITIVE` dalı yalnız tutma yönünde değişiklik yapıyor ("Ayrıca kapalı yüzme havuzu açıktır" artık `polarity_mismatch` — sıfat
okuması kaybolur, P3 b).

---
## (c) `src/lib/conversation-items/pet-policy.ts` + kanal / QR bağlantısı

### R16 — P1 (a) — `kbPetsFreeAllowed`: İSTİSNA sözcüğü (hariç / dışında / außer / sauf / excepto / excluding / excluded) koşul sayılmıyor; tür uyuşmazlığı hiç denetlenmiyor
Ölçüldü — `kbPetsFreeAllowed` **true** ("ücretsiz koşulsuz kabul") dönüyor:
"Evcil hayvanlar ücretsiz kabul edilir, köpekler hariç." · "… (köpekler hariç)." · "…; köpekler dışında." · "Haustiere sind kostenlos
willkommen, außer Hunde." · "Animaux acceptés gratuitement, sauf les chiens." · "Mascotas bienvenidas gratis, excepto perros." · "Pets are
welcome free of charge, excluding dogs." / "…, dogs excluded." · "Kediler ücretsiz kabul edilir." (yalnız kedi).
Zincir ölçüldü: misafir "Can we bring our puppy?" → cevap "Evet, köpeğinizi ücretsiz getirebilirsiniz." → `petReplyStraysFromFreeKb` false →
`autoReplyGateVerdict(..., {petsFreeAllowed: true})` **null** (öğe kipinde de, değilken de) → GİDER. Bilgi tabanı köpeği açıkça dışlamışken
misafire "evet". Düzeltme: CONDITION'a `hari[cç]|d[ıi][şs][ıi]nda|au(?:ss|ß)er|sauf|excepto|salvo|menos|excluding|excluded|except|кроме`;
ve tür kuralı: kalem tek bir TÜR adıyorsa (SPECIES eşleşmesi 1) ve "evcil hayvan / pets" genel adı yoksa yalnız o tür için evet — cevapta ya da
misafir mesajında başka tür geçiyorsa (SPECIES farkı) tut.

### R17 — P2 (a) — `kbPetsFreeAllowed`: yaygın kısıt biçimleri koşul sayılmıyor → "Evet, getirebilirsiniz" kısıtı düşürerek gider
true dönenler (ölçüldü): "Evcil hayvanlar ücretsiz kabul edilir; yatak odasına alınmaz." · "…; yatak odasına girmemeleri rica olunur." ·
"…, kanepelere çıkmasınlar." · "… Hasarlar misafire faturalandırılır." · "Pets are welcome free of charge. Guests are liable for any damage." ·
"… Bir defada tek hayvan." Kurucu 4.4: yalnız "koşul yazmıyorsa". NEGATIVE `alınmaz / girmemeli / -masınlar / rica` biçimlerini, CONDITION
"tek hayvan / liable / damage / hasar / fatura" sözcüklerini tanımıyor. Düzeltme: NEGATIVE'e Türkçe olumsuz geniş zaman / emir genel kalıbı
(`\p{L}+(?:maz|mez)(?![\p{L}])`, `-m[ae]s[ıi]nlar`, `rica olunur`), CONDITION'a `hasar|fatura|liable|damage|tek (?:bir )?hayvan`.

### R18 — P1 (a) — ÖĞE KİPİNDE (canlı: `AI_CONVERSATION_ITEMS_ENABLED=1`) B4 cevap denetimi DEVRE DIŞI: hayvanı anmayan cümle hiç okunmuyor
`automation.ts:614` `const petTurn = !items && mentionsPets(guestMessage)`; yorum "öğe kipinde evcil hayvan isteği zaten ayrı öğe olarak
tutulur" diyor — ama `petsFreeAllowed === true` iken `core.ts:382` evcil hayvan öğesinin hassasiyeti "none" (cevaplanabilir) ve `:393` kelime
etiketi de atlanıyor. Yani B4'ün asıl hedefi olan "bilgi tabanı ücretsiz kabul diyor ama model ters / ücretli yazdı" durumu öğe kipinde
denetlenmiyor. Ölçüldü (`items: {held: [], paymentHeld: false, answerableKinds: ["pets"]}`, `answeredRequests: {ok, refs: ["R1"]}`,
`petsFreeAllowed: true`, misafir "Can we bring our puppy?"):
- "Evet, getirebilirsiniz. Gecelik ücret 200 TL'dir." → öğe kipi **null (gider)** · öğesiz `reply_pet_policy`
- "Maalesef kabul edemiyoruz." → öğe kipi **null** · öğesiz `reply_pet_policy`
Düzeltme: öğe kipinde de evcil hayvan öğesi cevaplanabilir sayıldıysa (`answerableKinds` "pets" içeriyorsa) `petTurn = true`.

### R19 — P2 (a) — `petReplyStraysFromFreeKb`: hayvanı anmayan cümlede TUTAR / rakam ve yaygın olumsuzlar okunmuyor
`petTurn` dalı yalnız `NEGATIVE || FEE_WORD` arıyor (CONDITION / rakam yok). Ölçüldü (petTurn=true → `false`, öğesiz kapı da null):
"Evet, getirebilirsiniz. Kaparo 500 TL." · "Evet, getirebilirsiniz. Ek olarak 50 € alınır." · "Yes, you can bring your dog. There's an extra
€20 per night." · "Yes, bring him along! Just pay $30 at check-in." · "Evet, getirebilirsiniz. Giriş sırasında 300 TL ödemeniz yeterli." ·
"Evet, getirebilirsiniz, iki köpeğe kadar." · olumsuz: "Bunu kabul edemeyiz." · "Ne yazık ki mümkün olmuyor." (NEGATIVE "edemiyoruz"u tanıyor,
"edemeyiz / olmuyor"u değil). Bilgi tabanı ücretsiz derken uydurulmuş bir ÜCRET misafire gidiyor. Düzeltme: petTurn dalında para birimi
/ tutar (`\p{Nd}+\s*(?:tl|try|₺|€|eur|\$|usd|£)` ya da tersi), "öde / pay / kaparo / extra / ek olarak / kadar" ve NEGATIVE'e
`edemeyiz|olmuyor|mümkün değil|not possible|can t accommodate`.

### R20 — P3 (b) — QR: misafir mesajı hayvan anıyorsa hayvansız cevap da tutuluyor
`guest-chat-gate.ts:390` `(mentionsPets(result.reply) || mentionsPets(message)) && petsFreeAllowed !== true` → "Köpeğimle geliyorum, otopark var
mı?" → "Evet, ücretsiz otopark var." tutulur. Güvenli yön; kurucuya oran olarak bildirilmeli.

---
## (d) `src/lib/automation.ts` — imza iletişim kemeri + kota

### R21 — P2 (a) — kapanış nezaketinde yalnız İMZA denetleniyor; ev sahibinin ÖZEL nezaket metni (`closingReplyText`) iletişim değeri taşıyabilir ve Airbnb onaysız konuşmada gider
`maybeSendClosingCourtesy:1048` `containsContactValue(opts.org.aiSignature)`; gövde `composeClosingCourtesy({customText: closingReplyText, signature})`.
`closingReplyText` serbest metin (Ayarlar, `api/settings/route.ts:153`; iletişim doğrulaması yok). Örnek: özel metin "Rica ederiz! Bir şey
olursa WhatsApp: 0532 123 45 67" → onaysız Airbnb ön sorusunda "teşekkürler" mesajına bu metin gider. Düzeltme: koşulu kurulmuş GÖVDEYE uygula
(`containsContactValue(body)` — `composeClosingCourtesy` sonrası).

### R22 — P3 (a) — `containsContactValue` imzada çıplak alan adını / sosyal hesabı / yazıyla numarayı görmüyor
Ölçüldü (`offPlatformContactHolds: true`): imza "Sevgiler, Ali\nlale-evleri.com" → **null (gider)** · "Ali | Instagram: @laleevleri" → null ·
"Ali — WhatsApp: beş üç iki bir iki üç dört beş altı yedi" → null · "laleevleri at gmail dot com" → null. ("0 532 …", "wa.me/…",
"(whatsapp 0532 1234567)" tutuluyor.) Airbnb ön mesajda web sitesi / sosyal hesabı da engeller. İmza ev sahibinin SABİT metni olduğu için daha
sıkı bir denetim (alan adı `\p{L}[\p{L}\p{N}-]*\.(?:com|net|org|com\.tr|…)`, `@\w{3,}`, "instagram / whatsapp / telegram" sözcüğü) ucuz.

### R23 — P3 (d) — `partRewriteBilled` yalnız otomatik turda düşülüyor
`automation.ts:3226`; dryRun (yönetici "AI öner" — rota kendi 1 birimini düşer) yolunda parça yeniden yazma ikinci çağrı olsa da ek birim yok.
Kıdemli okuyucu yeniden yazması birleşince (`mergeSeniorRewrite` `...first`) bayrak doğru taşınıyor — çift sayım YOK (kontrol edildi). Parça
okuyucusunun iki çağrısı (`readParts`) kotaya hiç girmiyor (raporda F1 açık olarak yazılı).

---
## (e) `src/lib/kb/after-change.ts` + çağıranlar
Sorun bulunmadı (kiracı yalıtımı: bütün `propertyIds` kapsamlı sorgulardan; `refreshPropertyMemoryBestEffort(org, pid)` org ile süzer;
kanca işlem dışında; kopyalamada tekrar ayıklanıyor). Pin regex'i (`kb-write-hook-pin`) `createManyAndReturn / updateManyAndReturn /
$executeRaw / iç içe yazım`ı görmez — bugün src'de yok (grep), P3 not: regex'e `(?:AndReturn)?` eklenmeli.
Entegrasyon dosyası başlığı "Wi-Fi önerisi onayı + kalem silme" diyor; Wi-Fi onayı `ai-action-suggestions.test.ts`'te — doğru.

---
## (f) `src/lib/kb-import/document.ts` + `extract-helpers.ts`
Not: modül henüz hiçbir rotaya bağlı değil (grep: `planDocumentImport` yalnız kendi dosyasında) → bulgular BAĞLANMADAN ÖNCE kapanmalı.
Ölçüm `planDocumentImport([{page:1, text}])`; ayrıca Genel'e düşen metin `guest-chat.withoutSecretKbItems` (rezervasyon öncesi içerik
sezgiseli, ikinci bacak) ile sınandı — "KEPT" = aday misafirin istemine girer.

### R24 — P1 (a, bağlanınca) — kod ile erişim sözcüğü AYRI paragraflardaysa kod "Genel"e düşüyor; D1'in paragraf düzeyi yalnız TEK uzun paragrafın parçalarını birleştiriyor
Ölçüldü (Genel taslak + `withoutSecretKbItems` sonucu):
- "Anahtar kutusu kapının sağında.\n\n4590" → Genel "4590" (KEPT)
- "The lockbox is by the door.\n\nThe number is 4590." → Genel "The number is 4590." (KEPT)
- "# Arrival\n\nUse the keypad at the main entrance.\n\nType 4590 then press the bell icon." → Genel "Type 4590 …" (KEPT)
- "Giriş:\n\nBina kapısını açın.\n\n4590 yazıp # basın." → HEPSİ Genel (KEPT) — "kapı" + rakam erişim sayılmıyor
- "Bahçe kapısı her zaman açıktır.\n\nDaireye girmek için 4590 yazın." → Genel (KEPT)
Adım adım giriş talimatı (paragraf başına bir adım) en yaygın belge biçimidir. Ayrıca `CATEGORY_WORDS`'te `checkin` kategorisi için hiç sözcük
yok ("Giriş / Check-in / Arrival / Anreise / Varış" başlığı kategorisiz → Genel). Düzeltme: (1) `checkin` kategorisine başlık sözcükleri
(giriş, check-in, arrival, varış, anahtar, ankunft, llegada, arrivée); (2) erişim izi taşıyan bloğun AYNI bölümündeki (aynı başlık altı ya da
bitişik genel koşu) rakam taşıyan bloklar da erişime; (3) en azından 3+ haneli sayı + "yaz / tuşla / bas / type / enter / press / number /
combination" taşıyan blok erişim izi sayılsın.

### R25 — P1 (a, bağlanınca) — erişim izi kaçan tek paragraf biçimleri
Genel'e düşen ve `withoutSecretKbItems`'ten de geçen (KEPT): "The PIN for the front door is 2468." · "Keyless entry: use the code sent on the day
of arrival, 4590." (`keys?` "keyless"i almıyor) · "Der Türcode lautet 4590." · "Il codice della porta è 4590.". Ayrıca "Kapı 3. katta, sağdaki
daire. Şifre 4590." → **Wi-Fi** kategorisi (kapı kodu Wi-Fi cevabı olarak verilir; rezervasyon öncesi kapalı ama yanlış konu).
Düzeltme: ACCESS_WORDS'e `pin|keyless|t[üu]rcode|codice|entry|access code|door code|kapı (?:kodu|şifresi)` ve "kapı / door / tür / porte /
puerta" + aynı paragrafta 3+ haneli sayı.

### R26 — P2 (a, bağlanınca) — `tableRowsToText` başlık satırlı tabloda sütun ADINI satırlardan koparıyor
`[["Daire","Kapı kodu"],["Daire 1","4590"],["Daire 2","7781"]]` → "Daire: Kapı kodu\n\nDaire 1: 4590\n\nDaire 2: 7781" → plan: "Daire: Kapı kodu"
Giriş Talimatı'na, **"Daire 1: 4590 | Daire 2: 7781" Genel'e**. Yorum "etiket ile değer AYNI blokta kalır" yalnız iki sütunlu etiket/değer
tablosu için doğru. Düzeltme: ilk satır başlıksa (bütün hücreler harf, sonraki satırlarda rakam) her satırı "Başlık1: d1 · Başlık2: d2" yaz.

### R27 — P3 (b) — "Key points / key information / key features" erişim sayılıyor
"Key points: no smoking, quiet after 22:00." → Giriş Talimatı (aday misafirden saklanır). Güvenli yön; `key(?! (?:points?|information|
features?|facts|rules|details))`.

### R28 — P3 — `extract-helpers.ts` küçükler (ölçüldü)
- `DOUBLE_UTF8` `["Ã ", "à"]` girdisinde ikinci karakter DÜZ BOŞLUK (0x20); gerçek çift UTF-8 "à" = "Ã" + U+00A0 → girdi gerçek bozulmayı hiç
  yakalamıyor, meşru metni bozuyor: "MAÇÃ É BOM" → `repairTurkishMojibake` "MAÇàÉ BOM", dedektör `suspicious: true`.
- Latin-1 (C1 denetim karakterli) biçim onarılmıyor: "Şişli ağır ığdır" UTF-8 baytları `String.fromCharCode` ile → onarım "ÅiÅli aÄır ıÄdır"
  (tablo yalnız cp1252 biçimini biliyor; ş/ğ/Ş/Ğ'nin ikinci baytı 0x9E/0x9F). `normalizeDocText` C1 karakterlerini de silmiyor.
- `decodeTextFile`: geçerli UTF-8 dosyanın SONUNDA tek yarım bayt → bütün dosya 1254 okunuyor: "Merhaba Şişli " + 0xC5 → "Merhaba ÅiÅŸli Å"
  (doğru Türkçe metin bozuluyor). Öneri: yalnız sondaki yarım dizi ise onu at, UTF-8 kalsın; ya da hatalı bayt oranı eşiği.
- `sniffDocumentKind`: RTF ("{\rtf1…") → "txt" (denetim sözcükleri içeriğe girer); her zip → "docx" (yorumda belirtilmiş).
- Süre: `detectMojibake` 200.000 karakter + onarım 100.000 ikili + 20.000 PDF parçası toplam 81 ms — karesel iş yok.

---
## Ek `absence.ts` kalıntıları (HEAD 91dd5edc'de yeniden ölçüldü, hepsi **go**)

### R29 — P2 (a) — olumsuzluk muafiyeti hâlâ CÜMLE düzeyinde (A5 yalnız "ev sahibine bağlı" yaptı)
- "You don't need to contact your host for the Wi-Fi password; for parking, please ask your host." → go
- "Wi-Fi şifresi için ev sahibinize sormanıza gerek yok; otopark için ev sahibinize sorabilirsiniz." → go
- "Site yöneticisine sormanıza gerek yok, ev sahibinize sorabilirsiniz." → go (A2 "yönetici"yi HOST_TR'ye ekledi → olumsuzluk ona bağlanıyor)
Çok sorulu cevapta doğal. Düzeltme (R12 ile aynı): `CLAUSE_SPLIT` yan cümlelerinde her yönlendirme yan cümlesi ayrı değerlendirilsin; olumsuz
yan cümle yalnız KENDİNİ muaf tutsun.

### R30 — P3 (a) — kalıp boşlukları
- RU mastar kalıbı iyelik zamirini almıyor: "Рекомендую связаться с вашим хозяином." / "Вы можете уточнить у вашего хозяина." → go
  (yeni `(?:связаться|…)(?: (?:с|со|к|у))? ${RU_HOST}` — `(?: (?:вашим|вашему|вашего|вашей))?` eksik; eski emir kalıbında var).
- "site yönetimi" (en yaygın Türkçe biçim) yok, yalnız "yönetici": "Konuyu site yönetimiyle görüşebilirsiniz." → go.
- DE "Wenden Sie sich bitte direkt an Ihren Gastgeber." → go (`(?:bitte )?an` + sonra `(?:bitte|gerne|direkt)` sırası; "bitte direkt an" yok).
- İletişim değeri muafiyeti KONUYA bakmıyor: "Otopark için ev sahibinize 0532 123 45 67 numarasından sorabilirsiniz." → go (değer yönlendirmenin
  kendi yan cümlesinde — tasarım gereği; ama sorulan konu otopark, telefon değil. Kurucunun "istenen telefon" ölçütüyle çelişir; soru olarak
  sunulmalı).

---
## Özet tablosu
| kimlik | öncelik | alan | tür | durum |
|---|---|---|---|---|
| R1 | P1 | absence varış muafiyeti | a, gerileme | koordinatör düzeltti (3c909217) |
| R2 | P1 | absence olay sözcüğü cümle geneli | a | düzeltildi |
| R3 | P2 | absence olay talimatı tutuluyor | b, gerileme | düzeltildi |
| R4 | P2 | absence telefon yan cümle / satır bölmesi | b, gerileme | düzeltildi |
| R5 | P2 | absence satır sonu karesel (50k → 10,5 sn), pin ölçmüyor | c, e | düzeltildi (34,8 ms) |
| R10 | P2 | TOPIC_MARKER belirtme hâli nesnesini görmüyor → numara kurtarıyor | a, R4 düzeltmesinin gerilemesi | AÇIK |
| R11 | P2 | varış muafiyeti nesne biçimli konu | a | AÇIK |
| R12 | P2 | olay muafiyeti cümle düzeyi | a | AÇIK |
| R13 | P2 | INFO_CONDITION "let them know / details" | b | ✅ 10-28 gece (kurucu "r13 tamam"; haber verme ifadesi bilgi koşulundan önce silinir, "bilgi verebilirsiniz" yönlendirme değil; mutasyon 8/8) |
| R14 | P3 | "break" / "issues" geniş | a | AÇIK |
| R15 | P2 | binding: tire / parantez / "•" / noktalamasız "kapalı" sıfat | a | AÇIK — 10-28 gece tasarım notu ↓ (aceleyle kapatılmadı: yan cümle bölme bu dosyada üç ayrı yerde) |
| R16 | P1 | pet: "hariç / except" + tür uyuşmazlığı → evet gider | a | düzeltildi 10-28 (ac4bfa66 + pin) |
| R17 | P2 | pet: kısıt biçimleri koşul sayılmıyor | a | AÇIK |
| R18 | P1 | pet: öğe kipinde (canlı) B4 devre dışı; test yalnız öğesiz | a, e | düzeltildi 10-28 (ac4bfa66 + pin) |
| R19 | P2 | pet: hayvansız cümlede tutar / "edemeyiz" | a | AÇIK |
| R20 | P3 | QR: misafir hayvan andı → hayvansız cevap tutulur | b | bilgi |
| R21 | P2 | kapanış nezaketi özel metni denetlenmiyor | a | düzeltildi 10-28 (ac4bfa66) |
| R22 | P3 | imza: alan adı / @hesap / yazıyla numara | a | KISMEN: alan adı + @hesap 10-28 gece (Ö1, imza satırı); yazıyla numara AÇIK |
| R23 | P3 | partRewriteBilled dryRun / okuyucu çağrıları | d | bilgi |
| R24 | P1* | KB içe aktarma: kod ayrı paragrafta → Genel | a (bağlanınca) | düzeltildi 10-28 gece (bölüm düzeyi kod benzeri değer + giriş fiiliyle sayı; `checkin` kategori sözcüğü EKLENMEDİ — kategori yalnız erişim kapısıyla açılır) |
| R25 | P1* | KB içe aktarma: PIN / keyless / Türcode / IT → Genel | a (bağlanınca) | düzeltildi 10-28 gece — kök neden ORTAK sır okuyucusundaydı (QR çıktı taraması + bilgi tabanı süzgeci de kaçırıyordu); "Kapı … Şifre 4590" Wi-Fi'ye gidiyordu çünkü kapıya kodun tahmin ettiği "Wi-Fi" başlığı veriliyordu |
| R26 | P2* | tablo başlık satırı satırlardan kopuyor | a (bağlanınca) | erişim yönü düzeltildi 10-28 gece (R24 bölüm kuralı: başlık satırı erişim bloğu, satırlar onunla Giriş Talimatı'nda, belge sırasıyla); metin biçimi BİLİNÇLİ değişmedi — 2 sütunlu etiket / değer tablosunda "ilk satır başlık" sezgisi "Adres \| Lale Sokak" satırını yanlış eşlerdi |
| R27 | P3 | "Key points" erişim | b | düzeltildi 10-28 gece |
| R28 | P3 | extract-helpers küçükler ("Ã " düz boşluk, Latin-1, yarım bayt, RTF) | — | düzeltildi 10-28 gece (bölünmez boşluk; Latin-1 C1 biçimi ş ğ Ş Ğ Ç Ü Ö; yalnız sondaki yarım dizi atılır; RTF reddedilir; normalizasyon C1 siler) |
| R29 | P2 | olumsuzluk muafiyeti cümle düzeyi | a | AÇIK |
| R30 | P3 | RU iyelik, "site yönetimi", DE "bitte direkt an", konusuz değer muafiyeti | a | AÇIK |
(* modül henüz bağlı değil — bağlamadan önce kapanmalı.) Sorun bulunmayan: `kb/after-change.ts` + çağıranlar (kiracı yalıtımı, işlem dışı,
çift sayım yok).


---
## 10-28 gece — R15 tasarım notu (uygulanmadı; sıradaki dilim)

Kök: `closedIsNotPredicate` "kapalı"nın ARDINDAKİ tesis adına bakıp sıfat okuması yapıyor; tire / parantez / eğik çizgi / "•" belirteçlere
ayırmada siliniyor, sonraki "havuz" sözcüğü "kapalı havuz" sıfat öbeği sanılıyor. Önerilen iki adım (ikisi de yalnız TUTMA yönünde):
1. `" - " · "–" · "(" · ")" · "/" · "•"` yan cümle ayracı (belirteçlere ayırmadan ÖNCE) — dört biçimi kapatır. Yan cümle bölme bu dosyada üç
   yerde farklı (satır ~1489 cümle, ~1554 yer, ~2730 olumluluk) → hepsinde aynı ayraç kümesi; tek kaynak yardımcı.
2. Noktalamasız biçim ("Havuz şu an kapalı havuz havluları dolaptadır"): özne (tesis adı) "kapalı"dan ÖNCE aynı yan cümlede söylendiyse VE
   ardındaki tesis adı yeni bir ad öbeği başlatıyorsa (ardından yüklem / var / mevcut / ek-fiil gelmiyorsa) "kapalı" yüklemdir. Korunması
   gereken sıfat okumaları (pin): "Otoparkımız kapalı otoparktır" (ad ek-fiilli), "Havuz yanında kapalı otopark vardır" (var / mevcut),
   "Sitenin kapalı yüzme havuzu açıktır" (tesis tamlayanı), "Spa kapalı havuz açık" (mevcut kural).
Ölçüt: yanmış kabul setindeki 5 "kapalı" doğru-tutma vakası geri gelmemeli (10-23 akşam ölçümü) + Opus'un 5 biçimi + yukarıdaki 4 sıfat pini.

---
## 10-28 gece-2 — kurucunun R13 sınırı + iki SORU (R13-b, R13-c)

Kurucu (aynen): "Yaşanan olayla varsayımsal olay ayrılmalı. 'Wi-Fi bozulursa ne yapmalıyız?' sorusuna bu talimat uygun olabilir. Ama misafir
'Wi-Fi şu anda çalışmıyor' diyorsa yalnız 'Bozulursa ev sahibine yazın' demek, bildirimi anlamamış gibi olur. Mevcut sorun kaydı ve host'a
bildirim akışı korunmalı. Bu cümlenin gönderilmesi sorunu çözülmüş saydırmamalı. 'Ev sahibine haber verin' yazıldı diye açık şikâyet
kapanmamalı; sistem gerçekten bildirim göndermediyse 'ev sahibinize bildirdim' de denmemeli. … bu tür mesajlar çok sık gitmesin … 'Bir sorun
olursa ev sahibinizi arayıp bilgi verebilirsiniz.' yazmasın mesela bunu ne sorulursa yazıyor."

**Ölçüldü (kodda, bugün) — korunuyor:** pin `tests/unit/r13-actual-vs-hypothetical.test.ts` (kanal kapısı + QR kapısı).
- Gerçek bildirim ("Wi-Fi şu anda çalışmıyor", "Klima soğutmuyor", "Sıcak su gelmiyor", "The wifi is not working right now", "The power is
  out") → cevap metni NE olursa olsun **tutulur**: sözcük ağı şikâyet der (model "genel" dese de), model "şikâyet" derse de tutulur. Cevap
  gitmediği için açık şikâyet "cevaplandı" sayılamaz; ev sahibi bildirimi (Sorunlu / e-posta) bugünkü yolundan gider. R13 bunlara dokunmadı.
- "Ev sahibinize bildirdim / ilettim / I've notified your host" → çıktı vetosu **tutar** (sistem bildirim göndermeden söz verilemez).
- "Wi-Fi bozulursa ne yapmalıyım?" (varsayımsal) → "Wi-Fi bozulursa ev sahibinizi arayıp bilgi verebilirsiniz." **gider** (R13'ün amacı).

### R13-b — SORU: sözcük ağının şikâyet saymadığı gerçek bildirimler (açık R13'ten ÖNCE de vardı)
Bugün tek koruma model niyeti. Model "genel" derse koşullu talimat GİDER:

| Misafir | Model cevabı | Bugün | Önerim (A) |
|---|---|---|---|
| "İnternet yok, bağlanamıyorum" | "Bir sorun olursa ev sahibinize yazın." | gider | **tutulur**, ev sahibi yanıtlar |
| "Elektrik yok" / "Su yok" / "Isıtma yok" | aynı | gider | **tutulur** |
| "İnternet kesildi" / "TV açılmıyor" | aynı | gider | **tutulur** |
| "Wi-Fi'ye bağlanamıyorum" | "Ağ adı Lale, şifre 12345678." | gider | **gider** (şifre gerçek cevap — değişmez) |
| "Wi-Fi bozulursa ne yapmalıyım?" | "Bozulursa ev sahibinize yazın." | gider | gider |

Öneri (A): misafirin mesajı ŞİMDİKİ bir arıza / yokluk bildiriyorsa (koşul eki yok: "-sa / -se / if" değil) ve cevabın ev sahibine yönlendiren
cümlesi YALNIZ koşullu talimatsa ("olursa / bozulursa / if … breaks"), cevap bildirimi anlamamıştır → tutulur. Yalnız TUTMA yönünde; şifre /
adım veren cevap etkilenmez. (B) sözcük ağına "elektrik / su / ısıtma / internet yok · kesildi · açılmıyor" eklemek — daha geniş etki (o
mesajlarda HİÇBİR cevap gitmez, şifre bile), önermiyorum. Büyük şirketler: Hospitable / Guesty otomatik cevabı "issue reported" etiketinde
durdurup ev sahibine düşürüyor; biz de aynısını yapıyoruz, yalnız etiket sözcük ağına bağlı kalmasın.
**Böyle yapalım mı? (A / B / ikisi de değil)**

### R13-c — SORU: soruyla ilgisiz "Bir sorun olursa ev sahibinizi arayın" kuyruğu
Bugün: "Otopark var mı?" → "Evet, binanın arkasında ücretsiz otopark var. Bir sorun olursa ev sahibinizi arayıp bilgi verebilirsiniz." **gider**.
(R13'ten önce "…arayın." biçimi de gidiyordu; R13 yalnız "bilgi verebilirsiniz" biçimini ekledi.) İstem bunu istemiyor — model kendiliğinden
ekliyor (büyük olasılıkla bilgi tabanındaki "herhangi bir sorunda ev sahibini arayın" satırından).

Öneri: iki katman.
1. KOD (hemen, ücretsiz): misafir bir sorun / arıza / "ne yapmalıyım" sormadıysa, koşullu "bir sorun olursa ev sahibinize yazın / arayın"
   cümlesi cevaptan SİLİNİR (yeni söz eklenmez; "talimat yok" cümlesinin silinmesiyle aynı yöntem, `no-instruction-filler.ts`). Kalan metin
   bütün kapılardan yine geçer; geriye cevap kalmazsa tutulur.
   - Önce: "Evet, binanın arkasında ücretsiz otopark var. Bir sorun olursa ev sahibinizi arayıp bilgi verebilirsiniz."
   - Sonra: "Evet, binanın arkasında ücretsiz otopark var."
   - Değişmez: "Wi-Fi bozulursa ne yapmalıyım?" → "Wi-Fi bozulursa ev sahibinizi arayıp bilgi verebilirsiniz." (soru tam bu)
   - Değişmez: "Anahtarı kaybedersem?" → "Anahtarı kaybederseniz ev sahibinizi arayın."
2. İSTEM (OpenAI kredisi gelince ölçerek): "misafir sormadıysa 'bir sorun olursa ev sahibinize yazın' kapanışı ekleme" satırı.
**Böyle yapalım mı?**
