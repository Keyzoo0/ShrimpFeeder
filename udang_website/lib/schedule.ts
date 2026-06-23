export interface Cycle {
  name: string;
  days: number;
  fr: number; // feeding rate %
}

export interface ActiveSchedule {
  enabled: boolean;
  startDate: string; // YYYY-MM-DD
  offsetAge: number; // umur saat startDate
  count: number; // jumlah udang
  initialWeight: number; // gram/ekor (berat awal, diinput sekali)
  feedTimes: string[]; // ["07:00","15:00","23:00"]
  cycles: Cycle[];
}

export const DEFAULT_CYCLES: Cycle[] = [
  { name: "Starter",  days: 14, fr: 15 },
  { name: "Early",    days: 14, fr: 10 },
  { name: "Grower",   days: 28, fr: 8 },
  { name: "Finisher", days: 56, fr: 4 },
];

export const DEFAULT_FEED_TIMES = ["07:00", "15:00", "23:00"];

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Total hari satu masa tebar (age 0 .. total). */
export function totalDays(cycles: Cycle[]): number {
  return cycles.reduce((s, c) => s + (Number(c.days) || 0), 0);
}

/** Biomassa awal total (gram) = initialWeight * count. */
export function biomassGram(initialWeight: number, count: number): number {
  return (Number(initialWeight) || 0) * (Number(count) || 0);
}

/** Setpoint per feed (gram) — berdasarkan initialWeight yang SAMA untuk semua siklus. */
export function setpointPerFeed(cycle: Cycle, initialWeight: number, count: number, feedsPerDay: number): number {
  const biomass = biomassGram(initialWeight, count);
  const daily = (biomass * (Number(cycle.fr) || 0)) / 100;
  return daily / (feedsPerDay > 0 ? feedsPerDay : 3);
}

/** Cari siklus untuk umur tertentu (band kumulatif dari age 0). */
export function cycleForAge(cycles: Cycle[], age: number): { cycle: Cycle; index: number } | null {
  let acc = 0;
  for (let i = 0; i < cycles.length; i++) {
    if (age < acc + (Number(cycles[i].days) || 0)) return { cycle: cycles[i], index: i };
    acc += Number(cycles[i].days) || 0;
  }
  return null; // di luar masa tebar
}

function addDaysISO(startISO: string, n: number): string {
  const [y, m, d] = startISO.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function daysBetween(startISO: string, endDate: Date): number {
  const [y, m, d] = startISO.split("-").map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export interface DayRow {
  dayIndex: number;
  date: string;
  age: number;
  cycle: string;
  perFeed: number; // gram
  times: string[];
}

/** Tabel harian untuk dilihat ulang. */
export function buildDailyTable(s: ActiveSchedule): DayRow[] {
  const rows: DayRow[] = [];
  const total = totalDays(s.cycles);
  const feeds = s.feedTimes.length || 3;
  for (let d = 0; ; d++) {
    const age = s.offsetAge + d;
    if (age >= total) break;
    const found = cycleForAge(s.cycles, age);
    if (!found) break;
    rows.push({
      dayIndex: d,
      date: addDaysISO(s.startDate, d),
      age,
      cycle: found.cycle.name,
      perFeed: setpointPerFeed(found.cycle, s.initialWeight, s.count, feeds),
      times: s.feedTimes,
    });
  }
  return rows;
}

export interface CurrentInfo {
  age: number;
  cycle: string | null;
  perFeed: number;
  finished: boolean;
}

/** Info siklus hari ini (yang dipakai ESP32). */
export function currentInfo(s: ActiveSchedule, now: Date = new Date()): CurrentInfo {
  const age = s.offsetAge + daysBetween(s.startDate, now);
  const total = totalDays(s.cycles);
  if (age >= total) return { age, cycle: null, perFeed: 0, finished: true };
  const found = cycleForAge(s.cycles, age);
  if (!found) return { age, cycle: null, perFeed: 0, finished: true };
  return {
    age,
    cycle: found.cycle.name,
    perFeed: setpointPerFeed(found.cycle, s.initialWeight, s.count, s.feedTimes.length || 3),
    finished: false,
  };
}
