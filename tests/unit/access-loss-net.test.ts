import { describe, it, expect } from "vitest";
import { detectRiskType, detectRiskTypes, isAccessLossText, classifyFallback } from "@/lib/ai/fallback";
import { cleanGateEvidence } from "@/lib/ai/gate-evidence";
import { passesAutoReplySafetyGate } from "@/lib/automation";

// ---------------------------------------------------------------------------
// ERİŞİM KAYBI AĞI (kurucu 10-29 gece, GD4: "anahtarı kaybettim, bulamıyorum gibi şeyler hosta kalsın, öncelikli olarak hosta
// gösterilsin"). Önceki durum (ölçüldü, `docs/claude/sozcuk-aglari.md`): "Anahtarı kaybettim" konu ağında `checkin` sayılıyordu ("anahtar"
// sözcüğü giriş KONUSU listesinde), hiçbir risk ağı bir KAYIP OLAYINI tanımıyordu → tutulmuyor, e-posta yok, öncelik yok; yedi dilin
// beşinde ("Schlüssel verloren", "perdu la clé" …) hiç etiket yoktu.
// Ağ yalnız SIKILAŞTIRIR (bir oto-gönderimi ENGELLEYEBİLİR, asla sebep olmaz) — kurucunun "sezgi yalnız ipucu ya da sıkılaştıran yedek"
// ilkesine uygun. Ek / koşul eki okunmaz: kayıp fiilinin TAM biçimleri ("kaybettim", "lost my") aranır, varsayım ("kaybedersem", "if I
// lose") bilerek eşleşmez — çünkü o biçim LİSTEDE YOK, ek okuyan bir kural yüzünden değil.
// ---------------------------------------------------------------------------

