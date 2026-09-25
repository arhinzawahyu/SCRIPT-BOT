"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ImagePlus, LoaderCircle, Upload, X } from "lucide-react";
import type { ArchiveKind } from "@/types/archive";
import ActionButton from "./ActionButton";
import Modal from "./Modal";

// Batas disamakan dengan server: file langsung maksimal 4 MB.
const MAX_FILE = 4 * 1024 * 1024;
const ACCEPTS = [".jpg", ".jpeg", ".png", ".webp", ".mp4", ".ogg", ".oga", ".mp3", ".m4a", ".wav"];

const schema = z.object({
  sender_name: z.string().max(80, "Maksimal 80 karakter.").optional(),
  sender: z.string().max(32, "Maksimal 32 karakter.").optional(),
  caption: z.string().max(1000, "Maksimal 1000 karakter.").optional(),
});
type Values = z.infer<typeof schema>;

type Props = {
  kind: ArchiveKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
};

function guessMedia(file: File): string {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "image";
}

export default function UploadModal({ kind, open, onOpenChange, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { sender_name: "", sender: "", caption: "" } });
  const textOnly = kind === "delete";

  function pick(next: File | null) {
    if (!next) {
      setFile(null);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      return;
    }
    if (next.size > MAX_FILE) {
      toast.error("File terlalu besar", { description: "Maksimal 4 MB per file." });
      return;
    }
    setFile(next);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return next.type.startsWith("image/") || next.type.startsWith("video/") ? URL.createObjectURL(next) : null;
    });
  }

  function close() {
    if (busy) return;
    pick(null);
    form.reset();
    onOpenChange(false);
  }

  async function submit(values: Values) {
    if (!textOnly && !file) {
      toast.error("File belum dipilih", { description: "Pilih foto, video, atau audio dulu." });
      return;
    }
    if (textOnly && !(values.caption || "").trim()) {
      toast.error("Teks belum diisi", { description: "Tulis pesan yang ingin disimpan." });
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set("kind", kind);
      if (!textOnly && file) {
        body.set("media_type", guessMedia(file));
        body.set("file", file, file.name);
      } else {
        body.set("media_type", "text");
      }
      body.set("sender", (values.sender || "").trim());
      body.set("sender_name", (values.sender_name || "").trim());
      body.set("caption", (values.caption || "").trim());
      const res = await fetch("/api/upload", { method: "POST", body });
      const payload = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "Upload gagal.");
      toast.success("Arsip tersimpan");
      pick(null);
      form.reset();
      onOpenChange(false);
      onUploaded();
    } catch (error) {
      toast.error("Upload gagal", { description: error instanceof Error ? error.message : "Coba lagi." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !next && close()} title="Unggah arsip" description="File disimpan ke arsip ini.">
      <form className="upload-body" onSubmit={form.handleSubmit(submit)}>
        {!textOnly && (
          <div
            className={dragOver ? "dropzone dropzone--over" : "dropzone"}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0] || null); }}
          >
            {file ? (
              <div className="dropzone__file">
                {previewUrl && file.type.startsWith("image/") && <img src={previewUrl} alt="" />}
                {previewUrl && file.type.startsWith("video/") && <video src={previewUrl} muted playsInline />}
                <div>
                  <strong>{file.name}</strong>
                  <span>{(file.size / 1024).toFixed(0)} KB, {file.type || "tipe tidak dikenal"}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => pick(null)} aria-label="Hapus file">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <label className="dropzone__empty">
                <ImagePlus size={22} aria-hidden="true" />
                <strong>Seret file ke sini atau klik untuk memilih</strong>
                <span>JPG, PNG, WebP, MP4, OGG, MP3. Maksimal 4 MB.</span>
                <input
                  type="file"
                  accept={ACCEPTS.join(",")}
                  className="sr-only"
                  onChange={(e) => pick(e.target.files?.[0] || null)}
                />
              </label>
            )}
          </div>
        )}
        <div className="field">
          <label htmlFor="upload-sender">Nama pengirim</label>
          <input id="upload-sender" className="field-input" placeholder="Nama kontak" autoComplete="off" {...form.register("sender_name")} />
        </div>
        <div className="field">
          <label htmlFor="upload-number">Nomor</label>
          <input id="upload-number" className="field-input" placeholder="62812..." autoComplete="off" inputMode="tel" {...form.register("sender")} />
        </div>
        <div className="field">
          <label htmlFor="upload-caption">{textOnly ? "Isi pesan" : "Caption"}</label>
          <textarea
            id="upload-caption"
            className="field-input field-area"
            rows={3}
            maxLength={1000}
            placeholder={textOnly ? "Tulis pesan yang dihapus..." : "Tulis caption..."}
            {...form.register("caption")}
          />
          {form.formState.errors.caption && <span className="field-error">{form.formState.errors.caption.message}</span>}
        </div>
        <div className="modal-actions">
          <ActionButton type="button" variant="ghost" onClick={close} disabled={busy}>Batal</ActionButton>
          <ActionButton type="submit" variant="primary" disabled={busy}>
            {busy ? <LoaderCircle className="action-button__spinner" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
            <span>{busy ? "Mengunggah" : "Simpan arsip"}</span>
          </ActionButton>
        </div>
      </form>
    </Modal>
  );
}
