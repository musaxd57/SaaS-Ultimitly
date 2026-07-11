import { describe, it, expect } from "vitest";
import {
  reservationSchema,
  loginSchema,
  registerSchema,
  propertySchema,
  kbSchema,
  taskUpdateSchema,
  conversationReplySchema,
  zodFieldErrors,
} from "@/lib/validators";

describe("reservationSchema", () => {
  const valid = {
    propertyId: "p1",
    guestName: "John Smith",
    arrivalDate: "2026-06-01",
    departureDate: "2026-06-04",
  };

  it("applies defaults for channel, status and currency", () => {
    const parsed = reservationSchema.parse(valid);
    expect(parsed.channel).toBe("manual");
    expect(parsed.status).toBe("confirmed");
    expect(parsed.currency).toBe("EUR");
    expect(parsed.arrivalDate).toBeInstanceOf(Date);
  });

  it("rejects a departure date that is not after arrival", () => {
    const result = reservationSchema.safeParse({ ...valid, departureDate: "2026-05-30" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodFieldErrors(result.error);
      expect(fields.departureDate).toMatch(/sonra/);
    }
  });

  it("requires a guest name", () => {
    const result = reservationSchema.safeParse({ ...valid, guestName: "" });
    expect(result.success).toBe(false);
  });
});

describe("auth schemas", () => {
  it("rejects an invalid email on login", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("requires an 8+ char password on register", () => {
    const short = registerSchema.safeParse({
      organizationName: "Acme",
      name: "Owner",
      email: "owner@acme.com",
      password: "123",
    });
    expect(short.success).toBe(false);
  });
});

describe("propertySchema", () => {
  it("defaults check-in/out times and validates the HH:MM format", () => {
    const parsed = propertySchema.parse({ name: "Loft" });
    expect(parsed.checkInTime).toBe("15:00");
    expect(parsed.checkOutTime).toBe("11:00");

    // Format-only check: rejects anything that is not two-digit HH:MM.
    expect(propertySchema.safeParse({ name: "Loft", checkInTime: "9:5" }).success).toBe(false);
    expect(propertySchema.safeParse({ name: "Loft", checkInTime: "noon" }).success).toBe(false);
  });
});

describe("kbSchema", () => {
  it("defaults category, language and active flag", () => {
    const parsed = kbSchema.parse({ propertyId: "p1", title: "Wi-Fi", content: "şifre" });
    expect(parsed.category).toBe("general");
    expect(parsed.language).toBe("tr");
    expect(parsed.isActive).toBe(true);
  });
});

describe("taskUpdateSchema.photoUrl scheme guard", () => {
  it("accepts a same-origin upload path and an https URL", () => {
    expect(taskUpdateSchema.safeParse({ photoUrl: "/uploads/org/pic.jpg" }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({ photoUrl: "https://cdn.example.com/a.png" }).success).toBe(true);
  });

  it("rejects javascript:/data:/protocol-relative/http schemes (stored-XSS vectors)", () => {
    // photoUrl is rendered as <a href> AND <img src> in the task board.
    expect(taskUpdateSchema.safeParse({ photoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ photoUrl: "data:text/html,<script>1</script>" }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ photoUrl: "//evil.example.com/x.png" }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ photoUrl: "http://insecure.example.com/x.png" }).success).toBe(false);
  });
});

describe("zodFieldErrors", () => {
  it("flattens a ZodError into a field -> message map", () => {
    const result = loginSchema.safeParse({ email: "bad", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodFieldErrors(result.error);
      expect(Object.keys(fields)).toContain("email");
      expect(Object.keys(fields)).toContain("password");
    }
  });
});

describe("conversationReplySchema — reserved sender names", () => {
  it("rejects the AI classification magic string and its brand alias (self-inflate guard)", () => {
    for (const name of ["GuestOps AI", "guestops ai", " Lixus AI ", "LIXUS AI"]) {
      const r = conversationReplySchema.safeParse({ body: "Merhaba", senderName: name });
      expect(r.success).toBe(false);
    }
  });
  it("accepts normal sender names (and none at all)", () => {
    expect(conversationReplySchema.safeParse({ body: "Merhaba", senderName: "Musa" }).success).toBe(true);
    expect(conversationReplySchema.safeParse({ body: "Merhaba" }).success).toBe(true);
  });
});
