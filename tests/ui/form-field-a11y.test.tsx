// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Field } from "@/components/form-field";
import { Input } from "@/components/ui/input";

// Ortak Field bileşeni hata/ipucu metnini ÜRETİYOR ama kontrole BAĞLAMIYORDU
// (Codex): ekran okuyucu kullanıcısı alana odaklanınca hatayı hiç duymuyor,
// alanın geçersiz olduğunu bilmiyordu. 55 çağıranın 54'ü htmlFor verdiği için
// tek merkezi düzeltme neredeyse tüm formları iyileştiriyor.

describe("Field — hata/ipucu metni kontrole PROGRAMATİK olarak bağlı", () => {
  beforeEach(cleanup);

  it("hata varsa: aria-describedby hata metnini gösterir ve aria-invalid işaretlenir", () => {
    render(
      <Field label="E-posta" htmlFor="f-email" error="Bu e-posta zaten kayıtlı">
        <Input id="f-email" />
      </Field>,
    );
    const input = screen.getByLabelText("E-posta");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // Bağlanan düğüm GERÇEKTEN hata metnini taşımalı (id eşleşmesi yetmez).
    const desc = document.getElementById(describedBy!);
    expect(desc?.textContent).toBe("Bu e-posta zaten kayıtlı");
  });

  it("hata bir DUYURUdur: role=alert taşır", () => {
    render(
      <Field label="Şifre" htmlFor="f-pw" error="En az 8 karakter">
        <Input id="f-pw" />
      </Field>,
    );
    expect(screen.getByRole("alert").textContent).toBe("En az 8 karakter");
  });

  it("hata yokken ipucu bağlanır ve aria-invalid KONMAZ", () => {
    render(
      <Field label="Şifre" htmlFor="f-pw2" hint="En az 8 karakter.">
        <Input id="f-pw2" />
      </Field>,
    );
    const input = screen.getByLabelText("Şifre");
    expect(input.getAttribute("aria-invalid")).toBeNull(); // geçerli alan geçersiz görünmemeli
    const desc = document.getElementById(input.getAttribute("aria-describedby")!);
    expect(desc?.textContent).toBe("En az 8 karakter.");
  });

  it("çocuğun KENDİ aria-describedby'ı korunur (ezilmez)", () => {
    render(
      <>
        <span id="own-desc">Kendi açıklaması</span>
        <Field label="Ad" htmlFor="f-name" error="Zorunlu">
          <Input id="f-name" aria-describedby="own-desc" />
        </Field>
      </>,
    );
    const ids = screen.getByLabelText("Ad").getAttribute("aria-describedby")!.split(" ");
    expect(ids).toContain("own-desc");
    expect(ids.length).toBe(2);
  });

  it("htmlFor verilmemişse çökmez (bağlama yapılamaz ama hata yine duyurulur)", () => {
    render(
      <Field label="Etiketsiz" error="Hata">
        <Input />
      </Field>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Hata");
  });
});
