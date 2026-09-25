"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Mood = "idle" | "happy" | "shy" | "alert";

function useDoodleFace() {
  const ref = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [mood, setMood] = useState<Mood>("idle");

  useEffect(() => {
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (e.clientX - cx) / r.width;
      const dy = (e.clientY - cy) / r.height;
      const cl = (v: number, m: number) => Math.max(-m, Math.min(m, v));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLook({ x: cl(dx, 1), y: cl(dy, 1) }));
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

  const happy = useCallback(() => setMood("happy"), []);
  const calm = useCallback(() => setMood("idle"), []);

  return { ref, look, blink, mood, setMood, happy, calm };
}

function Eyes({
  look,
  blink,
  happy,
  shy,
}: {
  look: { x: number; y: number };
  blink: boolean;
  happy: boolean;
  shy: boolean;
}) {
  const px = look.x * 3.2;
  const py = look.y * 2.6;
  const eyeScaleY = blink || shy ? 0.08 : happy ? 1.08 : 1;
  return (
    <g>
      {/* mata kiri */}
      <g style={{ transformOrigin: "38px 44px", transform: `scaleY(${eyeScaleY})`, transition: "transform 120ms ease" }}>
        <ellipse cx="38" cy="44" rx="9.5" ry="11" fill="#fff" stroke="#1c1310" strokeWidth="2.4" />
        <circle cx={38 + px} cy={44 + py} r="4.4" fill="#1c1310" />
        <circle cx={38 + px - 1.4} cy={44 + py - 1.6} r="1.5" fill="#fff" />
      </g>
      {/* mata kanan */}
      <g style={{ transformOrigin: "66px 44px", transform: `scaleY(${eyeScaleY})`, transition: "transform 120ms ease" }}>
        <ellipse cx="66" cy="44" rx="9.5" ry="11" fill="#fff" stroke="#1c1310" strokeWidth="2.4" />
        <circle cx={66 + px} cy={44 + py} r="4.4" fill="#1c1310" />
        <circle cx={66 + px - 1.4} cy={44 + py - 1.6} r="1.5" fill="#fff" />
      </g>
    </g>
  );
}

function Mouth({ mood }: { mood: Mood }) {
  if (mood === "happy") {
    return (
      <g>
        <path
          d="M40 62 Q52 76 64 62 Q60 72 52 73 Q44 72 40 62 Z"
          fill="#1c1310"
        />
        <path d="M45 67 Q52 71 59 67" stroke="#ffb38a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      </g>
    );
  }
  if (mood === "shy") {
    return <path d="M45 64 Q52 69 59 64" stroke="#1c1310" strokeWidth="2.6" strokeLinecap="round" fill="none" />;
  }
  if (mood === "alert") {
    return <ellipse cx="52" cy="66" rx="5.2" ry="6.4" fill="#1c1310" />;
  }
  return <path d="M42 64 Q52 71 62 64" stroke="#1c1310" strokeWidth="2.8" strokeLinecap="round" fill="none" />;
}

function Sparkles({ color = "#ffb38a" }: { color?: string }) {
  return (
    <g className="doodle-sparkle" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 18 l0 8 M8 22 l8 0" className="doodle-twinkle" />
      <path d="M90 16 l0 7 M86.5 19.5 l7 0" className="doodle-twinkle doodle-twinkle--late" />
      <circle cx="92" cy="72" r="2.2" fill={color} stroke="none" className="doodle-bob" />
      <circle cx="10" cy="68" r="1.7" fill={color} stroke="none" className="doodle-bob doodle-bob--late" />
    </g>
  );
}

type BuddyProps = {
  title: string;
  variant?: "shield" | "box" | "ghost" | "note";
  shy?: boolean;
  className?: string;
};

/** Maskot doodle interaktif: mata mengikuti kursor, berkedip, mulut bereaksi saat hover/klik. */
export function DoodleBuddy({ title, variant = "shield", shy = false, className }: BuddyProps) {
  const { ref, look, blink, mood, happy, calm, setMood } = useDoodleFace();
  const reduce = useReducedMotion();
  const isHappy = mood === "happy";
  const pop = () => {
    setMood("happy");
    window.setTimeout(() => setMood("idle"), 900);
  };
  const bodyFill = variant === "shield" ? "#ffd0b3" : variant === "ghost" ? "#e8e8ef" : variant === "note" ? "#ffe9c9" : "#ffcfae";
  const bodyStroke = "#1c1310";

  return (
    <div
      ref={ref}
      role="img"
      aria-label={title}
      title={title}
      className={cn("doodle", `doodle--${variant}`, className)}
      onMouseEnter={happy}
      onMouseLeave={calm}
      onFocus={happy}
      onBlur={calm}
      onClick={pop}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pop(); } }}
      tabIndex={0}
    >
      <motion.svg
        viewBox="0 0 104 92"
        width="100%"
        height="100%"
        aria-hidden="true"
        animate={reduce ? undefined : isHappy ? { y: [0, -6, 0], rotate: [0, -2.5, 2, 0] } : { y: [0, -2.4, 0] }}
        transition={isHappy ? { duration: 0.55 } : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* bayangan */}
        <ellipse cx="52" cy="84" rx="26" ry="5.5" fill="rgba(0,0,0,.32)" />
        {/* badan */}
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
        {/* pipi */}
        <ellipse cx="29" cy="58" rx="5" ry="3.4" fill="#ff8a7a" opacity=".55" />
        <ellipse cx="75" cy="58" rx="5" ry="3.4" fill="#ff8a7a" opacity=".55" />
        <Eyes look={look} blink={blink} happy={isHappy} shy={shy} />
        <Mouth mood={shy ? "shy" : isHappy ? "happy" : "idle"} />
        <Sparkles />
        {/* alis waspada saat shy */}
        {shy && <path d="M30 30 L44 33 M60 33 L74 30" stroke={bodyStroke} strokeWidth="2.4" strokeLinecap="round" />}
      </motion.svg>
    </div>
  );
}

