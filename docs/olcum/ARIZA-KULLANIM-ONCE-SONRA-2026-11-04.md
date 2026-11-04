# Arıza ↔ kullanım — anlama katmanı ÖNCE / SONRA (11-04, kurucu onayı için)

Kurucu 11-04: "her zaman şikâyet sabit sözcük kuralına dönüşmesin — varsayım, olumsuzlama, çözülmüş durum bağlamdan okunmalı; bağımsız güvenli
soru cevaplansın; önce / sonra testlerini (konuşma geçmişi dahil) görürsem onaylarım." Bu belge o kanıttır. **Ürün istemi DEĞİŞMEDİ** — kural
yalnız ölçümde istemin niyet satırının ardına eklenir (`tests/eval/understanding-breakdown.eval.test.ts`, `EVAL_UNDERSTANDING_FAULT_RULE=2`).

**Ne ölçülüyor:** yalnız anlama MODELİNİN etiketleri (gpt-5.1, canlı kip = öğe + ilişki istemi, her vaka 2 tur), set `evals/understanding-breakdown.json`
v2 (37 vaka; kural örnekleri ÜTÜ üzerinden — test cümleleri kuralda geçmez, pinli). Yerel koşu 11-04 sabah; aynı koşu + Haiku kolları istek 9'da.
Etiketlerin ürün karşılığı: **arıza** = şikâyet öğesi, ev sahibinde tutulur (ev sahibine iş / bildirim; o konuya bağlı istek cevaplanmaz) ·
**ACİL** = bugünkü acil yol (yapay zekâ o turda susar, ev sahibine acil uyarı) · **kullanım / Wi-Fi / çöp** = bilgi tabanından cevaplanabilir istek.

**Kural (v2, özet):** şu an bozuk / çalışmıyor bildirimi arızadır (nasıl düzelir diye sorsa da); "çalışmazsa ne yapalım?" varsayımı ve "bozuk değil,
sadece bulamadık" kullanım sorusudur; "çalışmıyordu, şimdi düzeldi" hiçbiri değildir; konuşmada zaten cevaplanmış arıza yeni istek değildir;
"dediğiniz gibi yaptım, hâlâ çalışmıyor" arızadır; duman / kıvılcım / yanık kokusu ACİL'dir (kullanım asla); bağımsız sorular ayrı kalır.

## Kategori bazında (canlı kip, doğru tur / toplam tur)

| kategori | bugünkü istem | v2 kuralı |
|---|---|---|
| arıza bildirimi | 22/22 | 22/22 |
| kullanım sorusu | 17/18 | 18/18 |
| varsayımsal ("…ısınmazsa?") | 6/6 | 6/6 |
| çözülmüş ("…ama şimdi düzeldi") | **2/6** | **6/6** |
| olumsuzlanan ("bozuk değil, sadece…") | 4/4 | 4/4 |
| arıza + bağımsız soru | 4/4 | 4/4 |
| arıza + tehlike | **0/4** | **3/4** |
| konuşma geçmişli | 10/10 | 10/10 |
| **toplam** | **65/74** | **73/74** |

Temel kip (öğesiz eski istem): 64/74 → 72/74; tek gerileme "İnternet iki saattir yok, modemi nasıl resetleriz?" (temelde yalnız "kullanım";
canlı kipte iki istemde de doğru).

## Kurucunun beş cümlesi (aynı sınıftan set vakaları)

| Mesaj | Beklenen | Bugünkü istem (2 tur) | Bağlam kuralı v2 (2 tur) |
|---|---|---|---|
| Tost makinesi ısınmazsa ne yapmalıyım? | kullanım bilgisi, arıza AÇILMAZ | ✓ kullanım · ✓ kullanım | ✓ kullanım · ✓ kullanım |
| Tost makinesi ısınmıyordu ama şimdi düzeldi, teşekkürler. | aktif arıza YOK | ✓ teşekkür · ✓ kullanım + teşekkür | ✓ — · ✓ teşekkür |
| Tost makinesi ısınmıyor; çöpleri nereye atıyoruz? | arıza ev sahibinde + soru cevaplanır | ✓ arıza + kullanım + çöp · ✓ arıza + kullanım + çöp | ✓ arıza + kullanım + çöp · ✓ arıza + kullanım + çöp |
| Tost makinesi ısınmıyor, prizden duman çıkıyor. | ACİL (kullanım tarifi yok) | ✗ ACİL + kullanım + arıza · ✗ ACİL + arıza + kullanım | ✗ ACİL + arıza + kullanım · ✓ ACİL + arıza |
| Tost makinesi hiç ısınmıyor, ekmek kızarmıyor. Wi-Fi şifresi neydi? | arıza → ev sahibine iş | ✓ arıza + kullanım + Wi-Fi · ✓ arıza + kullanım + Wi-Fi | ✓ arıza + kullanım + Wi-Fi · ✓ arıza + kullanım + Wi-Fi |

## Konuşma geçmişli vakalar

