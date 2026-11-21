# Kurucu cevapları — 21 Kasım sabah (AYNEN)

> Sorular: gece raporu (FB metinleri · müsaitlik gece sayısı T8-B2 · QR tek cevap S-F4b-1 · e-posta düğmesi). Cevaplar değiştirilmeden.
> Aynı sabah kurucu CI kırmızısını sordu: "devam edebilirsin, ya kırmızı bu tam kapı yeşildi neden kırmızı oldu ki o zzaman? soruların varsa sor
> sabah oldu".

## FB metin düzeltmeleri (açılış, panel, e-posta)
Hepsini uygula (Önerilen)

## Müsaitlik sorusunda gece sayısı (T8-B2)
Önce geçici, sonra kalıcı (Önerilen)

## QR'da birden çok mesaja tek cevap — biri cevaplanamıyorsa (S-F4b-1)
wifi cevabı gitsin ve mesela adam ütü var mı diye sordu ya aslında aynı zamanda yeri de soruyor model onu anlayabiliyor dimi bunu ücretli
testlerle çok geliştirelim. ve hostun eski cevaplarında bakmasına rağmen görmüyorsaki durum için mi o nasıl bir durum. fablelarda sorunları
çözdüyse- işlerini kodlarını bırakbilecekleri yere getirdiklerinde onlarda bitirsin sen didik didik kontrol gerekirse revizeni yap kapıyı başlat
yeni pushta dikkat et kırmızı olmasın ondan sonra dur. şuanlık böyle kalsın buna bir ara çok sert yönelelim

## Bildirim e-postalarına düğme
Evet, ekle (Önerilen)

## Uygulama
- FB'nin üç METİN commit'i dala alındı (başlıkları "METIN (kurucu onayladi 11-21)").
- T8-B2 geçici kural: süre / bitiş yazılmış müsaitlik sorusunda kod metni kurulmaz (`ai/verified-availability.ts` `mentionsStayLengthOrEnd`);
  kalıcı çözüm (model okur, kod kıyaslar) kredi gelince ücretli ölçümle.
- QR tek cevap: anahtar KAPALI ve davranış ŞİMDİLİK aynen; kurucunun yönü (cevaplanabilen kısım gitsin + "ütü var mı" = varlık + yer sorusunu
  modelin anlaması, ücretli testlerle) ayrı ve sert bir çalışma olarak açık işlerde.
- E-posta düğmeleri: metin + görsel ÖNCE kurucuya gösterilir, onaydan sonra kod.
- Fable'lar bitince kontrol + kapı + kırmızısız push, sonra dur.
