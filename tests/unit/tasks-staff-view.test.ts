import { describe, it, expect } from "vitest";
import { cleanerTaskDescription, cleanerTaskTitle, staffTaskProjection } from "@/lib/tasks/staff-view";

// ---------------------------------------------------------------------------
// TEMİZLİKÇİ GÖRÜNÜMÜ (09-24, kanıt modeli dilim 3; kurucu: "temizlikçi misafir mesajını, adını, iletişimini ASLA
// görmez"). Sistem görev başlıkları misafir ADI taşıyor ("Çıkış temizliği - Ayşe"), yapay zekâ görevlerinin açıklaması
// misafirin MESAJI. Personele / temizlikçiye giden her yüzey başlığı ve açıklamayı bu tek kuraldan alır.
// ---------------------------------------------------------------------------

const GUEST = "Ayşe Yılmaz";
const MESSAGE = "Klima bozuk, ben Ayşe Yılmaz, numaram 0532 111 22 33";

describe("temizlikçi başlığı — misafir adı asla", () => {
  it("sistem görevi: misafir adlı başlık yerine türün sabit adı", () => {
    expect(cleanerTaskTitle({ origin: "system", type: "cleaning", title: `Çıkış temizliği - ${GUEST}` })).toBe("Çıkış temizliği");
    expect(cleanerTaskTitle({ origin: "system", type: "checkin_prep", title: `${GUEST} girişi için hazırlık` })).toBe("Giriş hazırlığı");
    expect(cleanerTaskTitle({ origin: "system", type: "laundry", title: `Çamaşır - ${GUEST}` })).toBe("Çamaşır");
  });

  it("yapay zekâ görevi: yalnız bizim 'Tür: konu' biçimimiz kalır; başka her başlık (şikâyet + misafir adı) tür adına düşer", () => {
    expect(cleanerTaskTitle({ origin: "ai", type: "maintenance", title: "Bakım: klima" })).toBe("Bakım: klima");
    expect(cleanerTaskTitle({ origin: "ai", type: "restock", title: "Eksik Eşya: havlu" })).toBe("Eksik Eşya: havlu");
    expect(cleanerTaskTitle({ origin: "ai", type: "maintenance", title: `Şikayet: ${GUEST}` })).toBe("Bakım");
    // Etiket başka türün etiketiyse (bozuk satır) ya da konu rakam içeriyorsa (telefon/kod) geçmez.
    expect(cleanerTaskTitle({ origin: "ai", type: "maintenance", title: "Temizlik: klima" })).toBe("Bakım");
    expect(cleanerTaskTitle({ origin: "ai", type: "maintenance", title: "Bakım: 0532 111 22 33" })).toBe("Bakım");
    expect(cleanerTaskTitle({ origin: "ai", type: "maintenance", title: `Bakım: klima ${"x".repeat(60)}` })).toBe("Bakım");
  });

  it("elle açılmış görev host'un yazdığıdır (personele yazıldı) → olduğu gibi; bilinmeyen kaynak → tür adı", () => {
    expect(cleanerTaskTitle({ origin: "manual", type: "cleaning", title: "Balkon camlarını da silin" })).toBe("Balkon camlarını da silin");
    expect(cleanerTaskTitle({ origin: null, type: "cleaning", title: `Temizlik - ${GUEST}` })).toBe("Temizlik");
    expect(cleanerTaskTitle({ origin: "imported", type: "maintenance", title: GUEST })).toBe("Bakım");
  });
});

describe("temizlikçi açıklaması — misafir mesajı asla", () => {
  it("yapay zekâ görevinin açıklaması (misafir mesajı) ve bilinmeyen kaynak gösterilmez; sistem/elle açıklaması kalır", () => {
    expect(cleanerTaskDescription({ origin: "ai", type: "maintenance", title: "Bakım: klima", description: MESSAGE })).toBeNull();
    expect(cleanerTaskDescription({ origin: null, type: "cleaning", title: "x", description: MESSAGE })).toBeNull();
    expect(cleanerTaskDescription({ origin: "system", type: "cleaning", title: "x", description: "Çıkış sonrası tam temizlik." })).toBe("Çıkış sonrası tam temizlik.");
    expect(cleanerTaskDescription({ origin: "manual", type: "cleaning", title: "x", description: "Anahtar kutuda." })).toBe("Anahtar kutuda.");
    expect(cleanerTaskDescription({ origin: "manual", type: "cleaning", title: "x" })).toBeNull();
  });

  it("izdüşüm: başlık + açıklama değişir, misafir mesajına bağlanan kimlik düşer, geri kalan alanlar AYNEN", () => {
    const row = { id: "t1", status: "todo", origin: "ai", type: "maintenance", title: `Şikayet: ${GUEST}`, description: MESSAGE, sourceMessageId: "m1", propertyId: "p1" };
    const p = staffTaskProjection(row);
    expect(p).toEqual({ ...row, title: "Bakım", description: null, sourceMessageId: null });
    expect(JSON.stringify(p)).not.toMatch(/Ayşe|0532/);
    // Kaynak satır değişmez (yan etki yok).
    expect(row.title).toBe(`Şikayet: ${GUEST}`);
  });
});
