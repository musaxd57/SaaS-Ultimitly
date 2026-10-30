import { describe, it, expect } from "vitest";
import { analyzeHostContact, isSafetyWarningSentence, stripHostContactFiller } from "@/lib/ai/host-contact-filler";
import { hostContactKindOf } from "@/lib/ai/absence";
import { settleHostContactRemovals, hostContactOpenWithoutLedger, needsFromUnderstanding, type SettleNeed } from "@/lib/conversation-items/host-contact-settle";
import { needTerms } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";
import { asksHypotheticalSituation } from "@/lib/ai/absence";
import { mergeSeniorRewrite } from "@/lib/ai/semantic/senior-rewrite";

// ---------------------------------------------------------------------------
// K-1029-A v2 (10-30) — Opus sert incelemesinin (F1–F12) somut örnekleri. v1 bu dosyada 7/58 geçiyordu (ölçüldü, kırmızı-önce): silme
// "bilgim yok" ağının yerini almıştı ("emin değilim" misafire gidiyordu), konu etiketi tek başına gidiyordu ("Otopark."), konusuz
// yönlendirme sessizce "cevaplandı" kapatıyordu, bildirimli başvurma ve güvenlik talimatı yanlış işleniyordu.
// `null` = cevabın TAMAMI tutulur (nothingLeft), ev sahibi yanıtlar.
// ---------------------------------------------------------------------------

const W = "Wi-Fi şifresi Lale1234.";
const WE = "The Wi-Fi password is Lale1234.";
const sent = (reply: string) => {
  const a = analyzeHostContact(reply);
  return a.nothingLeft ? null : a.text;
};
const need = (ref: string, queries: string[]): SettleNeed => ({
  ref,
  topics: topicsWithSymptomsOf(queries.join(" ")),
  terms: needTerms(queries),
  contingency: queries.some((q) => asksHypotheticalSituation(q)),
});
/** Settle sonrası açık kalan beyan edilmiş istekler. */
function opened(reply: string, needs: [string, string[]][], declared: string[]): string[] {
  const a = analyzeHostContact(reply);
  const out = settleHostContactRemovals({
    removals: a.removals,
    keptText: a.nothingLeft ? "" : a.text,
    needs: needs.map(([r, q]) => need(r, q)),
    declared: { refs: declared },
  });
  return declared.filter((r) => !out.refs.includes(r));
}

describe("F1 — konu etiketi tek başına gitmez (iki nokta ve konu edatı kesim sınırı değildir)", () => {
  it.each([
    ["F1a", `${W}\n\nOtopark: ev sahibinize sorabilirsiniz.`, W],
    ["F1b", "Parking: please contact your host.", null],
    ["F1c", `${WE} About a hair dryer: please message your host.`, WE],
    ["F1d", `${W}\n- Otopark: ev sahibinize sorabilirsiniz.`, W],
    ["F1e", `${WE} Pour le parking : contactez votre hôte.`, WE],
    ["F1f", `${WE} For the sauna, if you need anything, message your host.`, WE],
    ["F1g", `${W} Sauna için, herhangi bir sorunuz olursa ev sahibinize yazabilirsiniz.`, W],
    ["F1h", `${W} Otopark konusunda, bir sorun olursa ev sahibinize yazın.`, W],
    ["F1i", `${WE} Regarding late checkout, should you have questions, please contact your host.`, WE],
    ["F1j", `${WE} Zur Sauna: Bei Fragen schreiben Sie bitte Ihrem Gastgeber.`, WE],
    // Mutasyon V5 (10-30): koşullu başvurmada da iki nokta yan cümle sınırı değildir ("Otopark." tek başına gitmez).
    ["F1k", `${W} Otopark: bir sorun olursa ev sahibinize yazın.`, W],
    ["F8d", "Of course, if anything breaks, message your host.", null],
  ])("%s", (_id, reply, expected) => {
    expect(sent(reply)).toBe(expected);
  });

  it("konu etiketli yönlendirme kendi isteğini AÇAR; cevaplanan istek kapanır", () => {
    expect(opened(`${W}\n\nOtopark: ev sahibinize sorabilirsiniz.`, [["R1", ["wifi şifresi"]], ["R2", ["otopark var mı"]]], ["R1", "R2"])).toEqual(["R2"]);
    expect(opened(`${WE} About a hair dryer: please message your host.`, [["R1", ["wifi password"]], ["R2", ["hair dryer"]]], ["R1", "R2"])).toEqual(["R2"]);
  });

  it("KONTROL: bilgi taşıyan baş kısım kalır (GD5)", () => {
    expect(sent("Havlular dolapta, internet giderse ev sahibinize sorun.")).toBe("Havlular dolapta.");
    expect(sent("Check-in is at 15:00. If you have any questions, feel free to reach out to your host.")).toBe("Check-in is at 15:00.");
  });
});

