// The main window: sidebar on the left, the current page on the right.

import { Brush, CalendarDays, CalendarRange, Images, PanelLeftClose, PanelLeftOpen, Settings as Gear, Star, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../shared/i18n";
import { useSettings } from "../shared/settings";
import { useTheme } from "../shared/theme";
import { Logo, Toasts } from "../shared/ui";
import { CleanupPage } from "./CleanupPage";
import { AppIcon } from "./AppIcon";
import { LibraryPage } from "./LibraryPage";
import { SettingsPage } from "./SettingsPage";
import { useLibrary } from "./store";
import { SetupPage } from "./SetupPage";
import { needsSetup } from "./setup";

export type Page = "library" | "cleanup" | "settings" | "setup";

const COLLAPSED_KEY = "sidebar-collapsed";

/** Whether the sidebar shows icons only; remembered on this PC. */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function pageFromHash(): Page {
  const h = location.hash.replace("#", "");
  return h === "welcome" ? "setup" : h === "cleanup" || h === "settings" || h === "setup" ? h : "library";
}

export function App() {
  useTheme();
  const t = useT();
  const settings = useSettings((s) => s.settings);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [setupActive, setSetupActive] = useState(() => needsSetup(useSettings.getState().settings));
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { filter, app, overview, setQuery } = useLibrary();

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  const go = (p: Page) => {
    location.hash = p;
  };

  const show = (q: { filter?: "all" | "favorites" | "today" | "week" | "month"; app?: string }) => {
    setQuery({ filter: q.filter ?? "all", app: q.app ?? "" });
    go("library");
  };

  if (!settings) return null;
  // The guided setup is a popup over the app: on first run and from Settings.
  const setupOpen = setupActive || needsSetup(settings) || page === "setup";
  // Behind the popup: Settings when it was opened from there, else the library.
  const behind: Page = page === "setup" ? (needsSetup(settings) ? "library" : "settings") : page;
  const closeSetup = (next: Page) => {
    setSetupActive(false);
    go(next);
  };

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // Not remembered; the sidebar still toggles.
    }
  };

  const onLibrary = behind === "library";
  const navItem = (key: string, icon: ReactNode, label: string, count: number | null, active: boolean, onClick: () => void) => (
    <button key={key} className={`nav-item${active ? " active" : ""}`} onClick={onClick} title={collapsed ? label : undefined} aria-label={label}>
      {icon}
      <span className="nav-label">{label}</span>
      {count !== null && <span className="nav-count edge">{count}</span>}
    </button>
  );

  return (
    <div className={`shell${collapsed ? " collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo size={26} />
          <span className="display brand-name">{t("app.name")}</span>
          <button
            className="icon-btn sidebar-toggle"
            onClick={toggleSidebar}
            title={t(collapsed ? "lib.expand" : "lib.collapse")}
            aria-label={t(collapsed ? "lib.expand" : "lib.collapse")}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <nav className="nav">
          {navItem("all", <Images size={17} />, t("lib.all"), overview?.stats.count ?? null, onLibrary && filter === "all" && !app, () => show({ filter: "all" }))}
          {navItem("fav", <Star size={17} />, t("lib.favorites"), null, onLibrary && filter === "favorites", () => show({ filter: "favorites" }))}
          {navItem("today", <Sun size={17} />, t("lib.today"), null, onLibrary && filter === "today", () => show({ filter: "today" }))}
          {navItem("week", <CalendarDays size={17} />, t("lib.week"), null, onLibrary && filter === "week", () => show({ filter: "week" }))}
          {navItem("month", <CalendarRange size={17} />, t("lib.month"), null, onLibrary && filter === "month", () => show({ filter: "month" }))}

          {overview && overview.apps.length > 0 && (
            <>
              <div className="nav-heading edge">{t("lib.apps")}</div>
              <div className="nav-apps">
                {overview.apps.map((a) =>
                  navItem(
                    `app-${a.app}`,
                    <AppIcon app={a.app} revision={a.count} />,
                    a.app,
                    a.count,
                    onLibrary && app === a.app,
                    () => show({ app: a.app }),
                  ),
                )}
              </div>
            </>
          )}
        </nav>

        <div className="nav nav-bottom">
          {navItem("cleanup", <Brush size={17} />, t("lib.cleanup"), null, behind === "cleanup", () => go("cleanup"))}
          {navItem("settings", <Gear size={17} />, t("lib.settings"), null, behind === "settings", () => go("settings"))}
        </div>
      </aside>

      <main className="main">
        {behind === "library" && <LibraryPage />}
        {behind === "cleanup" && <CleanupPage />}
        {behind === "settings" && <SettingsPage />}
      </main>
      {setupOpen && (
        <div className="setup-backdrop">
          <div className="setup-popup" role="dialog" aria-modal="true" aria-label={t("setup.reopen")}>
            <SetupPage
              compact
              onDone={() => closeSetup("library")}
              onAfterCapture={() => closeSetup("library")}
              onCancel={!needsSetup(settings) ? () => closeSetup("settings") : undefined}
            />
          </div>
        </div>
      )}
      <Toasts />
    </div>
  );
}
