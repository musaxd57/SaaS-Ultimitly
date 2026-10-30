import { describe, it, expect } from "vitest";
import { analyzeHostContact, splitInstructionClauses, stripHostContactFiller } from "@/lib/ai/host-contact-filler";
import { hostContactKindOf, mentionsHostContact } from "@/lib/ai/absence";
import { settleHostContactRemovals, hostContactOpenWithoutLedger, type SettleNeed } from "@/lib/conversation-items/host-contact-settle";
import { needTerms } from "@/lib/conversation-items/topic-absence";
import { topicsWithSymptomsOf } from "@/lib/conversation-items/relation";

// ---------------------------------------------------------------------------
// K-1029-A / K-1029-B / K-1029-C (kurucu 10-29 gece): "ev sahibinize yazın" HER DİLDE, HER BİÇİMDE yasak — cümle silinir, doğru cevap
// gider, cevapsız soru AÇIK kalır (asla "cevaplandı" değil); GD5: yalnız talimat yan cümlesi silinir, bilgi gider; ek / koşul eki
// sezgileri karar vermez. Tasarım `docs/TASARIM-2026-10-29-ev-sahibine-yonlendirme-yasagi.md` (C1–C4 tabloları; "Bugün" sütunu bu
// dosyanın kırmızı-önce koşusunda ölçüldü).
// ---------------------------------------------------------------------------

describe("C1 — yasak: cümle her dilde çıkar, doğru cevap kalır", () => {
  const cases: [string, string, string][] = [
    ["TR1", "Otopark binanın arkasında. Herhangi bir sorunda ev sahibinize yazın.", "Otopark binanın arkasında."],
    ["TR2", "Çöp konteyneri binanın girişinde. Bir sıkıntı olursa bize yazabilirsiniz.", "Çöp konteyneri binanın girişinde."],
    ["EN1", "Parking is behind the building. Should anything come up, message your host.", "Parking is behind the building."],
    ["EN2", "Checkout is at 11:00. Feel free to message your host.", "Checkout is at 11:00."],
    ["EN3", "Checkout is at 11:00. For the sauna, please message your host.", "Checkout is at 11:00."],
    ["EN4", "Checkout is at 11:00. If you need anything, just message us.", "Checkout is at 11:00."],
    ["EN5", "Checkout is at 11:00. Feel free to reach out to the property owner.", "Checkout is at 11:00."],
    ["DE1", "Der Parkplatz ist hinter dem Gebäude. Bei Problemen schreiben Sie bitte Ihrem Gastgeber.", "Der Parkplatz ist hinter dem Gebäude."],
    ["DE2", "Der Parkplatz ist hinter dem Gebäude. Rufen Sie Ihren Gastgeber an, falls etwas fehlt.", "Der Parkplatz ist hinter dem Gebäude."],
    ["FR1", "Le parking est derrière l'immeuble. En cas de problème, écrivez à votre hôte.", "Le parking est derrière l'immeuble."],
    ["FR2", "Le départ est à 11h. N'hésitez pas à contacter votre hôte si besoin.", "Le départ est à 11h."],
    ["ES1", "El aparcamiento está detrás del edificio. Llame a su anfitrión si llegan tarde.", "El aparcamiento está detrás del edificio."],
    ["ES2", "Los contenedores están en la entrada. Si tiene algún problema, escriba a su anfitrión.", "Los contenedores están en la entrada."],
    ["RU1", "Парковка за домом. Если что-то случится, напишите хозяину.", "Парковка за домом."],
    ["RU2", "Выезд в 11:00. Позвоните хозяину, если опоздаете.", "Выезд в 11:00."],
    ["AR1", "الموقف خلف المبنى. إذا حدثت أي مشكلة، راسل المضيف.", "الموقف خلف المبنى."],
  ];
  it.each(cases)("%s", (_id, reply, expected) => {
    const a = analyzeHostContact(reply);
    expect(a.text).toBe(expected);
    expect(a.removals.length).toBeGreaterThan(0);
    expect(a.nothingLeft).toBe(false);
  });

  it("yalnız yönlendirme varsa metne dokunulmaz, kapı tutar (nothingLeft)", () => {
    const a = analyzeHostContact("Wi-Fi bozulursa ev sahibinize yazın.");
    expect(a.nothingLeft).toBe(true);
    expect(stripHostContactFiller("Wi-Fi bozulursa ev sahibinize yazın.").hostContactOnly).toBe(true);
  });

  it("çıkan parçanın kaydında METİN yok — yalnız tür, biçim, kök, konu", () => {
    const a = analyzeHostContact("Checkout is at 11:00. For the sauna, please message your host.");
    expect(Object.keys(a.removals[0]).sort()).toEqual(["appendix", "form", "generic", "kind", "stems", "topics"]);
    expect(a.removals[0].generic).toBe(false);
    expect(a.removals[0].stems).toContain("sauna");
    expect(analyzeHostContact("Otopark binanın arkasında. Herhangi bir sorunda ev sahibinize yazın.").removals[0].generic).toBe(true);
  });
});

