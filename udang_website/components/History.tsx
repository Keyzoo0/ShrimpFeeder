"use client";

import { useEffect, useMemo } from "react";

import { useRtdbValue } from "@/hooks/useRtdb";
import type { FeedEvent } from "@/lib/types";
import { db } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function History() {
  const { data } = useRtdbValue<Record<string, FeedEvent>>("/feedEvents");

  const events = useMemo(() => {
    if (!data) return [] as (FeedEvent & { id: string })[];
    return Object.entries(data)
      .map(([id, e]) => ({ id, ...e }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 20);
  }, [data]);

  // Mirror best-effort ke Firestore (idempotent by id).
  useEffect(() => {
    if (!data) return;
    (async () => {
      for (const [id, e] of Object.entries(data).slice(-20)) {
        try {
          await setDoc(doc(db, "feedHistory", id), { ...e }, { merge: true });
        } catch {
          /* abaikan */
        }
      }
    })();
  }, [data]);

  const fmt = (ts: number) => {
    if (!ts) return "-";
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, "0")}/${String(
      d.getMonth() + 1,
    ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Riwayat Feeding</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada riwayat.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-muted-foreground">
                    {fmt(e.ts)}
                  </span>
                  <Badge variant={e.trigger === "auto" ? "default" : "warning"}>
                    {e.trigger}
                  </Badge>
                  <span className="text-foreground">{e.cycle}</span>
                </div>
                <div className="text-right tabular-nums">
                  <span className="font-bold text-foreground">
                    {Math.round(e.delivered || 0)} g
                  </span>
                  <span className="ml-1 text-xs text-muted-foreground">
                    / {Math.round(e.setpoint || 0)} g
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
