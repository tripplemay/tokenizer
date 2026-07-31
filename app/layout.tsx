import "./globals.css";
import "@/styles/App.css";
import "@/styles/Contact.css";
import "@/styles/MiniCalendar.css";
import "@/styles/index.css";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AdminShell } from "./admin-shell";
import { AuthProvider } from "./session-provider";
import { auth } from "@/auth";
import { getAgentUpdateSummary, INSTALL_COMMANDS } from "@/server/agent-version";
import { latestAgentReleaseHighlights } from "@/shared/agent-release-version";
import { shouldRenderUpgradeBanner, UpgradeBanner } from "./_components/upgrade-banner";

export const metadata: Metadata = {
  title: "Tokenizer",
  description: "Coding token usage tracker"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const session = await auth();
  const updateSummary = session?.user?.id
    ? await getAgentUpdateSummary(session.user.id)
    : null;
  const banner = updateSummary && shouldRenderUpgradeBanner(updateSummary.outdatedCount, updateSummary.unknownCount)
    ? (
      <UpgradeBanner
        outdatedCount={updateSummary.outdatedCount}
        unknownCount={updateSummary.unknownCount}
        latestRelease={updateSummary.latestRelease}
        highlights={latestAgentReleaseHighlights(locale)}
        commands={INSTALL_COMMANDS}
      />
    )
    : null;
  return (
    <html lang={locale}>
      <body id="root">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthProvider>
            <AdminShell banner={banner}>
              {children}
            </AdminShell>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