describe("C2 — GD5: yalnız talimat yan cümlesi çıkar, bilgi gider", () => {
  const cases: [string, string, string][] = [
    ["G-TR", "Havlular yatak odasındaki dolapta, bir sorun olursa ev sahibinize yazın.", "Havlular yatak odasındaki dolapta."],
    ["G-EN", "Towels are in the wardrobe; if anything breaks, contact your host.", "Towels are in the wardrobe."],
    ["G-DE", "Die Handtücher sind im Schrank; falls etwas fehlt, rufen Sie Ihren Gastgeber an.", "Die Handtücher sind im Schrank."],
    ["G-FR", "Les serviettes sont dans l'armoire ; en cas de problème, écrivez à votre hôte.", "Les serviettes sont dans l'armoire."],
    ["G-ES", "Las toallas están en el armario; si falta algo, escriba a su anfitrión.", "Las toallas están en el armario."],
    ["G-RU", "Полотенца в шкафу; если что-то понадобится, напишите хозяину.", "Полотенца в шкафу."],
    ["G-AR", "المناشف في الخزانة، إذا حدثت أي مشكلة، راسل المضيف.", "المناشف في الخزانة."],
  ];
  it.each(cases)("%s", (_id, reply, expected) => {
    const a = analyzeHostContact(reply);
    expect(a.text).toBe(expected);
    expect(a.removals).toHaveLength(1);
    expect(a.removals[0].appendix).toBe(true);
  });

  it("kalan metin özgün sözcüklerin özgün sırasıdır (yalnız silme)", () => {
    const s = "Havlular yatak odasındaki dolapta, bir sorun olursa ev sahibinize yazın.";
    const kept = splitInstructionClauses(s)!;
    expect(s.startsWith(kept.slice(0, -1))).toBe(true);
  });
});

