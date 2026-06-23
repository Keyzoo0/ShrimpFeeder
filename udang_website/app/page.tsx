"use client";

import { AppShell } from "@/components/AppShell";
import { Monitoring } from "@/components/Monitoring";
import { ControlPanel } from "@/components/ControlPanel";
import { ScheduleManager } from "@/components/ScheduleManager";
import { History } from "@/components/History";

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="grid gap-4 lg:grid-cols-2">
        <Monitoring />
        <ControlPanel />
      </div>
      <div className="mt-4">
        <ScheduleManager />
      </div>
      <div className="mt-4">
        <History />
      </div>
    </AppShell>
  );
}
