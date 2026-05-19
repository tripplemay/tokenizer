"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import routes from "@/routes";
import { getActiveRoute, isWindowAvailable } from "@/utils/navigation";
import Navbar from "@/components/navbar";
import Sidebar from "@/components/sidebar";
import Footer from "@/components/footer/Footer";
import { TimezoneReporter } from "./_components/timezone-reporter";
import { UpgradeBanner } from "./_components/upgrade-banner";

export function AdminShell({
  outdatedCount,
  installCommand,
  children,
}: {
  outdatedCount: number;
  installCommand: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  if (isWindowAvailable()) document.documentElement.dir = "ltr";

  // Login routes render full-bleed with their own brand shell — bypass
  // the admin sidebar/navbar so unauthenticated users don't see nav
  // links they can't use.
  if (pathname?.startsWith("/login")) return <>{children}</>;

  return (
    <div className="flex h-full w-full bg-background-100 dark:bg-background-900">
      <Sidebar routes={routes} open={open} setOpen={setOpen} variant="admin" />
      <div className="h-full w-full font-dm dark:bg-navy-900">
        <main className="mx-2.5 flex-none transition-all dark:bg-navy-900 md:pr-2 xl:ml-[323px]">
          <div>
            <Navbar
              onOpenSidenav={() => setOpen(!open)}
              brandText={getActiveRoute(routes, pathname || "/")}
              secondary={false}
            />
            {outdatedCount > 0 && (
              <div className="mx-auto px-2 pt-2 md:px-2">
                <UpgradeBanner count={outdatedCount} command={installCommand} />
              </div>
            )}
            <div className="mx-auto min-h-screen p-2 !pt-[10px] md:p-2">
              {children}
            </div>
            <div className="p-3">
              <Footer />
            </div>
          </div>
        </main>
      </div>
      <TimezoneReporter />
    </div>
  );
}
