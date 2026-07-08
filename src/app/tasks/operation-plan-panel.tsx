"use client";

import { useMemo, useState } from "react";

type PlanStep = {
  tool: string;
  title: string;
  reason: string;
  status: "pending" | "requires_human" | "safe_to_automate";
  payload: Record<string, unknown>;
};

type PlanResponse = {
  plan: {
    automationMode: "copilot" | "controlled_automation" | "human_only";
    riskLevel: string;
    summary: string;
    blockers: string[];
    steps: PlanStep[];
  };
  run?: {
    id?: string;
  };
};

type ExecutionResult = {
  mode: "dry_run" | "persist";
  automationMode: string;
  executedCount: number;
  queuedForHumanCount: number;
  skippedCount: number;
  results: Array<{
    tool: string;
    title: string;
    status: "executed" | "queued_for_human" | "skipped";
    skipped: boolean;
    skipReason?: string;
    created?: Record<string, string | undefined>;
  }>;
};

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

const statusLabels: Record<PlanStep["status"], string> = {
  pending: "Bağlantı bekliyor",
  requires_human: "İnsan onayı",
  safe_to_automate: "Güvenli otomasyon"
};

const resultLabels: Record<ExecutionResult["results"][number]["status"], string> = {
  executed: "Çalıştı",
  queued_for_human: "Onaya alındı",
  skipped: "Atlandı"
};

export function OperationPlanPanel() {
  const [message, setMessage] = useState(defaultPayload.message);
  const [planResponse, setPlanResponse] = useState<PlanResponse | null>(null);
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [mode, setMode] = useState<ExecutionResult["mode"]>("dry_run");
  const [error, setError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const plan = planResponse?.plan;
  const canExecute = Boolean(plan && !isPlanning && !isExecuting);
  const executionSummary = useMemo(() => {
    if (!execution) {
      return null;
    }

    return [
      { label: "Çalışan", value: execution.executedCount },
      { label: "Onay", value: execution.queuedForHumanCount },
      { label: "Atlanan", value: execution.skippedCount }
    ];
  }, [execution]);

  async function createPlan() {
    setIsPlanning(true);
    setError(null);
    setPlanResponse(null);
    setExecution(null);

    try {
      const response = await fetch("/api/agents/operation-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...defaultPayload,
          message
        })
      });

      if (!response.ok) {
        throw new Error("Operasyon planı oluşturulamadı.");
      }

      setPlanResponse((await response.json()) as PlanResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Beklenmeyen planlama hatası.");
    } finally {
      setIsPlanning(false);
    }
  }

  async function executePlan() {
    if (!plan) {
      return;
    }

    setIsExecuting(true);
    setError(null);
    setExecution(null);

    try {
      const response = await fetch("/api/agents/execute-operation-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: defaultPayload.tenantId,
          agentRunId: planResponse?.run?.id,
          mode,
          plan
        })
      });

      if (!response.ok) {
        throw new Error(
          mode === "persist"
            ? "Kalıcı çalıştırma başarısız. Gerçek veritabanında tenant ve ilişkili kayıtlar hazır olmalı."
            : "Plan çalıştırma simülasyonu başarısız."
        );
      }

      setExecution((await response.json()) as ExecutionResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Beklenmeyen çalıştırma hatası.");
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <div className="card stack">
      <div>
        <h2>Operasyon Planı</h2>
        <p className="muted">
          Büyük agent modu mesajı işler, güvenli adımları çalıştırır ve riskli kararları insan onayına alır.
        </p>
      </div>

      <textarea rows={6} value={message} onChange={(event) => setMessage(event.target.value)} />

      <div className="toolbar">
        <button className="button" onClick={createPlan} disabled={isPlanning || isExecuting}>
          {isPlanning ? "Plan hazırlanıyor..." : "Plan Oluştur"}
        </button>
        <select value={mode} onChange={(event) => setMode(event.target.value as ExecutionResult["mode"])}>
          <option value="dry_run">Dry run</option>
          <option value="persist">Persist</option>
        </select>
        <button className="button secondary" onClick={executePlan} disabled={!canExecute}>
          {isExecuting ? "Çalıştırılıyor..." : "Planı Çalıştır"}
        </button>
      </div>

      {error ? <div className="notice high">{error}</div> : null}

      {plan ? (
        <div className="stack">
          <div className="summary-grid">
            <div>
              <span className="muted">Mod</span>
              <strong>{plan.automationMode}</strong>
            </div>
            <div>
              <span className="muted">Risk</span>
              <strong>{plan.riskLevel}</strong>
            </div>
            <div>
              <span className="muted">Adım</span>
              <strong>{plan.steps.length}</strong>
            </div>
          </div>

          <p>{plan.summary}</p>

          {plan.blockers.length ? (
            <div className="notice medium">
              {plan.blockers.map((blocker) => (
                <div key={blocker}>{blocker}</div>
              ))}
            </div>
          ) : null}

          <div className="stack compact">
            {plan.steps.map((step) => (
              <article className="step-row" key={`${step.tool}-${step.title}`}>
                <div>
                  <span className={`badge ${step.status === "requires_human" ? "high" : "low"}`}>
                    {statusLabels[step.status]}
                  </span>
                  <h3>{step.title}</h3>
                  <p className="muted">{step.reason}</p>
                </div>
                <code>{step.tool}</code>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {execution ? (
        <div className="stack">
          <div className="summary-grid">
            {executionSummary?.map((item) => (
              <div key={item.label}>
                <span className="muted">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>

          <div className="stack compact">
            {execution.results.map((result) => (
              <article className="step-row" key={`${result.tool}-${result.title}`}>
                <div>
                  <span className={`badge ${result.status === "queued_for_human" ? "medium" : "low"}`}>
                    {resultLabels[result.status]}
                  </span>
                  <h3>{result.title}</h3>
                  {result.skipReason ? <p className="muted">{result.skipReason}</p> : null}
                </div>
                <code>{result.created ? Object.values(result.created).filter(Boolean).join(", ") : result.tool}</code>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
