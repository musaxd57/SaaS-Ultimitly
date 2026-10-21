import { describe, it, expect } from "vitest";
import {
  wifiTargetAmbiguous,
  wifiValueCount,
  applyWifiValue,
  AUTO_PROMOTION_MIN_DECISIONS,
  detectHostPromise,
  contextHalfHint,
  contextSaysNow,
  detectHostPromises,
  MAX_PROMISES_PER_MESSAGE,
  extractWifiValues,
  kbContainsValue,
  maskSecret,
  parseSuggestionKey,
  promiseWindow,
  promotionReadiness,
  suggestionKey,
  type SuggestionDecision,
} from "@/lib/ai-suggestions/core";

// ---------------------------------------------------------------------------
// ⑤ ilk dilim (kurucu 10-12: "A + B + C"): saf çekirdek — söz tespiti, Wi-Fi değer çıkarımı, anahtar biçimi, otomatiğe geçiş ölçütü.
// ---------------------------------------------------------------------------

describe("C · ev sahibinin sözü", () => {
  it.each([
    ["Yarın sabah teknisyen gelecek, kombiye bakacak.", "maintenance", "tomorrow"],
    ["Birazdan temizlikçi gelecek.", "cleaning", "today"],
    ["Havluları 18:00'de getireceğim.", "towels", "today"],
    ["Tuvalet kağıdı göndereceğim.", "supplies", "today"],
    ["I'll bring fresh towels in 30 minutes.", "towels", "today"],
    ["The technician will come tomorrow to fix the AC.", "maintenance", "tomorrow"],
    ["Our cleaner is on the way.", "cleaning", "today"],
  ])("%s → %s / %s", (text, kind, day) => {
    expect(detectHostPromise(text)).toMatchObject({ kind, day });
  });

  it.each([
    ["Havlular dolapta.", "söz fiili yok"],
    ["İsterseniz havlu getirebilirim.", "teklif"],
    ["If you need, I'll bring towels.", "koşul"],
    ["Teknisyen yarın gelecek mi?", "soru"],
    ["Teknisyen gelmeyecek maalesef.", "olumsuz"],
    ["Yarın görüşürüz, iyi akşamlar.", "konu yok"],
    ["", "boş"],
    // Haiku 10-12: sıfat "gelecek" · olumsuzluk · tanınmayan gün · "team" içinde "tea".
    ["Yarın gelecek misafirler için havlu hazırladım.", "sıfat"],
    ["Temizlikçi gelecek değil.", "olumsuz"],
    ["Temizlikçi gelecek hafta izinli.", "olumsuz / gelecek hafta"],
    ["Pazartesi teknisyen gelecek.", "tanınmayan gün"],
    ["I'll let the team know.", "konu yok (team ≠ tea)"],
    ["The technician won't come today.", "olumsuz"],
  ])("%s → söz değil (%s)", (text) => {
    expect(detectHostPromise(text)).toBeNull();
  });

  it("gün YALNIZ sözün cümleciğinden (Haiku 10-12): 'Teknisyen bugün gelecek. Yarın havlu getiririm.' → bakım bugün", () => {
    expect(detectHostPromise("Teknisyen bugün gelecek. Yarın havlu getiririm.")).toMatchObject({ kind: "maintenance", day: "today" });
    expect(detectHostPromise("Teknisyen 30 dakika içinde gelecek. Yarın havlu getiririm.")).toMatchObject({ kind: "maintenance", day: "today", inMinutes: 30 });
  });

  it("son an: açık saat → şimdiden sonraki ilk aday; AÇIK göreli süre; saat yoksa UYDURULMAZ (kurucu 10-17: gün ya da 'kısa süre içinde')", () => {
    const at10 = 10 * 60;
    expect(promiseWindow(detectHostPromise("Havluları 18:00'de getireceğim.")!, at10)).toEqual({ day: "today", precision: "time", time: "18:00", end: 1080 });
    expect(promiseWindow(detectHostPromise("Havluları 6'da getireceğim.")!, at10)).toEqual({ day: "today", precision: "time", time: "18:00", end: 1080 });
    expect(promiseWindow(detectHostPromise("I'll bring fresh towels in 30 minutes.")!, at10)).toEqual({ day: "today", precision: "time", time: "10:30", end: 630 });
    expect(promiseWindow(detectHostPromise("Yarın teknisyen gelecek.")!, at10)).toEqual({ day: "tomorrow", precision: "day", end: 1439 });
    expect(promiseWindow(detectHostPromise("Temizlikçi gelecek.")!, at10)).toEqual({ day: "today", precision: "day", end: 1439 });
    // "Birazdan" süre değil: saat yazılmaz, "kısa süre içinde" (eskiden şimdi + 60 dk uyduruluyordu).
    expect(promiseWindow(detectHostPromise("Birazdan temizlikçi gelecek.")!, 23 * 60 + 30)).toEqual({ day: "today", precision: "part", dayPart: "soon", end: 1439 });
  });

  // Haiku 10-12 2. tur.
  it("rakamlar arasındaki nokta cümlecik bölmez ('09.30', '1.5'); ondalık süre dakikaya çevrilir", () => {
    expect(detectHostPromise("Teknisyen saat 09.30'da gelecek.")).toMatchObject({ kind: "maintenance", timeCandidates: [9 * 60 + 30] });
    expect(detectHostPromise("Temizlikçi 1,5 saat içinde gelecek.")).toMatchObject({ kind: "cleaning", inMinutes: 90 });
    expect(detectHostPromise("Temizlikçi 1.5 saat içinde gelecek.")).toMatchObject({ kind: "cleaning", inMinutes: 90 });
    expect(detectHostPromise("Teknisyen 2 saat sonra gelecek.")).toMatchObject({ inMinutes: 120 });
    // Cümle sonu noktası ("saat 10.") yine böler: ikinci cümlecikteki söz kendi saatini taşır.
    expect(detectHostPromise("Kahvaltı saat 10. Temizlikçi gelecek.")).toMatchObject({ kind: "cleaning", timeCandidates: [] });
  });

  it("'değil' / 'yok' yalnız söz fiilinin parçasında ve fiilden SONRA olumsuzlar; başka parçadaki 'yok' sözü bozmaz", () => {
    expect(detectHostPromise("Havlu yok demişsiniz, yarın getireceğim havluları.")).toMatchObject({ kind: "towels", day: "tomorrow" });
    expect(detectHostPromise("Sorun yok, teknisyen yarın gelecek.")).toMatchObject({ kind: "maintenance", day: "tomorrow" });
    expect(detectHostPromise("Sorun yok yarın teknisyen gelecek.")).toMatchObject({ kind: "maintenance" }); // aynı parça, fiilden ÖNCE
    expect(detectHostPromise("Bugün gelecek teknisyen yok.")).toBeNull();
    expect(detectHostPromise("Havlu getirecek kimse yok.")).toBeNull();
    expect(detectHostPromise("Teknisyen gelecek ama iptal olabilir.")).toBeNull(); // iptal cümlecik boyunca
  });

  it("konu önce söz fiilinin parçasında aranır: 'Klima için teşekkürler, yarın havlu getireceğim' → havlu (bakım değil)", () => {
    expect(detectHostPromise("Klima için teşekkürler, yarın havlu getireceğim.")).toMatchObject({ kind: "towels" });
    // Fiilin parçasında konu yoksa cümlecik geneline düşer.
    expect(detectHostPromise("Kombi için, yarın getireceğim.")).toMatchObject({ kind: "maintenance" });
  });

  it("gün dilimi: açık saat yoksa DİLİM olarak tutulur (kurucu 10-17: 'akşam yazmışsa akşam'); pencere sonu gecikme hesabı için; açık saati öğleden önce / sonra süzer", () => {
    const at14 = 14 * 60;
    expect(promiseWindow(detectHostPromise("Yarın sabah teknisyen gelecek.")!, at14)).toEqual({ day: "tomorrow", precision: "part", dayPart: "morning", end: 720 });
    expect(promiseWindow(detectHostPromise("Bu akşam havlu getireceğim.")!, at14)).toEqual({ day: "today", precision: "part", dayPart: "evening", end: 1439 });
    expect(promiseWindow(detectHostPromise("Bu gece havlu getireceğim.")!, at14)).toEqual({ day: "today", precision: "part", dayPart: "night", end: 1800 });
    expect(promiseWindow(detectHostPromise("Yarın öğlen temizlikçi gelecek.")!, at14)).toEqual({ day: "tomorrow", precision: "part", dayPart: "noon", end: 840 });
    expect(promiseWindow(detectHostPromise("Öğleden sonra teknisyen gelecek.")!, 10 * 60)).toEqual({ day: "today", precision: "part", dayPart: "afternoon", end: 1080 });
    // Akşam yazılan "bu akşam" bugün kalır (pencere 23:59'a kadar); eskiden şimdi + 2 saat uyduruluyordu.
    expect(promiseWindow(detectHostPromise("Bu akşam havlu getireceğim.")!, 20 * 60)).toEqual({ day: "today", precision: "part", dayPart: "evening", end: 1439 });
    // Bugünün erken dilimi GEÇTİYSE yarın ("Sabah teknisyen gelecek" 14:00'te yazıldı); akşam / gece dilimi bugün kalır.
    expect(promiseWindow(detectHostPromise("Sabah teknisyen gelecek.")!, at14)).toEqual({ day: "tomorrow", precision: "part", dayPart: "morning", end: 720 });
    expect(promiseWindow(detectHostPromise("Gece yarısı havlu getireceğim.")!, at14)).toEqual({ day: "today", precision: "part", dayPart: "midnight", end: 1500 });
    // "akşam 6" → 18:00 (06:00 değil); "sabah 9" → 09:00 (21:00 değil).
    expect(detectHostPromise("Akşam 6'da teknisyen gelecek.")).toMatchObject({ timeCandidates: [18 * 60], cue: null });
    expect(detectHostPromise("Yarın sabah 9'da temizlikçi gelecek.")).toMatchObject({ timeCandidates: [9 * 60], cue: null });
    // Açık saat ya da süre varsa ipucu kullanılmaz.
    expect(detectHostPromise("Bu akşam 30 dakika içinde havlu getireceğim.")).toMatchObject({ inMinutes: 30, cue: null });
  });
});

describe("B · Wi-Fi değeri", () => {
  it.each([
    // Sonda "!" → şifrenin mi cümlenin mi parçası, belirsiz → değer yok (Haiku 10-12 4. tur; yanlış şifre yazmaktansa öneri kaçar).
    ["Yeni Wi-Fi şifresi: Lale2025!", null, null],
    ["Şifre artık DenizKenari99 oldu.", "DenizKenari99", null],
    ["The wifi password is now Sunny#2025", "Sunny#2025", null],
    ["Ağ adı: LaleNet-5G, şifre: abc12345", "abc12345", "LaleNet-5G"],
    ["Network name is LaleNet", null, "LaleNet"],
  ])("%s → şifre %s · ağ %s", (text, password, network) => {
    expect(extractWifiValues(text)).toEqual({ password, network });
  });

  it.each([
    "Şifre yanlış mı?",
    "Şifre kartta yazıyor.",
    "Wi-Fi şifresi aşağıda",
    "The password is wrong",
    "şifre: 1234",
    // Haiku 10-12: rakamsız sözcük şifre değildir.
    "Wi-Fi şifresi değişmedi",
    "Şifre çalışmazsa resepsiyonu arayın",
    "Şifre sıfırlama bağlantısı gönderdim",
    "password is incorrect",
  ])("%s → şifre değeri yok", (text) => {
    expect(extractWifiValues(text).password).toBeNull();
  });

  it("ağ adı: 'Wi-Fi adı yok' değer değil; biçimlendirme işaretleri atılır; kalemdeki değer sayısı (ana + misafir ağı = belirsiz)", () => {
    expect(extractWifiValues("Wi-Fi adı yok").network).toBeNull();
    expect(extractWifiValues("**Şifre:** abc12345").password).toBe("abc12345");
    // "/" sonrası belirsiz → ilk etiket değer vermez; kalemde hedef yine BELİRSİZ (iki etiket) → öneri yok.
    expect(wifiValueCount("Ana ağ şifresi: Abc12345 / Misafir şifresi: Gst98765", "password")).toBe(1);
    expect(wifiTargetAmbiguous("Ana ağ şifresi: Abc12345 / Misafir şifresi: Gst98765", "password")).toBe(true);
    expect(wifiValueCount("Ana ağ şifresi: Abc12345\nMisafir şifresi: Gst98765", "password")).toBe(2);
    expect(wifiValueCount("Ağ LaleNet, şifre: eskiSifre1", "password")).toBe(1);
  });

  it("bilgi tabanı metnine uygulama: eski değer yerine yazılır; yoksa satır eklenir; aynıysa değişmez; maske son iki karakter", () => {
    expect(applyWifiValue("Ağ LaleNet, şifre: eskiSifre1", "password", "YeniSifre2")).toBe("Ağ LaleNet, şifre: YeniSifre2");
    // Eski değer metinde İKİ kez geçiyorsa hangisinin değişeceği belirsiz → uygulanmaz (Haiku 10-12 3. tur; önceki "yalnız ilk geçiş" kuralı
    // başlıkta / başka satırda geçen aynı sözcüğü değiştirebiliyordu).
    expect(applyWifiValue("şifre: abc12345 (yedek kart: abc12345)", "password", "Yeni99999")).toBeNull();
    expect(applyWifiValue("Modem salonda.", "password", "YeniSifre2")).toBe("Modem salonda.\nŞifre: YeniSifre2");
    expect(applyWifiValue("şifre: YeniSifre2", "password", "YeniSifre2")).toBe("şifre: YeniSifre2");
    expect(applyWifiValue("Ağ adı: EskiAg, şifre: x1234567", "network", "YeniAg")).toBe("Ağ adı: YeniAg, şifre: x1234567");
    expect(kbContainsValue("şifre: Abc12345", "abc12345", true)).toBe(false);
    expect(kbContainsValue("Ağ: LALENET", "lalenet", false)).toBe(true);
    expect(maskSecret("Lale2025!")).toBe("••••5!");
  });
});

