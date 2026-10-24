import { ArrowLeft, ArrowRight, Check, CircleAlert, Keyboard, ScanLine, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type AppInfo, type HotkeyStatus, type Settings } from "../shared/api";
import { resolveLang, translate, type Key, type Vars } from "../shared/i18n";
import { useSettings } from "../shared/settings";
import { Keys, Logo } from "../shared/ui";
import { CaptureStep, PersonalizeStep, ReviewStep, SavingStep, SmartStep } from "./SetupFields";
import { commitSetup, SETUP_STEPS, setupDraft, validateSetup, type SetupStep } from "./setup";
import "./setup.css";

function initialStep(): SetupStep {
  const requested = import.meta.env.DEV ? new URLSearchParams(location.search).get("setup-step") : null;
  return SETUP_STEPS.find((step) => step === requested) ?? "personalize";
}

export function SetupPage({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const settings = useSettings((store) => store.settings)!;
  const [draft, setDraft] = useState(() => setupDraft(settings));
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [phase, setPhase] = useState<"editing" | "saving" | "complete">("editing");
  const [error, setError] = useState<{ key?: Key; message?: string } | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<HotkeyStatus[]>([]);
  const [verifiedKeys, setVerifiedKeys] = useState<HotkeyStatus[] | null>(null);
  const [keyCheckFailed, setKeyCheckFailed] = useState(false);
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [metadataFailed, setMetadataFailed] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [previewTime] = useState(() => new Date());
  const saving = useRef(false);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const lang = resolveLang(draft.language);
  const t = useCallback((key: Key, vars?: Vars) => translate(lang, key, vars), [lang]);
  const index = SETUP_STEPS.indexOf(step);
  const complete = phase === "complete";
  const busy = phase === "saving";
  const appearance = draft.theme === "system" ? (systemDark ? "dark" : "light") : draft.theme;
  const issues = useMemo(() => validateSetup(draft), [draft]);
  const errorMessage = error ? (error.key ? t(error.key) : t("setup.actionError", { msg: error.message ?? "" })) : null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    let active = true;
    setMetadataFailed(false);
    void Promise.allSettled([api.appInfo(), api.hotkeyStatus()]).then(([appInfo, keys]) => {
      if (!active) return;
      if (appInfo.status === "fulfilled") setInfo(appInfo.value);
      if (keys.status === "fulfilled") setStatus(keys.value);
      setMetadataFailed(appInfo.status === "rejected" || keys.status === "rejected");
    });
    return () => { active = false; };
  }, [metadataAttempt]);

  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step, complete]);

  useEffect(() => {
    if (!complete) return;
    let active = true;
    void api.hotkeyStatus().then((keys) => { if (active) setVerifiedKeys(keys); })
      .catch(() => { if (active) setKeyCheckFailed(true); });
    return () => { active = false; };
  }, [complete]);

  const patch = (changes: Partial<Settings>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setError(null);
  };
  const go = (nextStep: SetupStep) => { setError(null); setStep(nextStep); };
  const next = () => {
    const issue = issues.find((item) => item.step === step);
    if (issue) { setError({ key: issue.key }); return; }
    go(SETUP_STEPS[Math.min(index + 1, SETUP_STEPS.length - 1)]);
  };
  const finish = async () => {
    if (saving.current) return;
    if (issues.length) { setStep(issues[0].step); setError({ key: issues[0].key }); return; }
    saving.current = true;
    setError(null);
    setPhase("saving");
    try {
      const saved = await commitSetup(draft, useSettings.getState().update);
      if (!mounted.current) return;
      setDraft(setupDraft(saved));
      setVerifiedKeys(null);
      setKeyCheckFailed(false);
      setPhase("complete");
    } catch (failure) {
      if (mounted.current) { setError({ message: errorText(failure) }); setPhase("editing"); }
    } finally {
      saving.current = false;
    }
  };
  const pickFolder = async () => {
    setPickingFolder(true);
    try {
      const folder = await api.pickFolder();
      if (mounted.current && folder) patch({ saveDir: folder });
    } catch (failure) {
      if (mounted.current) setError({ message: errorText(failure) });
    } finally {
      if (mounted.current) setPickingFolder(false);
    }
  };
  const openWindowsSettings = () => {
    void api.openKeyboardSettings().catch((failure) => { if (mounted.current) setError({ message: errorText(failure) }); });
  };
  const takeFirst = async () => {
    if (capturing) return;
    setCapturing(true);
    try { await api.captureStart("region"); if (mounted.current) onDone(); }
    catch (failure) { if (mounted.current) setError({ message: errorText(failure) }); }
    finally { if (mounted.current) setCapturing(false); }
  };
  const controls = { draft, patch, t };
  const unavailableKeys = verifiedKeys?.filter((item) => !item.ok) ?? [];

  return (
    <div className="setup-shell" data-appearance={appearance} lang={lang}>
      <main className="setup-main" aria-busy={busy}>
        <header className="setup-topbar"><div className="setup-topbar-brand"><Logo size={22} /><span>Algorith<span>Shot</span></span></div><div><span>{t("setup.step", { n: index + 1, total: SETUP_STEPS.length })}</span><div className="setup-progress" aria-hidden="true">{SETUP_STEPS.map((item, position) => <i key={item} className={position <= index || complete ? "on" : undefined} />)}</div></div><span className="setup-top-note"><ShieldCheck size={14} />{complete ? t("setup.saved") : t("setup.draftNote")}</span></header>

        <div ref={content} className="setup-content">
          {complete ? <div className="setup-success">
            <div className="setup-success-logo"><Logo size={86} /><span><Check size={21} /></span></div>
            <span className="setup-eyebrow">{t("setup.saved")}</span><h1 ref={heading} tabIndex={-1}>{t("setup.successTitle")}</h1><p>{t("setup.successBody")}</p>
            <div className="setup-ready-shortcut"><Keyboard size={18} /><div><small>{t("set.hotkey")}</small>{draft.hotkeys.capture || draft.hotkeys.captureAlt ? <Keys value={draft.hotkeys.capture || draft.hotkeys.captureAlt} /> : <span>{t("setup.captureButton")}</span>}</div></div>
            {unavailableKeys.length > 0 && <div className="setup-callout"><CircleAlert size={18} /><div><strong>{t("setup.shortcutWarning")}</strong><p>{unavailableKeys.map((item) => item.key).join(" · ")}</p><button type="button" className="setup-text-button" onClick={() => { setPhase("editing"); go("capture"); }}>{t("setup.adjustKeys")}<ArrowRight size={13} /></button></div></div>}
            {keyCheckFailed && <p className="setup-completion-note">{t("setup.keyCheckFailed")}</p>}
            <div className="setup-success-actions"><button type="button" className="setup-primary" onClick={onDone} disabled={capturing}>{t("setup.openLibrary")}<ArrowRight size={16} /></button><button type="button" className="setup-secondary" onClick={takeFirst} disabled={capturing}><ScanLine size={15} />{t("setup.takeFirst")}</button></div>
            <small>{t("setup.changeLater")}</small>
          </div> : <div className="setup-step-content" key={step}>
            <div className="setup-step-heading"><span className="setup-eyebrow">{String(index + 1).padStart(2, "0")} / {t(`setup.${step}.nav`)}</span><h1 ref={heading} tabIndex={-1}>{t(`setup.${step}.title`)}</h1><p>{t(`setup.${step}.body`)}</p></div>
            <fieldset className="setup-fields" disabled={busy || pickingFolder}>
              {step === "personalize" && <PersonalizeStep {...controls} />}
              {step === "capture" && <CaptureStep {...controls} info={info} status={status} onWindowsSettings={openWindowsSettings} />}
              {step === "saving" && <SavingStep {...controls} info={info} pickingFolder={pickingFolder} onPickFolder={pickFolder} now={previewTime} />}
              {step === "smart" && <SmartStep {...controls} onSaving={() => go("saving")} />}
              {step === "review" && <ReviewStep draft={draft} t={t} info={info} now={previewTime} onEdit={go} />}
            </fieldset>
            {metadataFailed && step === "capture" && <div className="setup-metadata-note"><span>{t("setup.metadataFailed")}</span><button type="button" className="setup-text-button" onClick={() => setMetadataAttempt((attempt) => attempt + 1)}>{t("startup.retry")}</button></div>}
          </div>}
        </div>

        <footer className="setup-footer">
          {errorMessage && <div className="setup-save-error" role="alert"><CircleAlert size={16} /><span>{errorMessage}</span></div>}
          {!complete ? <div className="setup-footer-row"><div>{index > 0 ? <button type="button" className="setup-back" disabled={busy || pickingFolder} onClick={() => go(SETUP_STEPS[index - 1])}><ArrowLeft size={15} />{t("setup.back")}</button> : onCancel ? <button type="button" className="setup-back" disabled={busy} onClick={onCancel}>{t("common.cancel")}</button> : <span className="setup-footer-caption">{t("setup.changeLater")}</span>}</div><button type="button" className="setup-primary" disabled={busy || pickingFolder} onClick={step === "review" ? finish : next}>{busy ? <><span className="setup-button-spinner" aria-hidden="true" />{t("setup.savingButton")}</> : <>{t(step === "review" ? "setup.finish" : "setup.next")}<ArrowRight size={16} /></>}</button></div> : <div className="setup-footer-row setup-complete-footer"><span><ShieldCheck size={14} />{t("setup.settingsSaved")}</span><span>AlgorithShot</span></div>}
        </footer>
      </main>
    </div>
  );
}
