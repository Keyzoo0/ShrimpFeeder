"use client";

import { Settings, Scale, Lock, Wind, AlertTriangle, CheckCircle2 } from "lucide-react";

import { useRtdbValue } from "@/hooks/useRtdb";
import type { DeviceState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  { label: "Motor Buka", stages: [1], icon: Settings },
  { label: "Timbang", stages: [2], icon: Scale },
  { label: "Tutup+Servo", stages: [3, 4], icon: Lock },
  { label: "Blower+Kosong", stages: [5, 6, 7], icon: Wind },
];

function Chip({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-center">
      <div className="label-overline">{label}</div>
      <div
        className={cn(
          "mt-1 text-sm font-bold",
          ok ? "text-primary" : "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function Monitoring() {
  const { data } = useRtdbValue<DeviceState>("/state");
  const s = data || {};
  const weight = Math.round(s.weight || 0);
  const stage = s.stage || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monitoring</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Berat realtime */}
        <div className="glass rounded-xl bg-gradient-to-b from-primary/10 to-transparent px-4 py-6 text-center">
          <div className="label-overline">Berat Loadcell (realtime)</div>
          <div className="mt-1">
            <span className="font-heading text-5xl font-extrabold text-primary">
              {weight}
            </span>
            <span className="ml-1 text-base text-muted-foreground">gram</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {s.feeding
              ? `Tahap: ${s.stageLabel || "-"}`
              : weight < 10
              ? "Loadcell kosong / stabil"
              : "Menahan beban"}
          </div>
        </div>

        {/* Flow alur */}
        <div className="grid grid-cols-4 gap-2">
          {STEPS.map((st, i) => {
            const active = st.stages.includes(stage);
            const done = stage > Math.max(...st.stages);
            const Icon = st.icon;
            return (
              <div
                key={i}
                className={cn(
                  "rounded-xl border px-2 py-3 text-center text-[10px] font-semibold transition",
                  active
                    ? "border-primary bg-primary/10 text-primary shadow-glow"
                    : done
                    ? "border-primary/30 text-primary/70"
                    : "border-border text-muted-foreground",
                )}
              >
                <Icon className="mx-auto mb-1 h-4 w-4" />
                {st.label}
              </div>
            );
          })}
        </div>

        {/* Status komponen */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Chip label="Motor" value={s.motor === 1 ? "Buka" : "Tutup"} ok={s.motor === 1} />
          <Chip label="Loadcell" value={`${weight} g`} ok={weight > 0} />
          <Chip label="Servo" value={`${s.servo || 0}°`} ok={!!s.servo} />
          <Chip label="Blower" value={s.ssr === 1 ? "ON" : "OFF"} ok={s.ssr === 1} />
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Encoder: {s.encoder ?? "-"}</span>
          {s.error ? (
            <span className="flex items-center gap-1 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {s.error}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> OK
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