describe("erişim kaybı — tutulması gereken mesajlar (her dilde)", () => {
  it.each([
    // TR
    "Anahtarı kaybettim",
    "Anahtarımı kaybettim, yedek var mı?",
    "ANAHTARI KAYBETTİM",
    "anahtari kaybettim",
    "Anahtarı galiba dün akşam restoranda kaybettik",
    "Anahtarlar kayboldu",
    "Anahtar kayıp, ne yapacağız?",
    "Anahtarımı bulamıyorum",
    "Anahtarları bulamadık",
    "Çantam çalındı, anahtar da içindeydi",
    "Kapı kartını kaybettim",
    "Oda kartımı bulamıyorum",
    "Anahtarları içeride unuttum, kapı kapandı",
    "Anahtarı unuttum",
    "Anahtar kilitte kırıldı",
    "Anahtar kutusu boş",
    "Kapıda kaldık, ne yapmalıyız?",
    "Otopark kumandasını kaybettim",
    // EN
    "I lost my key",
    "We lost the keys",
    "I can't find my keys",
    "Someone stole our keys",
    "I lost my fob",
    "I lost the key card",
    "I locked myself out",
    "I'm locked out",
    "Kapıda kilitli kaldım",
    "Wir sind ausgesperrt",
    "Me quedé fuera del apartamento",
    "The lockbox is empty",
    "The key broke in the lock",
    "I forgot my keys inside",
    "The key is missing from the key box",
    // DE / FR / ES / RU / AR
    "Ich habe meinen Schlüssel verloren",
    "Wir finden den Schlüssel nicht",
    "J'ai perdu la clé",
    // Aksansız yazım (sağlamlık ölçümü 10-29 gece buldu): "clé" → "cle", "perdí" → "perdi"
    "J'ai perdu la cle de l'appartement",
    "Perdi la llave",
    // Yazım hatası / öznesiz İngilizce / duyulan geçmiş zaman (10-29 gece hakem ölçümü: üçü de kaçıyordu)
    "anahtarı kaybetim",
    "Anahtarı kaybetmişim, ne yapacağız?",
    "lost key",
    "the keys are lost",
    "Je ne trouve pas mes clés",
    "He perdido la llave",
    "No encuentro las llaves",
    "Я потерял ключ",
    "Не могу найти ключи",
    "فقدت المفتاح",
    "لا أجد المفاتيح",
    // 10-30 sert inceleme C7: kapı önünde boş kutu / kutuda anahtar yok (yedi dilde kaçıyordu)
    "There's no key in the lockbox",
    "No keys in the lockbox!",
    "The key isn't in the lockbox",
    "We opened the lockbox but it was empty",
    "Kodu girdim, kutu açıldı ama anahtar yok",
    "Anahtar kutusunu açtık ama boş",
    "Der Schlüsselkasten ist leer",
    "Kein Schlüssel im Schlüsselkasten",
    "Il n'y a pas de clé dans la boîte",
    "La boîte à clés est vide",
    "No hay llave en la caja",
    "В ключнице нет ключа",
    "Ключница пустая",
    "لا يوجد مفتاح في الصندوق",
    "Empty lockbox, help!",
    // C8: kaybolma / içeride kalma / klavyesiz Almanca yazım
    "The keys are gone",
    "Der Schlüssel ist weg",
    "Der Schlüssel ist verschwunden",
    "Les clés ont disparu",
    "Je n'arrive pas à trouver les clés",
    "Ключи пропали",
    "Ключ потерян",
    "Дверь захлопнулась, ключи внутри",
    "I left my keys inside and the door closed behind me",
    "Las llaves se quedaron dentro",
    "Ich habe meinen Schluessel verloren",
    "المفتاح ضائع",
    // C1 sınır düzeltmesinden SONRA da tutulanlar (sözcük sınırı gerçek kalıbı kesmez)
    "I forgot my keys",
    "I forgot my key card",
    "I locked my keys inside",
    "I locked the keys in the apartment",
    "LOCKED OUT",
    // Tasarım S11 (10-30): yere bağlı kapıda kalma (yedi dil) + kapalı yazım hatası listesi
    "Eve giremiyoruz",
    "Daireye giremiyorum, kapı açılmıyor",
    "Binaya giremedik",
    "We can't get into the apartment",
    "We cannot get into the flat",
    "Wir kommen nicht in die Wohnung",
    "No podemos entrar al piso",
    "On ne peut pas entrer dans l'appartement",
    "Мы не можем попасть в квартиру",
    "لا نستطيع دخول الشقة",
    "anahtarı kaybetdim",
    "Anathar kayboldu",
    "anahtra bulamıyorum",
    "aanhtarı kaybettim",
    // Haiku 10-30 (inceleme döngüsü): Almanca bileşik baş sözcük; iyelikli çıplak kilitleme; yerli Rusça yokluk
    "Ich habe meinen Hausschlüssel vergessen",
    "Ich habe meinen Hausschlüssel verloren",
    "Wir haben den Haustürschlüssel vergessen",
    "I think I locked my keys, can you come?",
    "I locked my key",
    "Нет ключа в ключнице",
  ])("%j → access_security", (m) => {
    expect(isAccessLossText(m)).toBe(true);
    expect(detectRiskTypes(m)).toContain("access_security");
  });
});

