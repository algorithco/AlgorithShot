// The main window: sidebar on the left, the current page on the right.

import { listen } from "@tauri-apps/api/event";
import { Brush, Calendar, CalendarDays, CalendarRange, Images, Settings as Gear, Star, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../shared/api";
import { formatBytes } from "../shared/format";
import { useT } from "../shared/i18n";
import { initSettings, useSettings } from "../shared/settings";
import { useTheme } from "../shared/theme";
import { Keys, Logo, Toasts } from "../shared/ui";
import { CleanupPage } from "./CleanupPage";
import { LibraryPage } from "./LibraryPage";
import { SettingsPage } from "./SettingsPage";
import { useLibrary } from "./store";
import { WelcomePage } from "./WelcomePage";

export type Page = "library" | "cleanup" | "settings" | "welcome";

function pageFromHash(): Page {
  const h = location.hash.replace("#", "");
  return h === "cleanup" || h === "settings" || h === "welcome" ? h : "library";
}

export function App() {
  useTheme();
  const t = useT();
  const settings = useSettings((s) => s.settings);
  const [page, setPage] = useState<Page>(pageFromHash);
  const { filter, app, overview, setQuery } = useLibrary();

  useEffect(() => {
    initSettings();
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    const sub = listen<string>("nav", (e) => {
      location.hash = e.payload;
    });
    return () => {
      window.removeEventListener("hashchange", onHash);
      sub.then((un) => un());
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
  if (page === "welcome") return <WelcomePage onDone={() => go("library")} />;

  const onLibrary = page === "library";
  const navItem = (key: string, icon: ReactNode, label: string, count: number | null, active: boolean, onClick: () => void) => (
    <button key={key} className={`nav-item${active ? " active" : ""}`} onClick={onClick}>
      {icon}
      <span className="nav-label">{label}</span>
      {count !== null && <span className="nav-count edge">{count}</span>}
    </button>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo size={26} />
          <span className="display">{t("app.name")}</span>
        </div>
        <button className="btn btn-primary capture-btn" onClick={() => api.captureStart("region")}>
          {t("lib.capture")}
          <Keys value={settings.hotkeys.capture || settings.hotkeys.captureAlt} />
        </button>

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
                {overview.apps.slice(0, 12).map((a) =>
                  navItem(
                    `app-${a.app}`,
                    <span className="app-dot">{a.app.slice(0, 1).toUpperCase()}</span>,
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
          {navItem("cleanup", <Brush size={17} />, t("lib.cleanup"), null, page === "cleanup", () => go("cleanup"))}
          {navItem("settings", <Gear size={17} />, t("lib.settings"), null, page === "settings", () => go("settings"))}
          {overview && (
            <div className="storage edge">
              <Calendar size={12} />
              {t(overview.stats.count === 1 ? "lib.countOne" : "lib.count", { n: overview.stats.count, size: formatBytes(overview.stats.bytes) })}
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        {page === "library" && <LibraryPage />}
        {page === "cleanup" && <CleanupPage />}
        {page === "settings" && <SettingsPage />}
      </main>
      <Toasts />
    </div>
  );
}