describe("F5 — AKLAMA yok: yönlendirme silinince kalan belirsizlik / yetersizlik / özür misafire gitmez (cevabın tamamı tutulur)", () => {
  it.each([
    "I'm not sure about that. Please message your host.",
    "Bundan emin değilim; ev sahibinize sorabilirsiniz.",
    "Sauna saatleri net değil. Ev sahibinize sorabilirsiniz.",
    "Telefon numarası paylaşılmamış. Ev sahibinize sorabilirsiniz.",
    "I'm not able to confirm that; please check with your host.",
    "Bunu ben ayarlayamıyorum. Ev sahibinize yazabilirsiniz.",
    "Early check-in depends on availability; please message your host.",
    "We are sorry for the inconvenience. Please message your host.",
    `${WE} I'm not sure about the sauna hours; please message your host.`,
    `${W} Sauna saatlerinden emin değilim; ev sahibinize sorabilirsiniz.`,
    "Je ne suis pas sûr. Contactez votre hôte.",
    "No estoy seguro. Escriba a su anfitrión.",
    "Не уверен. Напишите хозяину.",
    // Ret (10-30 tekrar oynatma — gerçek model cevapları): eskiden tamamı tutuluyordu, kurucu kararına kadar öyle kalır.
    "Merhaba, Güvenlik nedeniyle başka bir dairenin giriş kodunu paylaşamam. Kendi dairenizin giriş bilgileri için ev sahibinize platform üzerinden yazabilirsiniz.",
    "Hello Alex, For security, I can’t share the master key box code. Please contact the host through the platform.",
    // Yalnız nezaket kalan kapanış (10-30 tekrar oynatma).
    "Thank you for letting me know, Alex. If anything comes up during your stay, you can always reach me here.",
    "Merhaba,\n\nRica ederim, ne zaman ihtiyaç olursa yazabilirsiniz.",
  ])("%j", (reply) => {
    expect(sent(reply)).toBeNull();
  });

  it("KONTROL: silme yoksa kalan-metin sınavı koşmaz (o cevaplar bugünkü kapılardan geçer)", () => {
    expect(analyzeHostContact("I'm not sure about that.")).toMatchObject({ nothingLeft: false, removals: [] });
  });
});

