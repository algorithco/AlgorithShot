import { AlertCircle, ArrowDownToLine, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { formatBytes } from "../shared/format";
import { useT } from "../shared/i18n";
import { updateStore } from "./updates";
import "./updates.css";

export function UpdateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="update-frame">
      <UpdateBanner />
      <div className="update-content">{children}</div>
    </div>
  );
}

function UpdateBanner() {
  const t = useT();
  const state = useStore(updateStore);
  const { status, version, downloaded, total, installed, error, install } = state;
  if (!version) return null;

  const busy = status === "downloading" || status === "installing" || status === "restarting";
  const percent = total ? Math.min(100, Math.round(downloaded / total * 100)) : null;
  const title = status === "error"
    ? t(installed ? "update.restartFailed" : "update.failed")
    : status === "downloading"
      ? t("update.downloading")
      : status === "installing"
        ? t("update.installing")
        : status === "restarting"
          ? t("update.restarting")
          : t("update.available", { v: version });

  return (
    <div className={`update-banner${status === "error" ? " update-error" : ""}`}>
      {status === "error" ? <AlertCircle size={20} aria-hidden="true" /> : busy
        ? <LoaderCircle size={20} className="update-spinner" aria-hidden="true" />
        : <ArrowDownToLine size={20} aria-hidden="true" />}
      <div className="update-copy" role="status" aria-live="polite" aria-atomic="true">
        <strong>{title}</strong>
        <span title={error ?? undefined}>{t(busy ? "update.keepOpen" : "update.restartHint")}</span>
      </div>
      {status === "downloading" && (
        <div className="update-download">
          <progress aria-label={t("update.downloading")} max={100} value={percent ?? undefined} />
          <span>{percent === null ? formatBytes(downloaded) : `${percent}%`}</span>
        </div>
      )}
      <button className="btn btn-primary update-action" type="button" disabled={busy} onClick={() => void install()}>
        {installed ? <RefreshCw size={15} aria-hidden="true" /> : <ArrowDownToLine size={15} aria-hidden="true" />}
        {t(busy ? "update.updating" : installed ? "update.restart" : status === "error" ? "update.retry" : "update.action")}
      </button>
    </div>
  );
}
