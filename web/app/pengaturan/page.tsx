"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { CheckCircle2, KeyRound, LockKeyhole } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import Shell from "../Shell";
import ActionButton from "@/components/ActionButton";
import { DoodleBuddy } from "@/components/Doodles";
import Field from "@/components/Field";

const schema = z.object({
  oldPassword: z.string().min(1, "Password lama wajib diisi."),
  newPassword: z.string().min(8, "Minimal 8 karakter.").max(200, "Maksimal 200 karakter."),
});
type Values = z.infer<typeof schema>;

export default function PengaturanPage() {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { oldPassword: "", newPassword: "" } });

  async function submit(values: Values) {
    try {
      const response = await fetch("/api/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Password gagal diganti.");
      form.reset();
      toast.success("Password diganti");
    } catch (error) {
      toast.error("Gagal mengganti password", { description: error instanceof Error ? error.message : "Coba lagi." });
    }
  }

  return (
    <Shell>
      <motion.div className="settings-page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .4, ease: [0.22, 1, 0.36, 1] }}>
        <header className="archive-hero">
          <div className="archive-hero__mascot">
            <DoodleBuddy variant="shield" />
          </div>
          <div className="archive-hero__body">
            <h1 className="archive-hero__title">Pengaturan <em>Keamanan</em></h1>
            <p className="archive-hero__desc">Ganti kata sandi untuk login berikutnya.</p>
          </div>
        </header>
        <div className="settings-grid">
          <section className="settings-panel">
            <div className="settings-panel__heading"><div className="settings-icon"><KeyRound size={19} aria-hidden="true" /></div><div><h2>Ganti password</h2><p>Password baru langsung digunakan untuk login berikutnya.</p></div></div>
            <form className="stack-form" onSubmit={form.handleSubmit(submit)} noValidate>
              <Field label="Password lama" type="password" autoComplete="current-password" error={form.formState.errors.oldPassword?.message} {...form.register("oldPassword")} />
              <Field label="Password baru" type="password" autoComplete="new-password" hint="Minimal 8 karakter." error={form.formState.errors.newPassword?.message} {...form.register("newPassword")} />
              <ActionButton type="submit" variant="primary" loading={form.formState.isSubmitting}>Simpan password</ActionButton>
            </form>
          </section>
          <aside className="settings-notes">
            <div className="settings-note"><LockKeyhole size={17} aria-hidden="true" /><div><strong>Password baru langsung berlaku</strong><span>Setelah disimpan, login berikutnya memakai password baru.</span></div></div>
            <div className="settings-note"><CheckCircle2 size={17} aria-hidden="true" /><div><strong>Password tidak ditampilkan lagi</strong><span>Isi kolom tidak bisa dibaca setelah disimpan.</span></div></div>
          </aside>
        </div>
      </motion.div>
    </Shell>
  );
}
