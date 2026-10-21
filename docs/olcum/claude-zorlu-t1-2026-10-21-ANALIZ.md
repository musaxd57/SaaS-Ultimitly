# Claude zorlu testler — kurucu T1 ölçümü (10-21): analiz ve sıradaki iş

Kaynak rapor: `docs/olcum/claude-zorlu-t1-2026-10-21.md` (commit `00ba57a`, üretici Claude Sonnet, hakem Claude Opus, kategori başına 30;
GitHub Actions `claude-eval.yml`, anahtar Actions sırrında). Ölçer: `tests/eval/claude-t1.eval.test.ts`. Aynı koşuda eski zorlu set
`docs/olcum/claude-zorlu-2026-10-21.md` — 10-15 koşusuyla aynı düzeyde (gerileme yok; bunlar model düşünce devreye giren tabanın bilinen sınırları).

Ölçülen: ürünün DETERMİNİSTİK son kapıları (model çağrılmaz). ⚠️ Ayrım kategorilerinde modelin ilişki işareti en gevşek durum ("kendi konusu")
varsayılır — canlıda anlama modeli çoğu bağlı soruyu zaten "bağlı" işaretler; ölçülen, model yanılırsa kodun yakaladığı.

| Kategori | Doğru karar | Iska / vaka | Tür |
|---|---|---|---|
| "Talimat yok" + bilgi tabanında OLMAYAN yönerge | tut | 3 / 30 | yanlış gönderim |
| "Talimat yok" + bilgi tabanında YAZAN yönerge | gönder | 18 / 30 | gereksiz tutma |
| İç kaynak anlatımı ("bilgi tabanımda yok", "sistemde görünmüyor") | tut | 21 / 30 | yanlış gönderim |
| Sistem / kayıt sözcüklü normal cevap | gönder | 0 / 30 | — |
| Arıza + ona BAĞLI soru | tut | 17 / 31 | yanlış gönderim (model yanılırsa) |
| Arıza + ondan BAĞIMSIZ soru | gönder | 7 / 30 | gereksiz tutma |

## Kök nedenler (ıskalar okunarak)
1. **İç kaynak anlatımı (21):** `admitsMissingKnowledge` kalıpları dar: "isn't covered in the material I've been working from", "not in my
   prompt", "loaded into my context", "FAQ entries I can pull up", "searched the knowledge base … nothing", "in der mir vorliegenden
   Wissensdatenbank nichts hinterlegt", "no aparece en nuestro sistema", "لا يوجد في سجلاتنا", "bana tanımlanan bilgilerin içinde",
   "elimdeki bilgi notlarında", "sistem sorgusunda eşleştiremedim", "fiche du logement qui m'a été transmise". Yedi dilde kaynak / bağlam /
   arama / kayıt sözcüğü + yokluk yüklemi ailesi genişletilmeli (ReDoS kuralına uygun, sınırlı boşluklu).
2. **Dayanak gereksiz tutma (18):** `sentenceGroundedInKb` 5 harflik gövde + %75 eşiği çok katı: Türkçe çekim / türetme ("bırakmanızı" ↔
   "bırakın", "söndürülmesini" ↔ "söndürün"), 12 / 24 saat ("10 PM" ↔ "22:00"), yazıyla sayı ("twenty-five" ↔ "25"), birden çok kalemden
   birleşik cümle (tek kalem şartı), "solo que / si ce n'est / other than / beyond" istisna kalıpları silicide kalan cümleyi yanlış böler.
   Öneri: gövde 4 harf + kalem BİRLEŞİMİ (cümle başına en çok 2 kalem), saat normalleştirme (12 sa → 24 sa), yazıyla sayı sözlüğü (TR/EN),
   istisna bağlaçlarının silici izin listesine eklenmesi. Her değişiklikte yanlış gönderim 0 korunacak (aynı ölçer + birim seti).
3. **Dayanak yanlış gönderim (3, ar/ru):** kalemle büyük örtüşme + KÜÇÜK uydurma ek (pasaport fotoğrafı şartı, "2 saat önce" ↔ "24 saat",
   kask "dahil" ↔ "2 €"). Sayı tam belirteç kuralı "2" ile "24"ü ayırıyor ama Rusça "за 2 часа" ↔ "за 24 часа" vakasında "2" başka yerde
   geçiyor; çözüm: sayı + birim çifti kıyası ve kalemde olmayan YENİ şart / yükümlülük fiili (gerek / zorunlu / must / нужно / يجب) varsa dayanaksız.
4. **Bağlı soru (17, model yanılırsa):** çoğu GÜVENLİK bağı (kıvılcım + şarj, CO alarmı + şömine, kaynar su + bebek, küf + astım, bozuk
   buzdolabı + insülin). Kod erişim bağını (kapı / anahtar / otopark) biliyor, güvenlik bağını bilmiyor. Öneri: arıza tehlike sınıfındaysa
   (elektrik / gaz / CO / su baskını / sıcak su / küf / haşere) aynı mesajdaki "kullanabilir miyiz / güvenli mi / -ebilir miyiz" kipli her
   soru bağlı sayılsın (tutucu yön). Müşteriye gideni değiştirir → kurucuya önce/sonra örnekli sorulmalı.
5. **Bağımsız soru gereksiz tutma (7):** konu sözcüğü örtüşmesi (balkon kapısı kilidi + bavul bırakma, duman dedektörü + mangal kuralı).
   Erişim kelime ağı "check-out / bırakma" gibi fiilleri yakalıyor; düzeltme 2. sıradaki tutucu kuralla dengelenmeli.

## Sıra (clear sonrası)
1. İç kaynak kalıpları (1) — anahtarsız, tutucu yön (yalnız TUTAR), kurucunun 10-21 T1 kuralının ("iç kaynak anlatımı yazılmayacak") doğrudan
   uygulaması → yap, haber ver. Süre pini + yanlış tutma kontrolü ("Sistem / kayıt sözcüklü normal cevap" 0 kalmalı).
2. Dayanak gevşetme (2) + yeni şart fiili (3) — misafire GİDENİ artırır (gereksiz tutma azalır) → önce/sonra örnekle kurucuya sor.
3. Güvenlik bağı (4) + bağımsız soru (5) — müşteriye gideni değiştirir → kurucuya sor.
4. Her turdan sonra aynı Claude ölçerini yeniden koştur (`evals/claude-run-request.json` → `request` +1, suite `tests/eval/claude-`).
