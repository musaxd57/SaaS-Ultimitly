"use client";

import { useState } from "react";

const defaultPayload = {
  tenantId: "demo-tenant",
  conversationId: "demo-conversation",
  sourceMessageId: "demo-message",
  message: "Kapı şifresi çalışmıyor, dışarıda kaldık. Hemen yardım eder misiniz?",
  channel: "AIRBNB",
  guest: { name: "Demo Misafir", language: "tr" },
  property: {
    id: "galata-loft",
    name: "Galata Loft",
    city: "Istanbul",
    houseRules: "Sigara yasak. Check-in 15:00 sonrası.",
    checkInGuide: "Ana giriş kodu rezervasyon günü gönderilir."
  },
  reservation: {
    id: "reservation-1",
    checkIn: "2026-07-07",
    checkOut: "2026-07-10",
    status: "confirmed"
  },
  recentMessages: []
};

export function OperationPlanPanel() {
  const [message, setMessage] = useState(defaultPayload.message);
  const [result, setResult] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function createPlan() {
    setIsLoading(true);
    setResult(null);

    const response = await fetch("/api/agents/operation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...defaultPayload,
        message
      })
    });

    setResult(await response.json());
    setIsLoading(false);
  }

  return (
    <div className="card">
      <h2>Operasyon Planı</h2>
      <p className="muted">
        Büyük agent modu: mesajdan sadece görev değil, kontrollü tool planı çıkarır.
      </p>
      <textarea rows={6} value={message} onChange={(event) => setMessage(event.target.value)} />
      <div style={{ marginTop: 12 }}>
        <button className="button" onClick={createPlan} disabled={isLoading}>
          {isLoading ? "Plan hazırlanıyor..." : "Agent Planı Oluştur"}
        </button>
      </div>
      {result ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}
    </div>
  );
}
