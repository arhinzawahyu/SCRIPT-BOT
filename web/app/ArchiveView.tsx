"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { FileSearch, Images, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Trash2, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ArchiveItem, ArchiveKind, MediaType } from "@/types/archive";
import { deleteArchive, fetchArchive } from "@/lib/archive-api";
import { useArchiveStore } from "@/lib/archive-store";
import { formatBytes, formatDate, senderLabel, cn } from "@/lib/utils";
import { useLiveFeed } from "./useLive";
import ArchiveCard from "@/components/ArchiveCard";
import ActionButton from "@/components/ActionButton";
import Modal from "@/components/Modal";
import { DoodleBuddy } from "@/components/Doodles";

const PAGE_SIZE = 30;
const FILTERS: Array<{ value: MediaType | "all"; label: string }> = [
  { value: "all", label: "Semua" },
  { value: "image", label: "Foto" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
];
const KIND_LABEL: Record<ArchiveKind, string> = {
  viewonce: "Media sekali lihat",
  status: "Status WhatsApp",
  delete: "Log pesan dihapus",
};
const KIND_VARIANT: Record<ArchiveKind, "shield" | "box" | "note"> = {
  viewonce: "shield",
  status: "box",
  delete: "note",
};
const KIND_ACCENT_WORD: Record<ArchiveKind, string> = {
  viewonce: "ViewOnce",
  status: "Status",
  delete: "Dihapus",
};

type Props = { kind: ArchiveKind; title: string; description: string; emptyTitle: string };

function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function SkeletonGrid({ text }: { text: boolean }) {
  return (
    <div className={cn("archive-grid", text && "archive-grid--logs")} aria-label="Memuat arsip" aria-busy="true">
      {Array.from({ length: text ? 4 : 8 }, (_, index) => (
        <div className="archive-skeleton" key={index} style={{ animationDelay: `${index * 70}ms` }}><i /><span /><span /><b /></div>
      ))}
    </div>
  );
}

function EmptyState({ title, kind, filtered }: { title: string; kind: ArchiveKind; filtered: boolean }) {
  const copy = filtered
    ? "Tidak ada arsip yang cocok dengan pencarian atau filter aktif. Coba reset filter di bawah toolbar."
    : kind === "viewonce"
      ? "Belum ada media. Balas media sekali lihat dari WhatsApp; file akan muncul di sini otomatis."
      : kind === "status"
        ? "Belum ada status. Aktifkan auto-read di bot; kiriman baru akan terkumpul di sini."
        : "Belum ada log. Pesan yang dihapus akan tersimpan di sini bila anti-delete aktif.";
  return (
    <div className="empty-stage">
      <DoodleBuddy title={filtered ? "Maskot kebingungan mencari arsip" : "Maskot menunggu arsip pertama"} variant={filtered ? "ghost" : KIND_VARIANT[kind]} shy={filtered} />
      <h2>{filtered ? "Arsip tidak ditemukan" : title}</h2>
      <p>{copy}</p>
      <span className="empty-state__hint token-pill token-pill--dim"><span className="token-dot token-dot--peach" />Kiriman baru tampil otomatis tanpa refresh</span>
    </div>
  );
}

function Preview({ item }: { item: ArchiveItem }) {
  return (
    <div className="preview-wrap">
      {item.media_type === "image" && <img className="preview-media" src={`/api/items/${item.id}/file`} alt={item.caption || `Arsip dari ${senderLabel(item)}`} />}
      {item.media_type === "video" && <video className="preview-media" src={`/api/items/${item.id}/file`} controls autoPlay playsInline aria-label={`Video dari ${senderLabel(item)}`} />}
      {item.media_type === "audio" && <div className="audio-preview"><Volume2 size={28} aria-hidden="true" /><audio src={`/api/items/${item.id}/file`} controls autoPlay /></div>}
      {item.media_type === "text" && <div className="preview-text-message">{item.caption || "Pesan tidak memiliki caption."}</div>}
      <div className="preview-details">
        <div><span className="preview-label">Pengirim</span><strong>{senderLabel(item)}</strong><span>{item.sender || "—"}</span></div>
        <div><span className="preview-label">Waktu</span><strong>{formatDate(item.created_at)}</strong><span>{formatBytes(item.size)}</span></div>
      </div>
      {item.caption && item.media_type !== "text" && <p className="preview-caption">{item.caption}</p>}
      {item.media_type !== "text" && <a className="action-button action-button--secondary" href={`/api/items/${item.id}/file?download=1`}><span>Unduh media</span></a>}
    </div>
  );
}

function splitTitle(title: string, accent: string) {
  const i = title.indexOf(accent);
  if (i < 0) return <>{title}</>;
  return <>{title.slice(0, i)}<em>{accent}</em>{title.slice(i + accent.length)}</>;
}

export default function ArchiveView({ kind, title, description, emptyTitle }: Props) {
  const queryClient = useQueryClient();
  const query = useArchiveStore((state) => state.query);
  const filter = useArchiveStore((state) => state.filter);
  const editingId = useArchiveStore((state) => state.editingId);
  const preview = useArchiveStore((state) => state.preview);
  const deleting = useArchiveStore((state) => state.deleting);
  const setQuery = useArchiveStore((state) => state.setQuery);
  const setFilter = useArchiveStore((state) => state.setFilter);
  const setEditingId = useArchiveStore((state) => state.setEditingId);
  const setPreview = useArchiveStore((state) => state.setPreview);
  const setDeleting = useArchiveStore((state) => state.setDeleting);
  const debouncedQuery = useDebounced(query, 300);
  const [freshId, setFreshId] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const isText = kind === "delete";
  const hasActiveFilter = Boolean(query.trim()) || filter !== "all";

  useEffect(() => {
    setQuery("");
    setFilter("all");
    setEditingId(null);
    setPreview(null);
    setDeleting(null);
    setFreshId(null);
    setAnnouncement("");
  }, [kind, setDeleting, setEditingId, setFilter, setPreview, setQuery]);

  const archiveQuery = useInfiniteQuery({
    queryKey: ["archive", kind, debouncedQuery, filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchArchive(kind, debouncedQuery, pageParam as number, PAGE_SIZE, filter),
    getNextPageParam: (lastPage, pages) => pages.length * PAGE_SIZE < lastPage.total ? pages.length * PAGE_SIZE : undefined,
  });

  const live = useLiveFeed(kind, (items) => {
    const latest = items[items.length - 1];
    if (!latest) return;
    setFreshId(latest.id);
    setAnnouncement(`Arsip baru dari ${senderLabel(latest)} masuk ke ${KIND_LABEL[kind]}.`);
    void queryClient.invalidateQueries({ queryKey: ["archive", kind] });
    window.setTimeout(() => setFreshId((current) => current === latest.id ? null : current), 2200);
  });

  const deleteMutation = useMutation({
    mutationFn: deleteArchive,
    onSuccess: () => {
      setDeleting(null);
      setFreshId(null);
      void queryClient.invalidateQueries({ queryKey: ["archive", kind] });
      toast.success("Arsip dihapus");
    },
    onError: (error) => toast.error("Gagal menghapus arsip", { description: error.message }),
  });

  const items = useMemo(() => archiveQuery.data?.pages.flatMap((page) => page.items) || [], [archiveQuery.data]);
  const total = archiveQuery.data?.pages[0]?.total ?? 0;
  const shown = items;
  const activeFilterLabel = FILTERS.find((item) => item.value === filter)?.label;

  return (
    <motion.div className="archive-page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25, ease: [0.22, 1, 0.36, 1] }}>
      {/* HERO — doodle + judul + token pills + angka total */}
      <header className="archive-hero">
        <div className="archive-hero__mascot">
          <DoodleBuddy title={`Maskot ${KIND_LABEL[kind]} — arahkan kursor, matanya mengikuti`} variant={KIND_VARIANT[kind]} />
        </div>
        <div className="archive-hero__body">
          <div className="archive-header__context">
            <span className={cn("live-indicator", live && "live-indicator--active")}><span aria-hidden="true" />{live ? "Live" : "Menghubungkan"}</span>
            <span className="context-divider" aria-hidden="true" />
            {KIND_LABEL[kind]}
          </div>
          <h1 className="archive-hero__title">{splitTitle(title, KIND_ACCENT_WORD[kind])}</h1>
          <p className="archive-hero__desc">{description}</p>
          <div className="archive-hero__pills" aria-label="Ringkasan status">
            <span className={cn("token-pill", live ? "token-pill--live" : "token-pill--dim")}>
              <span className="token-dot" aria-hidden="true" />{live ? "Live sync aktif" : "Menghubungkan…"}
            </span>
            <span className="token-pill token-pill--accent">
              <ShieldCheck size={13} aria-hidden="true" /><span className="token-count">{archiveQuery.isPending ? "—" : total}</span>&nbsp;arsip private
            </span>
            <span className="token-pill token-pill--dim">
              <Images size={13} aria-hidden="true" />{activeFilterLabel && activeFilterLabel !== "Semua" ? `Filter: ${activeFilterLabel}` : "Semua media"}
            </span>
          </div>
        </div>
        <div className="archive-hero__side" aria-label={`${total} arsip tersimpan`}>
          <div className="archive-hero__bignum">{archiveQuery.isPending ? "—" : total}<small>Total arsip</small></div>
          <span className="archive-hero__secure"><LockKeyhole size={12} aria-hidden="true" />Sesi private</span>
        </div>
      </header>

      <div className="archive-toolbar-wrap">
        <form className="archive-toolbar" role="search" onSubmit={(event) => event.preventDefault()}>
          <div className="search-field">
            <Search size={17} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nama, nomor, caption" aria-label="Cari arsip" />
            {query && <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Hapus pencarian"><X size={15} aria-hidden="true" /></button>}
          </div>
          {!isText && <div className="filter-group" role="group" aria-label="Filter jenis media">
            <SlidersHorizontal size={15} aria-hidden="true" />
            {FILTERS.map((item) => <button type="button" key={item.value} className={cn("filter-button", filter === item.value && "filter-button--active")} onClick={() => setFilter(item.value)} aria-pressed={filter === item.value}>{item.label}</button>)}
          </div>}
          {hasActiveFilter && <ActionButton type="button" size="sm" variant="ghost" onClick={() => { setQuery(""); setFilter("all"); }}><X size={14} aria-hidden="true" /> Reset</ActionButton>}
        </form>
      </div>

      <div className="archive-statusline" aria-live="polite">
        <span>{archiveQuery.isFetching && !archiveQuery.isFetchingNextPage ? "Memuat arsip..." : `${shown.length} tampil${total > items.length ? ` dari ${total}` : ""}`}</span>
        <span className="archive-statusline__context">{activeFilterLabel && activeFilterLabel !== "Semua" ? `Filter: ${activeFilterLabel}` : "Semua media"}{hasActiveFilter && query.trim() ? ` · “${query.trim()}”` : ""}</span>
        {archiveQuery.isFetchingNextPage && <span className="inline-loading"><LoaderCircle size={13} aria-hidden="true" /> Memuat halaman berikutnya</span>}
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>

      {archiveQuery.isPending && <SkeletonGrid text={isText} />}
      {archiveQuery.isError && <div className="error-state" role="alert"><div className="error-state__icon"><X size={20} aria-hidden="true" /></div><div><h2>Arsip tidak dapat dimuat</h2><p>{archiveQuery.error.message}</p></div><ActionButton size="sm" onClick={() => void archiveQuery.refetch()}><RefreshCw size={14} aria-hidden="true" /> Coba lagi</ActionButton></div>}
      {archiveQuery.isSuccess && shown.length === 0 && <EmptyState title={emptyTitle} kind={kind} filtered={hasActiveFilter} />}

      {shown.length > 0 && (
        <>
          <div className="doodle-divider" aria-hidden="true">
            <FileSearch size={13} />Koleksi · {shown.length} item<FileSearch size={13} />
          </div>
          <div className={cn("archive-grid", isText && "archive-grid--logs")}>
            {shown.map((item, index) => (
              <ArchiveCard
                key={item.id}
                item={item}
                index={index}
                isText={isText}
                isFresh={freshId === item.id}
                isEditing={editingId === item.id}
                onPreview={() => setPreview(item)}
                onEdit={() => setEditingId(item.id)}
                onDelete={() => setDeleting(item)}
                onEditingDone={() => { setEditingId(null); void queryClient.invalidateQueries({ queryKey: ["archive", kind] }); }}
              />
            ))}
          </div>
        </>
      )}

      {archiveQuery.hasNextPage && <div className="load-more"><ActionButton size="sm" onClick={() => void archiveQuery.fetchNextPage()} loading={archiveQuery.isFetchingNextPage}>Muat 30 arsip lagi</ActionButton></div>}

      <Modal open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)} title="Pratinjau arsip" description={preview ? `${senderLabel(preview)} · ${formatDate(preview.created_at)}` : undefined} className="preview-modal">
        <AnimatePresence mode="wait">
          {preview && <motion.div key={preview.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Preview item={preview} /></motion.div>}
        </AnimatePresence>
      </Modal>

      <Modal open={Boolean(deleting)} onOpenChange={(open) => !open && !deleteMutation.isPending && setDeleting(null)} title="Hapus arsip?" description={deleting ? `${senderLabel(deleting)} · ${formatDate(deleting.created_at)}` : undefined} className="delete-modal">
        <div className="delete-modal__body"><div className="delete-modal__warning"><Trash2 size={18} aria-hidden="true" /><p>Metadata dan media akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.</p></div><div className="modal-actions"><ActionButton variant="ghost" onClick={() => setDeleting(null)} disabled={deleteMutation.isPending}>Batal</ActionButton><ActionButton variant="danger" loading={deleteMutation.isPending} onClick={() => deleting && deleteMutation.mutate(deleting.id)}>Hapus permanen</ActionButton></div></div>
      </Modal>
    </motion.div>
  );
}
