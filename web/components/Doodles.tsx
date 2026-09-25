"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* Mata mengikuti pointer = sinyal "arsip dijaga". Kedip = penanda hidup. Keduanya ambient, bukan kontrol. */

function useDoodleFace() {
  const ref = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const cl = (v: number, m: number) => Math.max(-m, Math.min(m, v));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() =>
        setLook({ x: cl((e.clientX - cx) / r.width, 1), y: cl((e.clientY - cy) / r.height, 1) }),
      );
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let t1: number, t2: number;
    const loop = () => {
      t1 = window.setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        t2 = window.setTimeout(() => {
          if (!alive) return;
          setBlink(false);
          loop();
        }, 140);
      }, 2200 + Math.random() * 2800);
    };
    loop();
    return () => {
      alive = false;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  return { ref, look, blink };
}

function Eyes({ look, blink }: { look: { x: number; y: number }; blink: boolean }) {
  const px = look.x * 3.2;
  const py = look.y * 2.6;
  const sy = blink ? 0.08 : 1;
  const t = { transform: `scaleY(${sy})`, transition: "transform 120ms ease" } as const;
  return (
    <g>
      <g style={{ ...t, transformOrigin: "38px 44px" }}>
        <ellipse cx="38" cy="44" rx="9.5" ry="11" fill="#fff" stroke="#1c1310" strokeWidth="2.4" />
        {!blink && (
          <g>
            <circle cx={38 + px} cy={44 + py} r="4.4" fill="#1c1310" />
            <circle cx={38 + px - 1.4} cy={44 + py - 1.6} r="1.5" fill="#fff" />
          </g>
        )}
      </g>
      <g style={{ ...t, transformOrigin: "66px 44px" }}>
        <ellipse cx="66" cy="44" rx="9.5" ry="11" fill="#fff" stroke="#1c1310" strokeWidth="2.4" />
        {!blink && (
          <g>
            <circle cx={66 + px} cy={44 + py} r="4.4" fill="#1c1310" />
            <circle cx={66 + px - 1.4} cy={44 + py - 1.6} r="1.5" fill="#fff" />
          </g>
        )}
      </g>
    </g>
  );
}

function Sparkles({ color = "#ffb38a" }: { color?: string }) {
  return (
    <g stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 18 l0 8 M8 22 l8 0" />
      <path d="M90 16 l0 7 M86.5 19.5 l7 0" />
      <circle cx="92" cy="72" r="2.2" fill={color} stroke="none" />
      <circle cx="10" cy="68" r="1.7" fill={color} stroke="none" />
    </g>
  );
}

type BuddyProps = {
  variant?: "shield" | "box" | "ghost" | "note";
  shy?: boolean;
  className?: string;
};

/* Figur dekoratif: aria-hidden, tidak focusable, tidak bisa diklik. Informasi sudah ada di judul halaman. */
export function DoodleBuddy({ variant = "shield", shy = false, className }: BuddyProps) {
  const { ref, look, blink } = useDoodleFace();
  const bodyFill =
    variant === "shield" ? "#ffd0b3" : variant === "ghost" ? "#e8e8ef" : variant === "note" ? "#ffe9c9" : "#ffcfae";
  const bodyStroke = "#1c1310";

  return (
    <div ref={ref} aria-hidden="true" className={cn("doodle", `doodle--${variant}`, className)}>
      <svg viewBox="0 0 104 92" width="100%" height="100%" aria-hidden="true">
        <ellipse cx="52" cy="84" rx="26" ry="5.5" fill="rgba(0,0,0,.32)" />
        {variant === "shield" && (
          <path
            d="M52 6 C66 10 78 12 80 13 C80 34 74 58 52 74 C30 58 24 34 24 13 C26 12 38 10 52 6 Z"
            fill={bodyFill}
            stroke={bodyStroke}
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
        )}
        {variant === "box" && (
          <g>
            <path
              d="M20 26 L52 14 L84 26 L84 66 L52 78 L20 66 Z"
              fill={bodyFill}
              stroke={bodyStroke}
              strokeWidth="2.6"
              strokeLinejoin="round"
            />
            <path d="M20 26 L52 38 L84 26 M52 38 L52 78" fill="none" stroke={bodyStroke} strokeWidth="2.2" strokeLinejoin="round" />
          </g>
        )}
        {variant === "ghost" && (
          <path
            d="M28 76 L28 42 C28 24 40 12 52 12 C64 12 76 24 76 42 L76 76 L68 69 L61 76 L53 69 L46 76 L39 69 L34 74 Z"
            fill={bodyFill}
            stroke={bodyStroke}
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
        )}
        {variant === "note" && (
          <g>
            <path
              d="M30 10 L66 10 L80 24 L80 76 L30 76 Z"
              fill={bodyFill}
              stroke={bodyStroke}
              strokeWidth="2.6"
              strokeLinejoin="round"
            />
            <path d="M66 10 L66 24 L80 24" fill="none" stroke={bodyStroke} strokeWidth="2.4" strokeLinejoin="round" />
            <path d="M38 44 L66 44 M38 52 L66 52 M38 60 L58 60" stroke={bodyStroke} strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
          </g>
        )}
        <ellipse cx="29" cy="58" rx="5" ry="3.4" fill="#ff8a7a" opacity=".55" />
        <ellipse cx="75" cy="58" rx="5" ry="3.4" fill="#ff8a7a" opacity=".55" />
        <Eyes look={look} blink={blink} />
        {shy ? (
          <path d="M45 64 Q52 69 59 64" stroke={bodyStroke} strokeWidth="2.6" strokeLinecap="round" fill="none" />
        ) : (
          <path d="M42 64 Q52 71 62 64" stroke={bodyStroke} strokeWidth="2.8" strokeLinecap="round" fill="none" />
        )}
        <Sparkles />
        {shy && <path d="M30 30 L44 33 M60 33 L74 30" stroke={bodyStroke} strokeWidth="2.4" strokeLinecap="round" />}
      </svg>
    </div>
  );
}

