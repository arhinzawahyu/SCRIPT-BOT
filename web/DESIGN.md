# WA Console Design System

## Product posture

Private. Fast. Functional. Silent.

WA Console adalah alat kerja single-admin, bukan landing page. Setiap layar harus membantu owner menyelesaikan satu pekerjaan: membuka arsip, mencari, melihat, mengedit, atau menghapus.

## Visual language

- Dark operational console; satu peach accent.
- Geist Sans untuk UI, Geist Mono untuk metadata dan identifier.
- Permukaan datar, border tipis, radius 6–24px.
- Shadow hanya untuk lift state dan modal.
- Matrix rain sangat subtle, 3–8% opacity, di belakang panel opaque.
- Tidak ada hero, statistik palsu, testimonial, FAQ, atau gradient dekoratif.

## Tokens

```css
--bg: #09090B;
--surface: #111114;
--surface-raised: #18181B;
--surface-hover: #26262B;
--line: #2A2A30;
--text: #FAFAFA;
--muted: #A1A1AA;
--faint: #71717A;
--faint-readable: #8B8B94;
--accent: #FFB38A;
--accent-strong: #FFC5A5;
--success: #22C55E;
--warning: #F59E0B;
--danger: #EF4444;
```

## Layout

Desktop: sidebar 280px + content fluid. Mobile: top identity bar + content + bottom navigation. Archive grid: 4 columns desktop, 2 tablet, 1 mobile. Deleted messages use a full-width log list.

## Motion

Motion explains state changes, not decoration. Use Framer Motion for page/card enter, Radix for dialogs, GSAP for matrix columns. One live-item highlight lasts 2.2s. All motion respects `prefers-reduced-motion`.

## Components

- `ActionButton`: primary, secondary, ghost, danger; 44px minimum touch target.
- `Modal`: Radix Dialog, focus-managed, dismissible via Escape.
- Archive cards: preview, sender, number, caption, type, size, edit, download, delete.
- Real loading skeleton, empty state, error state, and live state are mandatory.

## Copy

UI Bahasa Indonesia. Empty states retain the product's specified English labels where they are part of the archive vocabulary. No invented metrics or claims.
