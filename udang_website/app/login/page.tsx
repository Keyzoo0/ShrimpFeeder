"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";

function mapError(code?: string): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email atau password salah.";
    case "auth/invalid-email":
      return "Format email tidak valid.";
    case "auth/too-many-requests":
      return "Terlalu banyak percobaan. Coba lagi nanti.";
    case "auth/network-request-failed":
      return "Gagal terhubung. Cek koneksi.";
    default:
      return "Gagal masuk. Periksa kembali kredensial.";
  }
}

export default function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [user, loading, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setError(mapError(code));
    }
    setBusy(false);
  };

  return (
    <main className="relative grid min-h-screen place-items-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex items-center gap-4">
            <span className="grid h-[72px] w-[72px] place-items-center rounded-2xl bg-white p-2.5 shadow-card ring-1 ring-black/5">
              <Image
                src="/logo-polinema.png"
                alt="Politeknik Negeri Malang"
                width={56}
                height={56}
                className="h-full w-full object-contain"
              />
            </span>
            <Image
              src="/logo-elektro.png"
              alt="Teknik Elektro"
              width={72}
              height={72}
              className="h-[72px] w-[72px] rounded-2xl object-contain drop-shadow-md"
            />
          </div>
          <h1 className="font-heading text-xl font-bold">Smart Shrimp Feeder</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Penakar Pakan Udang IoT · Politeknik Negeri Malang
          </p>
        </div>

        <Card className="glass">
          <CardContent className="p-6">
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@email.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {error && (
                <p className="text-xs font-medium text-destructive">{error}</p>
              )}

              <Button type="submit" disabled={busy} size="lg" className="mt-1 w-full">
                <LogIn className="h-4 w-4" />
                {busy ? "Memproses…" : "Masuk"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          Akun dibuat oleh admin. Tidak ada pendaftaran mandiri.
        </p>
      </div>
    </main>
  );
}
