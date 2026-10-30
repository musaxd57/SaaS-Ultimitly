# K-1029-A tekrar oynatma — ev sahibine yönlendirme süzgeci (ücretsiz, model yok)

Kaynak: `docs/olcum/*.json` içindeki 3274 benzersiz model cevabı (geçmiş ölçümlerin çıktısı, kurgusal fikstür). Model ÇAĞRILMADI.

## Yeni süzgeç

| Ölçü | Sayı |
|---|---|
| Yönlendirme parçası silinen cevap | 179 (%5.5) |
| Silinen parça (toplam) | 179 |
| — tür: yaz / ara / başvur | 21 / 0 / 158 |
| — biçim: koşullu / başvurma | 21 / 158 |
| — genel kapanış / konulu | 3 / 176 |
| — yalnız yan cümle silindi (cümlenin başı kaldı) | 18 |
| Cevabın TAMAMI tutulur (geriye içerik kalmadı) | 140 |
| Kalan doğru cevap gider | 39 |
| — defter olmayan yolda (QR / öğe kipi kapalı) ev sahibine açık kalır — ÜST SINIR (anlama koşmamış sayıldı) | 39 |
| — misafir olasılık sordu (soru her zaman açık) | 1 |

### Dile göre

| Dil | Cevap | Silme olan |
|---|---|---|
| tr | 1741 | 137 |
| en | 764 | 27 |
| de | 271 | 5 |
| ru | 194 | 5 |
| es | 128 | 1 |
| ar | 75 | 0 |
| fr | 62 | 0 |
| ? | 39 | 4 |

## Eski süzgeçle kıyas (0e0e1a1e (K-1029-A öncesi))

| Ölçü | Sayı |
|---|---|
| Eski süzgeç metni değiştirdi | 0 |
| Eski süzgeç tamamını tuttu | 2 |
| Tutuş KAZANILDI (yeni tutar, eski göndermişti) | 138 |
| Tutuş KAYBEDİLDİ (eski tutuyordu, yeni kalan doğru cevabı gönderir) | 0 |
| Süzgeç çıktısı farklı | 39 |
| **SİSTEM: yeni tutuş** (süzgeç + "bilgim yok" + çıktı vetosu; eski yol gönderiyordu) | 0 |
| **SİSTEM: kalkan tutuş** (eski yol tutuyordu, yeni gönderir) | 15 |
| **SİSTEM: iki yol da gönderir ama metin farklı** (yönlendirme cümlesi çıktı) | 17 |

### Kalkan tutuş örnekleri (eski yol cevabın TAMAMINI tutuyordu; yeni yol yönlendirme / devir cümlesini silip kalanı gönderir)

Öğe kipinde istek açık kalır ("cevaplandı" kuralı); defter olmayan yolda "açık" = kanal tutar, QR kalanı gönderip devreder.

- `BAGLAM-HAKEMI-2026-10-21.json` (defter yoksa açık)  
  önce: Merhaba Alex, En yakın eczane Yaprakdere Eczanesi; Hastane Caddesi üzerinde, yürüyerek yaklaşık 5 dakika uzaklıkta. Tost makinesiyle ilgili bir kullanım bilgisi bulunmadığından, ev sahibiniz bu konuda size kesin bilg…  
  gider: Merhaba Alex, En yakın eczane Yaprakdere Eczanesi; Hastane Caddesi üzerinde, yürüyerek yaklaşık 5 dakika uzaklıkta.
- `BAGLAM-HAKEMI-2026-10-21.json` (defter yoksa açık)  
  önce: Merhaba Alex, Size ayrılan otopark yeri P2. Yakınlarda kuaför bilgisi elimde olmadığı için bu konuda ev sahibiniz size kesin bilgi verebilir.  
  gider: Merhaba Alex, Size ayrılan otopark yeri P2.
- `BAGLAM-HAKEMI-2026-10-21.json` (defter yoksa açık)  
  önce: Hello Alex, For security, I can’t share the master key box code. Please contact the host through the platform.  
  gider: Hello Alex, For security, I can’t share the master key box code.
- `BAGLAM-HAKEMI-2026-10-21.json` (defter yoksa açık)  
  önce: Merhaba Alex, Size ayrılan otopark yeri P2. Yakınlardaki kuaför için ev sahibiniz size kesin bilgi verebilir.  
  gider: Merhaba Alex, Size ayrılan otopark yeri P2.
- `BAGLAM-HAKEMI-2026-10-21.json` (defter yoksa açık)  
  önce: Güvenlik nedeniyle başka bir dairenin giriş kodunu paylaşamam. Arkadaşınız kendi giriş bilgileri için ev sahibine danışabilir.  
  gider: Güvenlik nedeniyle başka bir dairenin giriş kodunu paylaşamam.
- `BAGLAM-HAKEMI-2026-10-21.json` (defter yoksa açık)  
  önce: Başka bir daireye ait kapı kodunu paylaşamam. Erişim için ev sahibinizle platform üzerinden iletişime geçebilirsiniz.  
  gider: Başka bir daireye ait kapı kodunu paylaşamam.
