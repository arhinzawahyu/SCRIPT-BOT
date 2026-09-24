"use client";

import { motion } from "framer-motion";
import { Download, FileText, Maximize2, Pencil, Play, Trash2, Volume2 } from "lucide-react";
import type { ArchiveItem, MediaType } from "@/types/archive";
import { formatBytes, formatDate, senderLabel, cn } from "@/lib/utils";
import ActionButton from "./ActionButton";
import EditCaptionForm from "./EditCaptionForm";

const MEDIA_LABEL: Record<MediaType, string> = {
  image: "Foto",
  video: "Video",
  audio: "Audio",
  text: "Teks",
};

type Props = {
  item: ArchiveItem;
  isText: boolean;
  isFresh: boolean;
  isEditing: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEditingDone: () => void;
};

function MediaThumb({ item, onPreview }: { item: ArchiveItem; onPreview: () => void }) {
  if (item.media_type === "image") {
    return (
      <button className="archive-thumb" type="button" onClick={onPreview} aria-label={`Perbesar ${senderLabel(item)}`}>
        <img src={`/api/items/${item.id}/file`} alt="" loading="lazy" />
        <span className="thumb-overlay"><Maximize2 size={16} aria-hidden="true" /></span>
      </button>
    );
  }
  if (item.media_type === "video") {
    return (
      <button className="archive-thumb" type="button" onClick={onPreview} aria-label={`Putar ${senderLabel(item)}`}>
        <video src={`/api/items/${item.id}/file`} muted preload="metadata" />
        <span className="thumb-overlay"><Play size={16} fill="currentColor" aria-hidden="true" /></span>
      </button>
    );
  }
  if (item.media_type === "audio") {
    return (
      <button className="archive-thumb archive-thumb--audio" type="button" onClick={onPreview} aria-label={`Putar audio ${senderLabel(item)}`}>
        <span className="audio-glyph"><Volume2 size={22} aria-hidden="true" /></span>
        <span className="audio-bars" aria-hidden="true">{[22, 38, 28, 52, 34, 46, 24].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</span>
        <span className="thumb-label">Audio</span>
      </button>
    );
  }
  return <div className="archive-thumb archive-thumb--text" aria-hidden="true"><FileText size={24} /><span>Teks</span></div>;
}

export default function ArchiveCard({ item, isText, isFresh, isEditing, onPreview, onEdit, onDelete, onEditingDone }: Props) {
  return (
    <motion.article
      layout
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: .18, ease: [0.22, 1, 0.36, 1] }}
      className={cn("archive-card", isFresh && "archive-card--fresh", isText && "archive-card--log")}
    >
      {isText ? (
        <div className="archive-card__log-time">
          <span>{formatDate(item.created_at)}</span>
          <code>#{item.id}</code>
        </div>
      ) : <MediaThumb item={item} onPreview={onPreview} />}
      <div className="archive-card__body">
        <div className="archive-card__heading">
          <div className="archive-card__identity">
            <p className="archive-card__sender">{senderLabel(item)}</p>
            <p className="archive-card__meta">{item.sender || "Nomor tidak tersedia"} {isText && <><span>·</span> {MEDIA_LABEL[item.media_type]}</>}</p>
          </div>
          {isFresh && <span className="new-badge"><span aria-hidden="true" />Baru</span>}
        </div>
        {isEditing ? (
          <EditCaptionForm id={item.id} initialValue={item.caption} onDone={onEditingDone} />
        ) : (
          <p className={cn("archive-card__caption", isText && "archive-card__caption--log", !item.caption && "archive-card__caption--empty")}>{item.caption || "Tanpa caption"}</p>
        )}
        <div className="archive-card__footer">
          <span className="media-type"><span className="media-type__dot" />{MEDIA_LABEL[item.media_type]}</span>
          {item.size ? <span className="archive-card__size">{formatBytes(item.size)}</span> : <span>Metadata saja</span>}
        </div>
        <div className={cn("archive-card__actions", isText && "archive-card__actions--compact")}>
          {!isText && item.media_type !== "text" && <ActionButton size="sm" variant="secondary" onClick={onPreview}><Maximize2 size={14} aria-hidden="true" /> Buka</ActionButton>}
          {item.media_type !== "text" && <a className="action-button action-button--secondary action-button--sm" href={`/api/items/${item.id}/file?download=1`} aria-label={`Unduh media dari ${senderLabel(item)}`}><Download size={14} aria-hidden="true" /><span>Unduh</span></a>}
          <ActionButton size="sm" variant="ghost" onClick={onEdit}><Pencil size={14} aria-hidden="true" /> Ubah</ActionButton>
          <ActionButton size="sm" variant="danger" onClick={onDelete}><Trash2 size={14} aria-hidden="true" /> Hapus</ActionButton>
        </div>
      </div>
    </motion.article>
  );
}