/** Penjaga login: menutup mata saat password diketik (mode aman), mengintip saat token. */
export function LoginGuard({ hiding, peeking, className }: { hiding: boolean; peeking: boolean; className?: string }) {
  const { ref, look, blink } = useDoodleFace();
  const [wave, setWave] = useState(0);
  return (
    <div ref={ref} role="img" aria-label={hiding ? "Penjaga menutup mata saat password diketik" : "Penjaga login mengawasi dengan aman"} className={cn("doodle doodle--guard", className)} title="Penjaga private">
      <svg viewBox="0 0 120 96" width="100%" height="100%" aria-hidden="true">
        <ellipse cx="60" cy="88" rx="30" ry="6" fill="rgba(0,0,0,.32)" />
        {/* helm */}
        <path d="M22 52 C22 28 38 12 60 12 C82 12 98 28 98 52 L92 58 L28 58 Z" fill="#1e1e24" stroke="#ffb38a" strokeWidth="2.4" strokeLinejoin="round" />
        <rect x="50" y="4" width="20" height="12" rx="4" fill="#ffb38a" stroke="#1c1310" strokeWidth="2.2" />
        {/* wajah */}
        <rect x="28" y="54" width="64" height="30" rx="14" fill="#ffd0b3" stroke="#1c1310" strokeWidth="2.6" />
        <ellipse cx="43" cy="72" rx="5.4" ry="3.4" fill="#ff8a7a" opacity=".55" />
        <ellipse cx="77" cy="72" rx="5.4" ry="3.4" fill="#ff8a7a" opacity=".55" />
        {hiding ? (
          <g>
            {/* tangan menutup mata */}
            <ellipse cx="43" cy="65" rx="10" ry="7.5" fill="#fff7ef" stroke="#1c1310" strokeWidth="2.4" />
            <ellipse cx="77" cy="65" rx="10" ry="7.5" fill="#fff7ef" stroke="#1c1310" strokeWidth="2.4" />
            <path d="M35 62 L51 68 M37 68 L49 62 M69 62 L85 68 M71 68 L83 62" stroke="#1c1310" strokeWidth="2" strokeLinecap="round" />
            <path d="M52 76 Q60 80 68 76" stroke="#1c1310" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          </g>
        ) : (
          <g>
            <g style={{ transformOrigin: "46px 65px", transform: `scaleY(${blink ? 0.08 : 1})`, transition: "transform 120ms ease" }}>
              <ellipse cx="46" cy="65" rx="7.5" ry="8.6" fill="#fff" stroke="#1c1310" strokeWidth="2.3" />
              <circle cx={46 + look.x * 2.8} cy={65 + look.y * 2.2} r="3.6" fill="#1c1310" />
              <circle cx={46 + look.x * 2.8 - 1} cy={64 + look.y * 2.2} r="1.2" fill="#fff" />
            </g>
            <g style={{ transformOrigin: "74px 65px", transform: `scaleY(${blink ? 0.08 : 1})`, transition: "transform 120ms ease" }}>
              <ellipse cx="74" cy="65" rx="7.5" ry="8.6" fill="#fff" stroke="#1c1310" strokeWidth="2.3" />
              <circle cx={74 + look.x * 2.8} cy={65 + look.y * 2.2} r="3.6" fill="#1c1310" />
              <circle cx={74 + look.x * 2.8 - 1} cy={64 + look.y * 2.2} r="1.2" fill="#fff" />
            </g>
            {peeking ? (
              <path d="M50 76 Q60 84 70 76 Q66 82 60 83 Q54 82 50 76 Z" fill="#1c1310" />
            ) : (
              <path d="M52 76 Q60 81 68 76" stroke="#1c1310" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            )}
          </g>
        )}
        {/* kunci */}
        <g
          className="doodle-key"
          style={{ transformOrigin: "60px 88px", transform: `rotate(${wave}deg)` }}
          onClick={() => setWave((w) => w + 18)}
        >
          <circle cx="60" cy="88" r="5" fill="none" stroke="#ffb38a" strokeWidth="2.4" />
          <path d="M60 83 L60 78 M60 88 L60 96 M60 93 L64 93" stroke="#ffb38a" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <g className="doodle-sparkle" stroke="#ffb38a" strokeWidth="2" strokeLinecap="round">
          <path d="M10 30 l0 7 M6.5 33.5 l7 0" className="doodle-twinkle" />
          <path d="M108 26 l0 7 M104.5 29.5 l7 0" className="doodle-twinkle doodle-twinkle--late" />
        </g>
      </svg>
    </div>
  );
}

