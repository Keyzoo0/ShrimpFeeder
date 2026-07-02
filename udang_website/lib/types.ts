export interface DeviceState {
  weight?: number;
  encoder?: number;
  motor?: number; // 0/1
  ssr?: number; // 0/1
  servo?: number; // 0/50
  feeding?: boolean;
  stage?: number; // 0..9
  stageLabel?: string;
  online?: boolean;
  lastSeen?: number; // epoch ms
  error?: string;
}

export interface Command {
  motor: number | null;
  ssr: number | null;
  servo: number | null;
  feedNow: boolean;
  setpoint: number | null; // takaran manual (gram) untuk feedNow; null = pakai jadwal
  stop: boolean;
  ts: number;
  by: string;
}

export interface FeedEvent {
  ts: number;
  setpoint: number;
  delivered: number;
  cycle: string;
  trigger: string;
}

export const STAGE_LABELS: Record<number, string> = {
  0: "Idle",
  1: "Buka Katup",
  2: "Timbang",
  3: "Tutup Katup",
  4: "Buka Servo",
  5: "Jeda 3s",
  6: "Blower",
  7: "Blower 3s",
  8: "Tare + Tutup",
  9: "Selesai",
};