describe("B · Wi-Fi değeri — Haiku 10-12 2. tur", () => {
  it("modem / yönetici / kapı / kasa şifresi Wi-Fi değeri SAYILMAZ (ne çıkarılır ne kalemde sayılır)", () => {
    expect(extractWifiValues("Modem admin şifresi: admin1234").password).toBeNull();
    expect(extractWifiValues("Router password: Rt998877").password).toBeNull();
    expect(extractWifiValues("Kapı şifresi: 4829#1234").password).toBeNull();
    expect(extractWifiValues("Kasa şifresi 55667788").password).toBeNull();
    expect(extractWifiValues("Yönetici şifresi: Yn123456, Wi-Fi şifresi: Wf123456").password).toBe("Wf123456");
    expect(wifiValueCount("Wi-Fi şifresi: Abc12345\nModem arayüzü şifresi: Mdm12345", "password")).toBe(1);
    expect(extractWifiValues("Wi-Fi şifresi: Abc12345").password).toBe("Abc12345"); // kontrol
  });

  it("ağ adı: açık ':' ile yazılan, SATIRI bitiren, fiil sonu taşımayan sözcük kabul; 'ağ adımız / adınız / misafir ağı adı' etiketleri", () => {
    expect(extractWifiValues("Ağ adımız: lale").network).toBe("lale");
    expect(extractWifiValues("Wi-Fi adınız: Lale").network).toBe("Lale");
    expect(extractWifiValues("Misafir ağı adı: GuestNet").network).toBe("GuestNet");
    expect(extractWifiValues("Ağ adı: ab").network).toBeNull(); // sözcük biçimli ağ adı en az 3 harf
    expect(extractWifiValues("Ağ adı: lale, iyi tatiller").network).toBeNull(); // satırı bitirmiyor
  });

  // Haiku 10-12 3. tur — kurucu 10-11 dersi ("Wi-Fi çalışmıyor" ≠ şifre): sözcük biçimli şifre ASLA değer değildir.
  it.each([
    ["Wi-Fi şifresi: çalışmıyor, yarın bakacağım", "password"],
    ["Şifre: Değişmeyecek.", "password"],
    ["Wi-Fi şifresi: lalehouse", "password"],
    ["Şifre = lalehouse, iyi tatiller", "password"],
    ["Şifre: routerin altında yazıyor", "password"],
    ["Şifre lalehouse", "password"],
    ["Şifre: aşağıdaki.", "password"],
    ["Ağ adı: bilmiyorum", "network"],
    ["Network is Up", "network"],
    ["Network is Down", "network"], // durum sözcüğü (büyük harfli ≥ 4 harf olsa da)
    ["Wi-Fi şifresi: Sonbahar2024 Lale, misafir şifresi: Gst12345", "password"], // biri belirsiz → hangisi? değer yok
    // Haiku 10-12 4. tur: aynı mesajda iki farklı değer / ok / eğik çizgi → hangisi yeni? belirsiz.
    ["Eski şifre: lale1234, yeni şifre: lale5678", "password"],
    ["Wi-Fi şifresi: lale1234 → lale5678", "password"],
    ["Şifre: lale2024 / lale2025", "password"],
    ["Ağ adı: Lale → LaleGuest", "network"],
    ["Şifre: lale2024…", "password"],
    ["Wi-Fi şifresi: Lale2024.Teşekkürler", "password"],
    ["Wi-Fi şifresi: Sonbahar2024 Lale", "password"], // boşluklu şifre olabilir → belirsiz, ilk sözcük alınmaz
  ] as const)("%s → %s değer DEĞİL", (text, field) => {
    expect(extractWifiValues(text)[field]).toBeNull();
  });

  it("düz cümledeki etiket sözcüğü engel değil; değerden sonra etiket / bağlaç / noktalama gelebilir", () => {
    expect(extractWifiValues("Şifreyi değiştirdim, yeni şifre: Abc12345").password).toBe("Abc12345");
    expect(extractWifiValues("Şifreniz güncellenmiştir, yeni şifre: Abc12345").password).toBe("Abc12345"); // ayraçsız sözcük = düz cümle
    expect(extractWifiValues("Wi-Fi şifresi: Abc12345 olarak değişti").password).toBe("Abc12345");
    expect(extractWifiValues("Yeni şifre Abc12345, iyi tatiller").password).toBe("Abc12345");
    expect(extractWifiValues("Şifre: Abc12345 ağ adı: LaleNet").password).toBe("Abc12345");
    expect(extractWifiValues("Kapıdan girince Wi-Fi şifresi: Abc12345").password).toBe("Abc12345"); // "kapı" etiketten önce değil
    // Parantez / köşeli / açılı ayraç ve emoji değere GİRMEZ (Haiku 10-12 4. tur).
    expect(extractWifiValues("Şifre lale2024😊").password).toBe("lale2024");
    expect(extractWifiValues("Wi-Fi şifresi (lale2024)").password).toBe("lale2024");
    expect(extractWifiValues("Şifre: [lale2024]").password).toBe("lale2024");
    expect(extractWifiValues("Şifre: <lale2024>").password).toBe("lale2024");
    expect(extractWifiValues("Yeni şifre: Abc12345, eski şifre de Abc12345").password).toBe("Abc12345"); // aynı değer iki kez → tek değer
  });

  it("bilgi tabanında hedef belirsizse uygulanmaz: okunamayan etiket (boşluklu ağ adı / sözcük biçimli şifre) ya da eski değer metinde iki kez", () => {
    expect(wifiTargetAmbiguous("Wi-Fi adı: Lale Ev\nŞifre: Abc12345", "network")).toBe(true);
    expect(applyWifiValue("Wi-Fi adı: Lale Ev\nŞifre: Abc12345", "network", "Kumsal")).toBeNull();
    expect(applyWifiValue("Şifre: lalehouse", "password", "Yeni12345")).toBeNull();
    expect(applyWifiValue("Lale Apart Wi-Fi\nAğ adı: Lale\nŞifre: Abc12345", "network", "Kumsal")).toBeNull(); // "Lale" başlıkta da geçiyor
    expect(applyWifiValue("Ağ adı: Lale\nŞifre: Abc12345", "network", "Kumsal")).toBe("Ağ adı: Kumsal\nŞifre: Abc12345"); // kontrol
    expect(wifiTargetAmbiguous("Ağ adı: Lale\nŞifre: Abc12345", "network")).toBe(false);
  });
});

describe("C · söz — Haiku 10-12 3. tur", () => {
  it.each([
    "Teknisyen yarından sonra gelecek.",
    "Teknisyen 2 gün sonra gelecek.",
    "Teknisyen cumaya gelecek.",
    "Teknisyen önümüzdeki hafta gelecek.",
    "Havalimanı servisi yarın gelecek.", // ulaşım, bakım değil
    "Teknisyen 48 saat içinde gelecek.", // bugün / yarın modelinin dışında
    "Teknisyen bugün ya da yarın gelecek.", // hangi gün? belirsiz
  ])("%s → öneri yok (tanınmayan gün / konu değil)", (text) => {
    expect(detectHostPromise(text)).toBeNull();
  });

  it.each([
    ["Teknisyen yarına gelecek.", 600, { day: "tomorrow", precision: "day", end: 1439 }],
    ["Akşam 7:00'de teknisyen gelecek.", 600, { day: "today", precision: "time", time: "19:00", end: 1140 }],
    ["Öğleden sonra 2:30'da teknisyen gelecek.", 600, { day: "today", precision: "time", time: "14:30", end: 870 }],
    ["Yarın saat 2'de teknisyen gelecek.", 600, { day: "tomorrow", precision: "time", time: "14:00", end: 840 }],
    ["Tomorrow at 2 the technician will come.", 600, { day: "tomorrow", precision: "time", time: "14:00", end: 840 }],
    ["Teknisyen saat 10'da gelecek.", 900, { day: "tomorrow", precision: "time", time: "10:00", end: 600 }],
    ["Teknisyen bugün gelecek, yarın havlu getiririm.", 600, { day: "today", precision: "day", end: 1439 }],
    ["Yarın sabah, teknisyen gelecek.", 600, { day: "tomorrow", precision: "part", dayPart: "morning", end: 720 }],
    ["Teknisyen yarın gelecek, işi 2 saat sürer.", 540, { day: "tomorrow", precision: "day", end: 1439 }],
    ["Teknisyen bugün gelecek, 30 dakika sürer.", 540, { day: "today", precision: "day", end: 1439 }], // süre son an değil → saat yok
    ["Yarın akşama teknisyen gelecek.", 600, { day: "tomorrow", precision: "part", dayPart: "evening", end: 1439 }],
    ["Sabah teknisyen gelecek.", 840, { day: "tomorrow", precision: "part", dayPart: "morning", end: 720 }],
    ["Akşamüstü teknisyen gelecek.", 600, { day: "today", precision: "part", dayPart: "late_afternoon", end: 1140 }],
    ["Yarım saat içinde havlu getireceğim.", 600, { day: "today", precision: "time", time: "10:30", end: 630 }],
    ["Bir saat içinde havlu getireceğim.", 600, { day: "today", precision: "time", time: "11:00", end: 660 }],
    ["I'll bring towels in an hour.", 600, { day: "today", precision: "time", time: "11:00", end: 660 }],
    ["1,25 saat sonra temizlikçi gelecek.", 600, { day: "today", precision: "time", time: "11:15", end: 675 }],
    ["Gece 11'de havlu getireceğim.", 600, { day: "today", precision: "time", time: "23:00", end: 1380 }],
    ["Gece 11:30'da havlu getireceğim.", 600, { day: "today", precision: "time", time: "23:30", end: 1410 }],
    ["Teknisyen en geç 5'e kadar gelecek.", 600, { day: "today", precision: "time", time: "17:00", end: 1020 }], // Haiku 10-12 4. tur
    ["Teknisyen gelecek, yarın sabah 10 gibi.", 600, { day: "tomorrow", precision: "time", time: "10:00", end: 600 }],
    ["Teknisyen geliyor, yarın 10'da.", 600, { day: "tomorrow", precision: "time", time: "10:00", end: 600 }],
    ["The technician will come tomorrow, around 9.", 600, { day: "tomorrow", precision: "time", time: "09:00", end: 540 }],
    ["Temizlikçi gelecek, havlular yarın.", 600, { day: "today", precision: "day", end: 1439 }], // başka konulu parça katılmaz
    ["Havlu getiririm.", 600, { day: "today", precision: "day", end: 1439 }],
    ["Technician will come tomorrow morning.", 600, { day: "tomorrow", precision: "part", dayPart: "morning", end: 720 }],
    ["Cleaners will come tomorrow at 9am.", 600, { day: "tomorrow", precision: "time", time: "09:00", end: 540 }],
    ["Temizlikçi gelecek ve 3 saat kalacak.", 600, { day: "today", precision: "day", end: 1439 }], // süre "içinde / sonra"sız → son an değil
    ["Teknik servis yarın gelecek.", 600, { day: "tomorrow", precision: "day", end: 1439 }],
  ] as const)("%s @%i → %o", (text, now, win) => {
    const p = detectHostPromise(text);
    expect(p).not.toBeNull();
    expect(promiseWindow(p!, now)).toEqual(win);
  });
});

