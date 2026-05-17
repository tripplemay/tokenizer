import { FaApple, FaLinux, FaWindows } from "react-icons/fa";
import { MdComputer } from "react-icons/md";

// Renders a small platform glyph based on the Device.platform string the
// agent reports (darwin / linux / win32 / etc). Falls back to a generic
// monitor icon so unknown platforms still get a visual anchor.
export function PlatformIcon({ platform, className = "h-3.5 w-3.5" }: { platform: string | null | undefined; className?: string }) {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("darwin") || p.includes("mac")) return <FaApple className={`${className} text-gray-500 dark:text-gray-400`} />;
  if (p.includes("linux")) return <FaLinux className={`${className} text-gray-500 dark:text-gray-400`} />;
  if (p.includes("win")) return <FaWindows className={`${className} text-gray-500 dark:text-gray-400`} />;
  return <MdComputer className={`${className} text-gray-400`} />;
}
