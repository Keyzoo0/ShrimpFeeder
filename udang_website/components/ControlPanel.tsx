"use client";

import { Settings, Wind, Wrench, Play, Square } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useRtdbValue, sendCommand } from "@/hooks/useRtdb";
import type { DeviceState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "./Toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function Toggle({
  label,
  icon: Icon,
  on,
  onText,
  offText,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  on: boolean;
  onText: string;
  offText: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center gap-2 rounded-xl border border-border bg-muted/40 px-2 py-4 text-center sm:px-3">
      <Icon
        className={cn("h-6 w-6 shrink-0", on ? "text-primary" : "text-muted-foreground")}
      />
      <div className="label-overline flex min-h-[2rem] items-center justify-center leading-tight">
        {label}
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "mt-auto w-full rounded-lg px-2 py-2 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
          on
            ? "bg-primary text-primary-foreground shadow-glow"
            : "border border-border bg-background text-foreground hover:bg-accent",
        )}
      >
        {on ? onText : offText}
      </button>
    </div>
  );
}

export function ControlPanel() {
  const { user } = useAuth();
  const { data } = useRtdbValue<DeviceState>("/state");
  const s = data || {};
  const uid = user?.uid;
  const feeding = !!s.feeding;

  const cmd = async (fields: Parameters<typeof sendCommand>[0], msg: string) => {
    try {
      await sendCommand(fields, uid);
      toast(msg, "info");
    } catch {
      toast("Gagal kirim perintah", "error");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Kontrol Hardware</CardTitle>
        {feeding && <Badge variant="warning">Feeding berjalan</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Toggle
            label="Motor Katup"
            icon={Settings}
            on={s.motor === 1}
            onText="TUTUP"
            offText="BUKA"
            disabled={feeding}
            onClick={() => cmd({ motor: s.motor === 1 ? 0 : 1 }, "Perintah motor terkirim")}
          />
          <Toggle
            label="SSR Blower"
            icon={Wind}
            on={s.ssr === 1}
            onText="ON"
            offText="OFF"
            disabled={feeding}
            onClick={() => cmd({ ssr: s.ssr === 1 ? 0 : 1 }, "Perintah blower terkirim")}
          />
          <Toggle
            label="Servo"
            icon={Wrench}
            on={!!s.servo}
            onText="BUKA"
            offText="TUTUP"
            disabled={feeding}
            onClick={() => cmd({ servo: s.servo ? 0 : 1 }, "Perintah servo terkirim")}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button
            disabled={feeding}
            onClick={() => cmd({ feedNow: true }, "Memulai feeding…")}
          >
            <Play className="h-4 w-4" /> Mulai Feeding
          </Button>
          <Button
            variant="destructive"
            disabled={!feeding}
            onClick={() => cmd({ stop: true }, "Menghentikan feeding…")}
          >
            <Square className="h-4 w-4" /> Stop Feeding
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Multiuser: perintah terbaru yang menang (last-write-wins). Kontrol manual
          dikunci saat feeding otomatis berjalan.
        </p>
      </CardContent>
    </Card>
  );
}
