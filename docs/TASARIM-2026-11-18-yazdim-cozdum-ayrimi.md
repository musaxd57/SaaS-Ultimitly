# Tasarım 2026-11-18 — "Yazdım" ile "çözdüm" ayrımı (H-1)

> Kurucu 11-18 akşam (AYNEN `docs/KURUCU-TALIMATI-2026-11-18-aksam-kararlar-ve-anlam-yonu.md`, H-1): "Evet, 'yazdım' ile 'çözdüm' ayrılsın.
> Doğru bilgi cevabı ilgili soruyu kapatabilir. 'Havlu getiriyoruz' havlu ihtiyacını cevaplandı, teslim bekleniyor yapar; klima arızasına hiç
> dokunmaz. Fiziksel iş, o işe uygun kanıtla kapanır. Havlu için teslim kaydı yeterli olabilir; arızada teknisyenin 'gittim' demesi onarımın
> tamamlandığı anlamına gelmez. Bunun için hosta her cevap sonrası yeni bir kapatma tıklaması eklemem."
> Önceki belge: `docs/TASARIM-2026-11-18-ev-sahibine-nerede-soruyoruz-ve-ilk-akis.md` (H-1…H-8). KOD HENÜZ YOK — dilimler §5.

## 1. Bugün

- Misafirin her isteği bir **konuşma öğesi** (`ConversationItem`): açık · size bırakıldı · AI yanıtladı · tamamlandı · vazgeçti · birleşti.
- **"Yanıtladınız" konuşma düzeyinde türetilir** (kurucu 09-26: tıklama gerekmez): öğenin mesajından SONRA ev sahibi herhangi bir şey
  yazdıysa o konuşmanın BÜTÜN açık öğeleri "Yanıtladınız" görünür ve açık iş sayılmaz. Örnek: misafir "klima çalışmıyor, bir de havlu
  lazım" dedi; ev sahibi "Havluları getiriyoruz" yazdı → klima öğesi de "Yanıtladınız" olur.
- Ev sahibinin sözü ayrı bir kayıttır (`GuestCommitment` + görev). Görev bitince söz kapanır (`syncCommitmentsForTaskStatus`). Söz / görev ile
  konuşma öğesi arasında BAĞ YOK: havlu görevi bitse de havlu öğesi bundan haberdar olmaz; bitmese de öğe "Yanıtladınız"dır.
- Öğeyi gerçekten kapatan tek ev sahibi yolu elle "tamamlandı" ya da karar kartıdır.

## 2. Kural

Bir cevap, **hangi isteğe** yazıldıysa onu etkiler; ve isteğin türüne göre "cevaplandı" ile "çözüldü" ayrıdır.

| İstek türü | Cevap ne yapar | Ne zaman kapanır (kanıt) |
|---|---|---|
| Bilgi sorusu (Wi-Fi, otopark, çıkış saati) | doğru cevap misafire ULAŞINCA öğe kapanır | kanal kabul etti / QR'da görünür |
| Teslim işi (havlu, malzeme) | söz verilince öğe **"cevaplandı · teslim bekleniyor"** olur — açık iş sayılmaz ama KAPANMAZ | teslim kaydı: görevin kimlikli "bitti" kaydı |
| Arıza (klima, sıcak su) | söz verilince **"cevaplandı · onarım bekleniyor"** | görevin "bitti"si YETMEZ: misafirin teyidi ("çalışıyor, teşekkürler") ya da ev sahibinin "çözüldü" demesi |
| Hassas / karar (iade, şikâyet) | bugünkü gibi: ev sahibi kapatır | ev sahibi |
| Cevabın değinmediği istek | HİÇ etkilenmez — açık kalır | — |

Ek tıklama yok: kapanış kanıttan gelir (teslim kaydı, misafirin teyidi, kanal kabulü). Ev sahibi isterse yine elle kapatabilir.

## 3. "Bu cevap hangi isteğe?" — anlam sorusu, modele bırakılır

Bir ev sahibi mesajının hangi açık öğeye değindiği sözcük eşleşmesiyle çıkarılmaz (kurucu 11-18: "kelime bazlı değil"). Ev sahibi sözünü
okuyan model katmanı (`docs/TASARIM-2026-11-18-soz-sahipligi-model-okumasi.md`) genişletilir: çağrıya konuşmanın AÇIK öğelerinin kısa listesi
(tür + kimlik; misafir metni yok) verilir, model her öğe için kapalı kümeden seçer: `cevaplıyor` · `üstleniyor` · `erteliyor` · `değinmiyor`,
alıntı ve nedenle. Kod doğrular: alıntı metinde mi; öğe kimliği verilen listeden mi (uydurma kimlik yok). Model düşerse bugünkü kural sürer.

Misafirin teyidi de aynı sınıftır ("klima çalışıyor mu?" → "evet teşekkürler"): gelen mesajın hangi açık onarım öğesini teyit ettiği anlama
katmanının işidir.

## 4. Şema

`ConversationItem`a iki boş bırakılabilir alan (migration; kurucu onayı var): bağlı söz (`commitmentId`) ve karşılanma durumu
(`fulfilment`: bekleniyor · teslim edildi · teyit edildi). Görünen durum bunlardan TÜRETİLİR; saklı durum kümesi büyümez.

## 5. Dilimler

| Dilim | Ne | Etki |
|---|---|---|
| Y1 | gölge: ev sahibi mesajı ↔ açık öğe eşlemesini model okur, kaydeder; bugünkü "konuşma düzeyi" kuralıyla kıyaslar | yok (ölçüm) |
| Y2 | "Yanıtladınız" öğe bazına iner: cevabın değinmediği öğe açık kalır | açık iş sayısı ARTAR (gizlenen işler görünür) — kurucu onayı + önce / sonra örneği |
| Y3 | öğe ↔ söz bağı + "cevaplandı · teslim bekleniyor" etiketi; görev kanıtıyla kapanış | teslim işleri kendiliğinden kapanır |
| Y4 | arıza: görev bitti ≠ çözüldü; misafir teyidi / ev sahibi "çözüldü" | arıza öğeleri erken kapanmaz |

Y1 söz okuyucusunun gölge kaydıyla aynı altyapıyı kullanır (aynı tablo, aynı ölçer). Y2 görünen davranışı değiştirir → ölçümden sonra.

## 6. Kurucuya sorular

- **YÇ-1 (Y2 örneği):** misafir "klima çalışmıyor, bir de havlu lazım" → siz "Havluları getiriyoruz" → bugün iki iş de "Yanıtladınız"; yeni
  kuralla havlu "cevaplandı · teslim bekleniyor", klima AÇIK kalır ve Dikkat panelinde görünür. Böyle mi?
- **YÇ-2:** arızada kapanış için misafirin teyidi beklenirken süre sınırı olsun mu (ör. onarım görevi bittikten 24 saat sonra misafir bir şey
  yazmadıysa "teyit edilmedi" notuyla kapansın)? Önerim: kapanmasın, yalnız sönükleşsin; siz kapatırsınız.
- **YÇ-3:** etiket metinleri: "Cevaplandı · teslim bekleniyor" · "Cevaplandı · onarım bekleniyor" · "Teslim edildi" — uygun mu?
