"use client";

import { useEffect, useState } from "react";
import { ref, onValue, set } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import type { Command } from "@/lib/types";
import type { ActiveSchedule } from "@/lib/schedule";

export function useRtdbValue<T>(path: string): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const r = ref(rtdb, path);
    const unsub = onValue(r, (snap) => {
      setData(snap.val() as T);
      setLoading(false);
    });
    return () => unsub();
  }, [path]);

  return { data, loading };
}

type CommandFields = Partial<Pick<Command, "motor" | "ssr" | "servo" | "feedNow" | "stop">>;

/** Tulis command lengkap (set, bukan update) agar tidak ada field basi. Last-write-wins via ts. */
export async function sendCommand(fields: CommandFields, uid?: string): Promise<void> {
  const cmd: Command = {
    motor: null,
    ssr: null,
    servo: null,
    feedNow: false,
    stop: false,
    ...fields,
    ts: Date.now(),
    by: uid || "web",
  };
  await set(ref(rtdb, "/command"), cmd);
}

export async function writeActiveSchedule(schedule: ActiveSchedule): Promise<void> {
  await set(ref(rtdb, "/activeSchedule"), schedule);
}
