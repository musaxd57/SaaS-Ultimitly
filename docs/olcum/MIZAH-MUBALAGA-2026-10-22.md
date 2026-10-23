# Mizah / mübalağa / alay ölçümü — 2026-10-22

Kurucu (aynen): "model espri anlayışı olarak iyi mi test edebilirsin test örneklerini koyabiliriz ona mübalağayı falan anlayabilsin sen nasıl
anlayabiliyorsan" · "bizim kendi kodumuzda da bağlamı iyi ekle … kelime kelime bakmak yerine".

**Set:** `evals/humor-exaggeration.json` (30 mesaj, TR + EN: abartı, benzetme, şaka, ALAYLI şikâyet, gülme işaretiyle yazılmış GERÇEK tehlike).
**Ölçer:** `tests/eval/humor-understanding.eval.test.ts` (gerçek model; `RUN_REAL_EVAL=1 EVAL_HUMOR_OUT=… npx vitest run -c vitest.eval.config.ts …`).
Maliyet: 30 küçük çağrı (birkaç sent).

## Sonuç (30 mesaj, yanlış sayısı — düşük daha iyi)

| | Acil hükmü yanlış | Şikâyet hükmü yanlış |
|---|---|---|
| Kelime kuralları (eski) | 6 | 4 |
| Anlama modeli (gpt-5.1) | 2 (biri "gece 2'de çocuklarla kapıda" → acil dedi, savunulabilir) | 3 (hepsi gerçek acile ek "şikâyet" etiketi — zararsız) |

**Ne öğrendik:**
- Model mizahı ve alayı iyi anlıyor: "This wifi is killing me 😂", "Gülmekten öldüm", "I'd literally kill for a coffee" → risk yok, soru cevaplanır.
  "Harika, yine sıcak su yok 🙃" / "Love the free sauna, the AC must be on vacation 😒" → ŞİKÂYET (kelime kuralı bunları göremiyor).
- Kelime kuralları benzetmeyi ve argoyu tehlike sanıyordu: "Yangın gibi bir manzara!", "This place is fire 🔥", "Elektrik çarptı sanki o kadar
  güzel ki 😍". Üretimde anlama katmanı açıkken bunların çoğu "olası" düzeyde → karar modelde → model "acil değil" der, cevap gider.
- Kelime kuralının KAÇIRDIĞI gerçek tehlike: "Not joking: water is pouring from the ceiling onto the lamp" (hiç tehlike sayılmıyordu).
- Model bir kez mizahı kaçırdı: "Mutfak yanıyor sanki, o kadar sıcak 😅" → acil dedi (güvenli yön: ev sahibine kalır).

## Koda eklenenler (kelime kararı yerine bağlamı modele bırakma)

1. **Mecaz + şaka → karar modelde** (`src/lib/ai/hazard-evidence.ts`, `FIGURATIVE` + `PLAYFUL`): benzetme ("sanki", "gibi", "as if", "like a",
   "o kadar") + gülme / şaka işareti ("😂", "haha", "lol", "şaka") BİRLİKTE varsa kod "açık tehlike" hükmü vermez, en fazla "olası" — kararı
   bağlamı okuyan anlama modeli verir; model yoksa güvenli taraf (devir) aynen. Gaz ve nefes darlığı her zaman açık. Örnek: "Mutfak yanıyor
   sanki, o kadar sıcak 😅" eskiden modelsiz ACİL devir + kritik e-posta → şimdi model okur.
2. **"Şaka değil / not joking / cidden" vurgudur, olumsuzlama değil** (`NOT_JOKING`): "Not joking: water is pouring … onto the lamp" eskiden
   olumsuzlanmış sayılıyordu → şimdi AÇIK su + elektrik tehlikesi.
3. **Yardımcı fiilli su bildirimi** ("water is pouring", "keeps dripping"): artık tanınır (olası → model karar verir).

Testler: `tests/unit/hazard-figurative.test.ts` (değişenler + değişmeyenler: gerçek yangın / duman / gaz / nefes), `tests/unit/hazard-figurative-cost.test.ts`
(uzun gülme dizisi / boşluk dizisi süre pini).

## Açık soru (kurucuya)

- **Duman alarmı GEÇMİŞTE ötmüş ve geçmiş:** "Haha the smoke alarm went off because I burned the toast, it's fine now. How do I reset it?" bugün
  "dedektör ötüyor → doğrudan ev sahibine" kuralıyla (H3, kurucu 10-13) AÇIK acil. Mesaj olayın bittiğini söylüyor. Önerim: dedektör kuralı
  geçmiş zaman + "şimdi iyi / it's fine now" birlikteyse "olası"ya insin (karar modelde; model yoksa yine devir). Yapalım mı?

## Mesaj mesaj tablo

