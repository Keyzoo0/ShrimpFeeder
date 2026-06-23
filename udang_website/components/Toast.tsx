"use client";

import { toast as sonnerToast } from "sonner";

export { Toaster } from "@/components/ui/sonner";

type ToastType = "info" | "success" | "error";

/**
 * Adapter agar pemanggilan lama `toast("pesan", "success")` tetap berjalan,
 * sekarang ditenagai oleh Sonner (gaya shadcn).
 */
export function toast(msg: string, type: ToastType = "info") {
  if (type === "success") return sonnerToast.success(msg);
  if (type === "error") return sonnerToast.error(msg);
  return sonnerToast(msg);
}
