import { describe, it, expect } from "vitest";
import { detectRiskType, classifyFallback } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// DİL PARİTESİ — KATEGORİ × DİL MATRİSİ (08-07 (2))
//
// CLAUDE.md'nin kuralı zaten vardı ("SAFETY_CRITICAL_WORDS ile KEYWORDS.complaint
// dil kapsamı PARALEL tutulur") ama YALNIZ DİL ekseninde tutuluyordu. Ölçüldü:
// eksik olan KATEGORİLERDİ ve boşluk sistematikti.
//
//   Acil kapsamı ÖNCE:  TR 6/7 · EN 6/7 · DE 4/7 · FR 3/7 · ES 3/7 · RU 1/7 · AR 1/7
//   Acil kapsamı SONRA: yedi dilde 7/7
//
// Yani Rusça ya da Arapça yazan bir misafirin YANGIN dışındaki her acili
// deterministik ağdan SIFIR yakalanıyordu; kapının ikinci savunması yoktu ve
// geriye yalnız modelin kendi hükmü kalıyordu.
//
// 🚨 BU DOSYA "DAHA ÇOK YAKALA" TESTİ DEĞİL — İKİ YÖNLÜDÜR. Aşağıdaki
// yanlış-pozitif bloğu en az yakalama bloğu kadar önemlidir: `complaint`
// `NEVER_AUTO_REPLY_INTENTS` içinde, yani her fazla eşleşme oto-yanıtı kapatır.
// ---------------------------------------------------------------------------

/** 7 acil kategorisi × 7 dil. Hepsi `safety_emergency` olmalı. */
const ACIL: Record<string, string[]> = {
  TR: [
    "Dairede yangın var!",
    "Gaz kokusu geliyor, çok yoğun",
    "Eşim bayıldı, nefes alamıyor",
    "Prizden kıvılcım çıkıyor",
    "Su her yeri bastı, tavandan akıyor",
    "Kapıda kilitli kaldım, içeri giremiyorum",
    "Ölmek istiyorum",
  ],
  EN: [
    "There is a fire in the apartment!",
    "I smell gas, it's very strong",
    "My wife fainted and can't breathe",
    "Sparks coming from the outlet",
    "Water is flooding everywhere from the ceiling",
    "I'm locked out, can't get in",
    "I want to die",
  ],
  DE: [
    "Es brennt in der Wohnung!",
    "Es riecht stark nach Gas",
    "Meine Frau ist bewusstlos und atmet nicht",
    "Funken kommen aus der Steckdose",
    "Das Wasser überflutet alles von der Decke",
    "Ich bin ausgesperrt",
    "Ich will nicht mehr leben",
  ],
  FR: [
    "Il y a le feu dans l'appartement !",
    "Ça sent très fort le gaz",
    "Ma femme s'est évanouie et ne respire pas",
    "Des étincelles sortent de la prise",
    "L'eau inonde tout depuis le plafond",
    "Je suis enfermé dehors",
    "Je veux mourir",
  ],
  ES: [
    "¡Hay fuego en la cocina!",
    "Huele mucho a gas",
    "Mi esposa se desmayó y no respira",
    "Salen chispas del enchufe",
    "El agua está inundando todo desde el techo",
    "Estoy encerrado fuera",
    "Quiero morir",
  ],
  RU: [
    "У нас пожар в квартире!",
    "Сильно пахнет газом",
    "Жена потеряла сознание и не дышит",
    "Из розетки летят искры",
    "Вода затопила всё с потолка",
    "Я не могу попасть внутрь",
    "Я хочу умереть",
  ],
  AR: [
    "حريق في الشقة النجدة",
    "رائحة غاز قوية جدا",
    "زوجتي فاقدة الوعي ولا تتنفس",
    "شرر يخرج من المقبس",
    "المياه تغرق كل شيء من السقف",
    "أنا محبوس في الخارج",
    "أريد أن أموت",
  ],
};
const KATEGORI = ["yangın", "gaz", "tıbbi", "elektrik", "su baskını", "kilitli kaldı", "öz-zarar"];

/** Meşru mesajlar — hiçbiri acil VEYA şikayet sayılmamalı. */
const MESRU: Record<string, string[]> = {
  TR: ["Wifi şifresi nedir?", "Otopark nerede?", "Teşekkürler her şey harika", "Sıcak su çok güzel", "Sorun yok, teşekkürler", "Sessiz bir yer, çok memnunuz"],
  EN: ["What is the wifi password?", "Where can I park?", "Thanks, everything was great", "The hot water is great", "No problem at all", "Very quiet neighbourhood"],
  DE: ["Wie lautet das WLAN-Passwort?", "Wo kann ich parken?", "Vielen Dank für alles", "Das warme Wasser ist super", "Kein Problem", "Sehr ruhige Gegend"],
  FR: ["Quel est le mot de passe wifi ?", "Où puis-je me garer ?", "Merci beaucoup pour tout", "L'eau chaude est parfaite", "Pas de problème", "Quartier très calme"],
  ES: ["¿Cuál es la contraseña del wifi?", "¿Dónde puedo aparcar?", "Muchas gracias por todo", "El agua caliente está perfecta", "Ningún problema", "Barrio muy tranquilo"],
  // ⚠️ "Искренне" TUZAĞI: kök `искр` seçilseydi "içtenlikle teşekkür ederim"
  // ACİL sayılırdı. Bu yüzden yalnız tam biçimler (искры/искрит/искрят) listede.
  RU: ["Какой пароль от вайфая?", "Где можно припарковаться?", "Искренне благодарю за всё", "Горячая вода отличная", "Никаких проблем", "Очень тихий район"],
  AR: ["ما هي كلمة سر الواي فاي؟", "أين يمكنني ركن السيارة؟", "شكرا جزيلا على كل شيء", "الماء الساخن ممتاز", "لا توجد مشكلة", "حي هادئ جدا"],
};

