import { useLang, useT } from "../shared/i18n";
import { LOGO_CORNERS, Logo } from "../shared/ui";
import type { StartupStage } from "./startup";
import "./loading.css";

// Four independent, extruded pieces find the yellow focal point, settle into
// the exact logo, and release a capture wave. There is no rotating icon tile.
function FocusAssembly() {
  return (
    <div className="startup-scene" aria-hidden="true">
      <div className="focus-art">
      <div className="startup-halo" />
      <svg className="focus-reticle" viewBox="0 0 400 310" fill="none">
        <path d="M52 108V65h43M305 65h43v43M348 202v43h-43M95 245H52v-43" />
        <path className="focus-axis" d="M18 155h52m260 0h52M200 13v30m0 224v30" />
        <circle cx="200" cy="155" r="114" />
        <circle className="focus-target" cx="200" cy="155" r="66" />
      </svg>
      <span className="startup-crosshair startup-crosshair-left">+</span>
      <span className="startup-crosshair startup-crosshair-right">+</span>
      <div className="startup-ground" />

      <div className="focus-capture-wave" />
      <div className="focus-mechanism">
        {LOGO_CORNERS.map((corner, i) => (
          <div key={corner} className={`focus-arm focus-arm-${i}`}>
            {[0, 1, 2, 3, 4, 5].map((layer) => (
              <svg key={layer} className="focus-arm-depth" viewBox="0 0 100 100" style={{ transform: `translateZ(${layer * 1.6}px)` }}>
                <path d={corner} />
              </svg>
            ))}
            <svg className="focus-arm-front" viewBox="0 0 100 100">
              <defs>
                <linearGradient id={`focus-ceramic-${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="0.5" stopColor="#f7f7f5" />
                  <stop offset="1" stopColor="#c8c6b8" />
                </linearGradient>
              </defs>
              <path d={corner} stroke={`url(#focus-ceramic-${i})`} />
            </svg>
          </div>
        ))}
        <div className="focus-core">
          <div className="focus-core-light" />
          <div className="focus-core-body"><span /></div>
          <div className="focus-core-ring" />
        </div>
      </div>
      <div className="focus-scan" />
      <div className="focus-photons"><i /><i /><i /><i /><i /><i /></div>
      <span className="startup-focus-label">IN FOCUS</span>
      </div>
    </div>
  );
}

export function LoadingScreen({ stage, error, onRetry }: { stage: StartupStage; error: string | null; onRetry: () => void }) {
  const t = useT();
  const lang = useLang();
  const ready = stage === "ready" && !error;

  return (
    <section className={`startup-screen${ready ? " is-ready" : ""}${error ? " has-error" : ""}`} lang={lang} aria-label={t("startup.loading")} aria-busy={!ready && !error}>
      <header className="startup-header">
        <div className="startup-maker"><Logo size={20} /><span>ALGORITHCO</span></div>
        <span className="startup-edition">{t("startup.desktop")}</span>
      </header>

      <div className="startup-center">
        <FocusAssembly />
        <div className="startup-wordmark">
          <h1>Algorith<span>Shot</span><i aria-hidden="true" /></h1>
          <p>{t("startup.tagline")}</p>
        </div>

        <div className="startup-status">
          {error ? (
            <div className="startup-error">
              <div role="alert">
                <p className="startup-error-title">{t("startup.errorTitle")}</p>
                <p className="startup-error-detail">{error}</p>
              </div>
              <button className="startup-retry" type="button" onClick={onRetry}>{t("startup.retry")}<span aria-hidden="true">↗</span></button>
            </div>
          ) : (
            <>
              <div className="startup-activity" role="progressbar" aria-label={t("startup.loading")} aria-valuemin={0} aria-valuemax={100} {...(ready ? { "aria-valuenow": 100 } : {})}><span /></div>
              <p className="startup-status-text" role="status" aria-live="polite" aria-atomic="true"><span className="startup-status-light" aria-hidden="true" />{t(`startup.${stage}`)}</p>
            </>
          )}
        </div>
      </div>

      <footer className="startup-footer">
        <span>{t("startup.footer")}</span>
        <span className="startup-local"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5 13 3.5v4c0 3-5 6-5 6s-5-3-5-6v-4L8 1.5Z" stroke="currentColor" strokeWidth="1.2" /><path d="m5.5 7.5 1.7 1.7 3.3-3.4" stroke="currentColor" strokeWidth="1.2" /></svg>{t("startup.local")}</span>
      </footer>
    </section>
  );
}
