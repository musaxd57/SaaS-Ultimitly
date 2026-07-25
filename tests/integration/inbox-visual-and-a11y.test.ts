import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Inbox — görsel kalite turu (Codex) + doğrulanmış a11y bulguları.
//
// Pinlenen sözleşmeler:
//   • Sayaç MAKİNE ÇIKTISI değil CÜMLE: tek sayfada "N konuşma", çok sayfada
//     "N konuşmadan a–b arası · Sayfa p / t". "1–4 / 4" gitti.
//   • Tek sayfada sayfalama düğmeleri HİÇ basılmaz (tıklanacak şey yokken
//     görünmemeli).
//   • Arama kutusunun GERÇEK bir etiketi var (placeholder ad değildir) ve form
//     role="search" taşır.
//   • Aktif filtre aria-current ile bildirilir — eskiden YALNIZ renkti, yani
//     ekran okuyucu kullanıcısı boş listeyi "hiç kaydım yok" sanıyordu.
//   • "Acil" ikonu tek başına bilgi taşıyamaz → sr-only metin eşlik eder.
//
// Desen: list-pagination-pages.test.ts ile aynı — sayfa fonksiyonu GERÇEK test
// DB'siyle çağrılır, dönen React ağacı yürünür.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { requireAuth } from "@/lib/auth";
import InboxPage from "@/app/(app)/inbox/page";
import { EmptyState } from "@/components/empty-state";

const mockAuth = vi.mocked(requireAuth);

function treeText(root: unknown): string {
  const parts: string[] = [];
  const collect = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) collect(n);
      return;
    }
    if (React.isValidElement(node)) collect((node.props as { children?: unknown }).children);
  };
  collect(root);
  return parts.join("");
}

/** Belirli bir prop'u taşıyan tüm elementleri toplar. */
function elementsWithProp(root: unknown, prop: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (props[prop] !== undefined) found.push(props);
      walk(props.children);
    }
  };
  walk(root);
  return found;
}

/**
 * Sayfalama düğmelerinin etiketleri. LinkOrDisabled bir BİLEŞEN olduğu için
 * etiket `children` değil PROP'tur; treeText onu göremez. (Aynı tuzağa
 * list-pagination-pages.test.ts'te TaskBoard için de düşülmüştü.)
 */
function paginationLabels(root: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (React.isValidElement(node)) {
      const props = node.props as { label?: unknown; href?: unknown; children?: unknown };
      if (typeof props.label === "string" && "href" in props) out.push(props.label);
      walk(props.children);
    }
  };
  walk(root);
  return out;
}

function sessionFor(orgId: string) {
  return {
    userId: "user-inbox-test",
    organizationId: orgId,
    role: "owner",
    email: "owner@test.com",
    name: "Owner",
    sessionEpoch: 0,
  } as unknown as Awaited<ReturnType<typeof requireAuth>>;
}

const sp = <T,>(v: T) => Promise.resolve(v);

async function seed(name: string, conversationCount: number, opts: { urgent?: boolean } = {}) {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Daire A" },
  });
  for (let i = 0; i < conversationCount; i++) {
    await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier: `Misafir-${String(i).padStart(3, "0")}`,
        status: "new",
        priority: opts.urgent && i === 0 ? "urgent" : "standard",
        lastMessageAt: new Date(Date.now() - i * 60_000),
      },
    });
  }
  return org;
}

describe("Inbox sayacı — makine çıktısı değil, cümle", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("TEK sayfa: sadece toplam yazar, aralık/sayfa YOK", async () => {
    const org = await seed("Inbox Tek", 4);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const text = treeText(await InboxPage({ searchParams: sp({}) }));
    expect(text).toContain("4 konuşma");
    expect(text).not.toContain("1–4"); // eski "1–4 / 4"
    expect(text).not.toContain("Sayfa");
  });

  it("TEK sayfa: sayfalama düğmeleri hiç basılmaz", async () => {
    const org = await seed("Inbox Tek 2", 4);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    expect(paginationLabels(await InboxPage({ searchParams: sp({}) }))).toEqual([]);
  });

  it("ÇOK sayfa: nerede olduğunu SÖYLER ve düğmeler görünür", async () => {
    const org = await seed("Inbox Cok", 55); // 50/sayfa → 2 sayfa
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const tree = await InboxPage({ searchParams: sp({}) });
    expect(treeText(tree)).toContain("55 konuşmadan 1–50 arası · Sayfa 1 / 2");
    // Çubuk artık HEM ÜSTTE HEM ALTTA basılıyor → 2 değil 4 düğme.
    expect(paginationLabels(tree)).toEqual(["Önceki", "Sonraki", "Önceki", "Sonraki"]);
  });

  it("ÇOK sayfa, 2. sayfa: aralık ve sayfa numarası ilerler", async () => {
    const org = await seed("Inbox Cok 2", 55);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const text = treeText(await InboxPage({ searchParams: sp({ sayfa: "2" }) }));
    expect(text).toContain("55 konuşmadan 51–55 arası · Sayfa 2 / 2");
  });
});

