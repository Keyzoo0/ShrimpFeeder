"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Pencil,
  GraduationCap,
  User,
  IdCard,
  BookOpen,
  Building2,
  Landmark,
  CalendarDays,
  UserCog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import {
  DEFAULT_THESIS,
  ThesisInfo,
  saveThesis,
  subscribeThesis,
} from "@/lib/thesis";
import { toast } from "@/components/Toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  const empty = !value?.trim();
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-[1.1rem] w-[1.1rem]" />
      </span>
      <div className="min-w-0">
        <div className="label-overline">{label}</div>
        <div
          className={
            empty
              ? "mt-0.5 text-sm italic text-muted-foreground"
              : "mt-0.5 break-words text-sm font-semibold text-foreground"
          }
        >
          {empty ? "Belum diisi" : value}
        </div>
      </div>
    </div>
  );
}

function EditField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function EditDialog({ data }: { data: ThesisInfo }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ThesisInfo>(data);
  const [saving, setSaving] = useState(false);

  // Setiap dialog dibuka, isi ulang dari data terbaru.
  useEffect(() => {
    if (open) setForm(data);
  }, [open, data]);

  const set = <K extends keyof ThesisInfo>(key: K, val: ThesisInfo[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveThesis(form);
      toast("Data tersimpan", "success");
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast("Gagal menyimpan: " + msg, "error");
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Pencil className="h-4 w-4" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Data Tugas Akhir</DialogTitle>
          <DialogDescription>
            Perubahan disimpan ke Firebase dan langsung tersinkron di semua perangkat.
          </DialogDescription>
        </DialogHeader>

        <form id="thesis-form" onSubmit={submit} className="space-y-4">
          <EditField
            id="title"
            label="Judul Tugas Akhir"
            value={form.title}
            onChange={(v) => set("title", v)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <EditField id="studentName" label="Nama" value={form.studentName} onChange={(v) => set("studentName", v)} />
            <EditField id="nim" label="NIM" value={form.nim} onChange={(v) => set("nim", v)} />
            <EditField id="prodi" label="Program Studi" value={form.prodi} onChange={(v) => set("prodi", v)} />
            <EditField id="jurusan" label="Jurusan" value={form.jurusan} onChange={(v) => set("jurusan", v)} />
            <EditField id="campus" label="Kampus" value={form.campus} onChange={(v) => set("campus", v)} />
            <EditField id="year" label="Tahun" value={form.year} onChange={(v) => set("year", v)} />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <EditField id="advisor1" label="Dosen Pembimbing 1" value={form.advisor1} onChange={(v) => set("advisor1", v)} placeholder="Nama lengkap & gelar" />
            <EditField id="advisor1Nip" label="NIP Pembimbing 1" value={form.advisor1Nip} onChange={(v) => set("advisor1Nip", v)} />
            <EditField id="advisor2" label="Dosen Pembimbing 2" value={form.advisor2} onChange={(v) => set("advisor2", v)} placeholder="Nama lengkap & gelar" />
            <EditField id="advisor2Nip" label="NIP Pembimbing 2" value={form.advisor2Nip} onChange={(v) => set("advisor2Nip", v)} />
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Batal
          </Button>
          <Button type="submit" form="thesis-form" disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InfoPage() {
  const [data, setData] = useState<ThesisInfo>(DEFAULT_THESIS);

  useEffect(() => {
    const unsub = subscribeThesis(setData);
    return () => unsub();
  }, []);

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-heading text-lg font-bold">Info Tugas Akhir</h2>
          <p className="text-sm text-muted-foreground">
            Data mahasiswa &amp; tugas akhir.
          </p>
        </div>
        <EditDialog data={data} />
      </div>

      {/* Hero judul */}
      <Card className="glass mb-4 overflow-hidden">
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <span className="grid h-20 w-20 place-items-center rounded-2xl bg-white p-2.5 shadow-card ring-1 ring-black/5">
              <Image src="/logo-polinema.png" alt="Politeknik Negeri Malang" width={60} height={60} className="h-full w-full object-contain" />
            </span>
            <Badge variant="default" className="gap-1.5">
              <GraduationCap className="h-3.5 w-3.5" /> Tugas Akhir
            </Badge>
            <h1 className="max-w-3xl font-heading text-xl font-extrabold leading-snug sm:text-2xl">
              {data.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              Oleh <span className="font-semibold text-foreground">{data.studentName}</span>
              {data.nim && <> · NIM {data.nim}</>}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {data.prodi && <Badge variant="secondary">{data.prodi}</Badge>}
              {data.jurusan && <Badge variant="secondary">{data.jurusan}</Badge>}
              {data.year && <Badge variant="secondary">{data.year}</Badge>}
            </div>
          </CardContent>
        </div>
      </Card>

      {/* Detail */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-4 w-4 text-primary" /> Data Mahasiswa
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border pt-0">
            <Field icon={User} label="Nama" value={data.studentName} />
            <Field icon={IdCard} label="NIM" value={data.nim} />
            <Field icon={BookOpen} label="Program Studi" value={data.prodi} />
            <Field icon={Building2} label="Jurusan" value={data.jurusan} />
            <Field icon={Landmark} label="Kampus" value={data.campus} />
            <Field icon={CalendarDays} label="Tahun" value={data.year} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-4 w-4 text-primary" /> Dosen Pembimbing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="label-overline mb-1">Pembimbing 1</div>
              <Field icon={UserCog} label="Nama" value={data.advisor1} />
              <Field icon={IdCard} label="NIP" value={data.advisor1Nip} />
            </div>
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="label-overline mb-1">Pembimbing 2</div>
              <Field icon={UserCog} label="Nama" value={data.advisor2} />
              <Field icon={IdCard} label="NIP" value={data.advisor2Nip} />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