/* Penjaga login: menutup mata saat password diketik sebagai isyarat privasi. Dekoratif, bukan kontrol. */
export function LoginGuard({ hiding, peeking, className }: { hiding: boolean; peeking: boolean; className?: string }) {
  const { ref, look, blink } = useDoodleFace();
  return (
    <div
      ref={ref}
      role="img"
      aria-label={hiding ? "Penjaga menutup mata saat password diketik" : "Penjaga login"}
      className={cn("doodle doodle--guard", className)}
    >
      <svg viewBox="0 0 120 96" width="100%" height="100%" aria-hidden="true">
        <ellipse cx="60" cy="88" rx="30" ry="6" fill="rgba(0,0,0,.32)" />
        <path d="M22 52 C22 28 38 12 60 12 C82 12 98 28 98 52 L92 58 L28 58 Z" fill="#1e1e24" stroke="#ffb38a" strokeWidth="2.4" strokeLinejoin="round" />
        <rect x="50" y="4" width="20" height="12" rx="4" fill="#ffb38a" stroke="#1c1310" strokeWidth="2.2" />
        <rect x="28" y="54" width="64" height="30" rx="14" fill="#ffd0b3" stroke="#1c1310" strokeWidth="2.6" />
        <ellipse cx="43" cy="72" rx="5.4" ry="3.4" fill="#ff8a7a" opacity=".55" />
        <ellipse cx="77" cy="72" rx="5.4" ry="3.4" fill="#ff8a7a" opacity=".55" />
        {hiding ? (
          <g>
            <ellipse cx="43" cy="65" rx="10" ry="7.5" fill="#fff7ef" stroke="#1c1310" strokeWidth="2.4" />
            <ellipse cx="77" cy="65" rx="10" ry="7.5" fill="#fff7ef" stroke="#1c1310" strokeWidth="2.4" />
            <path d="M35 62 L51 68 M37 68 L49 62 M69 62 L85 68 M71 68 L83 62" stroke="#1c1310" strokeWidth="2" strokeLinecap="round" />
            <path d="M52 76 Q60 80 68 76" stroke="#1c1310" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          </g>
        ) : (
          <g>
            <g style={{ transformOrigin: "46px 65px", transform: `scaleY(${blink ? 0.08 : 1})`, transition: "transform 120ms ease" }}>
              <ellipse cx="46" cy="65" rx="7.5" ry="8.6" fill="#fff" stroke="#1c1310" strokeWidth="2.3" />
              {!blink && (
                <g>
                  <circle cx={46 + look.x * 2.8} cy={65 + look.y * 2.2} r="3.6" fill="#1c1310" />
                  <circle cx={46 + look.x * 2.8 - 1} cy={64 + look.y * 2.2} r="1.2" fill="#fff" />
                </g>
              )}
            </g>
            <g style={{ transformOrigin: "74px 65px", transform: `scaleY(${blink ? 0.08 : 1})`, transition: "transform 120ms ease" }}>
              <ellipse cx="74" cy="65" rx="7.5" ry="8.6" fill="#fff" stroke="#1c1310" strokeWidth="2.3" />
              {!blink && (
                <g>
                  <circle cx={74 + look.x * 2.8} cy={65 + look.y * 2.2} r="3.6" fill="#1c1310" />
                  <circle cx={74 + look.x * 2.8 - 1} cy={64 + look.y * 2.2} r="1.2" fill="#fff" />
                </g>
              )}
            </g>
            {peeking ? (
              <path d="M50 76 Q60 84 70 76 Q66 82 60 83 Q54 82 50 76 Z" fill="#1c1310" />
            ) : (
              <path d="M52 76 Q60 81 68 76" stroke="#1c1310" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            )}
          </g>
        )}
        <g stroke="#ffb38a" strokeWidth="2.4" strokeLinecap="round">
          <circle cx="60" cy="88" r="5" fill="none" />
          <path d="M60 83 L60 78 M60 88 L60 96 M60 93 L64 93" />
        </g>
        <g stroke="#ffb38a" strokeWidth="2" strokeLinecap="round">
          <path d="M10 30 l0 7 M6.5 33.5 l7 0" />
          <path d="M108 26 l0 7 M104.5 29.5 l7 0" />
        </g>
      </svg>
    </div>
  );
}
