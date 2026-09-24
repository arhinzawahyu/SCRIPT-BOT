import type { ArchiveKind, ArchiveResponse, MediaType } from "@/types/archive";

async function readError(response: Response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error || text;
  } catch {
    return text;
  }
}

export async function fetchArchive(kind: ArchiveKind, query: string, offset = 0, limit = 30, mediaType: MediaType | "all" = "all") {
  const params = new URLSearchParams({ kind, q: query, offset: String(offset), limit: String(limit) });
  if (mediaType !== "all") params.set("media_type", mediaType);
  const response = await fetch(`/api/items?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<ArchiveResponse>;
}

export async function updateArchiveCaption(id: number, caption: string) {
  const response = await fetch(`/api/items/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caption }),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function deleteArchive(id: number) {
  const response = await fetch(`/api/items/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
}