/** Mini maskot sidebar — kecil, ringan, tetap bermata-mulut. */
export function MiniBuddy({ className }: { className?: string }) {
  const { ref, look, blink } = useDoodleFace();
  return (
    <div ref={ref} role="img" aria-label="Maskot WA Console" title="Halo! Saya jaga arsipmu." className={cn("doodle doodle--mini", className)}>
      <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
        <rect x="7" y="9" width="34" height="32" rx="11" fill="#ffb38a" stroke="#1c1310" strokeWidth="2.4" />
        <g style={{ transform: `scaleY(${blink ? 0.1 : 1})`, transformOrigin: "24px 24px", transition: "transform 120ms ease" }}>
          <ellipse cx="17.5" cy="24" rx="4.6" ry="5.4" fill="#fff" stroke="#1c1310" strokeWidth="1.9" />
          <ellipse cx="30.5" cy="24" rx="4.6" ry="5.4" fill="#fff" stroke="#1c1310" strokeWidth="1.9" />
          {!blink && (
            <g fill="#1c1310">
              <circle cx={17.5 + look.x * 1.6} cy={24 + look.y * 1.4} r="2.1" />
              <circle cx={30.5 + look.x * 1.6} cy={24 + look.y * 1.4} r="2.1" />
            </g>
          )}
        </g>
        <path d="M18 32 Q24 36.5 30 32" stroke="#1c1310" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <circle cx="13.5" cy="29.5" r="2.1" fill="#ff8a7a" opacity=".7" />
        <circle cx="34.5" cy="29.5" r="2.1" fill="#ff8a7a" opacity=".7" />
      </svg>
    </div>
  );
}
