import { handlers } from "@/auth";

// Auth.js mounts every sign-in / callback / signout / session / csrf
// endpoint under /api/auth/* through this catch-all.
export const { GET, POST } = handlers;
