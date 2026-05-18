import { redirect } from "next/navigation";

// /admin/login → the magic-link /login flow. The admin-password page is no
// longer in use; every user now signs in via email.
export default function AdminLoginRedirect() {
  redirect("/login");
}
