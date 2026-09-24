"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { updateArchiveCaption } from "@/lib/archive-api";
import { toast } from "sonner";
import ActionButton from "./ActionButton";

const schema = z.object({ caption: z.string().max(1000, "Maksimal 1000 karakter.") });
type Values = z.infer<typeof schema>;

type Props = { id: number; initialValue: string; onDone: () => void };

export default function EditCaptionForm({ id, initialValue, onDone }: Props) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { caption: initialValue },
  });

  async function submit(values: Values) {
    try {
      await updateArchiveCaption(id, values.caption);
      toast.success("Caption disimpan");
      onDone();
    } catch (error) {
      toast.error("Caption gagal disimpan", { description: error instanceof Error ? error.message : "Coba lagi." });
    }
  }

  return (
    <form className="edit-caption" onSubmit={handleSubmit(submit)}>
      <label htmlFor={`caption-${id}`}>Caption</label>
      <textarea
        id={`caption-${id}`}
        rows={3}
        maxLength={1000}
        placeholder="Tanpa caption"
        {...register("caption")}
        aria-invalid={Boolean(errors.caption)}
      />
      {errors.caption && <span className="field-error">{errors.caption.message}</span>}
      <div className="edit-caption__actions">
        <ActionButton type="submit" size="sm" variant="primary" loading={isSubmitting}>Simpan</ActionButton>
        <ActionButton type="button" size="sm" variant="ghost" onClick={onDone} disabled={isSubmitting}>Batal</ActionButton>
      </div>
    </form>
  );
}
