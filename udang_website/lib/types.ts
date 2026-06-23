export interface DeviceState {
  weight?: number;
  encoder?: number;
  motor?: number; // 0/1
  ssr?: number; // 0/1
  servo?: number; // 0/50
  feeding?: boolean;
  stage?: number; // 0..8
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
  1: "Motor Buka",
  2: "Timbang",
  3: "Motor Tutup",
  4: "Servo Tutup",
  5: "Blower",
  6: "Buka Gate",
  7: "Dispense",
  8: "Selesai",
};
