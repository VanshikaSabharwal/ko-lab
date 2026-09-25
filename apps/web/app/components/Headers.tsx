"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { Sun, Moon, Github, Settings } from "lucide-react";
import Link from "next/link";
import UserAvatar from "./UserAvatar";
import { usePathname } from "next/navigation";

// Routes that render their own full-height chrome (sidebar + top bar) and would
// otherwise sit below this global bar, showing two logos and two theme toggles.
const OWN_CHROME = ["/workspace"];

const Header = () => {
  const { data: session, status } = useSession();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (pathname && OWN_CHROME.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-14">

          {/* Logo */}
          <a
            href="/"
            className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 to-purple-600 hover:from-purple-500 hover:to-blue-600 transition-all duration-300 tracking-tight"
          >
            Ko-lab
          </a>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Theme Toggle */}
            {mounted && (
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200"
                aria-label="Toggle theme"
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Auth Buttons */}
            {status === "authenticated" ? (
              <div className="flex items-center gap-2">
                <Link
                  href="/profile"
                  className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200"
                  aria-label="Settings"
                  title="Settings"
                >
                  <Settings className="w-4 h-4" />
                </Link>
                <Link
                  href="/profile"
                  className="flex items-center justify-center w-8 h-8 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 hover:ring-2 hover:ring-blue-500 transition"
                  title="Profile"
                >
                  <UserAvatar
                    src={session?.user?.image}
                    name={session?.user?.name ?? session?.user?.email}
                    size={32}
                  />
                </Link>
                <button
                  onClick={() => signOut()}
                  className="text-sm font-medium px-4 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-200"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => signIn("github")}
                  className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:bg-gray-700 dark:hover:bg-white transition-colors duration-200"
                >
                  <Github className="w-4 h-4" />
                  GitHub
                </button>
                <button
                  onClick={() => signIn("google")}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-200"
                >
                  Google
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </nav>
  );
};

export default Header;
