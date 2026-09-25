"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion } from "framer-motion";
import { ChevronDown, CircleUserRound, Eye, Images, LogOut, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "ViewOnce", short: "ViewOnce", icon: Eye },
  { href: "/status", label: "Status", short: "Status", icon: Images },
  { href: "/dihapus", label: "Pesan Dihapus", short: "Dihapus", icon: Trash2 },
] as const;

type ShellProps = { children: React.ReactNode };

export default function Shell({ children }: ShellProps) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [accountOpen, setAccountOpen] = useState(false);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string) => pathname === href;
  const isSettings = pathname === "/pengaturan";

  return (
    <div className="console-shell">
      <a className="skip-link" href="#main-content">Lewati ke konten</a>

      <motion.aside
        className="console-sidebar"
        initial={false}
        aria-label="Navigasi utama"
      >
        <div className="brand-lockup brand-lockup--v2">
          <div className="brand-symbol" aria-hidden="true"><span>WA</span></div>
          <div>
            <div className="brand-name">WA Console</div>
          </div>
        </div>

        <div className="sidebar-rule" />
        <nav className="sidebar-nav" aria-label="Arsip">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={cn("sidebar-link", isActive(href) && "sidebar-link--active")} aria-current={isActive(href) ? "page" : undefined}>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
              {isActive(href) && <motion.span layoutId="nav-active" className="sidebar-link__indicator" aria-hidden="true" />}
            </Link>
          ))}
        </nav>

        <nav className="sidebar-nav" aria-label="Sistem">
          <Link href="/pengaturan" className={cn("sidebar-link", isSettings && "sidebar-link--active")} aria-current={isSettings ? "page" : undefined}>
            <Settings size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>Pengaturan</span>
            {isSettings && <motion.span layoutId="nav-active" className="sidebar-link__indicator" aria-hidden="true" />}
          </Link>
        </nav>

        <div className="sidebar-spacer" />
        <DropdownMenu.Root open={accountOpen} onOpenChange={setAccountOpen}>
          <DropdownMenu.Trigger asChild>
            <button className="account-trigger" type="button" aria-label="Menu akun">
              <CircleUserRound size={18} aria-hidden="true" />
              <span>Owner</span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="account-menu" sideOffset={8} align="start">
              <DropdownMenu.Label className="account-menu__label">WA Console</DropdownMenu.Label>
              <DropdownMenu.Item className="account-menu__item" onSelect={() => router.push("/pengaturan")}>
                <Settings size={15} aria-hidden="true" /> Pengaturan
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="account-menu__separator" />
              <DropdownMenu.Item className="account-menu__item account-menu__item--danger" onSelect={logout}>
                <LogOut size={15} aria-hidden="true" /> Keluar
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </motion.aside>

      <div className="mobile-topbar">
        <Link href="/" className="mobile-brand" aria-label="WA Console beranda">
          <span className="mobile-brand__mark">WA</span>
          <span>WA Console</span>
        </Link>
      </div>

      <main id="main-content" className="console-main">
        {children}
      </main>

      <nav className="console-bottomnav" aria-label="Navigasi utama mobile">
        {NAV.map(({ href, short, icon: Icon }) => (
          <Link key={href} href={href} className={cn("bottom-link", isActive(href) && "bottom-link--active")} aria-current={isActive(href) ? "page" : undefined}>
            <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
            <span>{short}</span>
          </Link>
        ))}
        <Link href="/pengaturan" className={cn("bottom-link", isSettings && "bottom-link--active")} aria-current={isSettings ? "page" : undefined}>
          <Settings size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>Atur</span>
        </Link>
        <button className="bottom-link bottom-link--logout" type="button" onClick={logout}>
          <LogOut size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>Keluar</span>
        </button>
      </nav>
    </div>
  );
}
