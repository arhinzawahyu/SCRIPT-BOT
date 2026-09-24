"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

const GLYPHS = [
  "アイウエオカキクケコサシスセソ0123456789",
  "ガギグゲゴザジズゼゾABCDEFXYZ",
  "アカサタナハマヤラワ0987654321",
  "ンヲロヨモホノトソコオルユムフヌ",
];

const COLUMNS = Array.from({ length: 24 }, (_, index) => ({
  left: (index * 3.05) % 100,
  delay: -((index * 1.37) % 10),
  duration: 8 + (index % 5) * 1.7,
  glyphs: GLYPHS[index % GLYPHS.length],
}));

export default function MatrixRain() {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!root.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(".matrix-column").forEach((column, index) => {
        gsap.fromTo(
          column,
          { yPercent: -110, opacity: 0 },
          {
            yPercent: 220,
            opacity: 0.055,
            duration: Number(column.dataset.duration),
            delay: Number(column.dataset.delay),
            repeat: -1,
            ease: "none",
            modifiers: {
              yPercent: gsap.utils.unitize((value) => `${(Number(value) + index * 0.3) % 330 - 110}%`),
            },
          },
        );
      });
    }, root);
    return () => context.revert();
  }, []);

  return (
    <div ref={root} className="matrix-layer" aria-hidden="true">
      {COLUMNS.map((column, index) => (
        <span
          key={index}
          className="matrix-column"
          data-duration={column.duration}
          data-delay={column.delay}
          style={{ left: `${column.left}%`, ["--glyphs" as string]: `"${column.glyphs}"` }}
        />
      ))}
    </div>
  );
}
