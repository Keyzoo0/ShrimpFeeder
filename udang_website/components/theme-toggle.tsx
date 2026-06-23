"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Ganti tema terang/gelap"
      title={mounted ? (isDark ? "Mode terang" : "Mode gelap") : "Ganti tema"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative"
    >
      {/* Render both icons; avoid hydration mismatch by toggling via CSS once mounted */}
      <Sun
        className={`h-[1.15rem] w-[1.15rem] transition-all ${
          mounted && isDark ? "scale-0 -rotate-90" : "scale-100 rotate-0"
        }`}
      />
      <Moon
        className={`absolute h-[1.15rem] w-[1.15rem] transition-all ${
          mounted && isDark ? "scale-100 rotate-0" : "scale-0 rotate-90"
        }`}
      />
    </Button>
  );
}