describe("söz → görev otomatik (kurucu 10-17 gece): kararsız / aktarılan söz yok · saat değişikliği bağlamla · saat uydurulmaz", () => {
  // Kurucu T5 (10-21): "Müsait olursa / belki yarın gelir" → kesin söz olarak KAYDEDİLMEZ, belirsiz öneri olarak KALIR (eskiden hiç öneri yoktu).
  it.each([
    ["Belki yarın teknisyen gelecek.", "belki"],
    ["Teknisyen yarın gelecek galiba.", "galiba"],
    ["Umarım yarın teknisyen gelecek.", "umarım"],
    ["Teknisyen yarın gelecek, emin değilim.", "emin değilim"],
    ["Muhtemelen yarın havlu getiririm.", "muhtemelen"],
    ["Maybe the technician will come tomorrow.", "maybe"],
    ["Hopefully the cleaner will come today.", "hopefully"],
    ["Teknisyen müsait olursa yarın gelir.", "müsait olursa"],
    ["Belki yarın gelir teknisyen.", "belki + gelir"],
    ["If he is available the technician will come tomorrow at 10.", "if available"],
  ])("%s → KESİN DEĞİL öneri (%s; kurucu T5)", (text) => {
    const ps = detectHostPromises(text);
    expect(ps.length).toBeGreaterThan(0);
    expect(ps.every((p) => p.tentative)).toBe(true);
  });

  it.each([
    ["Teknisyen yarın gelecek demiştim.", "aktarılan"],
    ["Dediğim gibi teknisyen yarın gelecek.", "aktarılan"],
    ["As I said, the technician will come tomorrow.", "aktarılan (EN)"],
    ["Teknisyen ertelendi.", "değişiklik var, yeni zaman yok → hiçbir şey"],
    // Haiku 10-17 gece: bugün / yarın modelinin dışındaki gün ifadeleri ("bugün" sanılıp bugüne söz açılıyordu).
    ["Klima için teknisyen 2 hafta sonra gelecek.", "2 hafta sonra"],
    ["Teknisyen bir gün sonra gelecek.", "bir gün sonra"],
    ["Teknisyen 3 ay sonra gelecek.", "3 ay sonra"],
    ["The technician will come in two weeks.", "in two weeks"],
    ["Yarın havlu getireceğim?", "soru"],
    ["Teknisyen saati değişti.", "değişiklik var, yeni zaman yok → hiçbir şey"],
  ])("%s → söz yok (%s)", (text) => {
    expect(detectHostPromises(text)).toEqual([]);
  });

  it("kararlı söz kararsızdan ayrı cümlecikte ise yalnız kararlı olan: 'Havlu getireceğim. Belki teknisyen de gelir.'", () => {
    expect(detectHostPromises("Havlu getireceğim. Belki teknisyen de gelir.")).toMatchObject([
      { kind: "towels", tentative: false },
      { kind: "maintenance", tentative: true },
    ]);
  });

  it.each([
    ["Teknisyen 11'e kaydı.", 600, { day: "today", precision: "time", time: "11:00", end: 660 }],
    ["Teknisyen 11’e kaydı.", 600, { day: "today", precision: "time", time: "11:00", end: 660 }], // kıvrık kesme
    ["Teknisyen 3'e alındı.", 600, { day: "today", precision: "time", time: "15:00", end: 900 }], // gündüz tercihi
    ["Teknisyen saat 11'e kaydırıldı.", 600, { day: "today", precision: "time", time: "11:00", end: 660 }],
    ["Teknisyen 15:30'a ertelendi.", 600, { day: "today", precision: "time", time: "15:30", end: 930 }],
    ["Teknisyen yarına ertelendi.", 600, { day: "tomorrow", precision: "day", end: 1439 }],
    ["Teknisyen saati değişti, 15:00'te gelecek.", 600, { day: "today", precision: "time", time: "15:00", end: 900 }],
    ["The technician was rescheduled to 3pm.", 600, { day: "today", precision: "time", time: "15:00", end: 900 }],
  ] as const)("saat değişikliği %s @%i → %o (reschedule)", (text, now, win) => {
    const [p, ...rest] = detectHostPromises(text);
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ kind: "maintenance", reschedule: true });
    expect(promiseWindow(p!, now)).toEqual(win);
  });

  it("KONTROL: kararlılık sözcüğü SÖZÜN parçasında değilse kararsız sayılmaz mı? — HAYIR, bilerek cümlecik boyunca (kararsızlık sözü kapsar)", () => {
    expect(detectHostPromises("Teknisyen yarın gelecek, galiba.")).toMatchObject([{ tentative: true }]);
    expect(detectHostPromises("Teknisyen yarın gelecek.")).toMatchObject([{ kind: "maintenance" }]);
  });

  it("🚨 süre YALNIZ sözün parçasından (Haiku 10-17 gece: sağdaki işin süresi son an sanılıp 10:00 silinip 16:00 uyduruluyordu)", () => {
    const w = (t: string) => promiseWindow(detectHostPromise(t)!, 14 * 60);
    expect(w("Teknisyen yarın 10'da gelecek, işi 2 saat içinde bitirir.")).toEqual({ day: "tomorrow", precision: "time", time: "10:00", end: 600 });
    expect(w("Teknisyen yarın 10'da gelecek, 2 saat kadar sürer.")).toEqual({ day: "tomorrow", precision: "time", time: "10:00", end: 600 });
    // KONTROL: sözün kendi parçasındaki / solundaki süre okunur; saat değişikliğinin devam parçası sözün parçasıdır.
    expect(w("Teknisyen 30 dakika içinde gelecek.")).toEqual({ day: "today", precision: "time", time: "14:30", end: 870 });
    expect(w("30 dakika içinde, teknisyen gelecek.")).toEqual({ day: "today", precision: "time", time: "14:30", end: 870 });
    expect(w("Teknisyen saati değişti, 30 dakika içinde gelecek.")).toEqual({ day: "today", precision: "time", time: "14:30", end: 870 });
  });

  it("🚨 geçmişe atıf ('dün gece', 'geçen gece', 'geçen hafta') sözün dilimi DEĞİL; 'bu gece', 'gecenin ikisinde' gece dilimi", () => {
    const w = (t: string) => promiseWindow(detectHostPromise(t)!, 10 * 60);
    expect(w("Teknisyen yarın gelecek, geçen gece çok yağmur yağdı.")).toEqual({ day: "tomorrow", precision: "day", end: 1439 });
    expect(w("Dün gece klima bozuldu teknisyen yarın gelecek.")).toEqual({ day: "tomorrow", precision: "day", end: 1439 });
    expect(w("Teknisyen geçen hafta geldi, yarın tekrar gelecek.")).toEqual({ day: "tomorrow", precision: "day", end: 1439 });
    // "geçen" sözün KENDİ parçasında (virgülsüz) — "gece" dilimi sanılmaz (mutasyon SG-night-gecen: virgüllü vaka kapsama girmiyordu).
    expect(w("Teknisyen geçen hafta geldi yarın tekrar gelecek.")).toEqual({ day: "tomorrow", precision: "day", end: 1439 });
    expect(w("Geçende havlu eksikti yarın getireceğim.")).toEqual({ day: "tomorrow", precision: "day", end: 1439 });
    expect(w("Bu gece havlu getireceğim.")).toEqual({ day: "today", precision: "part", dayPart: "night", end: 1800 });
    expect(w("Gecenin ikisinde havlu getireceğim.")).toMatchObject({ precision: "part", dayPart: "night" });
  });

  it("aktarma girişi ('dediğim gibi, …') solda da sözü aktarılan yapar; 'bugün gelmedi, yarın 10'da gelecek' YENİ söz", () => {
    expect(detectHostPromises("Dediğim gibi, teknisyen yarın gelecek.")).toEqual([]);
    expect(detectHostPromise("Teknisyen bugün gelmedi, yarın 10'da gelecek.")).toMatchObject({ kind: "maintenance", day: "tomorrow", timeCandidates: [600] });
  });

  it("🚨 Opus O3: sözü TEYİDE bağlayan soru ('…, uygun mu?', '…, olur mu?') söz değil; ayrı soru söz bozmaz", () => {
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek, uygun mu?")).toEqual([]);
    expect(detectHostPromises("Yarın sabah havlu getireceğim, olur mu?")).toEqual([]);
    expect(detectHostPromises("The cleaner will come tomorrow at 10, is that ok?")).toEqual([]);
    expect(detectHostPromises("Yarın havlu getireceğim, başka bir ihtiyacınız var mı?")).toMatchObject([{ kind: "towels" }]);
  });

  it("🚨 Opus O5: 'Arıza kaydınız bugün alındı' saat değişikliği DEĞİL; yönelme ekli 'bugüne / yarına alındı' değişiklik", () => {
    expect(detectHostPromises("Arıza kaydınız bugün alındı, teknisyen yarın 10'da gelecek.")).toMatchObject([
      { kind: "maintenance", day: "tomorrow", reschedule: false, timeCandidates: [600] },
    ]);
    expect(detectHostPromises("Teknisyen yarına alındı.")).toMatchObject([{ reschedule: true, day: "tomorrow" }]);
  });

  it("🚨 Opus O6: 'iki ayrı', 'bir ayar' gün sanılmaz; dilek (umarım) yalnız sözün kendisinde kararsızlık", () => {
    expect(detectHostPromise("Yarın iki ayrı havlu getireceğim.")).toMatchObject({ kind: "towels", day: "tomorrow" });
    expect(detectHostPromise("Klimanın bir ayarı bozuk, teknisyen yarın gelecek.")).toMatchObject({ kind: "maintenance", day: "tomorrow" });
    expect(detectHostPromise("Teknisyen yarın 10'da gelecek, umarım sorun hemen çözülür.")).toMatchObject({ kind: "maintenance", timeCandidates: [600] });
    expect(detectHostPromises("Umarım yarın teknisyen gelecek.")).toMatchObject([{ tentative: true }]);
    expect(detectHostPromises("Teknisyen 2 ay sonra gelecek.")).toEqual([]);
  });

  it("🚨 Opus O1 / O9: sözü yapan (ziyaret / teslim) ve birden çok saat işareti", () => {
    expect(detectHostPromise("Klima için teknisyen yarın 10'da gelecek.")).toMatchObject({ actor: "visit", timeAmbiguous: false, dayExplicit: true });
    expect(detectHostPromise("Klima kumandasının pilini akşam getireceğim.")).toMatchObject({ kind: "maintenance", topic: "ac", actor: "delivery" });
    expect(detectHostPromise("Ekibimiz yarın havluları değiştirmeye gelecek.")).toMatchObject({ kind: "towels", actor: "visit" });
    expect(detectHostPromise("Teknisyen yarın 10:00-12:00 arası gelecek.")).toMatchObject({ timeAmbiguous: true });
    expect(detectHostPromise("Teknisyen 11'e kaydı.")).toMatchObject({ dayExplicit: false, reschedule: true });
  });

  it("🚨 sözden SONRA gelen ayrı soru sözü bozmaz ('…, başka bir ihtiyacınız var mı?'); sözün kendisi soruysa söz yok", () => {
    expect(detectHostPromises("Yarın havlu getireceğim, başka bir ihtiyacınız var mı?")).toMatchObject([{ kind: "towels", day: "tomorrow" }]);
    expect(detectHostPromises("Teknisyen yarın gelecek mi?")).toEqual([]);
    expect(detectHostPromises("Yarın havlu getireceğim?")).toEqual([]);
    expect(detectHostPromises("Havlu getireyim mi, yarın 10'da?")).toEqual([]);
  });

  it("'kaydı' / 'alındı' AD ya da başka anlamda ise saat değişikliği değil (aşırı uygulama kontrolü)", () => {
    expect(detectHostPromises("Rezervasyon kaydı alındı, havlu getireceğim.")).toMatchObject([{ kind: "towels", reschedule: false }]);
    expect(detectHostPromises("Klima değişti, teknisyen gelecek.")).toMatchObject([{ kind: "maintenance", reschedule: false }]);
    expect(detectHostPromises("Teknisyen 11'de gelecek.")).toMatchObject([{ reschedule: false, timeCandidates: [660] }]);
  });

  it("🚨 Haiku 2. tur: selamlaşmadaki dilek sözü bozmaz; yalın 'Umarım,' / sözün içindeki dilek bozar", () => {
    expect(detectHostPromises("Umarım iyisinizdir, teknisyen yarın 10'da gelecek.")).toMatchObject([{ kind: "maintenance", day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("I hope you are well, the technician will come tomorrow at 10.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("Umarım, teknisyen yarın 10'da gelecek.")).toMatchObject([{ tentative: true }]);
    // Kurucu T5 (10-21): "inşallah" tek başına sözü iptal etmez — açık plan kaydedilebilir (teknisyenden teyit alındığı anlamına gelmez).
    expect(detectHostPromises("İnşallah, teknisyen yarın gelecek.")).toMatchObject([{ day: "tomorrow", tentative: false }]);
    expect(detectHostPromises("Teknisyen inşallah yarın 10'da gelecek.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600], tentative: false }]);
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek inşallah.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600], tentative: false }]);
  });

  it("🚨 Haiku 2. tur: aynı konu + aynı gün, FARKLI yapan → iki söz (teslim sözü tekrar sanılmaz)", () => {
    expect(detectHostPromises("Klima için teknisyen yarın gelecek, klima filtresini yarın getireceğim.")).toMatchObject([
      { kind: "maintenance", topic: "ac", day: "tomorrow", actor: "visit" },
      { kind: "maintenance", topic: "ac", day: "tomorrow", actor: "delivery" },
    ]);
  });

  it("🚨 takvim tarihi ('25 Ekim', 'ayın 25'i', 'ay sonu', 'bu ay', 'October 25', '25/10', '25.10') bugün sanılmaz → söz yok (ölçüldü: bugüne görev açıyordu)", () => {
    for (const t of [
      "Teknisyen 25 Ekim'de 10'da gelecek.",
      "Teknisyen 3 Mart'ta gelecek.",
      "Teknisyen ayın 25'inde gelecek.",
      "Teknisyen ay sonunda gelecek.",
      "Teknisyen bu ay içinde gelecek.",
      "Teknisyen gelecek ay gelecek.",
      "The technician will come on October 25 at 10.",
      "The technician will come on the 25th.",
      "I will bring towels on May 3.",
      "Teknisyen 25.10'da gelecek.",
      "Teknisyen 25/10 tarihinde gelecek.",
      "Teknisyen 25.10.2026'da gelecek.",
    ])
      expect(detectHostPromises(t), t).toEqual([]);
  });

  it("🚨 Haiku 3. tur: tarih sözün SAĞINDAKİ parçada da sözü düşürür; tarihli (reddedilen) sözün zamansız devamı bugün sözü açmaz", () => {
    for (const t of [
      "Teknisyen gelecek, 25 Ekim'de.",
      "Teknisyen yarın gelecek, 25 Ekim.",
      "Teknisyen gelecek, ay sonunda.",
      "Teknisyen 25 Ekim'de gelecek, klima bakımı da yapacak.",
      "Teknisyen yarın gelecek mi, klima bakımı da yapacak.",
    ])
      expect(detectHostPromises(t), t).toEqual([]);
    // KONTROL: reddedilen sözden SONRAKİ zamanı olan söz ve farklı türden söz kalır.
    expect(detectHostPromises("Teknisyen 25 Ekim'de gelecek, klima ustası yarın 11'de gelecek.")).toMatchObject([{ day: "tomorrow", timeCandidates: [660] }]);
    expect(detectHostPromises("Teknisyen 25 Ekim'de gelecek, havluları yarın getireceğim.")).toMatchObject([{ kind: "towels", day: "tomorrow" }]);
  });

  it("🚨 Haiku 4. tur: '7/24' ve '2 ocaklı' tarih DEĞİL — sağdaki parça sözü düşürmez; geçerli gün/ay ('25/10', '1/12') yine tarih", () => {
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek, 7/24 telefonla ulaşabilirsiniz.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek, 2 ocaklı ocağı da kontrol edecek.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("Teknisyen 1/12 tarihinde gelecek.")).toEqual([]);
    expect(detectHostPromises("Teknisyen 3 Aralık'ta gelecek.")).toEqual([]);
  });

  it("🚨 Opus gece-3 F9: '24/7', '2nd floor / bedroom', 'No:12/3', '1/2 saat' tarih DEĞİL (söz düşmez); '24/7'de', 'the 25th', '25th of' tarih", () => {
    for (const t of [
      "The technician will come today at 2pm, you can reach me 24/7.",
      "I'll bring towels tomorrow at 10, call me 24/7.",
      "I'll bring extra towels to the 2nd floor tomorrow at 10.",
      "The cleaner will come tomorrow at 11 to clean the 2nd bedroom.",
      "Teknisyen yarın 10'da gelecek, adres Gül Sokak No:12/3.",
      "Teknisyen yarın 10'da gelecek, 1/2 saat sürer.",
    ])
      expect(detectHostPromises(t), t).toHaveLength(1);
    for (const t of ["Teknisyen 24/7'de gelecek.", "The technician will come on the 25th of October.", "The technician will come on the 25th."])
      expect(detectHostPromises(t), t).toEqual([]);
  });

  it("aşırı uygulama kontrolü: 'aylık' / 'aydır' / 'ayar' / saat '12.10' tarih DEĞİL", () => {
    expect(detectHostPromises("Bir aylık bakım için teknisyen yarın 10'da gelecek.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("Bir aydır bekliyorsunuz, teknisyen yarın 10'da gelecek.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("Bu ayarı yarın 10'da teknisyen yapacak.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("Teknisyen yarın 12.10'da gelecek.")).toMatchObject([{ day: "tomorrow", timeCandidates: [730] }]);
  });

  it("🚨 aynı cümlecikte zaman bilgisi olmayan aynı türden parça önceki sözün DEVAMI (uydurma 'bugün' sözü yok); yapanı farklıysa ayrı söz", () => {
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek, aylık bakımı da yapacak.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek, aylık bakımı da yapacak.")).toHaveLength(1);
    // Aynı tür + konu (klima), zamansız, YAPANI farklı → ayrı söz (devam sayılmaz).
    expect(detectHostPromises("Klima için teknisyen yarın 10'da gelecek, klima kumandasının pilini de getireceğim.")).toMatchObject([
      { kind: "maintenance", topic: "ac", actor: "visit", day: "tomorrow" },
      { kind: "maintenance", topic: "ac", actor: "delivery" },
    ]);
    // Zamanı olan ikinci parça ayrı söz (kontrol).
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek, klima ustası da 11'de gelecek.")).toHaveLength(2);
  });

  it("takvim tarihi kalıbı karesel iş yapmaz (rakam + uzun boşluk / nokta dizisi)", () => {
    for (const r of [`teknisyen 1${" ".repeat(3_980)}ekim`, `teknisyen 1${" ".repeat(1_980)}.${" ".repeat(1_980)}x`, "25 ".repeat(1_320), "1/".repeat(1_990), "ayin ".repeat(790)]) {
      const t = performance.now();
      detectHostPromises(r);
      expect(performance.now() - t).toBeLessThan(1_000);
    }
  });

  it("'birazdan / hemen / soon' → 'kısa süre içinde' (saat değil); açık süre varsa süre kazanır", () => {
    expect(detectHostPromise("Birazdan havlu getireceğim.")).toMatchObject({ soon: true, inMinutes: null, timeCandidates: [] });
    expect(detectHostPromise("Hemen temizlikçi gönderiyorum.")).toMatchObject({ soon: true });
    expect(detectHostPromise("The cleaner will come soon.")).toMatchObject({ soon: true });
    expect(detectHostPromise("Birazdan, 30 dakika içinde havlu getireceğim.")).toMatchObject({ soon: false, inMinutes: 30 });
    expect(detectHostPromise("Birazdan, saat 11'de teknisyen gelecek.")).toMatchObject({ soon: false, timeCandidates: [660] });
  });
});

