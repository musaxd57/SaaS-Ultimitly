"use client";

import { useState } from "react";

const defaultMessage = "Klima çalışmıyor, çocuk var ev çok sıcak. Biri hemen ilgilenebilir mi?";

export function AnalyzeMessageForm() {
  const [message, setMessage] = useState(defaultMessage);
  const [result, setResult] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function analyze() {
    setIsLoading(true);
    setResult(null);

    const response = await fetch("/api/agents/analyze-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "demo-tenant",
        conversationId: "demo-conversation",
        sourceMessageId: "demo-message",
        message,
        channel: "AIRBNB",
        guest: { name: "Demo Misafir", language: "tr" },
        property: {
          id: "galata-loft",
          name: "Galata Loft",
          city: "Istanbul",
          houseRules: "Evcil hayvan yok. Sigara yasak. Check-in 15:00 sonrası.",
          checkInGuide: "Kapı kodu rezervasyon günü gönderilir."
        },
        reservation: {
          id: "reservation-1",
          checkIn: "2026-07-07",
          checkOut: "2026-07-10",
          status: "confirmed"
        },
        recentMessages: []
      })
    });

    setResult(await response.json());
    setIsLoading(false);
  }

  return (
    <div className="card">
      <h2>Agent Denemesi</h2>
      <p className="muted">
        Bu panel gerçek API route'unu çağırır. LiteLLM yoksa deterministic fallback çalışır.
      </p>
      <textarea rows={7} value={message} onChange={(event) => setMessage(event.target.value)} />
      <div style={{ marginTop: 12 }}>
        <button className="button" onClick={analyze} disabled={isLoading}>
          {isLoading ? "Analiz ediliyor..." : "Mesajı Analiz Et"}
        </button>
      </div>
      {result ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}
    </div>
  );
}