describe("Inbox erişilebilirliği", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("arama kutusunun GERÇEK etiketi var ve form role=search taşır", async () => {
    const org = await seed("Inbox Ara", 3);
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const tree = await InboxPage({ searchParams: sp({}) });

    // Görünmez ama gerçek <label htmlFor> — placeholder bir AD DEĞİLDİR.
    const labels = elementsWithProp(tree, "htmlFor");
    expect(labels.some((p) => p.htmlFor === "inbox-search")).toBe(true);
    expect(treeText(tree)).toContain("Misafir adına göre ara");
    expect(elementsWithProp(tree, "role").some((p) => p.role === "search")).toBe(true);
  });

  it("aktif filtre aria-current ile bildirilir (yalnız renk değil)", async () => {
    const org = await seed("Inbox Filtre", 3);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const tree = await InboxPage({ searchParams: sp({ status: "new" }) });
    const current = elementsWithProp(tree, "aria-current").filter(
      (p) => p["aria-current"] === "page",
    );
    // TAM BİR tane: aktif olan. Hepsine konsaydı bilgi yine kaybolurdu.
    expect(current).toHaveLength(1);
  });

  it("filtre seçili değilken hiçbir çip aria-current taşımaz", async () => {
    const org = await seed("Inbox Filtre 2", 3);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const tree = await InboxPage({ searchParams: sp({}) });
    const current = elementsWithProp(tree, "aria-current").filter(
      (p) => p["aria-current"] === "page",
    );
    expect(current).toHaveLength(1); // "Tümü" aktif
  });

  it("ACİL önceliği ikonun yanında METİN olarak da vardır", async () => {
    const org = await seed("Inbox Acil", 2, { urgent: true });
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const text = treeText(await InboxPage({ searchParams: sp({}) }));
    // lucide <svg> ne <title> ne aria taşır (kod-doğrulandı) → sr-only metin şart.
    expect(text).toContain("Acil");
  });
});

describe("Inbox sayfalama — üstte ve altta", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  /** Ağaçtaki <nav> etiketleri. */
  function navLabels(root: unknown): string[] {
    return elementsWithProp(root, "aria-label")
      .map((p) => String(p["aria-label"]))
      .filter((l) => l.startsWith("Sayfalama"));
  }

  it("ÇOK sayfada aynı kontroller HEM ÜSTTE HEM ALTTA basılır", async () => {
    const org = await seed("Inbox Pager", 55);
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const tree = await InboxPage({ searchParams: sp({}) });

    // İki ayrı <nav>: ekran okuyucunun düğme listesinde özdeş "Önceki"leri
    // ayırt edebilmesi için adları FARKLI.
    expect(navLabels(tree)).toEqual(["Sayfalama (üst)", "Sayfalama (alt)"]);
    // Her iki çubukta da iki düğme → toplam 4.
    expect(paginationLabels(tree)).toEqual(["Önceki", "Sonraki", "Önceki", "Sonraki"]);
  });

  it("TEK sayfada iki çubuk da düğme BASMAZ", async () => {
    const org = await seed("Inbox Pager Tek", 10);
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const tree = await InboxPage({ searchParams: sp({}) });

    expect(navLabels(tree)).toEqual([]);
    expect(paginationLabels(tree)).toEqual([]);
  });

  it("sayfalama bağlantıları FİLTRE ve ARAMAYI korur", async () => {
    const org = await seed("Inbox Pager Filtre", 55);
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const tree = await InboxPage({ searchParams: sp({ status: "new", q: "Misafir" }) });

    const hrefs = elementsWithProp(tree, "href")
      .map((p) => String(p.href))
      .filter((h) => h.includes("sayfa="));
    expect(hrefs.length).toBeGreaterThan(0);
    // Sayfa değişirken filtre/arama DÜŞMEZ — yoksa 2. sayfada bambaşka bir
    // liste görünür ve kullanıcı filtreyi kaybettiğini fark etmez.
    for (const h of hrefs) {
      expect(h).toContain("status=new");
      expect(h).toContain("q=Misafir");
    }
  });
});

