# K-1029-A tekrar oynatma — ev sahibine yönlendirme süzgeci (ücretsiz, model yok)

Kaynak: `docs/olcum/*.json` içindeki 3274 benzersiz model cevabı (geçmiş ölçümlerin çıktısı, kurgusal fikstür). Model ÇAĞRILMADI.

## Yeni süzgeç

| Ölçü | Sayı |
|---|---|
| Yönlendirme parçası silinen cevap | 245 (%7.5) |
| Silinen parça (toplam) | 245 |
| — tür: yaz / ara / başvur | 22 / 0 / 223 |
| — biçim: koşullu / başvurma | 22 / 223 |
| — genel kapanış / konulu | 4 / 241 |
| — yalnız yan cümle silindi (cümlenin başı kaldı) | 18 |
| Cevabın TAMAMI tutulur (geriye içerik kalmadı) | 221 |
| Kalan doğru cevap gider | 24 |
| — defter olmayan yolda (QR / öğe kipi kapalı) ev sahibine açık kalır — ÜST SINIR (anlama koşmamış sayıldı) | 24 |
| — misafir olasılık sordu (soru her zaman açık) | 1 |

### Dile göre

| Dil | Cevap | Silme olan |
|---|---|---|
| tr | 1741 | 141 |
| en | 764 | 28 |
| de | 271 | 5 |
| ru | 194 | 66 |
| es | 128 | 1 |
| ar | 75 | 0 |
| fr | 62 | 0 |
| ? | 39 | 4 |

## Eski süzgeçle kıyas (0e0e1a1e (K-1029-A öncesi))

| Ölçü | Sayı |
|---|---|
| Eski süzgeç metni değiştirdi | 0 |
| Eski süzgeç tamamını tuttu | 2 |
| Tutuş KAZANILDI (yeni tutar, eski göndermişti) | 219 |
| Tutuş KAYBEDİLDİ (eski tutuyordu, yeni kalan doğru cevabı gönderir) | 0 |
| Süzgeç çıktısı farklı | 24 |
| **SİSTEM: yeni tutuş** (süzgeç + "bilgim yok" + çıktı vetosu; eski yol gönderiyordu) | 6 |
| **SİSTEM: kalkan tutuş** (eski yol tutuyordu, yeni gönderir) | 7 |
| **SİSTEM: iki yol da gönderir ama metin farklı** (yönlendirme cümlesi çıktı) | 14 |

### Kalkan tutuş örnekleri (eski yol cevabın TAMAMINI tutuyordu; yeni yol yönlendirme / devir cümlesini silip kalanı gönderir)

Öğe kipinde istek açık kalır ("cevaplandı" kuralı); defter olmayan yolda "açık" = kanal tutar, QR kalanı gönderip devreder.

- `BAGLAM-HAKEMI-2026-10-21.json` (defter yoksa açık)  
  önce: Merhaba Alex, En yakın eczane Yaprakdere Eczanesi; Hastane Caddesi üzerinde, yürüyerek yaklaşık 5 dakika uzaklıkta. Tost makinesiyle ilgili bir kullanım bilgisi bulunmadığından, ev sahibiniz bu konuda size kesin bilg…  
  gider: Merhaba Alex, En yakın eczane Yaprakdere Eczanesi; Hastane Caddesi üzerinde, yürüyerek yaklaşık 5 dakika uzaklıkta.
- `BAGLAM-HAKEMI-2026-10-21.json` (defter yoksa açık)  
  önce: Merhaba Alex, Size ayrılan otopark yeri P2. Yakınlarda kuaför bilgisi elimde olmadığı için bu konuda ev sahibiniz size kesin bilgi verebilir.  
  gider: Merhaba Alex, Size ayrılan otopark yeri P2.
- `BAGLAM-HAKEMI-2026-10-21.json` (defter yoksa açık)  
  önce: Merhaba Alex, Size ayrılan otopark yeri P2. Yakınlardaki kuaför için ev sahibiniz size kesin bilgi verebilir.  
  gider: Merhaba Alex, Size ayrılan otopark yeri P2.
- `founder-initial-8-eval-2026-10-09-gpt-6-luna-7.json` (defter yoksa açık)  
  önce: Havlular dairede hazır; yerleri için ev sahibiniz size kesin bilgi verebilir.  
  gider: Havlular dairede hazır.