describe("C3 — söz koruması ve aşırı uygulama", () => {
  it("PG1/PG2: koşulun ardındaki yan cümle de çıkar — koşulsuz söze dönmez", () => {
    const tr = analyzeHostContact("Bir sorun olursa ev sahibinize yazın, kendisi teknisyen gönderir. Kumanda komodinin üstünde.");
    expect(tr.text).toBe("Kumanda komodinin üstünde.");
    expect(tr.text).not.toMatch(/teknisyen/);
    const en = analyzeHostContact("If anything breaks, message your host and they will fix it right away. The remote is on the nightstand.");
    expect(en.text).toBe("The remote is on the nightstand.");
  });

  it.each([
    ["N1", "Ev sahibiniz yarın 10:00'da havlu getirecek."],
    ["N2", "Gaz kokusu alırsanız 187'yi arayın."],
    ["N3", "Ev sahibinize sormanıza gerek yok, şifre kartın arkasında."],
    ["N5", "Yazın havuz 22:00'ye kadar açık."],
    ["N6", "Çıkışta anahtarı kutuya bırakıp bize mesaj atın."],
    ["N7", "I'll check with the host."],
    ["N8", "Your host will message you tomorrow morning."],
    ["N9", "Ev sahibiniz size yarın yazacak."],
  ])("%s dokunulmaz: %s", (_id, reply) => {
    expect(analyzeHostContact(reply)).toEqual({ text: reply, removals: [], nothingLeft: false });
  });

  it("SW1: 'Fire TV' güvenlik uyarısı değil — arama cümlesi çıkar; SW2: gerçek gaz uyarısı kalır; SW3: 'yazın' hiç kalmaz", () => {
    expect(analyzeHostContact("If the Fire TV stops working, call your host.").nothingLeft).toBe(true);
    const gas = "If you smell gas, close the valve, open the windows and call 187 and your host.";
    expect(analyzeHostContact(gas).text).toBe(gas);
    expect(analyzeHostContact("Havlu dolapta. Gaz kokusu alırsanız ev sahibinize yazın.").text).toBe("Havlu dolapta.");
  });

  it("K-1029-C: koşul eki sezgisi artık 'arayın'ı TUTMAZ (misafir varsayımsal sorsa da, bilgi tabanında yazsa da) — soru ev sahibine açık kalır", () => {
    const r = stripHostContactFiller("Anahtarı kaybederseniz ev sahibinizi arayın.", ["Anahtarı kaybedersem ne yapmalıyım?"], [
      "Anahtarı kaybederseniz ev sahibini arayın.",
    ]);
    expect(r.hostContactOnly).toBe(true);
  });

  it("dedektörler: üç kaynak birleşik; ev sahibi özne ise eşleşmez", () => {
    expect(hostContactKindOf("Sauna için ev sahibinize sorabilirsiniz.")).toBe("referral");
    expect(hostContactKindOf("Bir sorun olursa ev sahibinize yazın.")).toBe("write");
    expect(mentionsHostContact("En cas de problème, écrivez à votre hôte.")).toBe("write");
    expect(mentionsHostContact("Позвоните хозяину, если опоздаете.")).toBe("call");
    expect(mentionsHostContact("Your host will call you.")).toBeNull();
    expect(mentionsHostContact("Ev sahibiniz sizi arayacak.")).toBeNull();
    expect(mentionsHostContact("Ev sahibinize 0532 111 22 33 numarasından ulaşabilirsiniz.")).toBeNull();
  });
});