describe("F6 / F11 — konusuz yönlendirme önceki cümlenin konusuna gider; 'bu konuda' adres değildir", () => {
  it("'for details' / 'Detaylar için': kısmi cevap gider ama istek AÇIK kalır", () => {
    expect(sent("We do have a sauna in the building. Please message your host for details.")).toBe("We do have a sauna in the building.");
    expect(opened("We do have a sauna in the building. Please message your host for details.", [["R1", ["Is there a sauna and when is it open?"]]], ["R1"])).toEqual(["R1"]);
    expect(opened("Binada sauna var. Detaylar için ev sahibinize yazabilirsiniz.", [["R1", ["sauna var mı ne zaman açık"]]], ["R1"])).toEqual(["R1"]);
  });

  it("mutasyon V8 (10-30): koşul izi taşısa da AYRINTI isteyen yönlendirme genel değildir — sauna açık kalır", () => {
    const reply = "We do have a sauna in the building. If you need more details, please message your host.";
    expect(sent(reply)).toBe("We do have a sauna in the building.");
    expect(opened(reply, [["R1", ["Is there a sauna and when is it open?"]]], ["R1"])).toEqual(["R1"]);
    expect(opened("Binada sauna var. Daha fazla bilgi isterseniz ev sahibinize yazabilirsiniz.", [["R1", ["sauna var mı ne zaman açık"]]], ["R1"])).toEqual(["R1"]);
  });

  it("'Bu konuda ev sahibinize danışabilirsiniz': sauna AÇIK, cevaplanan adres kapanır", () => {
    const reply = "Adresimiz Menekşe Sokak No: 14, Alsancak. Binada sauna var. Bu konuda ev sahibinize danışabilirsiniz.";
    expect(opened(reply, [["R1", ["adres nedir"]], ["R2", ["sauna var mı saatleri ne"]]], ["R1", "R2"])).toEqual(["R2"]);
    expect(analyzeHostContact(reply).removals[0].topics).not.toContain("address");
  });

  it("defter olmayan yol da açık sayar (QR devreder, kanal tutar)", () => {
    const a = analyzeHostContact("Binada sauna var. Detaylar için ev sahibinize yazabilirsiniz.");
    expect(
      hostContactOpenWithoutLedger({
        removals: a.removals,
        keptText: a.text,
        guestAskedContingency: false,
        needs: needsFromUnderstanding([{ queryTr: "sauna var mı ne zaman açık", queryOriginal: "sauna var mı ne zaman açık" }]),
      }),
    ).toBe(true);
  });

  it("KONTROL: 'diğer sorularınız için' ve koşullu kapanış GENEL kalır — cevaplanan istek kapanır (aşırı açma yok)", () => {
    expect(opened("Havlular dolapta; diğer sorularınız için ev sahibinize yazabilirsiniz.", [["R1", ["havlu nerede"]]], ["R1"])).toEqual([]);
    // Koşul izi olmadan da: "diğer konular için" GERİ KALANI anar.
    expect(opened("Havlular dolapta; diğer konular için ev sahibinize yazın.", [["R1", ["havlu nerede"]]], ["R1"])).toEqual([]);
    expect(opened(`${W} Herhangi bir sorunda ev sahibinize yazın.`, [["R1", ["wifi şifresi"]]], ["R1"])).toEqual([]);
    expect(opened("Giriş 15:00'te. Varınca ev sahibinizi arayın.", [["R1", ["Giriş saati kaç?"]], ["R2", ["Kapıyı nasıl açacağız?"]]], ["R1", "R2"])).toEqual(["R2"]);
  });
});

describe("F7 — bildirim taşıyan başvurma cümlesi: cevabın TAMAMI tutulur, taslak silinmiş metindir", () => {
  it.each([
    `${WE} If anything breaks, message your host; your host can also see it.`,
    `${WE} If the Wi-Fi fails, message your host — your host may also see this in the app.`,
    "Пароль от Wi-Fi Lale1234. Если интернет не работает, напишите хозяину — хозяин сможет его увидеть.",
  ])("%j", (reply) => {
    const a = analyzeHostContact(reply);
    expect(a.nothingLeft).toBe(true);
    expect(a.text).toBe(reply);
    expect(a.draft).not.toMatch(/message your host|напишите хозяину/);
  });
});