describe("Inbox — aralık dışı sayfa", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("taşan sayfa SON GEÇERLİ sayfaya yönlendirilir (boş ekran + yanlış mesaj yerine)", async () => {
    const org = await seed("Inbox Tasan", 55); // 2 sayfa
    mockAuth.mockResolvedValue(sessionFor(org.id));
    await expect(InboxPage({ searchParams: sp({ sayfa: "9" }) })).rejects.toThrow(
      "NEXT_REDIRECT:/inbox?sayfa=2",
    );
  });

  it("yönlendirme FİLTRE ve ARAMAYI korur", async () => {
    const org = await seed("Inbox Tasan Filtre", 55);
    mockAuth.mockResolvedValue(sessionFor(org.id));
    // Hepsi "new": filtre 2 sayfa bırakır.
    await expect(
      InboxPage({ searchParams: sp({ status: "new", q: "Misafir", sayfa: "9" }) }),
    ).rejects.toThrow(/NEXT_REDIRECT:\/inbox\?status=new&q=Misafir&sayfa=2/);
  });

  it("GERÇEKTEN kayıt yoksa yönlendirme YOK — boş durum doğrudur", async () => {
    const org = await seed("Inbox Bos", 0);
    mockAuth.mockResolvedValue(sessionFor(org.id));
    // Sonsuz yönlendirme döngüsü olmamalı: kayıt yokken clamp devreye GİRMEZ.
    // (EmptyState'in başlığı PROP olduğu için treeText'te görünmez — sözleşme
    //  "throw etmemesi", metni değil.)
    const tree = await InboxPage({ searchParams: sp({ sayfa: "5" }) });
    expect(paginationLabels(tree)).toEqual([]);
  });
});

describe("Inbox — filtre/arama SONUÇSUZ kaldığında", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  /**
   * EmptyState'in başlık/açıklaması PROP'tur — treeText göremez. Ayrıca
   * "title prop'u olan ilk element"i almak YETMEZ: PageHeader da title taşır
   * ve ilk o gelir; ilk yazımda testlerden biri PageHeader'ın "Mesajlar"ını
   * ölçüp VAKUM biçimde yeşil oldu. Bileşen KİMLİĞİYLE eşleştiriyoruz.
   */
  function emptyState(tree: unknown): { title: string; description: string } | null {
    let found: { title: string; description: string } | null = null;
    const walk = (node: unknown): void => {
      if (found || node == null || typeof node === "boolean") return;
      if (Array.isArray(node)) {
        for (const n of node) walk(n);
        return;
      }
      if (!React.isValidElement(node)) return;
      if (node.type === EmptyState) {
        const p = node.props as { title?: unknown; description?: unknown };
        found = { title: String(p.title ?? ""), description: String(p.description ?? "") };
        return;
      }
      walk((node.props as { children?: unknown }).children);
    };
    walk(tree);
    return found;
  }

  // BULUNAN HATA: sayfa YALNIZ `conversations.length === 0` diye bakıyordu ve
  // sebebi ayırt etmiyordu. 900 konuşması olan bir host "Sorunlu" filtresine
  // basıp o an sorunlu konuşması yoksa "Henüz misafir mesajı yok / Airbnb
  // bağlantısını kurunca mesajlar akar" görüyordu: bağlantı KURULU, mesajlar
  // VAR. Metin sadece yanlış değil, yanlış eylemi de öneriyordu ("Yeni
  // konuşma") — doğru eylem filtreyi kaldırmaktı.
  //
  // Bu, taşan-sayfa clamp'iyle AYNI sınıf ("kayıt var, bu pencerede yok"); orada
  // kapatılmış, burada açık kalmıştı.

  it("SORUÇSUZ arama 'hiç mesaj yok' DEMEZ ve aramayı temizlemeyi önerir", async () => {
    const org = await seed("Inbox Arama Bos", 12);
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const tree = await InboxPage({ searchParams: sp({ q: "BöyleBirMisafirYok" }) });

    const es = emptyState(tree)!;
    const text = `${es.title} ${es.description}`;
    expect(text).not.toContain("Henüz misafir mesajı yok");
    expect(text).not.toContain("otomatik buraya akar"); // bağlantı kurulum metni
    expect(text).toContain("BöyleBirMisafirYok"); // aranan terim geri gösterilir
    // Doğru çıkış yolu ekranda: filtreyi temizleyen bir bağlantı.
    const hrefs = elementsWithProp(tree, "href").map((p) => String(p.href));
    expect(hrefs).toContain("/inbox");
  });

  it("SONUÇSUZ durum filtresi de 'hiç mesaj yok' DEMEZ", async () => {
    const org = await seed("Inbox Filtre Bos", 12); // hepsi "new"
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const tree = await InboxPage({ searchParams: sp({ status: "problem" }) });

    const es = emptyState(tree)!;
    expect(`${es.title} ${es.description}`).not.toContain("Henüz misafir mesajı yok");
  });

  it("GERÇEKTEN sıfır konuşmada eski kurulum metni AYNEN kalır", async () => {
    // Karşı yön: filtre yokken boş kutu hâlâ yeni kullanıcıyı yönlendirmeli.
    const org = await seed("Inbox Gercek Bos", 0);
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const tree = await InboxPage({ searchParams: sp({}) });

    const es = emptyState(tree)!;
    expect(`${es.title} ${es.description}`).toContain("misafir mesaj");
  });
});