describe("C4 — 'cevaplandı' kuralı (settle)", () => {
  const need = (ref: string, queries: string[], contingency = false): SettleNeed => ({
    ref,
    topics: topicsWithSymptomsOf(queries.join(" ")),
    terms: needTerms(queries),
    contingency,
  });

  it("I1 (B2 hatası): genel kapanış silinince olasılık sorusu AÇIK kalır, şifre cevaplanır", () => {
    const a = analyzeHostContact("Wi-Fi şifresi Lale1234. Bir sorun olursa ev sahibinize yazın.");
    const out = settleHostContactRemovals({
      removals: a.removals,
      keptText: a.text,
      needs: [need("R1", ["Wi-Fi şifresi ne?"]), need("R2", ["Wi-Fi bozulursa ne yapmalıyım?"], true)],
      declared: { refs: ["R1", "R2"] },
    });
    expect(a.text).toBe("Wi-Fi şifresi Lale1234.");
    expect(out.refs).toEqual(["R1"]);
  });

  it("I1-b (mutasyon KA3, 10-30): olasılık sorusu metinde AYIRT EDİCİ karşılık bulsa da açık kalır (silinen kapanış onun cevabı olabilirdi)", () => {
    const a = analyzeHostContact("Wi-Fi giderse modemi yeniden başlatın. Bir sorun olursa ev sahibinize yazın.");
    expect(a.text).toBe("Wi-Fi giderse modemi yeniden başlatın.");
    const needs = (contingency: boolean) => [need("R1", ["Wi-Fi giderse ne yapmalıyım?"], contingency)];
    const open = settleHostContactRemovals({ removals: a.removals, keptText: a.text, needs: needs(true), declared: { refs: ["R1"] } });
    expect(open.refs).toEqual([]);
    // KONTROL: aynı istek olasılık sorusu değilse (yalnız bilgi) metin onu ayırt edici karşıladığı için cevaplandı.
    const answered = settleHostContactRemovals({ removals: a.removals, keptText: a.text, needs: needs(false), declared: { refs: ["R1"] } });
    expect(answered.refs).toEqual(["R1"]);
  });

  it("I2: varınca arayın tek cevapsa giriş sorusu açık, saat cevaplanır", () => {
    const a = analyzeHostContact("Giriş 15:00'te. Varınca ev sahibinizi arayın.");
    const out = settleHostContactRemovals({
      removals: a.removals,
      keptText: a.text,
      needs: [need("R1", ["Giriş saati kaç?"]), need("R2", ["Kapıyı nasıl açacağız?"])],
      declared: { refs: ["R1", "R2"] },
    });
    expect(out.refs).toEqual(["R1"]);
  });

  it("I3 (aşırı açma yok): iki soru da metinde ayırt edici karşılık buluyor, genel kapanış silindi → ikisi de cevaplandı", () => {
    const a = analyzeHostContact("Havlular dolapta. Otopark binanın arkasında. Bir sorun olursa ev sahibinize yazın.");
    const out = settleHostContactRemovals({
      removals: a.removals,
      keptText: a.text,
      needs: [need("R1", ["Havlu nerede?"]), need("R2", ["Otopark var mı?"])],
      declared: { refs: ["R1", "R2"] },
    });
    expect(out.refs).toEqual(["R1", "R2"]);
    expect(out.openRefs).toEqual([]);
  });

  it("I4: konulu yönlendirme kendi isteğini açar; sahipsiz konulu silme hepsini açar", () => {
    const a = analyzeHostContact("Otopark arkada. Klima için ev sahibinize yazın.");
    const out = settleHostContactRemovals({
      removals: a.removals,
      keptText: a.text,
      needs: [need("R1", ["Klima nasıl açılır?"]), need("R2", ["Otopark var mı?"])],
      declared: { refs: ["R1", "R2"] },
    });
    expect(out.refs).toEqual(["R2"]);
    const b = analyzeHostContact("Otopark arkada. Kombi için ev sahibinize yazın.");
    const out2 = settleHostContactRemovals({
      removals: b.removals,
      keptText: b.text,
      needs: [need("R1", ["Havlu nerede?"]), need("R2", ["Otopark var mı?"])],
      declared: { refs: ["R1", "R2"] },
    });
    expect(out2.refs).toEqual([]);
    expect(out2.openRefs).toContain("R2");
  });

  it("I7: yan cümle silmesi de sahibini açar (havlu cevaplandı, internet açık)", () => {
    const a = analyzeHostContact("Havlular dolapta, internet giderse ev sahibinize yazın.");
    const out = settleHostContactRemovals({
      removals: a.removals,
      keptText: a.text,
      needs: [need("R1", ["Havlu nerede?"]), need("R2", ["İnternet giderse?"], true)],
      declared: { refs: ["R1", "R2"] },
    });
    expect(a.text).toBe("Havlular dolapta.");
    expect(out.refs).toEqual(["R1"]);
  });

  it("silme yoksa beyan birebir", () => {
    expect(
      settleHostContactRemovals({ removals: [], keptText: "x", needs: [need("R1", ["x"])], declared: { refs: ["R1"], openRefs: ["R9"] } }),
    ).toEqual({ refs: ["R1"], openRefs: ["R9"], trace: { n: 0, o: 0, u: 0 } });
  });

  it("defter olmayan yol: genel kapanış + kapsanan istek → gönder; konulu silme / olasılık sorusu / anlama yok → açık", () => {
    const generic = analyzeHostContact("Havlular dolapta. Bir sorun olursa ev sahibinize yazın.");
    expect(
      hostContactOpenWithoutLedger({ removals: generic.removals, keptText: generic.text, guestAskedContingency: false, needs: [need("R1", ["Havlu nerede?"])] }),
    ).toBe(false);
    expect(hostContactOpenWithoutLedger({ removals: generic.removals, keptText: generic.text, guestAskedContingency: false, needs: null })).toBe(true);
    expect(
      hostContactOpenWithoutLedger({ removals: generic.removals, keptText: generic.text, guestAskedContingency: true, needs: [need("R1", ["Havlu nerede?"])] }),
    ).toBe(true);
    const topical = analyzeHostContact("Havlular dolapta. Sauna için ev sahibinize yazın.");
    expect(
      hostContactOpenWithoutLedger({ removals: topical.removals, keptText: topical.text, guestAskedContingency: false, needs: [need("R1", ["Havlu nerede?"])] }),
    ).toBe(true);
  });
});