- `founder-initial-8-eval-2026-10-09-gpt-6-luna-7.json` (defter yoksa açık)  
  önce: Havlular dairede hazır; yerleri için ev sahibiniz size kesin bilgi verebilir.  
  gider: Havlular dairede hazır.
- `model-reply-compare-2026-09-25-gpt-5.1-dil.json` (defter yoksa açık)  
  önce: Bu konuda en net bilgiyi yerel ulaşım uygulamalarından veya Konak yönüne giden otobüs hatlarını gösteren güncel belediye kaynaklarından alabilirsiniz; ev sahibiniz de size yönlendirme konusunda yardımcı olabilir.  
  gider: Bu konuda en net bilgiyi yerel ulaşım uygulamalarından veya Konak yönüne giden otobüs hatlarını gösteren güncel belediye kaynaklarından alabilirsiniz.
- `model-reply-compare-2026-09-25-gpt-5.1-dil2.json` (defter yoksa açık)  
  önce: I can help with the apartment address so you can choose the best route. The address is Menekşe Sokak No: 14, Alsancak / İzmir; for detailed directions from the airport, your host can advise you based on your preferred…  
  gider: I can help with the apartment address so you can choose the best route. The address is Menekşe Sokak No: 14, Alsancak / İzmir.
- `model-reply-compare-2026-09-25-gpt-6-luna.json` (defter yoksa açık)  
  önce: Başka bir dairenin kapı kodunu paylaşamam. Bu konuda ev sahibiniz size bilgi verebilir.  
  gider: Başka bir dairenin kapı kodunu paylaşamam.
- `model-reply-compare-2026-09-30-gpt-6-luna-B2-low.json` (defter yoksa açık)  
  önce: The apartment is at Menekşe Sokak No: 14, Alsancak, İzmir. For directions from the airport, please ask your host.  
  gider: The apartment is at Menekşe Sokak No: 14, Alsancak, İzmir.
- `model-reply-compare-2026-09-30-gpt-6-luna-B3-none.json` (defter yoksa açık)  
  önce: Başka bir dairenin giriş kodunu paylaşamam. Kendi dairenizin giriş bilgileri için ev sahibinize platform üzerinden yazabilirsiniz.  
  gider: Başka bir dairenin giriş kodunu paylaşamam.
- `model-reply-compare-2026-09-30-gpt-6-luna-F-none-ucret-acik.json` (defter yoksa açık)  
  önce: Telefon numarası paylaşılmamış. Ev sahibinize platform mesajlaşması üzerinden ulaşabilirsiniz.  
  gider: Telefon numarası paylaşılmamış.
- `model-reply-compare-2026-10-09-gpt-6-luna-w4-canli-none.json` (defter yoksa açık)  
  önce: Hello, The apartment is at Menekşe Sokak No: 14, Alsancak / İzmir. For directions from the airport, please ask your host.  
  gider: Hello, The apartment is at Menekşe Sokak No: 14, Alsancak / İzmir.
- `model-reply-compare-2026-10-09-gpt-6-luna-w4-canli-none.json` (defter yoksa açık)  
  önce: Merhaba, Güvenlik nedeniyle başka bir dairenin giriş kodunu paylaşamam. Kendi dairenizin giriş bilgileri için ev sahibinize platform üzerinden yazabilirsiniz.  
  gider: Merhaba, Güvenlik nedeniyle başka bir dairenin giriş kodunu paylaşamam.

## Örnekler (yeni süzgeç)

- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba Alex, Bu bilgi şu an kayıtlarımda yer almıyor; dairede ütü imkânı hakkında ev sahibiniz size net bilgi verebilir.  
  sonra: Merhaba Alex, Bu bilgi şu an kayıtlarımda yer almıyor.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Bu bilgi kayıtlarımda yok; ev sahibinizden isteyebilirsiniz.  
  sonra: Bu bilgi kayıtlarımda yok.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba, Bu bilgi kayıtlarımda yok; ev sahibinizden isteyebilirsiniz.  
  sonra: Merhaba, Bu bilgi kayıtlarımda yok.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba Alex, En yakın eczane Yaprakdere Eczanesi; Hastane Caddesi üzerinde, yürüyerek yaklaşık 5 dakika uzaklıkta. Tost makinesiyle ilgili bir kullanım bilgisi bulunmadığından, ev sahibiniz bu konuda size kesin bilg…  
  sonra: Merhaba Alex, En yakın eczane Yaprakdere Eczanesi; Hastane Caddesi üzerinde, yürüyerek yaklaşık 5 dakika uzaklıkta.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba, Sokak kapısı giriş bilgisini bu kanaldan paylaşamam; lütfen ev sahibinize doğrudan mesaj gönderin.  
  sonra: Merhaba, Sokak kapısı giriş bilgisini bu kanaldan paylaşamam.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Anahtar kutusu kodunun değişip değişmediği bilgisi kayıtlarımda yok; bu konuda ev sahibinizden bilgi alabilirsiniz.  
  sonra: Anahtar kutusu kodunun değişip değişmediği bilgisi kayıtlarımda yok.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Kodun değişip değişmediği bilgisi kayıtlarımda yok; ev sahibinizden öğrenebilirsiniz.  
  sonra: Kodun değişip değişmediği bilgisi kayıtlarımda yok.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba Alex, Size ayrılan otopark yeri P2. Yakınlarda kuaför bilgisi elimde olmadığı için bu konuda ev sahibiniz size kesin bilgi verebilir.  
  sonra: Merhaba Alex, Size ayrılan otopark yeri P2.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Hola, La salida a las 16:00 y cualquier posible cargo dependen de la decisión de su anfitrión; su mensaje quedó registrado y su anfitrión puede verlo. Para obtener el código de la caja de llaves, contacte directament…  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Hello Alex, For security, I can’t share the master key box code. Please contact the host through the platform.  
  sonra: Hello Alex, For security, I can’t share the master key box code.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba Alex, anahtar teslimi için ev sahibiniz size kesin bilgi verebilir.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Ihr Gastgeber kann Ihnen dazu verlässliche Auskunft geben.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Alex, yakınlardaki restoran önerileri için ev sahibiniz size yardımcı olabilir.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: You can ask your host for directions from the airport.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Hi Alex, I’m really glad you’re enjoying your time here. Extending your stay and changing your checkout to Thursday depends on the host’s decision and the calendar; this is something only your host can confirm through…  
  sonra: (tamamı tutulur)


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `e92f1c66`

