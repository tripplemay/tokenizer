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
import { countOutdatedDevices, INSTALL_COMMAND } from "@/server/agent-version";

export const metadata: Metadata = {
  title: "Tokenizer",
  description: "Coding token usage tracker"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const session = await auth();
  const outdatedCount = session?.user?.id
    ? await countOutdatedDevices(session.user.id)
    : 0;
  return (
    <html lang={locale}>
      <body id="root">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthProvider>
            <AdminShell outdatedCount={outdatedCount} installCommand={INSTALL_COMMAND}>
              {children}
            </AdminShell>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