// ── C5 — 10-30 TEKRAR OYNATMA (docs/olcum/host-contact-replay-2026-10-30.md) ─────────────────────────────────────────────────────────────
// Silme, eskiden "yönlendirme = bilgim yok" kuralı ve çıktı vetosuyla TAMAMI tutulan cevapları kapıdan geçirebiliyordu (ölçüldü: 74 cevap).
// Üç sınıf eski davranışa döner: K10 devir / kayıt bildirimi silinmez (veto tutar), kalan metin kararı ev sahibine bırakıyorsa ya da
// geriye yalnız selam kalıyorsa cevabın tamamı tutulur.
describe("C5 — silme eskiden tutulan cevabı kapıdan geçirmez", () => {
  it.each([
    // K10 bildirimi çıktı vetosunun kalıbıyla
    "Erken giriş ev sahibinin kararıdır; mesajınız kaydedildi, ev sahibiniz görebilir.",
    "Ранний заезд около 10:00 — это решение хозяина; ваше сообщение сохранено, и хозяин сможет его увидеть.",
    // Vetonun kalıbında olmayan Rusça kayıt / görünürlük bildirimi
    "Стандартное время заезда — 15:00. Возможность заселиться около 10:00 зависит от решения хозяина; ваш запрос зафиксирован, владелец сможет его увидеть.",
    "Приносим извинения за неудобство. Ваше сообщение об отсутствии горячей воды записано; хозяин сможет его увидеть.",
  ])("bildirim cümlesi SİLİNMEZ (cevap aynen kalır, tutan kural eskisi gibi tutar): %j", (reply) => {
    const r = stripHostContactFiller(reply);
    expect(r.text).toBe(reply);
    expect(r.removals).toEqual([]);
  });

  it.each([
    // Mutasyon KA6 (10-30): yalnız ÇIKTI VETOSUNUN kalıbının tanıdığı bildirim (görünürlük kalıbında yok) — yönlendirme olarak da algılanır.
    "Talebiniz ev sahibinize iletildi, dilerseniz ev sahibinize de yazabilirsiniz.",
    "Your message has been recorded; feel free to message your host as well.",
  ])("veto kalıbındaki bildirim + yönlendirme cümlesi SİLİNMEZ (veto tamamını tutar): %j", (reply) => {
    const r = stripHostContactFiller(reply);
    expect(r.text).toBe(reply);
    expect(r.removals).toEqual([]);
  });

  it("kalan metin kararı ev sahibine bırakıyor → tamamı tutulur (hostContactOnly)", () => {
    const reply =
      "Hi Alex, I’m glad you’re enjoying your stay. Extending your stay to Thursday depends on the host’s decision and the calendar; this is something only your host can confirm through the platform.";
    const r = stripHostContactFiller(reply);
    expect(r.hostContactOnly).toBe(true);
    expect(r.text).toBe(reply);
  });

  it.each([
    "Здравствуйте, Alex! По поводу аренды автомобиля поблизости лучше уточнить у хозяина жилья.",
    "Merhaba Ayşe, kuaför için ev sahibiniz size kesin bilgi verebilir.",
    "Hello Alex, for directions from the airport, please ask your host.",
  ])("geriye yalnız selam kalır → tamamı tutulur: %j", (reply) => {
    const r = stripHostContactFiller(reply);
    expect(r.hostContactOnly).toBe(true);
  });

  it("KONTROL: gerçek bilgi + yönlendirme → bilgi gider, yönlendirme çıkar (K-1029-A aynen)", () => {
    const r = stripHostContactFiller("Merhaba Alex, Size ayrılan otopark yeri P2. Yakınlardaki kuaför için ev sahibiniz size kesin bilgi verebilir.");
    expect(r.hostContactOnly).toBe(false);
    expect(r.text).toBe("Merhaba Alex, Size ayrılan otopark yeri P2.");
  });
});