describe("anahtar ve ölçüt", () => {
  it("anahtar tür + kimlik; bozuk / bilinmeyen tür / tehlikeli karakter reddedilir", () => {
    expect(parseSuggestionKey(suggestionKey("task", "cm123"))).toEqual({ kind: "task", source: "cm123" });
    expect(parseSuggestionKey("kb_wifi:kb1:msg2")).toEqual({ kind: "kb_wifi", source: "kb1:msg2" });
    for (const bad of ["", "task", "nope:x", "task:", "task:a b", "task:<script>", 42, null]) expect(parseSuggestionKey(bad)).toBeNull();
  });

  it(`otomatiğe hazır: 14 gün içinde ≥ ${AUTO_PROMOTION_MIN_DECISIONS} karar ve ≥ %90 DÜZENLEMESİZ onay; düzenlenen onay sayılmaz; pencere dışı sayılmaz`, () => {
    const now = new Date("2026-10-12T12:00:00Z");
    const d = (decision: "approved" | "dismissed", edited = false, daysAgo = 1): SuggestionDecision => ({
      kind: "task",
      decision,
      edited,
      at: new Date(now.getTime() - daysAgo * 86_400_000),
    });
    const ok = [...Array(9).fill(0).map(() => d("approved")), d("dismissed")];
    expect(promotionReadiness(ok, now).task).toMatchObject({ decided: 10, cleanApproved: 9, ready: true });
    expect(promotionReadiness([...Array(9).fill(0).map(() => d("approved"))], now).task.ready).toBe(false); // < 10 karar
    expect(promotionReadiness([...Array(9).fill(0).map(() => d("approved")), d("approved", true)], now).task).toMatchObject({ cleanApproved: 9, ready: true });
    expect(promotionReadiness([...Array(8).fill(0).map(() => d("approved")), d("approved", true), d("dismissed")], now).task.ready).toBe(false);
    expect(promotionReadiness([...Array(10).fill(0).map(() => d("approved", false, 15))], now).task.decided).toBe(0);
    expect(promotionReadiness([], now).commitment).toEqual({ decided: 0, cleanApproved: 0, rate: null, ready: false });
  });
});

describe("süre (karesel iş yok)", () => {
  it("uzun tek sözcük / boşluk dizisi / tekrarlanan söz fiili ve şifre sözcüğü doğrusal", () => {
    const runs = ["a".repeat(4_000), `a${" ".repeat(3_990)}b`, "getirecegim ".repeat(330), "sifre ".repeat(660), "password is ".repeat(330), "havlu gelecek ".repeat(280), `${",".repeat(3_970)}teknisyen gelecek`, `${"sabah, ".repeat(560)}teknisyen gelecek`, "1,".repeat(1_990), "*".repeat(3_999), `şifre${"*_~`".repeat(990)}`,
      // Saat değişikliği / "N'e kadar" kalıbı: rakamdan sonra uzun boşluk dizisi (iki bitişik boşluk niceleyicisi yok — 10-17 gece).
      `teknisyen 1${" ".repeat(3_970)}'e kaydi`, `teknisyen 1${" ".repeat(1_980)}'${" ".repeat(1_980)}x`, "11 ".repeat(1_320), "ertelendi 3'e ".repeat(280),
      // Söz algılama v2 (gece-4): "ve" ile bağlı yüzlerce söz, yalın zaman / dilek parçası zinciri, aynı sözün yüzlerce cümlecikte tekrarı.
      "havlu getireceğim ve gelecek ve ".repeat(125), "getireceğim ve ".repeat(265), "yarın, ".repeat(570), "umarım, ".repeat(495),
      "yarın akşam 7'de, teknisyen gelecek. ".repeat(107)];
    for (const r of runs) {
      const t = performance.now();
      detectHostPromise(r);
      detectHostPromises(r);
      extractWifiValues(r);
      expect(performance.now() - t).toBeLessThan(1_000);
    }
  });
});

