export type ArchiveKind = "viewonce" | "status" | "delete";
export type MediaType = "image" | "video" | "audio" | "text";

export type ArchiveItem = {
  id: number;
  kind?: ArchiveKind;
  media_type: MediaType;
  sender: string;
  sender_name: string;
  caption: string;
  mime?: string;
  size: number | null;
  created_at: string;
};

export type ArchiveResponse = {
  items: ArchiveItem[];
  total: number;
};