| # | Misafir mesajı | Beklenen (acil / şikâyet) | Kelime kuralı ESKİ (etiket · tehlike düzeyi) | Kelime kuralı YENİ | Anlama modeli (gpt-5.1) |
|---|---|---|---|---|---|
| h01 | This wifi is killing me 😂 what's the password? | hayır / hayır | — · none | — · none | risk yok (wifi, greeting_thanks) |
| h02 | I'm dying of heat lol, how do I turn on the AC? | hayır / hayır | — · none | — · none | risk yok (appliance_help) |
| h03 | Gülmekten öldüm, kahvaltı yeri önerir misiniz? | hayır / hayır | — · none | — · none | risk yok (local_recommendations) |
| h04 | Bu manzara beni bitirdi, harika! Çıkış saati kaçta? | hayır / hayır | — · none | — · none | risk yok (checkout_time) |
| h05 | Sıcaktan eriyoruz haha, klimayı nasıl açıyoruz? | hayır / hayır | — · none | — · none | risk yok (appliance_help) |
| h06 | The view is to die for! Where can we park? | hayır / hayır | — · none | — · none | risk yok (parking) |
| h07 | My kids are going to kill me if there's no wifi 😅 what's the password? | hayır / hayır | — · none | — · none | risk yok (wifi) |
| h08 | Açlıktan ölüyoruz 😂 yakında restoran var mı? | hayır / hayır | — · none | — · none | risk yok (local_recommendations) |
| h09 | Yangın gibi bir manzara! Havlular nerede? | hayır / hayır | safety_emergency · possible | safety_emergency · possible | risk yok (amenities) |
| h10 | This place is fire 🔥 thanks! Check-out time? | hayır / hayır | safety_emergency · mentioned | safety_emergency · mentioned | risk yok (checkout_time, greeting_thanks) |
| h11 | Elektrik çarptı sanki o kadar güzel ki 😍 çıkış kaçta? | hayır / hayır | safety_emergency · possible | safety_emergency · possible | risk yok (checkout_time) |
| h12 | Mutfak yanıyor sanki, o kadar sıcak 😅 klima nasıl açılır? | hayır / hayır | — · possible | — · possible | emergency (emergency, appliance_help) |
| h13 | I'd literally kill for a coffee, is there a machine? | hayır / hayır | — · none | — · none | risk yok (amenities) |
| h14 | Komşunun köpeği bizi yedi bitirdi 😂 şaka şaka, çöp nereye atılıyor? | hayır / hayır | rule_violation · none | rule_violation · none | risk yok (trash) |
| h15 | We're drowning in towels haha, no need for more. Where is the iron? | hayır / hayır | — · none | — · none | risk yok (amenities) |
| h16 | Kafamız patladı bu Wi-Fi ile 😂 şifre neydi? | hayır / hayır | — · none | — · none | risk yok (wifi) |
| h17 | Bu yatak bulut gibi, hiç kalkmayacağız 😄 geç çıkış mümkün mü? | hayır / hayır | — · none | — · none | risk yok (late_checkout) |
| h18 | My husband says he'll murder me if I lose the key again 😂 is there a spare? | hayır / hayır | — · none | — · none | risk yok (access_keys) |
| h19 | Great, the shower is ice cold AGAIN, just what I wanted on holiday 🙃 | hayır / evet | — · none | — · none | complaint_issue (complaint_issue) |
| h20 | Harika, yine sıcak su yok, tam tatil keyfi 🙃 | hayır / evet | complaint · none | complaint · none | complaint_issue (complaint_issue) |
| h21 | Love the free sauna in the bedroom, the AC must be on vacation too 😒 | hayır / evet | — · none | — · none | complaint_issue (complaint_issue) |
| h22 | Wow, the neighbours' party is so loud we joined it from our bed. Any quiet hours here? | hayır / evet | rule_violation · none | rule_violation · none | complaint_issue (house_rules, complaint_issue) |
| h23 | Our toddler flooded the bathroom with bubbles lol, where is the mop? | hayır / hayır | safety_emergency · possible | safety_emergency · possible | risk yok (amenities) |
| h24 | Haha the smoke alarm went off because I burned the toast, it's fine now. How do I reset it? | hayır / hayır | safety_emergency · clear | safety_emergency · clear | risk yok (appliance_help) |
| h25 | Ev buz gibi, donduk resmen 🥶 kombiyi nasıl açarız? | hayır / hayır | — · none | — · none | risk yok (appliance_help) |
| h26 | lol there's actually smoke coming out of the socket now, is that bad?? | evet / — | safety_emergency · clear | safety_emergency · clear | emergency (emergency, complaint_issue) |
| h27 | Şaka değil, gerçekten gaz kokusu var, ne yapalım? | evet / — | safety_emergency,complaint · clear | safety_emergency,complaint · clear | emergency (emergency, complaint_issue) |
| h28 | Not joking: water is pouring from the ceiling onto the lamp | evet / — | — · none | — · clear | emergency (emergency, complaint_issue) |
| h29 | Haha very funny, the door code doesn't work and we're stuck outside at 2am with kids | — / evet | complaint · none | complaint · none | emergency (emergency, complaint_issue, access_keys) |
| h30 | Mükemmel bir deneyim, sadece hamamböceklerle kahvaltı ettik 🙂 temizlikçi ne zaman geliyor? | hayır / evet | complaint · none | complaint · none | complaint_issue (complaint_issue, cleaning_linen) |
