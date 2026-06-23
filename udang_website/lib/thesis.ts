import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface ThesisInfo {
  title: string; // judul tugas akhir
  studentName: string; // nama
  nim: string; // NIM
  prodi: string; // program studi
  jurusan: string; // jurusan
  campus: string; // kampus
  year: string; // tahun
  advisor1: string; // dosen pembimbing 1
  advisor1Nip: string; // NIP pembimbing 1
  advisor2: string; // dosen pembimbing 2
  advisor2Nip: string; // NIP pembimbing 2
}

/** Lokasi dokumen tunggal di Firestore. */
export const THESIS_DOC = doc(db, "siteContent", "thesis");

/** Nilai bawaan (dipakai bila dokumen belum ada di Firestore). */
export const DEFAULT_THESIS: ThesisInfo = {
  title:
    "PERANCANGAN ALAT PENAKAR PAKAN UDANG BERDASARKAN UMUR UDANG MENGGUNAKAN SENSOR BERAT BERBASIS IOT",
  studentName: "Ramadan Putra Ariani",
  nim: "2241170025",
  prodi: "Sarjana Terapan Teknik Elektronika",
  jurusan: "Teknik Elektro",
  campus: "Politeknik Negeri Malang",
  year: "2026",
  advisor1: "",
  advisor1Nip: "",
  advisor2: "",
  advisor2Nip: "",
};

/** Pastikan semua field terisi (gabung dengan default). */
export function normalizeThesis(data?: Partial<ThesisInfo> | null): ThesisInfo {
  return { ...DEFAULT_THESIS, ...(data || {}) };
}

/** Ambil sekali (mis. untuk SSR/awal). */
export async function getThesis(): Promise<ThesisInfo> {
  try {
    const snap = await getDoc(THESIS_DOC);
    return normalizeThesis(snap.exists() ? (snap.data() as Partial<ThesisInfo>) : null);
  } catch {
    return DEFAULT_THESIS;
  }
}

/** Langganan realtime. */
export function subscribeThesis(cb: (data: ThesisInfo) => void): () => void {
  return onSnapshot(
    THESIS_DOC,
    (snap) => cb(normalizeThesis(snap.exists() ? (snap.data() as Partial<ThesisInfo>) : null)),
    () => cb(DEFAULT_THESIS),
  );
}

/** Simpan (merge) ke Firestore. */
export async function saveThesis(data: ThesisInfo): Promise<void> {
  await setDoc(
    THESIS_DOC,
    { ...data, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