| Önceki mesajlar | Son mesaj | Beklenen | Bugünkü istem | v2 kuralı |
|---|---|---|---|---|
| Misafir: Tost makinesi ısınmıyor. ⟶ Biz: Haber verdiğiniz için teşekkürler, yarın sabah teknisyen gelecek. | Wi-Fi şifresi neydi? | yalnız Wi-Fi (arıza zaten cevaplandı) | ✓ Wi-Fi · ✓ Wi-Fi | ✓ Wi-Fi · ✓ Wi-Fi |
| Misafir: Tost makinesini nasıl çalıştırıyoruz? ⟶ Biz: Fişe takıp sağdaki düğmeyi 3'e getirmeniz yeterli. | Dediğiniz gibi yaptım ama hâlâ ısınmıyor. | arıza (tarif işe yaramadı) | ✓ arıza + kullanım · ✓ arıza + kullanım | ✓ arıza + kullanım · ✓ arıza + kullanım |
| Misafir: Tost makinesi ısınmıyor. | Tamam boşverin, fişi gevşekmiş, şimdi çalışıyor. | aktif arıza YOK | ✓ kullanım + — · ✓ kullanım + — | ✓ — + — · ✓ — + — |
| Misafir: Where is the toaster? ⟶ Biz: It's in the cupboard under the counter. | Found it, but it doesn't heat up at all. | arıza (buldu ama ısınmıyor) | ✓ arıza + kullanım · ✓ arıza + kullanım | ✓ arıza + kullanım · ✓ arıza + kullanım |
| Misafir: Teşekkürler, her şey çok güzel. ⟶ Biz: Rica ederiz, iyi tatiller! | Bu arada tost makinesi ısınmazsa kimi arayalım? | arıza AÇILMAZ (varsayım) | ✓ kullanım · ✓ kullanım + ev sahibi isteği | ✓ kullanım · ✓ kullanım |

## Değişen vakalar (bugün ✗ olan ya da v2'de değişen)

| Mesaj | Beklenen | Bugünkü istem | v2 kuralı |
|---|---|---|---|
| Klima kumandası nerede, bulamadık. | kullanım bilgisi, arıza AÇILMAZ | ✓ kullanım + kullanım · ✗ kullanım + arıza | ✓ kullanım · ✓ kullanım |
| The kettle wasn't working earlier but it's fine now, thanks! | aktif arıza YOK | ✗ arıza + kullanım · ✗ arıza + kullanım | ✓ — · ✓ — |
| Die Waschmaschine hat vorhin nicht geschleudert, jetzt geht sie wieder. | aktif arıza YOK | ✗ arıza + kullanım · ✗ arıza + kullanım | ✓ — · ✓ — |
| Tost makinesi ısınmıyor, prizden duman çıkıyor. | ACİL (kullanım tarifi yok) | ✗ ACİL + kullanım + arıza · ✗ ACİL + arıza + kullanım | ✗ ACİL + arıza + kullanım · ✓ ACİL + arıza |
| The kettle stopped working and there are sparks coming from the socket! | ACİL (kullanım tarifi yok) | ✗ ACİL + arıza + kullanım · ✗ ACİL + arıza + kullanım | ✓ ACİL + arıza · ✓ ACİL + arıza |


**Kalan tek hata (v2, 1/74):** "Tost makinesi ısınmıyor, prizden duman çıkıyor." bir turda ACİL'in yanına "kullanım" da yazıldı. Üründe misafire bir
şey göndertmez: tur içinde acil öğe varken yapay zekâ o turda susar (`conversation-items/core.ts hasEmergency`), ev sahibine acil uyarı gider.

**Kodun ikinci katmanı (bilgi):** `AI_FAULT_GUARD_ENABLED` (açılış listesinde, "ilk denemeler birlikte") anlama modeli arızayı kaçırsa da isteğin
kendi sorgusunda cihaz + arıza ifadesi varsa şikâyet öğesi ekler; koşul ("arıza yaparsa", "if it breaks"), düzelme ("çalışmadı ama sonra düzeldi")
ve misafirin kendi eşyası arıza sayılmaz. Bu ölçüm o katmanı İÇERMEZ (yalnız model).

## Karar sorusu
v2 kuralı ürünün anlama istemine girsin mi? Misafire / ev sahibine etkisi: (1) "çalışmıyordu, şimdi düzeldi" artık ev sahibine arıza işi AÇMAZ;
(2) duman / kıvılcım mesajında "kullanım" etiketi düşer (zaten acil yol); (3) "kumanda nerede, bulamadık" arıza sayılmaz. Öbür sınıflar bugünkü
gibi. Haiku'nun aynı kuralla sonuçları istek 9'da (5.1 aynı koşuda yeniden).

## CI tekrarı (istek 9, 11-04 akşam) + Haiku
5.1 bugünkü istem 64/74 → v2 73/74 (temel 61 → 72) — sabah yerel ölçümü BİREBİR tekrarladı. Haiku + v2: high 67/74, düşünme kapalı 69/74 (çözülmüş arızayı açıyor, geçmişli 8/10) → anlama 5.1'de kalır. Kural ürüne anahtar arkasında girdi: `AI_UNDERSTANDING_FAULT_CONTEXT_ENABLED` (kapalı; açmak kurucu onayı). Ölçülen = gönderilen: ölçer ürünün sabitini aynı yere koyar (pin).