describe("erişim kaybı — KONTROL: dokunulmayan mesajlar", () => {
  it.each([
    // Altın senaryo (golden-scenarios:511): giriş SORUSU otomatik cevaplanır.
    "Anahtarı nereden alacağız?",
    "Anahtar teslimi nasıl oluyor?",
    "Where do I pick up the keys?",
    "Should we leave the keys inside at checkout?",
    // Varsayım biçimi listede YOK (ek okunmuyor — kayıp fiilinin bu biçimi aranmıyor).
    "Anahtarı kaybedersem ne olur?",
    "Anahtar kaybolursa ne olur?",
    "We got lost looking for the key box, where is it?",
    "What if I lose the key?",
    // Anahtar olmayan nesne
    "Pasaportumu kaybettim",
    "Kartımı kaybettim",
    "I lost my credit card",
    "Kumandayı bulamıyorum",
    "Wi-Fi şifresini bulamıyorum",
    // Aynı cümlede başka anlam ("sıkıştık" trafikte; "got lost" yolda; "forgot to ask")
    "Trafikte sıkıştık, anahtarı nereden alacağız?",
    "We got lost, where is the key box?",
    "I forgot to ask, where do we leave the keys?",
    "We got stuck in traffic, where do we pick up the keys?",
    // Ayrı cümleler: anahtar alındı, kaybolan cüzdan
    "Anahtarı aldım. Cüzdanımı kaybettim.",
    // "Turkey" içindeki "key" (W2 tam sözcük kuralı); "keyboard" anahtar değil (tam sözcük)
    "We love Turkey! Lost in the beauty of it.",
    // Acil ağının "can't get in" / "içeri giremiyor" kalıpları BİLEREK alınmadı (erken giriş sorusu, "get in touch")
    "I can't get in touch with the cleaner",
    "İçeri giremiyor muyuz erken?",
    "I lost my keyboard charger",
    // Ayrık olumsuzluk iki parçası birlikte aranır: yalnız "nicht" kayıp değildir
    "Den Schlüssel brauchen wir nicht mehr.",
    // 10-30 sert inceleme C1: kalıp BAŞKA SÖZCÜĞÜN İÇİNDE ("clocked out", "blocked out", "keyboard"); çıkışta kutuyu kilitlemek
    "I just clocked out from work, heading over now. What's the wifi password?",
    "The blackout curtains blocked out the light perfectly, thank you!",
    "I forgot my keyboard at home, is there one in the apartment?",
    "We checked out, put the keys back and locked the key box.",
    // C6: "finde" alt dizesi "findet / befindet" içinde
    "Findet die Schlüsselübergabe nicht persönlich statt?",
    "Wo befindet sich der Schlüssel? Nicht im Kasten?",
    // S11: soru biçimi ve izin sorusu yer bağlı kalıba girmez (çıplak "giremiyor" bilerek yok)
    "Daireye erken giremiyor muyuz?",
    "Can we get into the apartment early?",
    // Haiku 10-30: yersiz "no key" (depozito / modem), Wi-Fi "ключ" (şifre), olumsuz kutu cümlesi, çıkışta masaya bırakılan anahtar
    "There is no key deposit, right?",
    "There's no key needed for the router",
    "Нет ключа от Wi-Fi, подскажите пароль",
    "The lockbox is not empty, the code works",
    "The key box isn't empty, the key is inside",
    "Anahtar kutusu boş değil, kod çalışıyor",
    "Der Schlüsselkasten ist nicht leer",
    "I left my keys on the table at checkout",
  ])("%j → access_security DEĞİL", (m) => {
    expect(isAccessLossText(m)).toBe(false);
    expect(detectRiskTypes(m)).not.toContain("access_security");
  });
});

describe("öncelik sırası ve kapı kanıtı", () => {
  it("acil (kilitli kaldı) etiketi önde kalır — tur düzeyi tutuş değişmez", () => {
    expect(detectRiskType("Kilitli kaldım, anahtarı içeride unuttum")).toBe("safety_emergency");
    expect(detectRiskTypes("Kilitli kaldım, anahtarı içeride unuttum")).toEqual(["safety_emergency", "access_security"]);
  });

  it("yalnız kayıp: ilk etiket access_security; şikâyet sınıflandırması DEĞİŞMEDİ (konu yine giriş)", () => {
    expect(detectRiskType("Anahtarı kaybettim")).toBe("access_security");
    expect(classifyFallback("Anahtarı kaybettim").isComplaint).toBe(false);
  });

  it("kapı kanıtı access_security etiketini düşürmez (kelime ağı uyarıları kümesinde)", () => {
    expect(cleanGateEvidence({ lx: ["access_security", "uydurma"] })?.lx).toEqual(["access_security"]);
  });
});

describe("kanal kapısı (öğe kipi kapalı): önceki cevapsız mesajdaki kayıp anahtar sonraki zararsız soruyla gömülmez", () => {
  const OK = { intent: "wifi", riskLevel: "none", confidence: 0.95, source: "openai", reply: "Wi-Fi şifresi Lale2024." };
  it("'Anahtarı kaybettim' + ardından 'Wi-Fi şifresi ne?' → tutulur", () => {
    expect(passesAutoReplySafetyGate(OK, "Wi-Fi şifresi ne?", { pendingGuestMessages: ["Anahtarı kaybettim"] })).toBe(false);
  });
  it("KONTROL: 'Anahtarı nereden alacağız?' + 'Wi-Fi şifresi ne?' → bugünkü gibi gider", () => {
    expect(passesAutoReplySafetyGate(OK, "Wi-Fi şifresi ne?", { pendingGuestMessages: ["Anahtarı nereden alacağız?"] })).toBe(true);
  });
});
