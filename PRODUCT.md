# Product

<!-- uizze:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router, TailwindCSS, Framer Motion, GSAP, Lucide Icons, Sonner, TanStack Query, Zustand, Radix UI, React Hook Form, Zod.

## Users

Satu admin pribadi. Ia memakai dashboard untuk mengarsipkan, mencari, melihat, mengunduh, mengedit caption, dan menghapus arsip WhatsApp.

## Product Purpose

WA Console menjadi alat kerja privat untuk menerima dan mengelola data dari bot WhatsApp. Bot menjadi sumber data; dashboard menjadi tempat kerja utama untuk melihat arsip ViewOnce, status, dan pesan yang dihapus.

## Positioning

Arsip WhatsApp privat dengan login dua tahap, data live, dan media privat. Bukan landing page, directory, atau produk SaaS publik.

## Operating Context

- Dashboard berjalan sebagai aplikasi web private.
- Data masuk dari bot WhatsApp melalui webhook.
- Media disimpan pada object storage; metadata pada database.
- Login menggunakan username/password, lalu token 6 digit yang dikirim bot ke WhatsApp owner.
- Live update memakai polling endpoint yang sudah ada.
- Pengguna bekerja pada desktop dan ponsel.

## Capabilities and Constraints

- Satu admin; tidak ada signup publik.
- Halaman: login, ViewOnce, Status, Pesan Dihapus, Pengaturan.
- Arsip dapat dicari, difilter, dipreview, diunduh, diedit caption-nya, dan dihapus permanen.
- State penting: loading, empty, error, success, live item baru, modal, dan fokus keyboard.
- API bot, auth, schema data, dan object storage harus tetap kompatibel.
- Tidak ada fitur AI atau panggilan LLM.
- Target aksesibilitas: keyboard, label, focus visible, target sentuh minimal 44px.

## Brand Commitments

- Nama: WA Console.
- Tagline: Private WhatsApp Archive Console.
- Karakter: private, cepat, fungsional, tenang.
- Visual commitment: terminal modern, dark tool, peach accent, tanpa marketing UI, statistik palsu, testimonial, FAQ, atau gradient dekoratif tanpa alasan.

## Evidence on Hand

- Source bot dan kontrak webhook berada di repository root.
- Source dashboard lama berada di `web/` sebagai referensi kontrak dan data.
- Tidak ada testimonial, statistik, atau klaim marketing yang boleh dicampur ke UI.

## Product Principles

- Fokus pada tugas arsip, bukan dekorasi.
- Satu admin, sedikit state, sedikit navigasi.
- Live dan dapat diprediksi.
- Private by default.
- Error selalu menjelaskan jalan keluarnya.

## Accessibility & Inclusion

- Gunakan semantic HTML, label form, keyboard support, focus ring peach, kontras AA, dan target sentuh minimal 44px.
- Semua media punya fallback teks atau metadata yang dapat dibaca.
- Animasi hormati `prefers-reduced-motion`.
