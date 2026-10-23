// First run: what the app does, the hotkey, and the Print Screen setting.

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AppInfo, type Settings } from "../shared/api";
import { prettyKey } from "../shared/format";
import { useT } from "../shared/i18n";
import { useSettings } from "../shared/settings";
import { Logo } from "../shared/ui";

export function WelcomePage({ onDone }: { onDone: () => void }) {
  const t = useT();
  const settings = useSettings((s) => s.settings)!;
  const update = useSettings((s) => s.update);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });

  useEffect(() => {
    api.appInfo().then(setInfo);
  }, []);

  // The size tag counts like a live selection being dragged.
  useEffect(() => {
    const sizes = [
      { w: 1280, h: 720 },
      { w: 1080, h: 1080 },
      { w: 1920, h: 1080 },
      { w: 1200, h: 630 },
    ];
    let i = 0;
    const id = window.setInterval(() => setSize(sizes[++i % sizes.length]), 2200);
    return () => window.clearInterval(id);
  }, []);

  const key = settings.hotkeys.capture || settings.hotkeys.captureAlt;
  const blocked = info?.printScreenTaken && settings.hotkeys.capture === "PrintScreen";
  const finish = () => update({ welcomeDone: true }).then(onDone);

  return (
    <div className="welcome">
      <div className="welcome-top">
        <div className="brand">
          <Logo size={26} />
          <span className="display">{t("app.name")}</span>
        </div>
        <select className="select" value={settings.language} onChange={(e) => update({ language: e.target.value as Settings["language"] })} aria-label="Language">
          <option value="system">{t("set.system")}</option>
          <option value="en">English</option>
          <option value="uz">Oʻzbekcha</option>
          <option value="ru">Русский</option>
        </select>
      </div>

      <div className="welcome-hero">
        <div className="hero-frame brackets">
          <span className="hero-size measure">
            {size.w} <span>×</span> {size.h}
          </span>
          <h1 className="display">{t("wel.title")}</h1>
          <p>{t("wel.subtitle")}</p>
        </div>
      </div>

      <ol className="welcome-steps">
        <li>
          <span className="step-n measure">1</span>
          <div>
            <h3 className="display">{t("wel.step1.title")}</h3>
            <p>{t("wel.step1.body", { key: prettyKey(key) })}</p>
          </div>
        </li>
        <li>
          <span className="step-n measure">2</span>
          <div>
            <h3 className="display">{t("wel.step2.title")}</h3>
            <p>{t("wel.step2.body")}</p>
          </div>
        </li>
        <li>
          <span className="step-n measure">3</span>
          <div>
            <h3 className="display">{t("wel.step3.title")}</h3>
            <p>{t("wel.step3.body")}</p>
          </div>
        </li>
      </ol>

      {blocked && (
        <div className="notice welcome-notice">
          <AlertTriangle size={18} />
          <div>
            <strong>{t("set.printScreen.title")}</strong>
            <p>{t("set.printScreen.body")}</p>
            <button className="btn" onClick={() => api.openKeyboardSettings()}>
              {t("set.printScreen.button")}
            </button>
          </div>
        </div>
      )}

      <div className="welcome-actions">
        <button
          className="btn btn-primary big"
          onClick={() => {
            finish();
            api.captureStart("region");
          }}
        >
          {t("wel.try")}
        </button>
        <button className="btn big" onClick={finish}>
          {t("wel.start")}
        </button>
      </div>
    </div>
  );
}