describe("acil kapsamı — 7 kategori × 7 dil", () => {
  for (const [dil, mesajlar] of Object.entries(ACIL)) {
    it(`${dil} — yedi acil kategorisinin hepsi safety_emergency`, () => {
      mesajlar.forEach((m, i) => {
        expect(detectRiskType(m), `${dil}/${KATEGORI[i]}: ${m}`).toBe("safety_emergency");
      });
    });
  }
});

describe("🚨 yanlış pozitif — aşırı-eşleşme ürünü kısar", () => {
  for (const [dil, mesajlar] of Object.entries(MESRU)) {
    it(`${dil} — meşru mesaj ne ACİL ne ŞİKAYET sayılır`, () => {
      for (const m of mesajlar) {
        expect(detectRiskType(m), `yanlış acil: ${m}`).not.toBe("safety_emergency");
        expect(classifyFallback(m).intent, `yanlış şikayet: ${m}`).not.toBe("complaint");
      }
    });
  }
});

describe("şikayet paritesi — temel hizmet yokluğu ve gürültü", () => {
  // Bu iki kategori host'un MUTLAKA görmesi gerekenlerdi ve EN dışında hiçbir
  // dilde yoktu. ⚠️ "wifi çalışmıyor" sınıfı BİLİNÇLİ dışarıda: bilgi
  // tabanından yanıtlanabilir, complaint yapmak ürünü kısar, güvenliği artırmaz.
  const SIKAYET: [string, string][] = [
    ["TR", "Sıcak su yok"], ["EN", "There is no hot water"], ["DE", "Es gibt kein warmes Wasser"],
    ["FR", "Il n'y a pas d'eau chaude"], ["ES", "No hay agua caliente"],
    ["RU", "Нет горячей воды"], ["AR", "لا يوجد ماء ساخن"],
    ["TR", "Çok gürültülü"], ["EN", "It's too noisy"], ["DE", "Es ist zu laut"],
    ["FR", "C'est trop bruyant"], ["ES", "Hay demasiado ruido"],
    ["RU", "Очень шумно"], ["AR", "صاخب جدا"],
  ];
  it.each(SIKAYET)("%s → complaint: %s", (_dil, mesaj) => {
    expect(classifyFallback(mesaj).intent).toBe("complaint");
  });
});

describe("🚨 olumsuzlama koruması FR/AR'yi de kapsar", () => {
  // ÖNCEDEN VARDI: `problème` ve `مشكلة` DÜZ listedeydi ve olumsuzlama
  // korumasını komple atlıyorlardı → "sorun YOK" diyen olumlu bir kapanış
  // ŞİKAYET sayılıyor, oto-yanıt kapanıyor ve host boşuna uyarılıyordu.
  it.each([
    ["Il y a un problème avec la douche"],
    ["هناك مشكلة في الحمام"],
    ["There is a problem with the shower"],
    ["Duşta bir sorun var"],
  ])("GERÇEK sorun bildirimi complaint kalır: %s", (m) => {
    expect(classifyFallback(m).intent).toBe("complaint");
  });

  it.each([["Pas de problème"], ["لا توجد مشكلة"], ["No problem at all"], ["Sorun yok, teşekkürler"]])(
    "'sorun YOK' complaint DEĞİL: %s",
    (m) => {
      expect(classifyFallback(m).intent).not.toBe("complaint");
    },
  );
});

describe("🚨 kök seçimi tuzakları — ölçülerek elenen İKİ aday", () => {
  // Gövdeyi kısaltmak için kök kullanmak cazip; bu ikisi ölçülerek REDDEDİLDİ.
  // ⚠️ Bunlar "acil DEĞİL" testleridir — ikisi de meşru bir ŞİKAYET ya da
  // teşekkür olabilir, sınanan şey ACİL sınıfına yanlışlıkla düşmemeleri.
  it("DE `funkt` kökü YASAK — 'funktioniert nicht' yangın sayılamaz", () => {
    // "Die Heizung funktioniert nicht" = kalorifer çalışmıyor. Şikayet EVET,
    // acil HAYIR. Kök `funkt` seçilseydi her "çalışmıyor" cümlesi acil olurdu.
    for (const m of [
      "Die Heizung funktioniert nicht",
      "Die Klimaanlage funktioniert nicht richtig",
      "Das Licht funktioniert nicht",
    ]) {
      expect(detectRiskType(m), m).not.toBe("safety_emergency");
    }
    // ...ama gerçek kıvılcım YAKALANIR (kapsam kaybedilmedi).
    expect(detectRiskType("Funken kommen aus der Steckdose")).toBe("safety_emergency");
  });

  it("RU `искр` kökü YASAK — 'искренне' (içtenlikle) acil sayılamaz", () => {
    for (const m of ["Искренне благодарю за всё", "Искренне рекомендую эту квартиру"]) {
      expect(detectRiskType(m), m).not.toBe("safety_emergency");
      expect(classifyFallback(m).intent, m).not.toBe("complaint");
    }
    expect(detectRiskType("Из розетки летят искры")).toBe("safety_emergency");
  });
});