describe("F9 / F3 — güvenlik talimatı sessizce düşmez; çıplak sayı / cihaz adı güvenlik uyarısı değildir", () => {
  it.each([
    [
      "The stove runs on gas: turn the knob and press to ignite. If you smell gas, turn off the valve, open the windows and message your host.",
      "The stove runs on gas: turn the knob and press to ignite. If you smell gas, turn off the valve, open the windows.",
    ],
    [
      "Ocak doğalgazlı: düğmeyi çevirip bastırın. Gaz kokusu alırsanız vanayı kapatın, pencereleri açın ve ev sahibinize yazın.",
      "Ocak doğalgazlı: düğmeyi çevirip bastırın. Gaz kokusu alırsanız vanayı kapatın, pencereleri açın.",
    ],
    [
      "Der Herd läuft mit Gas: Knopf drehen und drücken. Bei Gasgeruch drehen Sie den Haupthahn zu, öffnen Sie die Fenster und schreiben Sie Ihrem Gastgeber.",
      "Der Herd läuft mit Gas: Knopf drehen und drücken. Bei Gasgeruch drehen Sie den Haupthahn zu, öffnen Sie die Fenster.",
    ],
    [
      "If the carbon monoxide alarm goes off, open all windows, leave the flat and let your host know. The boiler is in the kitchen.",
      "If the carbon monoxide alarm goes off, open all windows, leave the flat. The boiler is in the kitchen.",
    ],
    ["Duman dedektörü öterse balkon kapısını açın ve ev sahibinize haber verin. Kombi alt katta.", "Duman dedektörü öterse balkon kapısını açın. Kombi alt katta."],
    // Yalnız koşul + yazın: kaybedilecek adım yok → cümle çıkar ("If you smell gas." gitmez).
    ["Havlu dolapta. If you smell gas, message your host.", "Havlu dolapta."],
    ["Havlu dolapta. Gaz kokusu alırsanız ev sahibinize yazın.", "Havlu dolapta."],
    // Adım temiz ayrılamıyor → cevabın tamamı tutulur.
    ["Havlu dolapta. Gaz kokusu alırsanız pencereleri açıp ev sahibinize yazın.", null],
    ["Havlu dolapta. Gaz kaçağında hemen ev sahibinize yazın ve binayı terk edin.", null],
    // "Arayın" güvenlik cümlesi kalır (K-1029-C).
    ["Gaz kokusu alırsanız 112'yi arayın ve ev sahibinize ulaşın.", "Gaz kokusu alırsanız 112'yi arayın ve ev sahibinize ulaşın."],
    ["If you smell gas, leave the apartment and call 112.", "If you smell gas, leave the apartment and call 112."],
    // F3: rastlantısal sayı / cihaz adı güvenlik değildir → "arayın / ulaşın" yan cümlesi çıkar.
    ["Otopark 110 numaralı yerde, bir sorun olursa ev sahibinizi arayın.", "Otopark 110 numaralı yerde."],
    ["Temizlik ücreti 155 TL, bir sorun olursa ev sahibinize ulaşın.", "Temizlik ücreti 155 TL."],
    ["Your apartment is 112, if anything breaks contact your host.", "Your apartment is 112."],
    [`${W} Gaz ocağı yanmazsa ev sahibinizi arayın.`, W],
  ])("%j", (reply, expected) => {
    expect(sent(reply)).toBe(expected);
  });

  it("acil numara yalnız yönergeyle / acil sözcüğüyle", () => {
    expect(isSafetyWarningSentence("Call 112 in an emergency.")).toBe(true);
    expect(isSafetyWarningSentence("Acil durumda 112'yi arayın.")).toBe(true);
    expect(isSafetyWarningSentence("Im Notfall 112.")).toBe(true);
    expect(isSafetyWarningSentence("Daire 112 numarada.")).toBe(false);
    expect(isSafetyWarningSentence("Gaz ocağı mutfakta.")).toBe(false);
  });
});

describe("F4 — satır sonuyla bölünmüş cümle birleştirilir", () => {
  it.each([
    [`${WE}\nIf the Wi-Fi fails, message\nyour host.`, WE],
    [`${WE}\nIf anything breaks, please contact\nyour host.`, WE],
    [`${W}\nBir sorun olursa\nev sahibinize yazın.`, W],
  ])("%j", (reply, expected) => {
    expect(sent(reply)).toBe(expected);
  });

  it("KONTROL: silme olmayan satırlar aynen (satır sonu korunur)", () => {
    const reply = "Wi-Fi: Lale\nşifre: 1234";
    expect(analyzeHostContact(reply)).toMatchObject({ text: reply, removals: [] });
  });
});

describe("F8 — yalnız nezaket / temenni kalırsa cevabın tamamı tutulur", () => {
  it.each([
    "Hi Alex, thanks for your message! For the sauna, please message your host. Enjoy your stay!",
    "Hello Alex! I hope you're having a great time. Please ask your host about the sauna.",
    "Mesajınız için teşekkürler. Sauna için ev sahibinize yazabilirsiniz. Umarım konaklamanız keyifli geçer.",
  ])("%j", (reply) => {
    expect(sent(reply)).toBeNull();
  });
});

