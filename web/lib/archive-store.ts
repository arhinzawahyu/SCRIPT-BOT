"use client";

import { create } from "zustand";
import type { ArchiveItem, MediaType } from "@/types/archive";

type ArchiveStore = {
  query: string;
  filter: MediaType | "all";
  editingId: number | null;
  preview: ArchiveItem | null;
  deleting: ArchiveItem | null;
  setQuery: (query: string) => void;
  setFilter: (filter: MediaType | "all") => void;
  setEditingId: (id: number | null) => void;
  setPreview: (item: ArchiveItem | null) => void;
  setDeleting: (item: ArchiveItem | null) => void;
};

export const useArchiveStore = create<ArchiveStore>((set) => ({
  query: "",
  filter: "all",
  editingId: null,
  preview: null,
  deleting: null,
  setQuery: (query) => set({ query }),
  setFilter: (filter) => set({ filter }),
  setEditingId: (editingId) => set({ editingId }),
  setPreview: (preview) => set({ preview }),
  setDeleting: (deleting) => set({ deleting }),
}));
