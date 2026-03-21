import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Input } from "./FormControls";
import { bootstrap, openRepoWindow } from "../lib/api";
import { useI18n } from "../lib/i18n";
import groveMark from "../assets/grove-mark.svg";

export default function RepoSelector() {
  const { t } = useI18n();
  const [repoInput, setRepoInput] = useState("");
  const [recentRepos, setRecentRepos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void bootstrap().then((data) => {
      setRecentRepos(data.recentRepos);
      if (data.recentRepos[0]) {
        setRepoInput(data.recentRepos[0]);
      }
    });
  }, []);

  async function handleOpen(path: string) {
    const trimmed = path.trim();
    if (!trimmed) return;
    setError(null);
    setIsBusy(true);
    try {
      await openRepoWindow(trimmed);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setIsBusy(false);
    }
  }

  async function browseForRepo() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t.chooseRepo,
    });
    if (typeof selected === "string") {
      setRepoInput(selected);
      await handleOpen(selected);
    }
  }

  return (
    <div className="shell">
      <nav className="topbar">
        <div className="topbar-left">
          <div className="topbar-brand">
            <img className="brand-mark" src={groveMark} alt="" aria-hidden="true" />
            <span>Git Grove</span>
          </div>
        </div>
        <div className="topbar-right" />
      </nav>
      <div className="body">
        <main className="main">
          {error && <div className="error-banner">{error}</div>}
          <div className="repo-view">
            <section className="hero card">
              <h2>{t.heroTitle}</h2>
              <p>{t.heroDescription}</p>
              <ul className="hero-points">
                <li>{t.heroPoint1}</li>
                <li>{t.heroPoint2}</li>
                <li>{t.heroPoint3}</li>
              </ul>
            </section>
            <section className="card stack">
              <div className="repo-picker">
                <Input
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder={t.repoPlaceholder}
                  onKeyDown={(e) => e.key === "Enter" && void handleOpen(repoInput)}
                  className="repo-picker-input"
                />
                <div className="repo-picker-actions">
                  <button className="primary-button" onClick={browseForRepo} disabled={isBusy}>
                    {t.chooseRepo}
                  </button>
                </div>
                {recentRepos.length > 0 && (
                  <div className="recent-repos">
                    <button className="recent-repos-toggle" onClick={() => {}}>
                      <span>{t.recentRepos}</span>
                      <span className="subtle">▾</span>
                    </button>
                    <div className="pill-list">
                      {recentRepos.map((item) => (
                        <button
                          key={item}
                          className="pill"
                          onClick={() => void handleOpen(item)}
                          disabled={isBusy}
                        >
                          {item.split("/").pop()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
