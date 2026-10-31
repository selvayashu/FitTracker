import { NavLink, Outlet } from "react-router-dom";
import { SyncBadge } from "./SyncBadge";
import { PwaPrompt } from "./PwaPrompt";

const TABS = [
  { to: "/", label: "Today", end: true },
  { to: "/meals", label: "Meals" },
  { to: "/activity", label: "Activity" },
  { to: "/reports", label: "Reports" },
  { to: "/settings", label: "Settings" },
];

/** Mobile-first layout: sync badge on top, page content, bottom tab bar. */
export function AppShell() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <SyncBadge />
      <PwaPrompt />
      <main className="flex-1 px-4 pb-24 pt-4">
        <Outlet />
      </main>
      <nav aria-label="Primary" className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <ul className="mx-auto flex max-w-md">
          {TABS.map((t) => (
            <li key={t.to} className="flex-1">
              <NavLink
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `block py-3 text-center text-xs ${isActive ? "font-semibold text-teal-700 dark:text-teal-300" : "text-slate-500 dark:text-slate-400"}`
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
