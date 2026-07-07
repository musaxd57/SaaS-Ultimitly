"use client";

import { useState } from "react";

const demoMetrics = {
  period: "2026-07 haftası",
  totalMessages: 428,
  totalTasks: 96,
  overdueTasks: 7,
  averageCloseMinutes: 184,
  riskConversationCount: 19,
  autoResolutionRate: 0.41,
  topCategories: [
    { category: "MAINTENANCE", count: 31 },
    { category: "CLEANING", count: 24 },
    { category: "CHECK_IN", count: 18 }
  ],
  propertyHotspots: [
    { propertyName: "Galata Loft", issueCount: 11 },
    { propertyName: "Karaköy Suite", issueCount: 8 }
  ]
};

export function ReportInsightPanel() {
  const [result, setResult] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function generate() {
    setIsLoading(true);
    setResult(null);

    const response = await fetch("/api/agents/report-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(demoMetrics)
    });

    setResult(await response.json());
    setIsLoading(false);
  }

  return (
    <section className="card">
      <h2>Rapor Agentı</h2>
      <p className="muted">
        Haftalık operasyon metriklerinden yönetici özeti ve aksiyon listesi üretir.
      </p>
      <button className="button" onClick={generate} disabled={isLoading}>
        {isLoading ? "Hazırlanıyor..." : "İçgörü Üret"}
      </button>
      {result ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}
    </section>
  );
}
