"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSession, signOut } from "next-auth/react";
import { FiAlignJustify } from "react-icons/fi";
import { RiMoonFill, RiSunFill } from "react-icons/ri";
import { MdSettings, MdLogout } from "react-icons/md";
import { LocaleSwitcher } from "@/components/locale-switcher";

const Navbar = (props: {
  onOpenSidenav: () => void;
  brandText: string;
  secondary?: boolean | string;
  [x: string]: any;
}) => {
  const { onOpenSidenav, brandText } = props;
  const t = useTranslations();
  const { data: session } = useSession();
  const [darkmode, setDarkmode] = React.useState(false);
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const userMenuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const stored = localStorage.getItem("darkmode");
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const enabled = stored !== null ? stored === "true" : prefersDark;
    setDarkmode(enabled);
    document.documentElement.classList.toggle("dark", enabled);
  }, []);

  // Close user menu on outside click
  React.useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  const toggleDark = () => {
    const next = !darkmode;
    setDarkmode(next);
    localStorage.setItem("darkmode", String(next));
    document.documentElement.classList.toggle("dark", next);
  };

  const title = (() => {
    try {
      return t(brandText);
    } catch {
      return brandText;
    }
  })();

  const userEmail = session?.user?.email ?? "";
  const userInitial = userEmail ? userEmail.charAt(0).toUpperCase() : "?";

  return (
    <nav className="sticky top-4 z-40 flex flex-row flex-wrap items-center justify-between rounded-xl bg-white/10 p-2 backdrop-blur-xl dark:bg-[#0b14374d]">
      <div className="ml-[6px]">
        <p className="shrink text-[26px] font-bold capitalize text-navy-700 dark:text-white">{title}</p>
      </div>

      <div className="relative mt-[3px] flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-xl shadow-shadow-500 dark:!bg-navy-800 dark:shadow-none">
        <button
          type="button"
          onClick={onOpenSidenav}
          aria-label="Open sidebar"
          className="cursor-pointer rounded-full p-1 text-gray-600 hover:text-brand-500 dark:text-white xl:hidden"
        >
          <FiAlignJustify className="h-5 w-5" />
        </button>

        <LocaleSwitcher />

        <button
          type="button"
          onClick={toggleDark}
          aria-label={darkmode ? "Switch to light mode" : "Switch to dark mode"}
          className="cursor-pointer rounded-full p-1 text-gray-600 hover:text-brand-500 dark:text-white"
        >
          {darkmode ? <RiSunFill className="h-4 w-4" /> : <RiMoonFill className="h-4 w-4" />}
        </button>

        <Link
          href="/admin/setup"
          aria-label="Settings"
          className="cursor-pointer rounded-full p-1 text-gray-600 hover:text-brand-500 dark:text-white"
        >
          <MdSettings className="h-5 w-5" />
        </Link>

        {/* User menu — replaces the previous standalone admin gear icon's
            role. Anchored to the navbar's right edge so the dropdown opens
            in a sensible direction regardless of viewport width. */}
        {session?.user ? (
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white shadow transition hover:bg-brand-600"
              aria-label="User menu"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              {userInitial}
            </button>
            {userMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-10 z-50 min-w-[220px] rounded-2xl border border-gray-200 bg-white py-1.5 shadow-xl dark:border-white/10 dark:bg-navy-800"
              >
                <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                  <div className="truncate font-medium text-navy-700 dark:text-white">{userEmail}</div>
                  {session.user.role === "admin" ? (
                    <div className="mt-0.5 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                      管理员
                    </div>
                  ) : null}
                </div>
                <div className="my-1 h-px bg-gray-100 dark:bg-white/10" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5"
                >
                  <MdLogout className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <Link
            href="/login"
            className="ml-1 rounded-full bg-brand-500 px-3 py-1 text-xs font-medium text-white shadow transition hover:bg-brand-600"
          >
            登录
          </Link>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