describe("F10 — taslak yasaklı cümleyi taşımaz", () => {
  it("nothingLeft iken taslak silinmiş metin (selamdan ibaretse boş)", () => {
    const r = stripHostContactFiller("Merhaba Ayşe, herhangi bir sorunda ev sahibinize yazın.");
    expect(r.hostContactOnly).toBe(true);
    expect(r.draft).toBe("");
    const k = stripHostContactFiller(`${WE} If anything breaks, message your host; your host can also see it.`);
    expect(k.draft).toBe(WE);
  });

  it("yeniden yazmada taslak yeni metnindir (ilk taslağınki taşınmaz)", () => {
    type R = { reply: string; confidence: number; usedSources: string[]; missingInfo: string[]; hostContactDraft?: string };
    const base: R = { reply: "x", confidence: 0.9, usedSources: [], missingInfo: [] };
    expect(mergeSeniorRewrite<R>({ ...base, hostContactDraft: "eski" }, { ...base }).hostContactDraft).toBeUndefined();
    expect(mergeSeniorRewrite<R>({ ...base }, { ...base, hostContactDraft: "yeni" }).hostContactDraft).toBe("yeni");
  });

  it("P3-f: selamdaki misafir adı kök sayılmaz", () => {
    const a = analyzeHostContact("Merhaba Ayşe, herhangi bir sorunda ev sahibinize yazın.");
    expect(a.removals[0].stems).not.toContain("ayse");
    expect(a.removals[0].generic).toBe(true);
  });
});

describe("F12 — DE / FR / ES / RU genel kapanış genel sayılır (cevaplanan istek gereksiz açılmaz)", () => {
  it.each([
    ["Das WLAN-Passwort ist Lale1234. Bei Fragen schreiben Sie bitte Ihrem Gastgeber.", "WLAN Passwort"],
    ["Le mot de passe Wi-Fi est Lale1234. En cas de problème, écrivez à votre hôte.", "mot de passe wifi"],
    ["La contraseña del Wi-Fi es Lale1234. Si tiene algún problema, escriba a su anfitrión.", "contraseña wifi"],
    ["Пароль от Wi-Fi Lale1234. Если возникнут вопросы, напишите хозяину.", "пароль wifi"],
  ])("%j", (reply, q) => {
    expect(sent(reply)).not.toBeNull();
    expect(opened(reply, [["R1", ["wifi şifresi", q]]], ["R1"])).toEqual([]);
  });
});

