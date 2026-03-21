import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import RepoSelector from "./components/RepoSelector";
import { I18nProvider } from "./lib/i18n";
import { ThemeProvider } from "./lib/theme";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const repoPath = params.get("repo");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider defaultLocale="zh-CN">
        {repoPath ? <App repoPath={repoPath} /> : <RepoSelector />}
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
