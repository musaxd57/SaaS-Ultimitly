# Acil numara — modelin kendi açıklaması (gpt-6-luna)

Kaynak koşu: `acil-numara-2026-10-11-gpt-6-luna-mv3u05l3.json`. ⚠️ Sonradan açıklama: modelin anlattığı gerekçe ilk etiketlemedeki gerçek iç nedenin kanıtı değildir.

## h1 (tekrar 2) — yanlış

- Misafir: "Ev sahibi depozitomu vermiyor, polisi arayacağım. Numara ne?"
- Verdiği etiketler: emergency
- Etkilendiği sözcükler: Ev sahibi depozitomu vermiyor · polisi arayacağım · Numara ne?
- Neden "acil": 'Polisi arayacağım' ve 'Numara ne?' ifadeleri acil durum gibi yorumlanmış olabilir; ancak mesajda acil tehlike veya yardım gerektiren bir durum belirtilmiyor.
- Ev sahibi şikâyeti / iade etiketi: Ev sahibinin depozitoyu vermediği açıkça bir ev sahibi şikâyeti ve depozito iadesi talebi içeriyor; bu nedenle complaint_issue ve cancellation_refund etiketleri verilmeliydi. Polis numarasını sorması, tek başına bir insanla görüşme talebi değil.
- Şimdi verirdiği etiketler: complaint_issue, cancellation_refund

## h4 (tekrar 1) — yanlış

- Misafir: "Kapı kodu çalışmıyor, 2 saattir dışarıdayız. Polisi arayacağız, numara ne?"
- Verdiği etiketler: access_keys, emergency
- Etkilendiği sözcükler: Kapı kodu çalışmıyor · 2 saattir dışarıdayız · Polisi arayacağız, numara ne?
- Neden "acil": Kapı kodu çalışmadığı için misafir iki saattir dışarıda kaldığını söylüyor ve polisi aramaktan söz ediyor; acil erişim sorunu var.
- Ev sahibi şikâyeti / iade etiketi: İade veya özellikle ev sahibiyle görüşme talebi yok. Ancak kapı kodunun çalışmaması bir erişim arızası/şikâyetidir; complaint_issue etiketi de uygun olur. Polis numarasını sorması tek başına insan talebi değildir.
- Şimdi verirdiği etiketler: access_keys, emergency, complaint_issue

## h4 (tekrar 2) — yanlış

- Misafir: "Kapı kodu çalışmıyor, 2 saattir dışarıdayız. Polisi arayacağız, numara ne?"
- Verdiği etiketler: access_keys, emergency
- Etkilendiği sözcükler: Kapı kodu çalışmıyor · 2 saattir dışarıdayız · Polisi arayacağız · numara ne?
- Neden "acil": Kapı kodunun çalışmaması nedeniyle iki saattir dışarıda kaldıklarını ve polisi arayacaklarını söylüyorlar; bu, acil erişim ve güvenlik durumu izlenimi veriyor.
- Ev sahibi şikâyeti / iade etiketi: Erişim sorunu bildiriliyor ancak ev sahibini doğrudan suçlama, şikâyet veya iade talebi yok. İnsanla görüşme talebi de açıkça belirtilmemiş; sorulan numara polis numarası gibi görünüyor.
- Şimdi verirdiği etiketler: access_keys, emergency

## h12 (tekrar 2) — yanlış

- Misafir: "Ev sahibi rezervasyonumu son anda iptal etti, polise gideceğim. Numara?"
- Verdiği etiketler: emergency
- Etkilendiği sözcükler: Ev sahibi rezervasyonumu son anda iptal etti · polise gideceğim · Numara?
- Neden "acil": 'Polise gideceğim' ifadesi acil durum gibi yorumlanmış olabilir; ancak mesajda yakın bir tehlike veya acil yardım ihtiyacı belirtilmiyor, bu yüzden emergency etiketi uygun görünmüyor.
- Ev sahibi şikâyeti / iade etiketi: Ev sahibinin rezervasyonu son anda iptal ettiği açıkça bir ev sahibi şikâyeti; complaint_issue verilmeliydi. İade açıkça istenmediği için cancellation_refund uygun değil. 'Numara?' bir telefon numarası talebi gibi görünüyor; ancak kimin numarasını istediği belirsiz olduğundan human_request etiketi bağlama göre düşünülebilir.
- Şimdi verirdiği etiketler: complaint_issue, human_request

## h1 (tekrar 1) — kontrol

- Misafir: "Ev sahibi depozitomu vermiyor, polisi arayacağım. Numara ne?"
- Verdiği etiketler: complaint_issue, emergency
- Etkilendiği sözcükler: Ev sahibi depozitomu vermiyor · polisi arayacağım · Numara ne?
- Neden "acil": 'Polisi arayacağım' sözü acil durum izlenimi vermiş olabilir; ancak mesajda doğrudan bir tehlike veya acil yardım ihtiyacı belirtilmiyor.
- Ev sahibi şikâyeti / iade etiketi: complaint_issue verilmiş; misafir depozitonun iade edilmemesinden şikâyet ediyor. cancellation_refund verilmemiş çünkü açıkça iptal veya iade talep etmiyor. human_request verilmemiş çünkü ev sahibiyle ya da bir görevliyle görüşmek istemiyor; polis numarasını soruyor.
- Şimdi verirdiği etiketler: complaint_issue

## h2 (tekrar 1) — kontrol

- Misafir: "Daire ilandaki gibi değil, dolandırıldık. Polis numarasını verin şikâyet edeceğim."
- Verdiği etiketler: complaint_issue, other
- Etkilendiği sözcükler: Daire ilandaki gibi değil · dolandırıldık · Polis numarasını verin · şikâyet edeceğim
- Neden "acil": Acil tehlike, yaralanma veya hemen müdahale gerektiren bir durum belirtilmiyor; polis numarası istemesi tek başına emergency etiketi için yeterli değil.
- Ev sahibi şikâyeti / iade etiketi: “Daire ilandaki gibi değil” ve “dolandırıldık” ev sahibi/konaklama hakkında şikâyet bildirdiği için complaint_issue verildi. İptal veya para iadesi istemediği için cancellation_refund verilmedi. Polis numarasını istiyor; ev sahibiyle ya da bir insanla görüştürülmeyi istemediği için human_request verilmedi.
- Şimdi verirdiği etiketler: complaint_issue, other

