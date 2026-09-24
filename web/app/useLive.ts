"use client";

import { useEffect, useRef, useState } from "react";
import type { ArchiveItem } from "@/types/archive";

const POLL_INTERVAL = 3000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useLiveFeed(kind: string, onBatch: (items: ArchiveItem[]) => void, seed = 0) {
  const [connected, setConnected] = useState(false);
  const callback = useRef(onBatch);
  callback.current = onBatch;

  useEffect(() => {
    let stopped = false;
    let current = seed;

    async function poll() {
      while (!stopped) {
        try {
          const response = await fetch(`/api/events?kind=${encodeURIComponent(kind)}&since=${current}`, { cache: "no-store" });
          if (!response.ok) throw new Error(String(response.status));
          const payload = await response.json() as { items?: ArchiveItem[]; latest?: number };
          setConnected(true);
          if (!current) {
            current = payload.latest || 0;
          } else if (payload.items?.length) {
            current = Math.max(current, ...payload.items.map((item) => item.id));
            callback.current(payload.items);
          } else if (payload.latest) {
            current = Math.max(current, payload.latest);
          }
        } catch {
          setConnected(false);
        }
        await wait(POLL_INTERVAL);
      }
    }

    void poll();
    return () => { stopped = true; };
  }, [kind]);

  return connected;
}
