"use client";

import { ReactNode, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, GraduationCap, LogOut } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useRtdbValue } from "@/hooks/useRtdb";
import type { DeviceState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";

const TABS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/info", label: "Info", icon: GraduationCap },
];

function OnlineBadge() {
  const { data } = useRtdbValue<DeviceState>("/state");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(t);
  }, []);

  const online = !!data?.online && now - (data?.lastSeen || 0) < 15000;

  return (
    <Badge
      variant={online ? "success" : "destructive"}
      className="h-7 gap-1.5 px-2.5"
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          online ? "animate-pulseDot bg-success" : "bg-destructive",
        )}
      />
      {online ? "Alat Online" : "Alat Offline"}
    </Badge>
  );
}

function TabNav() {
  const pathname = usePathname();
  return (
    <nav className="inline-flex h-11 items-center gap-1 rounded-xl border border-border bg-muted/60 p-1 backdrop-blur">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-all",
              active
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <p className="text-sm text-muted-foreground">Memuat…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Image
              src="/logo-elektro.png"
              alt="Teknik Elektro"
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-xl object-contain drop-shadow-sm"
            />
            <div className="leading-tight">
              <h1 className="font-heading text-base font-bold sm:text-lg">
                Smart Shrimp Feeder
              </h1>
              <p className="hidden text-[11px] text-muted-foreground sm:block">
                Penakar Pakan Udang IoT · Politeknik Negeri Malang
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <OnlineBadge />
            </div>
            <ThemeToggle />
            <div className="hidden text-right md:block">
              <p className="max-w-[160px] truncate text-xs font-medium text-foreground">
                {user.email}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => signOut()}
              aria-label="Keluar"
              title="Keluar"
              className="text-destructive hover:text-destructive"
            >
              <LogOut className="h-[1.15rem] w-[1.15rem]" />
            </Button>
          </div>
        </div>

        <div className="container flex items-center gap-3 pb-3 sm:hidden">
          <OnlineBadge />
        </div>
      </header>

      <div className="container pb-20 pt-5">
        <div className="mb-5 flex justify-center sm:justify-start">
          <TabNav />
        </div>
        {children}
      </div>
    </div>
  );
}