- `model-reply-compare-2026-09-25-gpt-5.1-dil.json` (defter yoksa açık)  
  önce: Bu konuda en net bilgiyi yerel ulaşım uygulamalarından veya Konak yönüne giden otobüs hatlarını gösteren güncel belediye kaynaklarından alabilirsiniz; ev sahibiniz de size yönlendirme konusunda yardımcı olabilir.  
  gider: Bu konuda en net bilgiyi yerel ulaşım uygulamalarından veya Konak yönüne giden otobüs hatlarını gösteren güncel belediye kaynaklarından alabilirsiniz.
- `model-reply-compare-2026-09-30-gpt-6-luna-B2-low.json` (defter yoksa açık)  
  önce: The apartment is at Menekşe Sokak No: 14, Alsancak, İzmir. For directions from the airport, please ask your host.  
  gider: The apartment is at Menekşe Sokak No: 14, Alsancak, İzmir.
- `model-reply-compare-2026-10-09-gpt-6-luna-w4-canli-none.json` (defter yoksa açık)  
  önce: Hello, The apartment is at Menekşe Sokak No: 14, Alsancak / İzmir. For directions from the airport, please ask your host.  
  gider: Hello, The apartment is at Menekşe Sokak No: 14, Alsancak / İzmir.

### Sistem düzeyinde yeni tutuş örnekleri (eski yol misafire gönderiyordu)

- `BAGLAM-HAKEMI-2026-10-21.json`: Thank you for letting me know, Alex. If anything comes up during your stay, you can always reach me here.
- `BAGLAM-HAKEMI-2026-10-21.json`: Merhaba, Ev sahibinizle platform mesajlaşması üzerinden iletişim kurabilirsiniz.
- `conversation-state-eval-2026-10-09-gpt-6-luna-7.json`: Hello, Checking out around 8:00 a.m. is fine; please let your host know you’ll be leaving early. Before you leave, return the key to the key box, close the windows and air conditioning, and leave used towels in the b…
- `model-reply-compare-2026-09-25-gpt-5.1.json`: Thank you for letting me know, Alex. If you need anything during your stay, you can always write to me here.
- `model-reply-compare-2026-10-09-gpt-5.1-w3-varsayilan.json`: Hi Alex, thanks for letting me know, I’m glad everything is okay. If you need anything during your stay, you can always send me a message here.
- `model-reply-compare-2026-10-09-gpt-5.1-w4-canli-varsayilan.json`: Merhaba, Rica ederim, ne zaman ihtiyaç olursa yazabilirsiniz.

## Örnekler (yeni süzgeç)

- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba Alex, Bu bilgi şu an kayıtlarımda yer almıyor; dairede ütü imkânı hakkında ev sahibiniz size net bilgi verebilir.  
  sonra: Merhaba Alex, Bu bilgi şu an kayıtlarımda yer almıyor.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Bu bilgi kayıtlarımda yok; ev sahibinizden isteyebilirsiniz.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba, Bu bilgi kayıtlarımda yok; ev sahibinizden isteyebilirsiniz.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba Alex, En yakın eczane Yaprakdere Eczanesi; Hastane Caddesi üzerinde, yürüyerek yaklaşık 5 dakika uzaklıkta. Tost makinesiyle ilgili bir kullanım bilgisi bulunmadığından, ev sahibiniz bu konuda size kesin bilg…  
  sonra: Merhaba Alex, En yakın eczane Yaprakdere Eczanesi; Hastane Caddesi üzerinde, yürüyerek yaklaşık 5 dakika uzaklıkta.
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba, Sokak kapısı giriş bilgisini bu kanaldan paylaşamam; lütfen ev sahibinize doğrudan mesaj gönderin.  
  sonra: (tamamı tutulur)
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
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Thank you for letting me know, Alex. If anything comes up during your stay, you can always reach me here.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Merhaba Alex, anahtar teslimi için ev sahibiniz size kesin bilgi verebilir.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Продление проживания ещё на одну ночь — решение хозяина; ваше сообщение сохранено, и хозяин может его увидеть. Запрос на изменение бронирования можно отправить через платформу.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Ihr Gastgeber kann Ihnen dazu verlässliche Auskunft geben.  
  sonra: (tamamı tutulur)
- `BAGLAM-HAKEMI-2026-10-21.json`  
  önce: Alex, yakınlardaki restoran önerileri için ev sahibiniz size yardımcı olabilir.  
  sonra: (tamamı tutulur)


## Koşu kimliği (katman bazında model + düşünme ayarı)

Commit: `cee4a57d`

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