describe("F2 — yedi dilde kaçan kalıp aileleri yakalanır", () => {
  it.each([
    "Bir sorun olursa bizimle iletişime geçebilirsiniz.",
    "Herhangi bir sorunda bizi arayabilirsiniz.",
    "Bir şey olursa ev sahibinize not bırakın.",
    "İhtiyacınız olursa bize yazmaktan çekinmeyin.",
    "Bir sorun olursa ev sahibinize yazmaktan çekinmeyin.",
    "Herhangi bir sorunuz olursa yazabilirsiniz.",
    "Başka bir sorunuz olursa yazmaktan çekinmeyin.",
    "Herhangi bir sorunda mesaj atabilirsiniz.",
    "Bir sorun olursa ev sahibinize yazar mısınız?",
    "If anything breaks, tell your host.",
    "If the heating fails, give your host a call.",
    "If you have any problems, give us a call.",
    "If anything goes wrong, get hold of your host.",
    "If something breaks, please alert your host.",
    "If you need anything, ping your host.",
    "Should you need anything, we're just a message away.",
    "If you need anything, just reach out.",
    "Feel free to reach out anytime.",
    "If you need anything, contact host.",
    "Should anything go wrong, your host is just a message away.",
    "Bei Problemen geben Sie Ihrem Gastgeber Bescheid.",
    "Falls etwas fehlt, geben Sie uns Bescheid.",
    "Bei Fragen schicken Sie Ihrem Gastgeber eine Nachricht.",
    "Bei Fragen melden Sie sich einfach.",
    "Bei Fragen können Sie sich jederzeit an Ihren Gastgeber wenden.",
    "Bei Fragen können Sie Ihren Gastgeber kontaktieren.",
    "Bei Problemen können Sie uns jederzeit kontaktieren.",
    "En cas de problème, n'hésitez pas à contacter vos hôtes.",
    "En cas de problème, signalez-le à votre hôte.",
    "Si vous avez besoin de quoi que ce soit, n'hésitez pas.",
    "En cas de souci, faites-le savoir à votre hôte.",
    "Si besoin, envoyez-nous un message.",
    "En cas de problème, contactez-moi.",
    "Si hay algún problema, avísele a su anfitrión.",
    "Si hay algún problema, mándele un mensaje a su anfitrión.",
    "Si necesita algo, puede contactar a su anfitrión.",
    "Si necesita algo, no dude en escribirme.",
    "Si necesita algo, hágamelo saber.",
    "Si tiene algún problema, contacte con los anfitriones.",
    "Если что-то понадобится, пишите нам.",
    "Если что-то понадобится, пишите хозяину.",
    "Если возникнут вопросы — обращайтесь!",
    "Если возникнут вопросы, обращайтесь к хозяину.",
    "Если что-то сломается, звоните хозяину.",
    "Если что-то сломается, дайте знать хозяину.",
    "إذا واجهت أي مشكلة، أخبر المضيف.",
    "إذا واجهت أي مشكلة، تواصل مع صاحب الشقة.",
    "إذا احتجت أي شيء، راسلنا.",
  ])("%j", (s) => {
    expect(hostContactKindOf(s)).not.toBeNull();
    expect(sent(`${W} ${s}`)).toBe(W);
  });

  // Zamirle gönderme: ev sahibi önce anılır, talimat zamirle verilir — talimat yan cümlesi çıkar, ev sahibini anlatan baş kısım GD5 gereği kalır;
  // zamir kök sayılmaz (genel kapanış, cevaplanan istek açılmaz).
  it.each([
    ["Your host Mehmet is very helpful; if anything comes up, just message him.", "Your host Mehmet is very helpful."],
    ["Ev sahibiniz Ayşe Hanım çok yardımseverdir, bir sorun olursa ona yazın.", "Ev sahibiniz Ayşe Hanım çok yardımseverdir."],
    ["Ihr Gastgeber ist sehr hilfsbereit, bei Fragen schreiben Sie ihm einfach.", "Ihr Gastgeber ist sehr hilfsbereit."],
    ["Votre hôte est très disponible, en cas de problème écrivez-lui.", "Votre hôte est très disponible."],
    ["Хозяин всегда на связи, если что-то понадобится, напишите ему.", "Хозяин всегда на связи."],
  ])("zamirle: %j", (s, head) => {
    expect(hostContactKindOf(s)).not.toBeNull();
    expect(sent(`${W} ${s}`)).toBe(`${W} ${head}`);
    expect(opened(`${W} ${s}`, [["R1", ["wifi şifresi"]]], ["R1"])).toEqual([]);
  });

  it.each([
    "Your host will reach out to you before arrival.",
    "The host will contact you tomorrow.",
    "Ev sahibiniz size yazacak.",
    "Der Gastgeber wird Sie kontaktieren.",
    "Ihr Gastgeber wird sich bei Ihnen melden.",
    "Votre hôte vous contactera.",
    "Хозяин вам напишет.",
    "Kapı kodunu yazıp # tuşuna basın.",
    "If the elevator breaks, reach out to the building manager at the front desk.",
    "If you can, tell me your arrival time.",
    "Bitte melden Sie sich an der Rezeption.",
    "N'hésitez pas à profiter de la piscine.",
    "Don't hesitate to use the pool.",
    "Bizi tercih ettiğiniz için teşekkürler.",
    "Bir sorun olursa sigortayı kontrol edin.",
    "Si necesita algo, el supermercado está a 200 metros.",
    "Если что-то понадобится, магазин рядом.",
    "If anything breaks, the repair kit is under the sink.",
    "Feel free to use the washing machine.",
    "Bei Fragen finden Sie alles im Gästebuch.",
    // Zamir yalnız ev sahibi aynı cümlede anılıyorsa sayılır (temizlikçi / komşu başkasıdır).
    "If the cleaners are late, message them.",
    "Komşunuz yardımcı olur, ona yazabilirsiniz.",
  ])("aşırı uygulama yok: %j", (s) => {
    expect(hostContactKindOf(s)).toBeNull();
  });
});
