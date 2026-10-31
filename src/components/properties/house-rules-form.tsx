"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/form-field";
import { toast } from "@/lib/toast";
import { HOUSE_RULE_TOPICS, type HouseRulePolicy, type HouseRuleTopic } from "@/lib/house-rules/core";

/**
 * EV KURALLARI (mülk başına, #188 dilim 2). Ev sahibi konu başına İzinli / Yasak / Bana sor seçer; kendi seçimi ONAYDIR.
 * Yapay zekâ bu kuralları henüz cevaplarında KULLANMAZ (karar ayrı dilim: gölge ölçüm → kör ölçüm → kurucu onayı) — kart
 * bunu açıkça söyler. Müşteri metni sade. Yalnız yöneticiye çizilir (sayfa kapısı) ve kart bayrağı açıkken.
 */
export const HOUSE_RULE_TOPIC_LABELS: Record<HouseRuleTopic, string> = {
  party_event: "Parti ve etkinlik",
  smoking: "Evin içinde sigara",
  pets: "Evcil hayvan",
  extra_guests: "Rezervasyondakinden fazla misafir",
  quiet_hours: "Sessiz saatler dışında gürültü",
  visitors: "Ziyaretçi",
};

const POLICIES: readonly { code: HouseRulePolicy; label: string }[] = [
  { code: "ask_host", label: "Bana sor" },
  { code: "allowed", label: "İzinli" },
  { code: "forbidden", label: "Yasak" },
];

export function HouseRulesForm({
  propertyId,
  canManage,
  initial,
}: {
  propertyId: string;
  canManage: boolean;
  /** Konu başına kayıtlı seçim (kayıt yoksa "bana sor"). */
  initial: Record<HouseRuleTopic, HouseRulePolicy>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<HouseRuleTopic, HouseRulePolicy>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/house-rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: HOUSE_RULE_TOPICS.map((topic) => ({ topic, policy: values[topic] })) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { fields?: { _?: string } } | null;
        setError(body?.fields?._ ?? "Kaydedilemedi. Tekrar deneyin.");
        return;
      }
      toast.success("Ev kuralları kaydedildi.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Ev kuralları</p>
        <p className="text-xs text-muted-foreground">
          Misafir bu konularda izin isterse yapay zekâ yalnız sizin seçiminize göre cevap verecek. &quot;Bana sor&quot; seçilen
          konularda istek size kalır.
        </p>
        <p className="text-xs text-muted-foreground" data-testid="house-rules-inactive">
          Yapay zekâ bu kuralları henüz cevaplarında kullanmıyor; seçimleriniz kaydedilir.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {HOUSE_RULE_TOPICS.map((topic) => (
          <Field key={topic} label={HOUSE_RULE_TOPIC_LABELS[topic]} htmlFor={`hr-${topic}`}>
            <Select
              id={`hr-${topic}`}
              value={values[topic]}
              disabled={!canManage}
              onChange={(e) => setValues((v) => ({ ...v, [topic]: e.target.value as HouseRulePolicy }))}
            >
              {POLICIES.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Yasak seçilen konuda misafire nazikçe izin verilmediği söylenir. Parti, fazla misafir ve sessiz saatlerde
        &quot;İzinli&quot; seçseniz de yapay zekâ izin vermez; bu istekler size kalır.
      </p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {canManage ? (
        <div className="flex justify-end">
          <Button type="button" disabled={busy} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Kaydet
          </Button>
        </div>
      ) : null}
    </div>
  );
}
