import React from "react";
import Link from "next/link";
import { FiAlignJustify } from "react-icons/fi";
import { RiMoonFill, RiSunFill } from "react-icons/ri";
import { MdSettings } from "react-icons/md";

const Navbar = (props: {
  onOpenSidenav: () => void;
  brandText: string;
  secondary?: boolean | string;
  [x: string]: any;
}) => {
  const { onOpenSidenav, brandText } = props;
  const [darkmode, setDarkmode] = React.useState(false);

  // Sync local toggle state from localStorage / system preference on mount,
  // then apply the .dark class to the <html> element (Tailwind's default
  // darkMode: 'class' target).
  React.useEffect(() => {
    const stored = localStorage.getItem("darkmode");
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const enabled = stored !== null ? stored === "true" : prefersDark;
    setDarkmode(enabled);
    document.documentElement.classList.toggle("dark", enabled);
  }, []);

  const toggleDark = () => {
    const next = !darkmode;
    setDarkmode(next);
    localStorage.setItem("darkmode", String(next));
    document.documentElement.classList.toggle("dark", next);
  };

  return (
    <nav className="sticky top-4 z-40 flex flex-row flex-wrap items-center justify-between rounded-xl bg-white/10 p-2 backdrop-blur-xl dark:bg-[#0b14374d]">
      <div className="ml-[6px]">
        <p className="shrink text-[26px] font-bold capitalize text-navy-700 dark:text-white">
          {brandText}
        </p>
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

        <button
          type="button"
          onClick={toggleDark}
          aria-label={darkmode ? "Switch to light mode" : "Switch to dark mode"}
          className="cursor-pointer rounded-full p-1 text-gray-600 hover:text-brand-500 dark:text-white"
        >
          {darkmode ? (
            <RiSunFill className="h-4 w-4" />
          ) : (
            <RiMoonFill className="h-4 w-4" />
          )}
        </button>

        <Link
          href="/admin/setup"
          aria-label="Admin setup"
          className="cursor-pointer rounded-full p-1 text-gray-600 hover:text-brand-500 dark:text-white"
        >
          <MdSettings className="h-5 w-5" />
        </Link>
      </div>
    </nav>
  );
};

export default Navbar;