describe("Q1-b (kurucu 10-17: '2'sini de öner') — mesajdaki BÜTÜN sözler", () => {
  const brief = (t: string) => detectHostPromises(t).map((p) => [p.kind, p.topic, p.day, p.timeCandidates.join("|")]);

  it("🚨 iki cümlede iki söz → iki söz (konu + gün + saat her birinin kendi kapsamından)", () => {
    expect(brief("Klima için teknisyen yarın 10:00'da gelecek. Musluk için usta bugün 16:00'da gelecek.")).toEqual([
      ["maintenance", "ac", "tomorrow", String(10 * 60)],
      ["maintenance", "faucet", "today", String(16 * 60)],
    ]);
  });

  it("aynı cümlecikte farklı türde iki söz fiili → iki söz", () => {
    expect(brief("Teknisyen yarın 10:00'da gelecek, havluları da bugün 18:00'de getireceğim.")).toEqual([
      ["maintenance", null, "tomorrow", String(10 * 60)],
      ["towels", null, "today", String(18 * 60)],
    ]);
  });

  it("🚨 İLK söz `detectHostPromise` ile BİREBİR (öneri anahtarı geriye uyumlu)", () => {
    for (const t of [
      "Klima için teknisyen yarın 10:00'da gelecek. Musluk için usta bugün 16:00'da gelecek.",
      "Havluları bu akşam getireceğim.",
      "Teknisyen yarın sabah gelecek, işi 2 saat sürer.",
      "Klima için teşekkürler, yarın havlu getireceğim.",
      "The technician will come tomorrow, around 9.",
      "Yarın sabah, teknisyen gelecek.",
      "Teknisyen yarın 10'da gelecek, havluları da bugün getireceğim.",
    ]) {
      const one = detectHostPromise(t);
      expect(one, t).not.toBeNull();
      expect(detectHostPromises(t)[0], t).toEqual(one);
    }
  });

  it("tanınmayan gün YALNIZ o sözü düşürür (tek-söz okuyucusu bugünkü gibi bütün mesajı bırakır)", () => {
    const t = "Teknisyen pazartesi gelecek. Havluları yarın 10:00'da getireceğim.";
    expect(detectHostPromise(t)).toBeNull();
    expect(brief(t)).toEqual([["towels", null, "tomorrow", String(10 * 60)]]);
  });

  it("soru / koşul / olumsuz cümlecik söz değildir; ötekiler okunur", () => {
    expect(brief("Teknisyen yarın gelecek mi? Havluları bugün 18:00'de getireceğim.")).toEqual([["towels", null, "today", String(18 * 60)]]);
    expect(brief("İsterseniz yarın havlu getirebilirim. Teknisyen gelmeyecek. Temizlikçi bugün 14:00'te gelecek.")).toEqual([
      ["cleaning", null, "today", String(14 * 60)],
    ]);
  });

  it("yalnız BİREBİR tekrar alınmaz; konusuz + konulu farklı saatli iki söz İKİ öneri (Haiku 10-17); farklı konu alınır", () => {
    expect(brief("Teknisyen yarın 10:00'da gelecek. Teknisyen yarın 10:00'da gelecek.")).toHaveLength(1);
    expect(brief("Teknisyen yarın 10:00'da gelecek. Klima için usta yarın 11:00'de gelecek.")).toEqual([
      ["maintenance", null, "tomorrow", String(10 * 60)],
      ["maintenance", "ac", "tomorrow", String(11 * 60)],
    ]);
    expect(brief("Klima için teknisyen yarın 10:00'da gelecek. Kombi için usta yarın 11:00'de gelecek.")).toHaveLength(2);
    // Aynı konu, farklı saat → iki söz (iki ziyaret).
    expect(brief("Havluları bugün 14:00'te getireceğim. Havluları bugün 18:00'de de getireceğim.")).toHaveLength(2);
  });

  it("tavan: en çok 3 söz", () => {
    expect(MAX_PROMISES_PER_MESSAGE).toBe(3);
    const t =
      "Klima için teknisyen yarın 10:00'da gelecek. Musluk için usta yarın 11:00'de gelecek. Havluları bugün 18:00'de getireceğim. Temizlikçi yarın 14:00'te gelecek.";
    expect(detectHostPromises(t)).toHaveLength(3);
  });

  it("boş / çok uzun / söz yok → boş liste", () => {
    expect(detectHostPromises("")).toEqual([]);
    expect(detectHostPromises(null)).toEqual([]);
    expect(detectHostPromises("Teşekkürler, iyi tatiller!")).toEqual([]);
    expect(detectHostPromises(`Teknisyen yarın gelecek. ${"a".repeat(4_000)}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SÖZ ALGILAMA v2 (sert itirazcı 10-17 gece-4, `scratchpad` CHALLENGE-soz-v2 §4): gün sözün KENDİ kapsamından ya da hemen solundaki YALIN
// zaman parçasından okunur; başka cümledeki "Cuma Bey" / "yarın çıkış" sözü veto etmez, sözün günü de TAHMİN edilmez (kart sorar).
// Özet biçimi: auto|CARD [tür/konu/yapan gün saat|dilim|day (+dayUnclear/timeAmb)] — mesaj 09:00'da yazıldı.
// ---------------------------------------------------------------------------
describe("söz algılama v2 — gün kapsamı, dilek, iki söz, süre, devam (sert itirazcı 10-17 gece-4)", () => {
  const summary = (text: string) =>
    detectHostPromises(text).map((p) => {
      const w = promiseWindow(p, 9 * 60);
      const at = w.precision === "time" ? w.time : w.precision === "part" ? w.dayPart : "day";
      const card = p.dayUnclear || p.timeAmbiguous || p.tentative ? "CARD" : "auto";
      return `${card} ${p.kind}/${p.topic ?? "-"}/${p.actor ?? "-"} ${w.day} ${at}${p.dayUnclear ? " dayUnclear" : ""}${p.timeAmbiguous ? " timeAmb" : ""}${p.tentative ? " tentative" : ""}`;
    });
  it.each<[string, string[]]>([
    // D2: soldaki YALIN gün parçası (günü + dilimi) benimsenir.
    ["Yarın, teknisyen 10'da gelecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["Yarın akşam, teknisyen 7'de gelecek.", ["auto maintenance/-/visit tomorrow 19:00"]],
    ["Tomorrow evening, I'll bring towels at 7.", ["auto towels/-/delivery tomorrow 19:00"]],
    ["Pazartesi, teknisyen 10'da gelecek.", []],
    ["25 Ekim'de, teknisyen 10'da gelecek.", []],
    // D1: kendi kapsamı kazanır — başka parçadaki gün / ad veto etmez.
    ["Bugün klima bozuldu, teknisyen yarın 10'da gelecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["Yarın çıkış yapıyorsunuz, teknisyen bugün 15'te gelecek.", ["auto maintenance/-/visit today 15:00"]],
    ["Merhaba Cuma Bey, teknisyen yarın 10'da gelecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    // H1: yalın olmayan dilek / "dilerim" bozmaz; yalın dilek parçası sözü KESİN DEĞİL yapar (kurucu T5: kart, kendiliğinden kaydedilmez).
    ["Umarım her şey yolundadır, teknisyen yarın 10'da gelecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["Özür dilerim, teknisyen yarın 10'da gelecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["Teknisyen yarın 10'da gelecek, umarım sorun hemen çözülür.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["Havluları akşam getireceğim, umarım beğenirsiniz.", ["auto towels/-/delivery today evening"]],
    ["Umarım yarın, teknisyen 10'da gelecek.", ["CARD maintenance/-/visit tomorrow 10:00 tentative"]],
    ["Umarım ki, teknisyen yarın 10'da gelecek.", ["CARD maintenance/-/visit tomorrow 10:00 tentative"]],
    ["Teknisyen yarın 10'da gelecek, umarım.", ["CARD maintenance/-/visit tomorrow 10:00 tentative"]],
    ["The technician will come tomorrow at 10, hopefully.", ["CARD maintenance/-/visit tomorrow 10:00 tentative"]],
    // D3: kendi günü yok + mesajda başka yerde yarın / tanınmayan gün → kart günü sorar; şimdiye bağlı söz muaf; "bugün" tetiklemez.
    ["Teknisyen yarın 10'da gelecek. Havlu getireceğim.", ["auto maintenance/-/visit tomorrow 10:00", "CARD towels/-/delivery today day dayUnclear"]],
    ["Teknisyen yarın 10'da gelecek. Havluları hemen getireceğim.", ["auto maintenance/-/visit tomorrow 10:00", "auto towels/-/delivery today soon"]],
    ["Teknisyen yarın 10'da gelecek. Havluları şimdi getiriyorum.", ["auto maintenance/-/visit tomorrow 10:00", "auto towels/-/delivery today soon"]],
    ["Teknisyen yarın 10'da gelecek. Havluları 20 dakika içinde getireceğim.", ["auto maintenance/-/visit tomorrow 10:00", "auto towels/-/delivery today 09:20"]],
    ["Teknisyen bugün 15'te gelecek. Havlu getireceğim.", ["auto maintenance/-/visit today 15:00", "auto towels/-/delivery today day"]],
    ["Yarın sabah\nTeknisyen 10'da gelecek", ["CARD maintenance/-/visit today 10:00 dayUnclear"]],
    [
      "Tomorrow:\n- technician will come at 10\n- I'll bring towels at 6pm",
      ["CARD maintenance/-/visit today 10:00 dayUnclear", "CARD towels/-/delivery today 18:00 dayUnclear"],
    ],
    ["Teknisyen yarın gelir. Havlu getireceğim.", ["CARD maintenance/-/visit tomorrow day tentative", "CARD towels/-/delivery today day dayUnclear"]],
    ["Merhaba, yarın çıkışınız var, saat 11'de, teknisyen 10'da gelecek.", ["CARD maintenance/-/visit today 10:00 dayUnclear"]],
    // T3: zamansız devam (tür + konu + yapan uyumlu, iki yönde) düşer; konusu konusuz söze yazılır. Konusu farklı devam ayrı söz.
    ["Teknisyen yarın 10'da gelecek. Klimaya da bakacak.", ["auto maintenance/ac/visit tomorrow 10:00"]],
    ["Temizlik yapılacak, temizlikçi yarın 10'da gelecek.", ["auto cleaning/-/visit tomorrow 10:00"]],
    [
      "Klima için teknisyen yarın 10'da gelecek. Kombiyi de tamir edecek.",
      ["auto maintenance/ac/visit tomorrow 10:00", "CARD maintenance/heating/- today day dayUnclear"],
    ],
    ["Yarın 10'da klimayı halledeceğiz, teknisyen gelecek.", ["auto maintenance/ac/- tomorrow 10:00"]],
    // T4: yalnız süre taşıyan söz, SOLUNDA aynı aileden günlü söz varsa işin süresidir; solda değilse ayrı söz.
    ["Teknisyen yarın 10'da gelecek, arızayı 2 saat içinde halledecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["Teknisyen 1 saat içinde gelecek. Yarın 10'da da usta gelecek.", ["auto maintenance/-/visit today 10:00", "auto maintenance/-/visit tomorrow 10:00"]],
    // T1: "ve" ile bağlı iki söz ayrılır (havlu kaybolmaz, teknisyen 22:00 olmaz).
    [
      "Teknisyen yarın 10'da gelecek ve havluları akşam getireceğim.",
      ["auto maintenance/-/visit tomorrow 10:00", "CARD towels/-/delivery today evening dayUnclear"],
    ],
    ["Teknisyen yarın 10'da gelecek ve 2 saat içinde halledecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    // T2: yarınki söz + süre → saat uydurulmaz (yarın 11:00 değil), kart sorar; açık saat süreyi yener.
    ["Teknisyen yarın 2 saat içinde gelecek.", ["CARD maintenance/-/visit tomorrow day timeAmb"]],
    [
      "Teknisyen 30 dakika içinde gelecek ve yarın 10'da kombiye de bakacak.",
      ["auto maintenance/-/visit today 09:30", "auto maintenance/heating/- tomorrow 10:00"],
    ],
    // Aşırı uygulama denetimi.
    ["Yarın teknisyen 10'da gelecek, havluları bugün akşam getireceğim.", ["auto maintenance/-/visit tomorrow 10:00", "auto towels/-/delivery today evening"]],
    [
      "Klima için teknisyen yarın 10'da gelecek, musluk için usta yarın 11'de gelecek.",
      ["auto maintenance/ac/visit tomorrow 10:00", "auto maintenance/faucet/visit tomorrow 11:00"],
    ],
    ["The technician will come today at 2pm, you can reach me 24/7.", ["auto maintenance/-/visit today 14:00"]],
    ["Teknisyen yarın 10'da gelecek, adres Gül Sokak No:12/3.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["Havlu getireceğim.", ["auto towels/-/delivery today day"]],
    // Sağdaki yalın olmayan parçadan gün okunmaz ("yarın görüşürüz" sözün günü değil → kart).
    ["Havlu getireceğim, yarın görüşürüz.", ["CARD towels/-/delivery today day dayUnclear"]],
    ["Teknisyen gelecek, yarın sabah 10 gibi.", ["auto maintenance/-/visit tomorrow 10:00"]],
    // Haiku gece-4: "ertesi / öbür / sonraki sabah", "next day / morning" tanınmayan gün (bugüne düşmez); kapsam dışındaysa kart.
    ["Teknisyen ertesi sabah 10'da gelecek.", []],
    ["Öbür sabah 10'da teknisyen gelecek.", []],
    ["Teknisyen sonraki gün 10'da gelecek.", []],
    ["The technician will come the next day at 10.", []],
    ["The technician will come the next morning at 10.", []],
    ["Havlu ertesi sabah getireceğim. Teknisyen 10'da gelecek.", ["CARD maintenance/-/visit today 10:00 dayUnclear"]],
    // Hafta günü yalnız hâl ekleriyle: "Salim," / "Salih," ad (söz düşmez); "Salıya", "Cumadan" gün.
    ["Salim, teknisyen 10'da gelecek.", ["auto maintenance/-/visit today 10:00"]],
    ["Salih, teknisyen 10'da gelecek.", ["auto maintenance/-/visit today 10:00"]],
    ["Salıya teknisyen gelecek.", []],
    ["Cumadan önce teknisyen gelecek.", []],
    // Hiçbir sözün kapsamına girmeyen saat değişikliği → saat kendiliğinden kaydedilmez (kart).
    ["Teknisyen yarın 10'da gelecek, saat 11'e kaydı.", ["CARD maintenance/-/visit tomorrow 10:00 timeAmb"]],
    ["Teknisyen yarın 10'da gelecek. 11'e kaydı.", ["CARD maintenance/-/visit tomorrow 10:00 timeAmb"]],
    ["Teknisyen yarın 10'da gelecek, ertelendi.", ["CARD maintenance/-/visit tomorrow 10:00 timeAmb"]],
    // Fiilden sonraki dilek: ardında içerik varsa sonuca dilektir (söz kalır); yoksa sözü bozar.
    ["Teknisyen yarın 10'da gelecek umarım sorun çözülür.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["Teknisyen yarın gelecek umarım.", ["CARD maintenance/-/visit tomorrow day tentative"]],
    ["The technician will come tomorrow hopefully.", ["CARD maintenance/-/visit tomorrow day tentative"]],
    ["Hopefully the technician will come tomorrow at 10.", ["CARD maintenance/-/visit tomorrow 10:00 tentative"]],
    // Soldaki yalın saat parçası okunur.
    ["Teknisyen 10'da, yarın gelecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    // T1: ayrılamayan iki söz fiili (bağlaç yok) → saat / dilim okunmaz (22:00 uydurulmaz), kart.
    ["Teknisyen yarın 10'da gelecek havluları akşam getireceğim.", ["CARD maintenance/-/visit tomorrow day timeAmb"]],
    // T2: kendi kapsamında saat + süre → saat kazanır (süre işin uzunluğu).
    ["Teknisyen yarın 10'da gelip 2 saat içinde halledecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    // Opus gece-4 F1: çıplak "-iyor" / "is coming" planlı geleceği de anlatır — şimdiye bağlı değil (D3 kartı); "şimdi" / "yolda" bağlı.
    ["Yarın teknisyen geliyor, temizlikçi de geliyor.", ["auto maintenance/-/visit tomorrow day", "CARD cleaning/-/visit today day dayUnclear"]],
    ["The technician is coming tomorrow at 10. The cleaner is coming too.", ["auto maintenance/-/visit tomorrow 10:00", "CARD cleaning/-/visit today day dayUnclear"]],
    ["Yarın 10'da teknisyen gelecek. Havluları getiriyorum.", ["auto maintenance/-/visit tomorrow 10:00", "CARD towels/-/delivery today day dayUnclear"]],
    ["Temizlikçi geliyor.", ["auto cleaning/-/visit today day"]],
    // Opus gece-4 F5: kesmesiz "well" / "ill" söz fiili değildir.
    ["The cleaning went well.", []],
    ["Hope the towels are well received.", []],
    ["The technician fixed it, all is well.", []],
    ["We'll bring towels tonight.", ["auto towels/-/delivery today night"]],
    // Opus gece-4 F3: yazım hataları / bitişik yazım / bayram / kısaltılmış gün.
    ["The technician will come tomorow at 10.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["The technician will come tmrw at 10.", ["auto maintenance/-/visit tomorrow 10:00"]],
    ["Teknisyen öbürgün gelecek.", []],
    ["Teknisyen bayramdan sonra gelecek.", []],
    ["Teknisyen yarından itibaren gelecek.", []],
    ["Cmt günü teknisyen 10'da gelecek.", []],
    // Opus gece-4 F4: geçmişe atıflı parçadaki "yarın" yine gün işaretidir.
    ["Dün akşam klima bozulmuş yarın teknisyen gelecek. Havlu getireceğim.", ["auto maintenance/ac/visit tomorrow day", "CARD towels/-/delivery today day dayUnclear"]],
    // Opus gece-4 F15: teyit sorusu ayrı cümlede de sözü bekletir; "umuyorum / I hope" dilektir. KONTROL: genel soru bozmaz.
    ["Teknisyen yarın 10'da gelecek. Sizin için uygun mu?", []],
    ["The technician will come tomorrow at 10. Is that ok?", []],
    ["Umuyorum teknisyen yarın 10'da gelecek.", ["CARD maintenance/-/visit tomorrow 10:00 tentative"]],
    ["I hope the technician will come tomorrow at 10.", ["CARD maintenance/-/visit tomorrow 10:00 tentative"]],
    ["Teknisyen yarın 10'da gelecek. Başka bir ihtiyacınız var mı?", ["auto maintenance/-/visit tomorrow 10:00"]],
    // Opus gece-4 F16: ayrı varış sözü ("tesisatçı da 1 saat içinde gelecek") işin süresi değildir.
    ["Elektrikçi yarın 10'da gelecek, tesisatçı da 1 saat içinde gelecek.", ["auto maintenance/-/visit tomorrow 10:00", "auto maintenance/-/visit today 10:00"]],
    // Opus gece-4 F17: soldaki BAŞKA konunun günü bu sözün günü değil → kart.
    ["Towels tomorrow, the technician will come at 3.", ["CARD maintenance/-/visit today 15:00 dayUnclear"]],
    ["Temizlik yarın, havluları akşam getireceğim.", ["CARD towels/-/delivery today evening dayUnclear"]],
    // Opus gece-4 F18: aynı ziyaretin iki fiili saati kaybetmez.
    ["Teknisyen yarın 10'da gelecek klimayı tamir edecek.", ["auto maintenance/ac/visit tomorrow 10:00"]],
    // Opus gece-4 F19: "getiriyor" söz fiili; "10 sularında" su konusu değil.
    ["Yarın sabah temizlikçi geliyor, havluları da o getiriyor.", ["auto cleaning/-/visit tomorrow morning", "CARD towels/-/delivery today day dayUnclear"]],
    ["Teknisyen yarın 10 sularında gelecek.", ["auto maintenance/-/visit tomorrow 10:00"]],
    // Opus gece-4 F6: "10 civarı" yalın zaman parçasıdır (gün + saat korunur).
    ["Yarın sabah, saat 10 civarı, klima için teknisyen gelecek.", ["auto maintenance/ac/visit tomorrow 10:00"]],
    ["10 civarı, teknisyen gelecek.", ["auto maintenance/-/visit today 10:00"]],
  ])("%s", (text, expected) => {
    expect(summary(text)).toEqual(expected);
  });

  it("Opus gece-4 F2: selamdaki gün dilimi ('İyi akşamlar', 'Good evening') sözün dilimi DEĞİL — akşam yazılan '9'da' yarın 09:00", () => {
    const at = (t: string, now: number) => detectHostPromises(t).map((p) => promiseWindow(p, now));
    expect(at("İyi akşamlar teknisyen yarın 9'da gelecek.", 20 * 60)).toEqual([{ day: "tomorrow", precision: "time", time: "09:00", end: 540 }]);
    expect(at("İyi akşamlar Ahmet Bey teknisyen yarın 9'da gelecek", 20 * 60)).toEqual([{ day: "tomorrow", precision: "time", time: "09:00", end: 540 }]);
    expect(at("Good evening the technician will come tomorrow at 9", 20 * 60)).toEqual([{ day: "tomorrow", precision: "time", time: "09:00", end: 540 }]);
    expect(at("İyi geceler teknisyen yarın 11'de gelecek", 23 * 60)).toEqual([{ day: "tomorrow", precision: "time", time: "11:00", end: 660 }]);
    // KONTROL: gerçek dilim okunmaya devam eder.
    expect(at("Yarın akşam 9'da teknisyen gelecek.", 20 * 60)).toEqual([{ day: "tomorrow", precision: "time", time: "21:00", end: 1260 }]);
  });

  it("söz konumu (anchor) metindeki yerdir: '<cümlecik>-<parça>-<tür>' — algılama kuralları değişse de aynı söz aynı konum (öneri anahtarı)", () => {
    expect(detectHostPromises("Merhaba. Teknisyen yarın 10'da gelecek ve havluları akşam getireceğim.").map((p) => p.anchor)).toEqual([
      "1-0-maintenance",
      "1-1-towels",
    ]);
    expect(detectHostPromises("Yarın, teknisyen 10'da gelecek.").map((p) => p.anchor)).toEqual(["0-1-maintenance"]);
    // Devamı düşen söz arayı KAYDIRMAZ: sonraki sözün konumu aynı kalır.
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek, aylık bakımı da yapacak. Havluları akşam getireceğim.").map((p) => p.anchor)).toEqual([
      "0-0-maintenance",
      "1-0-towels",
    ]);
    // Anahtar biçimi öneri anahtarı sözleşmesine uyar (nokta yok).
    expect(parseSuggestionKey(suggestionKey("commitment", "cmsg123:1-0-towels"))).toEqual({ kind: "commitment", source: "cmsg123:1-0-towels" });
  });

  it("Opus gece-4 F12–F18: yalın dilim, gece 12, açık bugün, teyit sorusu, dilek, varış sözü, başka konulu sol parça, aynı ziyaretin iki fiili", () => {
    const at = (t: string, now: number) => detectHostPromises(t).map((p) => ({ ...promiseWindow(p, now), card: p.dayUnclear || p.timeAmbiguous }));
    // F12: soldaki yalın "Akşam," / "Bu akşam," / "This evening," dilimi okunur (15:00'te yazıldı → bugün 21:00).
    for (const t of ["Akşam, teknisyen 9'da gelecek.", "Bu akşam, teknisyen 9'da gelecek.", "This evening, the technician will come at 9."]) {
      expect(at(t, 15 * 60)).toEqual([{ day: "today", precision: "time", time: "21:00", end: 1260, card: false }]);
    }
    expect(at("Yarın akşam ise, teknisyen 9'da gelecek.", 15 * 60)).toEqual([{ day: "tomorrow", precision: "time", time: "21:00", end: 1260, card: false }]);
    // F13: "gece 12" gece yarısıdır (öğlen değil); "yarın gece 12" belirsiz → kart.
    expect(at("Teknisyen bu gece 12'de gelecek.", 15 * 60)).toEqual([{ day: "tomorrow", precision: "time", time: "00:00", end: 0, card: false }]);
    expect(at("I'll bring towels tonight at 12.", 15 * 60)).toEqual([{ day: "tomorrow", precision: "time", time: "00:00", end: 0, card: false }]);
    expect(at("Teknisyen yarın gece 12'de gelecek.", 15 * 60)[0]!.card).toBe(true);
    // F14: açık "bugün" + geçmiş saat / dilim yarına kaymaz (bugün kalır → geçmiş söz önerilmez); "bugün" yazılmamışsa eskisi gibi yarın.
    expect(at("Teknisyen bugün 11'de gelecek.", 13 * 60)[0]).toMatchObject({ day: "today", time: "11:00" });
    expect(at("Teknisyen bu sabah gelecek.", 13 * 60)[0]).toMatchObject({ day: "today", dayPart: "morning" });
    expect(at("Sabah teknisyen gelecek.", 13 * 60)[0]).toMatchObject({ day: "tomorrow", dayPart: "morning" });
  });

  it("Opus gece-4 dilim sonu B5 / B7: genel hal sorusu sözü düşürmez; 'gece 12:30' ertesi günün 00:30'u", () => {
    const at = (t: string, now: number) => detectHostPromises(t).map((p) => ({ ...promiseWindow(p, now), card: p.dayUnclear || p.timeAmbiguous }));
    for (const t of ["The technician will come tomorrow at 10. Is everything else ok?", "Teknisyen yarın 10'da gelecek. Daire nasıl, her şey tamam mı?"]) {
      expect(at(t, 9 * 60), t).toEqual([{ day: "tomorrow", precision: "time", time: "10:00", end: 600, card: false }]);
    }
    // KONTROL: sözün kendisine dönük teyit hâlâ sözü bekletir (F15) — "başka bir saat" de teyittir (Opus B5 kalıntısı).
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek. Uygun mu?")).toEqual([]);
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek. Başka bir saat uygun mu?")).toEqual([]);
    expect(at("Teknisyen yarın 10'da gelecek. Başka bir şey tamam mı?", 9 * 60)[0]).toMatchObject({ day: "tomorrow", time: "10:00" });
    expect(at("Teknisyen gece 12:30'da gelecek.", 13 * 60)).toEqual([{ day: "tomorrow", precision: "time", time: "00:30", end: 30, card: false }]);
    expect(at("I'll bring towels tonight at 12:30.", 13 * 60)[0]).toMatchObject({ day: "tomorrow", time: "00:30" });
    expect(at("Teknisyen yarın gece 12:30'da gelecek.", 13 * 60)[0]!.card).toBe(true);
  });

  it("Haiku gece-4 (Opus düzeltmeleri sonrası): sözün kendi günü varken günsüz soldaki dilim ödünç alınmaz; kesmesiz 'Ill / Well' dar fiille söz", () => {
    const at = (t: string, now: number) => detectHostPromises(t).map((p) => ({ ...promiseWindow(p, now), card: p.dayUnclear || p.timeAmbiguous }));
    // "Akşam" (bugünün akşamı) "yarın 9'da"ya bağlanmaz → yarın 09:00 (21:00 değil).
    for (const t of ["Akşam, teknisyen yarın 9'da gelecek.", "Gece, teknisyen yarın 9'da gelecek.", "Akşam, yarın teknisyen 9'da gelecek."]) {
      expect(at(t, 15 * 60), t).toEqual([{ day: "tomorrow", precision: "time", time: "09:00", end: 540, card: false }]);
    }
    // KONTROL: kendi günü olmayan söz soldaki dilimi almaya devam eder (F12); günlü dilim aynen.
    expect(at("Akşam, teknisyen 9'da gelecek.", 15 * 60)[0]).toMatchObject({ day: "today", time: "21:00" });
    expect(at("Yarın akşam, teknisyen 9'da gelecek.", 15 * 60)[0]).toMatchObject({ day: "tomorrow", time: "21:00" });
    // Kesmesiz yazım (mobil) dar fiille söz; "well" / "well come" / "check-in" söz değil (F5 korunur).
    expect(detectHostPromises("Ill bring towels tomorrow.").map((p) => p.kind)).toEqual(["towels"]);
    expect(detectHostPromises("Well send the technician tomorrow at 10.").map((p) => p.kind)).toEqual(["maintenance"]);
    for (const t of [
      "The cleaning went well.",
      "You are well come, the technician is great.",
      "The AC works well check-in is at 15:00 tomorrow.",
      // Haiku gece-4 2. tur: durum sözcüğünden sonraki "well" zarftır.
      "Everything went well send towels tomorrow at 10.",
      "The shower works well fix tomorrow at 10.",
      // Cümle başı "welcome" yazım hatası — fiil listesi dar ("come" yok; ölçüldü: listede olsa havlu sözü çıkıyordu).
      "Well come to our flat, the towels are in the closet tomorrow.",
    ]) {
      expect(detectHostPromises(t), t).toEqual([]);
    }
  });
});

describe("gece-4 izsiz bulgular — koşul, kararsızlık, konaklamaya bağlı / alışkanlık, p.m., tür sınırı, iki dilim, alt sınır (S1)", () => {
  const none = (t: string) => expect(detectHostPromises(t), t).toEqual([]);

  it("🚨 S1-06: ekle kurulan koşul söz değil (Türkçe -rsa / -mazsa / -ıyorsa / -dıysa / varsa / eksikse, İngilizce should / in case / let me know)", () => {
    for (const t of [
      "Klima çalışmazsa yarın teknisyen gelecek",
      "Sorun devam ederse yarın teknisyen göndereceğim",
      "Hâlâ çalışmıyorsa yarın usta gelecek",
      "Bir sorun yaşarsanız yarın sabah ilk iş teknisyen göndereceğim",
      "Bir sorun olursa teknisyen gelecek",
      "Havlu lazımsa söyleyin, getiririm",
      "Havlu eksikse getiririm",
      "Havlu ihtiyacınız varsa getiririm",
      "Havlu gerekiyorsa getiririz",
      "Klima düzelmediyse yarın teknisyen gelecek",
      "Çıkışta çöpleri bırakırsanız temizlik ekibi temizleyecek",
      "Should the AC fail again, I'll send a technician",
      "In case of any problem the technician will come",
      "Let me know and I'll bring towels",
      "Whenever you need, the cleaner will come",
    ])
      none(t);
  });

  it("KONTROL S1-06: sağdaki ayrı koşul, konu eki 'ise', 'Bursa' ve 'of course' sözü BOZMAZ", () => {
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek, sorun olursa bana yazın.")).toMatchObject([{ kind: "maintenance", day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("Havlu ise yarın getireceğim.")).toMatchObject([{ kind: "towels", day: "tomorrow" }]);
    expect(detectHostPromises("Bursa'dan teknisyen yarın 10'da gelecek.")).toMatchObject([{ kind: "maintenance", day: "tomorrow" }]);
    expect(detectHostPromises("Of course, I will bring towels tomorrow.")).toMatchObject([{ kind: "towels", day: "tomorrow" }]);
  });

  it("S1-08 + kurucu T5: kararsızlık (herhalde / tahminen / büyük ihtimalle / olabilir) kesin söz değil — kart", () => {
    for (const t of ["Teknisyen yarın gelecek herhalde", "Teknisyen tahminen yarın gelecek", "Teknisyen büyük ihtimalle yarın gelecek", "Teknisyen yarın 10'da orada olabilir, gelecek"])
      expect(detectHostPromises(t).map((p) => p.tentative), t).toEqual([true]);
  });

  it("🚨 S1-19: konaklamaya bağlı an (çıkış / giriş / siz gelmeden) açık gün yoksa ve alışkanlık her zaman söz değil", () => {
    for (const t of [
      "Çıkıştan sonra temizlik yapılacak",
      "Çıkışınızdan sonra temizlikçi gelecek",
      "Siz çıkınca temizlik ekibi gelecek",
      "Temizlik ekibi çıkış günü gelecek",
      "Daire siz gelmeden önce temizlenecek",
      "Çarşaflar çıkışta değiştirilecek",
      "Check-out'tan sonra temizlik yapacağız",
      "After you leave, the cleaner will come",
      "The cleaner will come after you check out",
      "Çıkış günü saat 11'de temizlikçi gelecek",
      "Temizlikçi her sabah 9'da geliyor",
      "Normalde temizlik ekibi 10'da geliyor",
      "Temizlik ekibi genelde sabahları geliyor",
      "Havlular her gün değiştirilecek",
      "Housekeeping will come every morning",
      "We will change the towels every 3 days",
    ])
      none(t);
  });

  it("KONTROL S1-19: açık gün varsa konaklama sözcüğü bozmaz; başka cümledeki çıkış saati de bozmaz", () => {
    expect(detectHostPromises("Yarın çıkışınızdan sonra temizlikçi gelecek.")).toMatchObject([{ kind: "cleaning", day: "tomorrow" }]);
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek. Çıkış saatiniz 11:00.")).toMatchObject([{ kind: "maintenance", timeCandidates: [600] }]);
    expect(detectHostPromises("Giriş kapısının kilidi için usta yarın gelecek.")).toMatchObject([{ kind: "maintenance", day: "tomorrow" }]);
  });

  it("🚨 S1-13: noktalı a.m. / p.m. cümleyi bölmez; saat öğleden sonraya doğru okunur, baştaki gün kaybolmaz", () => {
    expect(detectHostPromises("The technician will come tomorrow at 2:30 p.m.")).toMatchObject([{ day: "tomorrow", timeCandidates: [14 * 60 + 30] }]);
    expect(detectHostPromises("Tomorrow at 10:00 a.m., the technician will come.")).toMatchObject([{ day: "tomorrow", timeCandidates: [600] }]);
    expect(detectHostPromises("The technician will come at 7 P.M. today.")).toMatchObject([{ timeCandidates: [19 * 60] }]);
    // Cümle sonundaki p.m. ardından yeni cümle: ikinci cümle ayrı okunur.
    expect(detectHostPromises("The technician will come tomorrow at 7 p.m. I will bring towels today.")).toMatchObject([
      { kind: "maintenance", day: "tomorrow", timeCandidates: [19 * 60] },
      { kind: "towels", day: "today" },
    ]);
  });

  it("S1-05: kısa kökler yalnız kendi ekleriyle (pilav / ustalıkla / bakımlı konu değil; pil / usta / bakım konu)", () => {
    for (const t of ["Akşam size pilav getireceğim", "Yarın size ustalıkla yapılmış bir hediye getireceğim", "Yarın size bakımlı bir araç göndereceğim", "Yarın size çaydanlık getireceğim"]) none(t);
    expect(detectHostPromises("Yarın pilleri getireceğim.")).toMatchObject([{ kind: "supplies" }]);
    expect(detectHostPromises("Ustamız yarın gelecek.")).toMatchObject([{ kind: "maintenance" }]);
    expect(detectHostPromises("Bakım için teknisyen yarın gelecek.")).toMatchObject([{ kind: "maintenance" }]);
    expect(detectHostPromises("Yarın çay ve şeker getireceğim.")).toMatchObject([{ kind: "supplies" }]);
  });

  it("S1-07: iki farklı gün dilimi → dilim seçilmez (gün kesinliği); 'akşamüstü' / 'gece yarısı' tek dilimdir", () => {
    expect(detectHostPromises("Teknisyen yarın sabah ya da öğleden sonra gelecek")).toMatchObject([{ day: "tomorrow", cue: null, timeCandidates: [] }]);
    expect(detectHostPromises("Teknisyen yarın akşamüstü gelecek")).toMatchObject([{ cue: { code: "late_afternoon" } }]);
    expect(detectHostPromises("Teknisyen yarın gece yarısı gelecek")).toMatchObject([{ cue: { code: "midnight" } }]);
    expect(detectHostPromises("Teknisyen yarın akşam gelecek")).toMatchObject([{ cue: { code: "evening" } }]);
  });

  it("S1-14 / S1-09: alt sınır, aralık ve 'yarın gece 1'de' kesin saat değil → kart saati sorar", () => {
    for (const t of [
      "Teknisyen yarın 10:30'dan sonra gelecek",
      "The technician will come tomorrow after 5 pm",
      "The technician will come between 2 and 4 pm tomorrow",
      "Teknisyen yarın 10-11 gibi gelecek",
      "Teknisyen yarın gece 1'de gelecek",
    ])
      expect(detectHostPromises(t), t).toMatchObject([{ timeAmbiguous: true }]);
    // KONTROL: kesin saat belirsiz sayılmaz.
    expect(detectHostPromises("Teknisyen yarın 10:30'da gelecek")).toMatchObject([{ timeAmbiguous: false, timeCandidates: [630] }]);
    expect(detectHostPromises("Teknisyen bu gece 1'de gelecek")).toMatchObject([{ timeAmbiguous: false }]);
  });

  it("Haiku S1 incelemesi: 1. tekil koşul ('gelirsem'), 'X pm'den sonra', baştaki 'Should …' koşul; cümle ortasındaki 'should' sözü bozmaz", () => {
    for (const t of ["Yarın gelirsem havlu getiririm", "Yarın uğrarsam havlu getiririm", "Should you need anything, I will bring towels tomorrow"]) none(t);
    expect(detectHostPromises("Teknisyen yarın 5 pm'den sonra gelecek")).toMatchObject([{ timeAmbiguous: true }]);
    expect(detectHostPromises("I will bring towels tomorrow, you should have them by 10")).toMatchObject([{ kind: "towels", day: "tomorrow" }]);
  });

  it("🚨 Haiku S1 incelemesi: saat değişikliği belirsizken de varış fiilli süreli söz ayrı söz kalır (kopyada fiil kaydı kayboluyordu)", () => {
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek. Tesisatçı da 1 saat içinde gelecek. Ertelendi.")).toMatchObject([
      { kind: "maintenance", day: "tomorrow", timeCandidates: [600], timeAmbiguous: true },
      { kind: "maintenance", inMinutes: 60, timeAmbiguous: true },
    ]);
  });

  it("süre: yeni kalıplar uzun girdide doğrusal (koşul eki, alışkanlık, konaklama, aralık, a.m.)", () => {
    const runs = [
      `${"a".repeat(3_990)}ursa`,
      "olursa ".repeat(570),
      "her gun ".repeat(500),
      `cikis${" ".repeat(3_990)}x`,
      "10-".repeat(1_330),
      `1${" ".repeat(1_990)}-${" ".repeat(1_990)}2`,
      "after 1 ".repeat(500),
      "a.m. ".repeat(800),
      `10:30${" ".repeat(3_980)}'dan sonra`,
      "siz gelmeden ".repeat(300),
    ];
    for (const r of runs) {
      const t = performance.now();
      detectHostPromises(r);
      expect(performance.now() - t).toBeLessThan(1_000);
    }
  });
});

describe("sert itirazcı gece-4 (354 cümle): yeni kurallar KESİN sözü düşürmez, kaçanlar kapanır", () => {
  const none = (t: string) => expect(detectHostPromises(t), t).toEqual([]);
  const some = (t: string) => expect(detectHostPromises(t).length, t).toBeGreaterThan(0);

  it("🚨 Y1/Y2: koşulun kendi yüklemi varsa ya da fiilden sonra geliyorsa söz kalır; soldaki parça koşulla bitiyorsa düşer", () => {
    for (const t of [
      "Sorun olursa bana yazın, teknisyen yarın 10'da gelecek",
      "Eksik bir şey varsa haber verin, havlu yarın sabah getireceğim",
      "Merhaba, bir sorun yaşarsanız bana yazın, yarın saat 10'da usta gelecek",
      "Let me know your arrival time, I'll bring towels tonight",
      "Please tell me what you need, I'll bring towels tonight",
      "Teknisyen yarın 10'da gelecek sorun olursa yazın",
      "Yarın havlu getireceğim eksik bir şey varsa yazın",
      "The technician will come tomorrow at 10 as needed",
    ])
      some(t);
    for (const t of ["Sorun olursa, teknisyen gelecek", "Klima çalışmazsa, teknisyen yarın gelecek", "Havlu lazımsa söyleyin, getiririm", "Havlu lazımsa yazın, yarın getiririm"]) none(t);
    // Mutasyon v9 yaşayanları: yüklemli koşul + SAATSİZ söz (başka konu) ve yüklemli koşul + saatli GENİŞ ZAMAN teklifi (konusuz koşul) söz değil.
    for (const t of ["Sorun olursa bana yazın, teknisyen gelecek", "Bir sorun olursa bana yazın, havlu getireceğim", "Eksik bir şey varsa yazın, havluları yarın getiririm"]) none(t);
    // Mutasyon v9 ikinci tur: koşul sözcüğünden sonra yalnız zaman sözcükleri ("… ederse yarın sabah,") soldaki parçayı koşul yapar.
    for (const t of ["Sorun devam ederse yarın sabah, teknisyen 10'da gelecek", "Olmazsa yarın, teknisyen 10'da gelecek"]) none(t);
  });

  it("Y3: yeni kararsızlık sözcükleri YEREL — sebep cümlesinde bozmaz, sözün kendisinde bozar", () => {
    for (const t of ["Biraz gecikme olabilir, teknisyen yarın 10'da gelecek", "Büyük ihtimalle filtre tıkanmış, teknisyen yarın 10'da gelecek", "Tahminen 2 saat sürer, usta yarın 10'da gelecek", "Olabilecek en kısa sürede teknisyen göndereceğiz", "Umarım iyisinizdir, teknisyen gelecek"]) some(t);
    for (const t of ["Teknisyen yarın gelecek herhalde", "Teknisyen tahminen yarın gelecek", "Teknisyen yarın gelecek olabilir", "I think the technician will come tomorrow at 10", "The technician will likely come tomorrow at 10", "We'll try to send the technician tomorrow", "Elimden geldiğince yarın teknisyen göndereceğim"])
      expect(detectHostPromises(t).map((p) => p.tentative), t).toEqual([true]);
  });

  it("Y4/Y5: açık gün varsa alışkanlık / konaklama sözcüğü bozmaz; çıkış kapısı / yangın çıkışı / varış saati konaklama anı değil", () => {
    for (const t of ["Haftalık temizlik için temizlikçi yarın 11'de gelecek", "Her zaman yardımcı oluruz, yarın havlu getireceğim", "Temizlikçi her sabah 9'da gelir, yarın 11'de gelecek", "Çıkış kapısının kilidini usta tamir edecek", "Yangın çıkışı için teknisyen gelecek", "Varış saatinizi öğrendim, teknisyen 4'te gelecek"]) some(t);
    for (const t of ["Konaklamanız bittiğinde temizlik yapılacak", "Odayı terk ettikten sonra temizlik yapılacak", "Siz çıkıp gidince temizlik ekibi gelecek", "Twice a week the cleaner will come", "Hafta sonları temizlikçi gelecek"]) none(t);
  });

  it("Y6/Y7: kısa kökün çekimleri konu ('ustayla', 'bakımını', 'pilinizi'); 'reimburse' koşul değil; ad + '-sa' koşulu ('bozuksa', 'müsaitseniz')", () => {
    for (const t of ["Ustayla görüştüm, yarın 10'da gelecek", "Havuzun bakımını yarın yapacağız", "Kumandanın pilini yarın getireceğim", "Çayınızı akşam getireceğim", "I'll bring the towels and reimburse you tomorrow", "The reimburse form is ready and the technician will come tomorrow at 10"]) some(t);
    for (const t of ["Klima bozuksa yarın teknisyen gelecek", "Müsaitseniz yarın teknisyen gelecek", "Sorun olduğunda teknisyen gelecek", "Havlu lazım olunca getiririm", "Provided you are home, the technician will come tomorrow", "Teknisyen 2026-10-19 tarihinde gelecek"]) none(t);
  });

  it("C1–C4: 'p.m. tomorrow' günü kaybetmez; telefon / daire numarası aralık değil; öğün dilimi bozmaz; saati niteleyen dilim; 'tomorrow night'", () => {
    expect(detectHostPromises("The technician will come at 2:30 p.m. tomorrow.")).toMatchObject([{ day: "tomorrow", timeCandidates: [14 * 60 + 30] }]);
    for (const t of ["Teknisyen Ahmet (0532-123 45 67) yarın 10'da gelecek", "3-1 numaralı daireye teknisyen yarın 10'da gelecek", "Wi-Fi 2-4 GHz için teknisyen yarın 10'da gelecek"])
      expect(detectHostPromises(t), t).toMatchObject([{ timeAmbiguous: false, timeCandidates: [600] }]);
    expect(detectHostPromises("Teknisyen yarın 10:00-11:00 arası gelecek")).toMatchObject([{ timeAmbiguous: true }]);
    expect(detectHostPromises("Yarın öğleden sonra, akşam yemeğinden önce havlu getireceğim")).toMatchObject([{ cue: { code: "afternoon" } }]);
    expect(detectHostPromises("Teknisyen yarın sabah kahvaltıdan sonra gelecek")).toMatchObject([{ cue: { code: "morning" } }]);
    expect(detectHostPromises("Teknisyen yarın sabah 8'de, öğlen olmadan gelecek")).toMatchObject([{ timeCandidates: [480] }]);
    expect(detectHostPromises("The technician will come tomorrow night at 11")).toMatchObject([{ day: "tomorrow", timeCandidates: [23 * 60] }]);
  });

  it("süre: yeni öbek / giriş / öğün kalıpları uzun girdide doğrusal", () => {
    for (const r of ["sorun oldugunda ".repeat(250), `provided${" ".repeat(3_990)}x`, "aksam yemegi ".repeat(300), "konaklama bitti ".repeat(250), "1-2 ".repeat(1_000), `sabah${" ".repeat(3_990)}8`]) {
      const t = performance.now();
      detectHostPromises(r);
      expect(performance.now() - t).toBeLessThan(1_000);
    }
  });

  it("Haiku gece-4: süre girdileri SÖZ yolunu da çalıştırır — soldaki koşul parçası doğrusal (eskiden her koşul sözcüğü kalanı yeniden tarıyordu: 3.990 karakterde ~180 ms)", () => {
    const S = ", teknisyen yarın 10'da gelecek";
    const inputs = ["olursa ".repeat(565) + S, "bozuksa yarın ".repeat(282) + S, `1-2${" ".repeat(3_920)}x${S}`, "her gün ".repeat(495) + S, "siz gidince ".repeat(330) + S];
    detectHostPromises(inputs[0]!); // ısınma (ilk çağrı kalıpları derler)
    for (const r of inputs) {
      expect(r.length).toBeLessThanOrEqual(4_000);
      const t = performance.now();
      detectHostPromises(r);
      expect(performance.now() - t, r.slice(0, 20)).toBeLessThan(100);
    }
  });

  it("Haiku gece-4: aynı konulu koşul sözü bozar (yüklemli de olsa); 'at 10 to 11' saati sorar; bilinen sınır: yüklemli alışkanlık / konaklama parçası", () => {
    for (const t of ["Havlu lazımsa yazın, yarın getireceğim", "Klima bozulursa yazın, teknisyen yarın 10'da gelecek"]) none(t);
    for (const t of ["Eksik bir şey varsa haber verin, havlu yarın getireceğim", "Havlu eksikse söyleyin, temizlikçi yarın 11'de gelecek", "Sorun olursa bana yazın, teknisyen yarın 10'da gelecek"]) some(t);
    expect(detectHostPromises("The technician will come tomorrow at 10 to 11")).toMatchObject([{ timeAmbiguous: true }]);
    expect(detectHostPromises("I'll bring 2 to 3 towels tomorrow at 10")).toMatchObject([{ timeAmbiguous: false, timeCandidates: [600] }]);
    expect(detectHostPromises("We'll try to send the technician tomorrow")).toMatchObject([{ tentative: true }]);
    // BİLİNEN SINIR (tutucu yön, kurucu kuralı "emin değilse görev açma"): soldaki parçanın kendi yüklemi olsa da alışkanlık / konaklama
    // sözcüğü açık günsüz sözü düşürür — "Siz gidince kapıyı kilitleyin, teknisyen 10'da gelecek"te gün gerçekten belirsiz.
    for (const t of ["Her gün kapıyı kontrol edin, teknisyen 10'da gelecek", "Siz gidince kapıyı kilitleyin, teknisyen 10'da gelecek"]) none(t);
  });
});

describe("Opus gece-4 dilim sonu 3: yanlış saat / kaçan kesin söz", () => {
  const none = (t: string) => expect(detectHostPromises(t), t).toEqual([]);
  const amb = (t: string) => expect(detectHostPromises(t), t).toMatchObject([{ timeAmbiguous: true }]);
  /** Kesin saat YOK: ya saat sorulur ya da hiç saat okunmaz (gün kesinliği — kart saati sorar). */
  const notFirm = (t: string) => {
    const [p] = detectHostPromises(t);
    expect(p, t).toBeDefined();
    expect(p!.timeAmbiguous || p!.timeCandidates.length === 0, t).toBe(true);
  };
  const firm = (t: string, minutes: number) => expect(detectHostPromises(t), t).toMatchObject([{ timeAmbiguous: false, timeCandidates: [minutes] }]);

  it("🚨 A2: saat karşıtlığı / değişikliği — olumsuzlanan ya da eski saat seçilmez (saat sorulur ya da dilimsiz gün)", () => {
    for (const t of ["Teknisyen sabah 9'da değil akşam gelecek.", "Havluları sabah 10'da değil akşam getireceğim.", "Teknisyen akşam 7'de değil sabah gelecek.", "Teknisyen 9 yerine 11'de gelecek", "The technician will come at 5 instead of 3"]) amb(t);
    for (const t of ["Teknisyen yarın sabah 9'dan akşama kaydı.", "Teknisyen yarın sabah 9 yerine akşam gelecek."]) {
      const [p] = detectHostPromises(t);
      expect(p, t).toBeDefined();
      expect([p!.timeCandidates, p!.cue?.code ?? null], t).toEqual([[], null]); // sabah ESKİ dilimdir
    }
    // KONTROL: saatten saate değişiklik yeni saati okur; olumsuz olmayan "sorun değil" bozmaz; iki dilimde saati niteleyen kalır.
    firm("Teknisyen yarın 10'dan 11'e kaydı.", 660);
    firm("Teknisyen yarın 10'da gelecek, sorun değil", 600);
    firm("Teknisyen yarın sabah 8'de, öğlen olmadan gelecek", 480);
  });

  it("🚨 A1: 'geçe / kala' söyleyişi gece dilimi değil; saat sorulur", () => {
    for (const t of ["Temizlikçi saat 3'ü 10 geçe gelecek.", "Teknisyen yarın 10'u çeyrek geçe gelecek.", "Teknisyen yarın 4'e 10 kala gelecek."]) {
      const [p] = detectHostPromises(t);
      expect(p?.timeAmbiguous, t).toBe(true);
      expect(p?.cue?.code ?? null, t).not.toBe("night");
    }
    firm("Teknisyen bu gece 9'da gelecek", 21 * 60); // KONTROL: gerçek "gece" dilimi
  });

  it("A3 + E1: seçenek / tireli / alt sınır / aralık biçimleri kesin saat değil (her alt dal ayrı)", () => {
    for (const t of [
      "The technician will come tomorrow around 2 or 3.",
      "The technician will come tomorrow at 2-3.",
      "Teknisyen yarın 10 veya 11'de gelecek.",
      "Teknisyen yarın 10 ya da 11 gibi gelecek.",
      "The technician will come tomorrow from 2pm.",
      "The technician will come tomorrow 2-3pm.",
      "Teknisyen yarın 10'dan 12'ye kadar gelecek.",
      "The technician will come tomorrow from 2 to 4 pm",
      "Teknisyen yarın saat 10-11 gelecek",
      "Teknisyen yarın 10 ile 11'de gelecek",
      "Teknisyen yarın 10-11 civarı gelecek",
      "Teknisyen yarın 10-11 saatleri arasında gelecek",
      "The technician will come tomorrow not before 10",
      "Teknisyen yarın 10'dan itibaren gelecek",
      "The technician will come tomorrow at 10 until 12",
      "The technician will come tomorrow at 10 till 12",
    ])
      notFirm(t);
    // KONTROL: adet / adres / süre aralık değil.
    firm("I'll bring 2 or 3 towels tomorrow at 10", 600);
    firm("The technician will come tomorrow at 10 from 3 Main Street", 600);
    firm("Teknisyen yarın 10'da gelecek, 2 veya 3 saat sürer", 600);
  });

  it("A6: karşıt-koşul ('ne olursa olsun', '-sa da', 'bile') kesin sözü düşürmez; zamanlı koşul ('olursa da') düşürür", () => {
    for (const [t, m] of [
      ["Ne olursa olsun teknisyen yarın 10'da gelecek.", 600],
      ["Geç olsa da teknisyen bu akşam 9'da gelecek.", 21 * 60],
      ["Trafik olsa bile teknisyen 3'te gelecek.", 15 * 60],
      ["Yağmur yağsa da usta yarın 10'da gelecek", 600],
    ] as const)
      firm(t, m);
    for (const t of ["Sorun olursa da teknisyen yarın gelecek", "Klima çalışmazsa yarın teknisyen gelecek"]) none(t);
  });

  it("A7 / A8: 'hava / su çıkışı, çıkış borusu' ve sözü yapanın kendi hareketi konaklama anı değil", () => {
    for (const [t, m] of [
      ["Klimanın hava çıkışından su damlıyor, teknisyen akşam 7'de gelecek.", 19 * 60],
      ["Su çıkışı tıkalı, tesisatçı 3'te gelecek.", 15 * 60],
      ["Kombinin çıkış borusu için usta 3'te gelecek.", 15 * 60],
      ["Teknisyen gelmeden önce sizi arayacak, saat 3'te gelecek.", 15 * 60],
      ["Temizlikçi diğer daireye gidince 3'te gelecek.", 15 * 60],
    ] as const)
      firm(t, m);
    // Mutasyon v10 B-isten: 'işten dönünce' sözü yapanın işi; 'dönünce' çapası yalnız misafirin dönüşü.
    expect(detectHostPromises("Teknisyen işten dönünce saat 7'de uğrayacak."), "işten dönünce").toMatchObject([
      { kind: "maintenance", timeCandidates: [420, 1140] },
    ]);
    // KONTROL: misafirin konaklama anı yine söz değil.
    for (const t of ["Çıkıştan sonra temizlik yapılacak", "Gelmeden önce daire temizlenecek", "Siz gidince temizlikçi gelecek", "Tatilden dönünce havlu getireceğim"]) none(t);
  });

  it("A10: İngilizce kip kararsızlığı yalnız sözün kendi parçasında; 'and will try to' ikinci fiilin", () => {
    firm("The technician will come tomorrow at 10 and will try to fix the AC.", 600);
    firm("We'll try to fix it, the technician will come tomorrow at 10.", 600);
    for (const t of ["We'll try to send the technician tomorrow", "The technician will likely come tomorrow at 10", "The technician will possibly come tomorrow"])
      expect(detectHostPromises(t).map((p) => p.tentative), t).toEqual([true]);
  });

  it("🚨 A11: en yaygın yeniden zamanlama mesajı — soldaki iptal / ayrı koşul yeni sözü düşürmez; sağdaki iptal ve öndeki koşul düşürür", () => {
    for (const t of [
      "Teknisyen bugün gelemeyecek, yarın 10'da gelecek.",
      "The technician can't come today, he will come tomorrow at 10.",
      "Bugün iptal oldu, teknisyen yarın 10'da gelecek.",
      "Teknisyen bugün gelmeyecek ama yarın 10'da gelecek.",
      "We'll fix the AC tomorrow at 10, if anything else comes up let us know.",
      "Teknisyen yarın 10'da gelecek, gerekirse parçayı da değiştirecek.",
    ])
      expect(detectHostPromises(t), t).toMatchObject([{ day: "tomorrow", timeCandidates: [600] }]);
    for (const t of [
      "Teknisyen gelecek ama iptal olabilir.",
      "Teknisyen yarın gelmeyecek",
      "If the AC fails, the technician will come tomorrow at 10",
      // Mutasyon v10 B-condWord: virgülsüz İngilizce koşul sözün kendi parçasında.
      "Unless it rains the technician will come tomorrow at 10",
      "Eğer klima bozulursa teknisyen gelecek",
      "Gerekirse yarın teknisyen gelecek",
      "Teknisyen yarın 10'da gelecek, iptal olursa haber veririm",
    ])
      none(t);
  });

  it("A12 / A14: 'temizliğe / temizliği' çekimi konu sayılır; sonu noktasız 'p.m' günü koparmaz", () => {
    firm("Ayşe Hanım yarın 11'de temizliğe gelecek.", 660);
    firm("Temizliği yarın 11'de yapacağız", 660);
    expect(detectHostPromises("Temizliği yarın 11'de yapacağız")[0]).toMatchObject({ kind: "cleaning", day: "tomorrow" });
    for (const t of ["Temizliğe dikkat ederseniz seviniriz.", "Temizliği sabah yaptık.", "Temizliğiniz için teşekkürler, yarın görüşürüz."]) none(t);
    expect(detectHostPromises("The technician will come at 2 p.m tomorrow")).toMatchObject([{ day: "tomorrow", timeCandidates: [840], dayUnclear: false }]);
    // Virgülsüz öne alınmış zaman tek cümle kalır (küçük harfli özneyi cümle başı saymanın ölçülmüş bedeli).
    expect(detectHostPromises("Tomorrow at 2 p.m. the cleaner will come")).toMatchObject([{ kind: "cleaning", day: "tomorrow", timeCandidates: [840] }]);
    // BİLİNEN SINIR (güvenli yön: söz kaybolur, yanlış saat yazılmaz): küçük harfle başlayan ikinci cümle birinciyle birleşir.
    expect(detectHostPromises("I'll bring towels at 6 p.m. the technician will come tomorrow.").map((p) => p.kind)).toEqual(["maintenance"]);
  });

  it("baş harfli ad cümleyi bölmez ('M. Ali', 'A.Murat'); önceki cümlenin saati söze geçmez", () => {
    firm("Teknisyenimiz M. Ali yarın 10'da gelecek.", 600);
    firm("Teknisyen A.Murat yarın 10'da gelecek.", 600);
    firm("Klimacı A.Mert yarın sabah 9'da gelecek.", 540);
    // Gerçek cümle sonu birleşse de saat sızmaz.
    for (const t of ["Toplantı saat 3'te, salon B. Teknisyen yarın gelecek.", "Checkout is at 11, gate B. The technician will come tomorrow."])
      expect(detectHostPromises(t), t).toMatchObject([{ kind: "maintenance", day: "tomorrow", timeCandidates: [] }]);
    firm("We switched to plan B. The technician will come tomorrow at 10.", 600);
    // BİLİNEN SINIR (güvenli yön): önceki cümledeki koşul birleşen sözü düşürür.
    none("Sorun olursa kapı B. Teknisyen yarın 10'da gelecek.");
    // Yalnız TEK harf baş harftir ("TV.", "ARAYIN." cümle sonu) ve ardından büyük + küçük harfli SÖZCÜK gelir ("TEKNİSYEN" yeni cümle):
    // aksi hâlde önceki cümlenin koşulu sözü düşürürdü.
    for (const t of [
      "Klima bozulursa haber verin lütfen TV. Teknisyen yarın 10'da gelecek.",
      "Sorun olursa ARAYIN. Teknisyen yarın 10'da gelecek.",
      "Sorun olursa kapı B. TEKNİSYEN yarın 10'da gelecek.",
    ])
      firm(t, 600);
  });
});

describe("kurucu T5 (10-21) — algılayıcı: kesin değil, sabah / akşam belirsizliği, bu gece, bağlam ipucu", () => {
  it("'yarın 7'de' / '8'de' sabah mı akşam mı belli değil; '10'da' gündüz tek okuma; dilim söylenince belirsizlik yok", () => {
    expect(detectHostPromises("Teknisyen yarın 7'de gelecek.")).toMatchObject([{ timeCandidates: [420, 1140], halfAmbiguous: true }]);
    expect(detectHostPromises("Teknisyen yarın 8'de gelecek.")).toMatchObject([{ halfAmbiguous: true }]);
    expect(detectHostPromises("Teknisyen yarın 10'da gelecek.")).toMatchObject([{ timeCandidates: [600], halfAmbiguous: false }]);
    expect(detectHostPromises("Teknisyen yarın akşam 7'de gelecek.")).toMatchObject([{ timeCandidates: [1140], halfAmbiguous: false }]);
  });

  it("'Bu gece 1'de' akşam yazıldıysa bu gecenin 01:00'i (ertesi gün), gece yarısından sonra yazıldıysa aynı gece", () => {
    const [p] = detectHostPromises("Bu gece 1'de havlu getireceğim.");
    expect(promiseWindow(p!, 21 * 60)).toMatchObject({ day: "tomorrow", time: "01:00" });
    expect(promiseWindow(p!, 30)).toMatchObject({ day: "today", time: "01:00" });
  });

  it("3. şahıs geniş zaman ('yarın gelir') kesin değil; kesin söz fiili varsa alışkanlık betimlemesi sözü düşürmez", () => {
    expect(detectHostPromises("Teknisyen yarın gelir.")).toMatchObject([{ day: "tomorrow", tentative: true }]);
    expect(detectHostPromises("Temizlikçi her sabah 9'da gelir, yarın 11'de gelecek.")).toMatchObject([{ day: "tomorrow", timeCandidates: [660], tentative: false }]);
    expect(detectHostPromises("Kira geliri yarın yatar.")).toEqual([]);
  });

  it("müsaitlik koşulu kesin değil; başka koşul (arıza) öneri değil", () => {
    for (const t of ["Teknisyen müsait olursa yarın gelir.", "Müsait olursa usta yarın gelecek.", "Mümkünse yarın teknisyen göndereceğim.", "If he is available the technician will come tomorrow at 10."])
      expect(detectHostPromises(t).map((p) => p.tentative), t).toEqual([true]);
    for (const t of ["Klima bozulursa teknisyen yarın gelecek.", "Müsait olursa ve klima bozulursa teknisyen yarın gelecek."]) expect(detectHostPromises(t), t).toEqual([]);
  });

  it("bağlam ipucu: tek yarı → o; iki yarı / yok → null; geçmişe atıf ('dün akşam') sayılmaz; 'şimdi / hemen'", () => {
    expect(contextHalfHint(["Teknisyen yarın akşam gelebilir mi?"])).toBe("pm");
    expect(contextHalfHint(["Sabah erkenden çıkıyoruz"])).toBe("am");
    expect(contextHalfHint(["Sabah mı akşam mı gelir?"])).toBeNull();
    expect(contextHalfHint(["Dün akşam klima bozuldu"])).toBeNull();
    expect(contextHalfHint(["İyi akşamlar, klima bozuk"])).toBeNull();
    expect(contextSaysNow(["Şimdi havlu getirebilir misiniz?"])).toBe(true);
    expect(contextSaysNow(["Yarın havlu getirebilir misiniz?"])).toBe(false);
  });
});
