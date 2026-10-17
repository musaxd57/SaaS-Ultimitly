import { describe, it, expect } from "vitest";
import {
  wifiTargetAmbiguous,
  wifiValueCount,
  applyWifiValue,
  AUTO_PROMOTION_MIN_DECISIONS,
  detectHostPromise,
  detectHostPromises,
  MAX_PROMISES_PER_MESSAGE,
  extractWifiValues,
  kbContainsValue,
  maskSecret,
  parseSuggestionKey,
  promiseDue,
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

  it("son an: açık saat → şimdiden sonraki ilk aday; göreli süre; yarın saatsiz → 12:00; hiçbiri → +2 saat", () => {
    const at10 = 10 * 60;
    expect(promiseDue(detectHostPromise("Havluları 18:00'de getireceğim.")!, at10)).toEqual({ day: "today", time: "18:00" });
    expect(promiseDue(detectHostPromise("Havluları 6'da getireceğim.")!, at10)).toEqual({ day: "today", time: "18:00" });
    expect(promiseDue(detectHostPromise("I'll bring fresh towels in 30 minutes.")!, at10)).toEqual({ day: "today", time: "10:30" });
    expect(promiseDue(detectHostPromise("Yarın teknisyen gelecek.")!, at10)).toEqual({ day: "tomorrow", time: "12:00" });
    expect(promiseDue(detectHostPromise("Temizlikçi gelecek.")!, at10)).toEqual({ day: "today", time: "12:00" });
    expect(promiseDue(detectHostPromise("Birazdan temizlikçi gelecek.")!, 23 * 60 + 30)).toEqual({ day: "tomorrow", time: "00:30" });
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

  it("gün dilimi: açık saat yoksa 'sabah' 10:00 / 'akşam' 19:00 / 'gece' 21:00 / 'öğlen' 12:00; açık saati öğleden önce / sonra süzer", () => {
    const at14 = 14 * 60;
    expect(promiseDue(detectHostPromise("Yarın sabah teknisyen gelecek.")!, at14)).toEqual({ day: "tomorrow", time: "10:00" });
    expect(promiseDue(detectHostPromise("Bu akşam havlu getireceğim.")!, at14)).toEqual({ day: "today", time: "19:00" });
    expect(promiseDue(detectHostPromise("Bu gece havlu getireceğim.")!, at14)).toEqual({ day: "today", time: "21:00" });
    expect(promiseDue(detectHostPromise("Yarın öğlen temizlikçi gelecek.")!, at14)).toEqual({ day: "tomorrow", time: "12:00" });
    expect(promiseDue(detectHostPromise("Öğleden sonra teknisyen gelecek.")!, 10 * 60)).toEqual({ day: "today", time: "15:00" });
    // Bugünkü dilim geçmişse yarına KAYMAZ ("bu akşam" 20:00'de yazıldıysa) → şimdi + 2 saat.
    expect(promiseDue(detectHostPromise("Bu akşam havlu getireceğim.")!, 20 * 60)).toEqual({ day: "today", time: "22:00" });
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
    ["Teknisyen yarına gelecek.", 600, { day: "tomorrow", time: "12:00" }],
    ["Akşam 7:00'de teknisyen gelecek.", 600, { day: "today", time: "19:00" }],
    ["Öğleden sonra 2:30'da teknisyen gelecek.", 600, { day: "today", time: "14:30" }],
    ["Yarın saat 2'de teknisyen gelecek.", 600, { day: "tomorrow", time: "14:00" }],
    ["Tomorrow at 2 the technician will come.", 600, { day: "tomorrow", time: "14:00" }],
    ["Teknisyen saat 10'da gelecek.", 900, { day: "tomorrow", time: "10:00" }],
    ["Teknisyen bugün gelecek, yarın havlu getiririm.", 600, { day: "today", time: "12:00" }],
    ["Yarın sabah, teknisyen gelecek.", 600, { day: "tomorrow", time: "10:00" }],
    ["Teknisyen yarın gelecek, işi 2 saat sürer.", 540, { day: "tomorrow", time: "12:00" }],
    ["Teknisyen bugün gelecek, 30 dakika sürer.", 540, { day: "today", time: "11:00" }],
    ["Yarın akşama teknisyen gelecek.", 600, { day: "tomorrow", time: "19:00" }],
    ["Sabah teknisyen gelecek.", 840, { day: "tomorrow", time: "10:00" }],
    ["Akşamüstü teknisyen gelecek.", 600, { day: "today", time: "17:00" }],
    ["Yarım saat içinde havlu getireceğim.", 600, { day: "today", time: "10:30" }],
    ["Bir saat içinde havlu getireceğim.", 600, { day: "today", time: "11:00" }],
    ["I'll bring towels in an hour.", 600, { day: "today", time: "11:00" }],
    ["1,25 saat sonra temizlikçi gelecek.", 600, { day: "today", time: "11:15" }],
    ["Gece 11'de havlu getireceğim.", 600, { day: "today", time: "23:00" }],
    ["Gece 11:30'da havlu getireceğim.", 600, { day: "today", time: "23:30" }],
    // Haiku 10-12 4. tur.
    ["Teknisyen en geç 5'e kadar gelecek.", 600, { day: "today", time: "17:00" }],
    ["Teknisyen gelecek, yarın sabah 10 gibi.", 600, { day: "tomorrow", time: "10:00" }],
    ["Teknisyen geliyor, yarın 10'da.", 600, { day: "tomorrow", time: "10:00" }],
    ["The technician will come tomorrow, around 9.", 600, { day: "tomorrow", time: "09:00" }],
    ["Temizlikçi gelecek, havlular yarın.", 600, { day: "today", time: "12:00" }], // başka konulu parça katılmaz
    ["Havlu getiririm.", 600, { day: "today", time: "12:00" }],
    ["Technician will come tomorrow morning.", 600, { day: "tomorrow", time: "10:00" }],
    ["Cleaners will come tomorrow at 9am.", 600, { day: "tomorrow", time: "09:00" }],
    ["Temizlikçi gelecek ve 3 saat kalacak.", 600, { day: "today", time: "12:00" }], // süre "içinde / sonra"sız → son an değil
    ["Teknik servis yarın gelecek.", 600, { day: "tomorrow", time: "12:00" }],
  ] as const)("%s @%i → %o", (text, now, due) => {
    const p = detectHostPromise(text);
    expect(p).not.toBeNull();
    expect(promiseDue(p!, now)).toEqual(due);
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
    const runs = ["a".repeat(4_000), `a${" ".repeat(3_990)}b`, "getirecegim ".repeat(330), "sifre ".repeat(660), "password is ".repeat(330), "havlu gelecek ".repeat(280), `${",".repeat(3_970)}teknisyen gelecek`, `${"sabah, ".repeat(560)}teknisyen gelecek`, "1,".repeat(1_990), "*".repeat(3_999), `şifre${"*_~`".repeat(990)}`];
    for (const r of runs) {
      const t = performance.now();
      detectHostPromise(r);
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
