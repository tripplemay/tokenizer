import { redirect } from "next/navigation";

// /admin/setup was the legacy enrollment-token UI behind an admin password.
// Multi-tenant moved device management onto /devices itself (the
// AddDeviceSection there embeds the same EnrollFlowCard), so this URL just
// redirects to keep any bookmarks / old links functional.
export default function AdminSetupRedirect() {
  redirect("/devices");
}
