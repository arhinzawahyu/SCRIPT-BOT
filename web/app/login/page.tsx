"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, KeyRound, LoaderCircle, MessageCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import ActionButton from "@/components/ActionButton";
import { LoginGuard } from "@/components/Doodles";
import Field from "@/components/Field";

const credentialsSchema = z.object({
  username: z.string().trim().min(1, "Username wajib diisi."),
  password: z.string().min(1, "Password wajib diisi."),
});
const tokenSchema = z.object({ token: z.string().regex(/^\d{6}$/, "Masukkan 6 digit token.") });
type Credentials = z.infer<typeof credentialsSchema>;
type TokenValues = z.infer<typeof tokenSchema>;

export default function LoginPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState("");
  const credentials = useForm<Credentials>({ resolver: zodResolver(credentialsSchema), defaultValues: { username: "", password: "" } });
  const token = useForm<TokenValues>({ resolver: zodResolver(tokenSchema), defaultValues: { token: "" } });
  const passwordValue = credentials.watch("password");
  const hiding = step === 1 && passwordValue.length > 0;

  useEffect(() => {
    if (step !== 2 || !waiting) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/login/verify", { cache: "no-store" });
        if (!response.ok || stopped) return;
        const payload = await response.json() as { pending?: boolean };
        if (payload.pending === false) {
          setWaiting(false);
          setNotice("Token sudah dikirim ke WhatsApp. Masukkan 6 digit di bawah.");
        }
      } catch {
        // Poll lagi; login tetap bisa dicoba manual.
      }
    }, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [step, waiting]);

  async function submitCredentials(values: Credentials) {
    setNotice("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json().catch(() => ({})) as { needToken?: boolean; error?: string };
      if (!response.ok || !payload.needToken) {
        toast.error("Gagal masuk", { description: payload.error || "Username atau password salah." });
        return;
      }
      setStep(2);
      setWaiting(true);
      setNotice("Menunggu bot mengirim token ke WhatsApp...");
    } catch {
      toast.error("Tidak dapat terhubung", { description: "Periksa koneksi lalu coba lagi." });
    }
  }

  async function submitToken(values: TokenValues) {
    setNotice("");
    try {
      const response = await fetch("/api/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: credentials.getValues("username"), password: credentials.getValues("password"), token: values.token }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        toast.error("Token tidak valid", { description: payload.error || "Coba lagi atau minta token baru." });
        return;
      }
      toast.success("Login berhasil");
      window.location.href = "/";
    } catch {
      toast.error("Tidak dapat terhubung", { description: "Periksa koneksi lalu coba lagi." });
    }
  }

  function backToCredentials() {
    setStep(1);
    setWaiting(false);
    setNotice("");
    token.reset();
  }

  return (
    <main className="login-page">
      <div className="login-layout login-layout--single">
        <motion.section className="login-panel login-panel--focused" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28, ease: [0.22, 1, 0.36, 1] }}>
          <div className="login-panel__top">
            <Link className="login-brand" href="/" aria-label="WA Console">
              <span className="login-brand__mark">WA</span>
              <span>WA Console</span>
            </Link>
          </div>

          {/* Penjaga doodle: menutup mata saat password diketik */}
          <div className="login-stage">
            <LoginGuard hiding={hiding} peeking={step === 2 && !waiting} />
          </div>

          <div className="login-progress" aria-label={`Tahap login ${step} dari 2`}>
            <span className={step === 1 ? "login-progress__step login-progress__step--active" : "login-progress__step login-progress__step--done"}><span className="login-progress__dot" aria-hidden="true" /><b>01</b> Password</span>
            <span className="login-progress__line" aria-hidden="true" />
            <span className={step === 2 ? "login-progress__step login-progress__step--active" : "login-progress__step"}><span className="login-progress__dot" aria-hidden="true" /><b>02</b> Token WhatsApp</span>
          </div>

          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div key="credentials" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: .2 }}>
                <div className="login-panel__heading"><KeyRound size={21} aria-hidden="true" /><h2>Masuk sebagai admin</h2><p>Password memeriksa identitas. Langkah berikutnya dikirim ke WhatsApp owner.</p></div>
                <form className="stack-form" onSubmit={credentials.handleSubmit(submitCredentials)} noValidate>
                  <Field label="Username" autoComplete="username" placeholder="owner" error={credentials.formState.errors.username?.message} {...credentials.register("username")} />
                  <Field label="Password" type="password" autoComplete="current-password" placeholder="••••••••" error={credentials.formState.errors.password?.message} {...credentials.register("password")} />
                  <ActionButton type="submit" variant="primary" loading={credentials.formState.isSubmitting}><span>Lanjut ke token</span><ArrowRight size={16} aria-hidden="true" /></ActionButton>
                </form>
              </motion.div>
            ) : (
              <motion.div key="token" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: .2 }}>
                <div className="login-panel__heading"><MessageCircle size={21} aria-hidden="true" /><h2>Masukkan token</h2><p>Gunakan kode 6 digit yang baru dikirim ke WhatsApp.</p></div>
                <div className={waiting ? "token-status token-status--waiting" : "token-status"} role="status"><span className="token-status__pulse">{waiting ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}</span><div><strong>{waiting ? "Menunggu token dikirim" : "Token siap digunakan"}</strong><span>{notice || "Bot mengirim kode ke WhatsApp."}</span></div></div>
                <form className="stack-form" onSubmit={token.handleSubmit(submitToken)} noValidate>
                  <Field label="Token 6 digit" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} className="token-field" error={token.formState.errors.token?.message} {...token.register("token", { onChange: (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6); } })} />
                  <ActionButton type="submit" variant="primary" loading={token.formState.isSubmitting}><span>Verifikasi dan masuk</span><ArrowRight size={16} aria-hidden="true" /></ActionButton>
                  <ActionButton type="button" variant="ghost" onClick={backToCredentials} disabled={token.formState.isSubmitting}>Kembali ke password</ActionButton>
                </form>
                <p className="login-help">Token tidak datang? Ketik <code>#token</code> di chat bot.</p>
              </motion.div>
            )}
          </AnimatePresence>


        </motion.section>

      </div>
    </main>
  );
}
