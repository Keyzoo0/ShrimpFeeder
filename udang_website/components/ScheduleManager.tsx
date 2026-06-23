"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, Save, Table2 } from "lucide-react";

import { useRtdbValue, writeActiveSchedule } from "@/hooks/useRtdb";
import {
  ActiveSchedule,
  Cycle,
  DEFAULT_CYCLES,
  DEFAULT_FEED_TIMES,
  todayISO,
  setpointPerFeed,
  buildDailyTable,
  currentInfo,
  totalDays,
  biomassGram,
} from "@/lib/schedule";
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { toast } from "./Toast";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const blank: ActiveSchedule = {
  enabled: false,
  startDate: todayISO(),
  offsetAge: 1,
  count: 1000,
  initialWeight: 5,
  feedTimes: DEFAULT_FEED_TIMES,
  cycles: DEFAULT_CYCLES,
};

interface PlanRow {
  id: string;
  startDate: string;
  count: number;
  offsetAge: number;
  initialWeight: number;
  cycles: Cycle[];
  feedTimes: string[];
  enabled?: boolean;
}

function Stat({
  label,
  value,
  unit,
  tone = "default",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "default" | "primary" | "warning";
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-center">
      <div className="label-overline">{label}</div>
      <div
        className={cn(
          "mt-1 text-sm font-bold",
          tone === "primary" && "text-primary",
          tone === "warning" && "text-warning",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
        {unit && <span className="ml-1 text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

export function ScheduleManager() {
  const { data } = useRtdbValue<ActiveSchedule>("/activeSchedule");
  const [form, setForm] = useState<ActiveSchedule>(blank);
  const [synced, setSynced] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<PlanRow[]>([]);

  // Sinkron sekali dari RTDB saat data pertama datang.
  useEffect(() => {
    if (data && !synced) {
      setForm({
        ...blank,
        ...data,
        cycles: data.cycles?.length ? data.cycles : DEFAULT_CYCLES,
        feedTimes: data.feedTimes?.length ? data.feedTimes : DEFAULT_FEED_TIMES,
      });
      setSynced(true);
    }
  }, [data, synced]);

  const loadPlans = async () => {
    try {
      const q = query(
        collection(db, "schedulePlans"),
        orderBy("createdAt", "desc"),
        limit(8),
      );
      const snap = await getDocs(q);
      setPlans(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PlanRow, "id">) })));
    } catch {
      /* abaikan bila offline / belum ada koleksi */
    }
  };
  useEffect(() => {
    loadPlans();
  }, []);

  const feeds = form.feedTimes.length || 3;
  const info = useMemo(() => currentInfo(form), [form]);
  const dailyTable = useMemo(() => buildDailyTable(form), [form]);
  const total = totalDays(form.cycles);
  const totalBiomass = biomassGram(form.initialWeight, form.count);

  const setField = <K extends keyof ActiveSchedule>(key: K, val: ActiveSchedule[K]) =>
    setForm((f) => ({ ...f, [key]: val }));
  const setCycle = (i: number, patch: Partial<Cycle>) =>
    setForm((f) => ({
      ...f,
      cycles: f.cycles.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));

  const persist = async (enabled: boolean, archive: boolean) => {
    setSaving(true);
    try {
      const sched: ActiveSchedule = { ...form, enabled };
      await writeActiveSchedule(sched);
      setForm(sched);
      if (archive) {
        await addDoc(collection(db, "schedulePlans"), {
          startDate: sched.startDate,
          offsetAge: sched.offsetAge,
          count: sched.count,
          initialWeight: sched.initialWeight,
          feedTimes: sched.feedTimes,
          cycles: sched.cycles,
          enabled,
          totalDays: total,
          createdAt: serverTimestamp(),
        });
        loadPlans();
      }
      toast(enabled ? "Jadwal aktif & tersimpan" : "Jadwal diperbarui", "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast("Gagal menyimpan: " + msg, "error");
    }
    setSaving(false);
  };

  const loadPlan = (p: PlanRow) => {
    setForm({
      enabled: false,
      startDate: p.startDate,
      offsetAge: p.offsetAge,
      count: p.count,
      initialWeight: p.initialWeight || 5,
      feedTimes: p.feedTimes?.length ? p.feedTimes : DEFAULT_FEED_TIMES,
      cycles: p.cycles?.length ? p.cycles : DEFAULT_CYCLES,
    });
    toast("Plan dimuat ke editor", "info");
  };

  return (
    <Card>
      <CardHeader className="flex flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 shrink-0 text-primary" />
          Penjadwalan Pakan (4 Siklus)
        </CardTitle>
        <Badge variant={form.enabled ? "success" : "secondary"} className="shrink-0">
          {form.enabled ? "AUTO aktif" : "AUTO nonaktif"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Input global */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="flex h-full flex-col gap-1">
            <Label className="label-overline leading-tight">Tgl Mulai</Label>
            <Input
              type="date"
              className="mt-auto"
              value={form.startDate}
              onChange={(e) => setField("startDate", e.target.value)}
            />
          </div>
          <div className="flex h-full flex-col gap-1">
            <Label className="label-overline leading-tight">Offset Umur (hari)</Label>
            <Input
              type="number"
              min={0}
              className="mt-auto"
              value={form.offsetAge}
              onChange={(e) => setField("offsetAge", parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="flex h-full flex-col gap-1">
            <Label className="label-overline leading-tight">Jumlah Udang (ekor)</Label>
            <Input
              type="number"
              min={1}
              className="mt-auto"
              value={form.count}
              onChange={(e) => setField("count", parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="flex h-full flex-col gap-1">
            <Label className="label-overline leading-tight">Berat Awal/Ekor (g)</Label>
            <Input
              type="number"
              min={0.1}
              step={0.1}
              className="mt-auto"
              value={form.initialWeight}
              onChange={(e) => setField("initialWeight", parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="flex h-full flex-col gap-1">
            <Label className="label-overline leading-tight">Jam Makan</Label>
            <div className="mt-auto flex h-10 items-center truncate rounded-md border border-border bg-muted/40 px-3 text-sm font-medium">
              {form.feedTimes.join(" · ")}
            </div>
          </div>
        </div>

        {/* Tabel siklus */}
        <div className="scroll-slim overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[18rem] text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-2 py-2 sm:px-3">Siklus</th>
                <th className="px-2 py-2 sm:px-3">Durasi</th>
                <th className="px-2 py-2 sm:px-3">FR (%)</th>
                <th className="px-2 py-2 text-right sm:px-3">Setpoint</th>
              </tr>
            </thead>
            <tbody>
              {form.cycles.map((c, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-2 font-semibold text-foreground sm:px-3">{c.name}</td>
                  <td className="px-2 py-2 sm:px-3">
                    <Input
                      type="number"
                      min={1}
                      className="h-8 w-14 sm:w-24"
                      value={c.days}
                      onChange={(e) => setCycle(i, { days: parseInt(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-2 py-2 sm:px-3">
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      className="h-8 w-14 sm:w-24"
                      value={c.fr}
                      onChange={(e) => setCycle(i, { fr: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right font-bold tabular-nums text-primary sm:px-3">
                    {Math.round(setpointPerFeed(c, form.initialWeight, form.count, feeds))} g
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Info hari ini */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Umur Hari Ini"
            value={String(info.age)}
            unit={`/ ${total} hari`}
          />
          <Stat
            label="Siklus Aktif"
            value={info.finished ? "Selesai" : info.cycle || "-"}
            tone="primary"
          />
          <Stat
            label="Setpoint Sekarang"
            value={info.finished ? "-" : `${Math.round(info.perFeed)} g`}
            tone="warning"
          />
          <Stat
            label="Biomassa Awal"
            value={String(Math.round(totalBiomass / 1000))}
            unit="kg"
          />
        </div>

        {/* Aksi */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button className="w-full sm:w-auto" disabled={saving} onClick={() => persist(true, true)}>
            <Check className="h-4 w-4" /> Aktifkan &amp; Simpan
          </Button>
          <Button className="w-full sm:w-auto" variant="outline" disabled={saving} onClick={() => persist(false, false)}>
            <Save className="h-4 w-4" /> Simpan (nonaktif)
          </Button>
          <Button className="w-full sm:w-auto" variant="ghost" onClick={() => setShowTable((v) => !v)}>
            <Table2 className="h-4 w-4" />
            {showTable ? "Sembunyikan" : "Lihat"} Tabel Harian ({dailyTable.length})
          </Button>
        </div>

        {/* Tabel harian */}
        {showTable && (
          <div className="scroll-slim max-h-72 overflow-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Hari</th>
                  <th className="px-3 py-2">Tanggal</th>
                  <th className="px-3 py-2">Umur</th>
                  <th className="px-3 py-2">Siklus</th>
                  <th className="px-3 py-2 text-right">Setpoint/feed</th>
                </tr>
              </thead>
              <tbody>
                {dailyTable.map((r) => (
                  <tr key={r.dayIndex} className="border-t border-border">
                    <td className="px-3 py-1.5">{r.dayIndex + 1}</td>
                    <td className="px-3 py-1.5">{r.date}</td>
                    <td className="px-3 py-1.5">{r.age}</td>
                    <td className="px-3 py-1.5">{r.cycle}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-primary">
                      {Math.round(r.perFeed)} g
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Plan tersimpan */}
        {plans.length > 0 && (
          <div>
            <div className="label-overline mb-2">Jadwal Tersimpan</div>
            <div className="flex flex-col gap-2">
              {plans.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="text-muted-foreground">
                    Mulai {p.startDate} · {p.count} ekor · {p.initialWeight || "?"}g/ekor ·
                    offset {p.offsetAge}h
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full shrink-0 sm:w-auto"
                    onClick={() => loadPlan(p)}
                  >
                    Muat
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