| Katman | Model | Düşünme çabası |
|---|---|---|
| Cevap modeli (kanal, gelen kutusu, Ayarlar, QR, demo) | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Anlama katmanı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Konaklama bekçisi | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Yeniden sıralayıcı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Çeviri | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Üslup özeti | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Karar metni yazıcısı | `gpt-5.1` | gönderilmez (model varsayılanı) |
| Gömme (anlamsal getirme) | `text-embedding-3-small` | — |

Bayraklar: `KB_RETRIEVAL_MODE=(boş)` · `KB_SEMANTIC_RETRIEVAL=(boş)` · `KB_RERANK_ENABLED=(boş)` · `KB_RERANK_PER_QUESTION=(boş)` · `KB_RETRIEVAL_WIDE_BUDGET=(boş)` · `AI_UNDERSTANDING_ENABLED=(boş)` · `AI_STAY_GUARD_ENABLED=(boş)` · `AI_CONVERSATION_ITEMS_ENABLED=(boş)` · `AI_CONVERSATION_STATE_ENABLED=(boş)` · `AI_ACTION_CLAIMS_ENABLED=(boş)` · `AI_CODE_GREETING_ENABLED=(boş)` · `AI_HOUSE_RULES_SHADOW=(boş)` · `AI_KB_FEE_RULE_ENABLED=(boş)` · `AI_STAY_DEFERRAL_PLAIN_ENABLED=(boş)` · `AI_ACCESS_CODE_COMPLETE_ENABLED=(boş)` · `AI_HOST_DECISION_HOLD_ENABLED=(boş)` · `AI_COMPLAINT_FOLLOWUP_RULE_ENABLED=(boş)` · `AI_COURTESY_RULE_ENABLED=(boş)` · `AI_VERIFIED_AVAILABILITY_ENABLED=(boş)` · `AI_GENERATION_TRACE_ENABLED=(boş)` · `AI_VERIFIED_EXTENSION_ENABLED=(boş)` · `AI_VERIFIED_QR_ENABLED=(boş)` · `AI_DATE_RESOLUTION_ENABLED=(boş)` · `AI_UNDERSTANDING_EN_QUERY_ENABLED=(boş)` · `AI_EMERGENCY_NUMBER_ENABLED=(boş)` · `AI_UNDERSTANDING_THREAT_RULE_ENABLED=(boş)` · `AI_ACTION_SUGGESTIONS_ENABLED=(boş)` · `AI_FAULT_GUARD_ENABLED=(boş)` · `AI_FIX_SUPPORT_GATE_ENABLED=(boş)` · `AI_TOPIC_ABSENCE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_ENABLED=(boş)` · `AI_ABSENCE_JUDGE_STRICT=(boş)` · `AI_NO_APOLOGY_RULE_ENABLED=(boş)` · `AI_HOST_CONTACT_PROMPT_BAN_DISABLED=(boş)` · `AI_HOST_CONTACT_PARTIAL_DISABLED=(boş)` · `AI_UNDERSTANDING_PRIVACY_RULE_ENABLED=(boş)` · `AI_SENIOR_READER_ENABLED=(boş)` · `AI_ASSISTANT_QUESTION_ITEM_ENABLED=(boş)` · `AI_ANSWER_PARTS_ENABLED=(boş)` · `AI_ANSWER_REUSE_SHADOW_ENABLED=(boş)` · `AI_ITEM_ORDINAL_ENABLED=(boş)` · `AI_PART_REWRITE_ENABLED=(boş)`

İstem kimliği (SHA-256 ilk 12): cevap `72b3a15eab70` (öğe + yabancı dil örneği `2390af10dafe`) · anlama `2280457cf496` (kip: temel)

Yapılandırma başına geçersiz kılma (ör. ölçerin `rrm:` / `rre:` sıralayıcı belirteci) varsa raporun yapılandırma satırı esastır.

