import { Component, type ReactNode, useEffect } from "react";
import { App as AntApp, ConfigProvider, theme as antdTheme } from "antd";
import "material-symbols/rounded.css";
import "./styles.css";
import { useTranslation } from "react-i18next";
import AppShell from "./components/AppShell";
import { recordApplicationError } from "./services/applicationLogging";
import { SettingsProvider, useSettings } from "./settings/SettingsContext";

class RenderBoundary extends Component<
  { children: ReactNode; message: string; reloadLabel: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    void recordApplicationError("react.render", error);
  }

  render() {
    return this.state.failed ? (
      <main className="render-failure">
        <strong>{this.props.message}</strong>
        <button onClick={() => window.location.reload()}>
          {this.props.reloadLabel}
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}

const palettes = {
  dark: {
    bg: "#17191e",
    surface: "#20242b",
    elevated: "#272c35",
    border: "#3a424f",
    text: "#e5e9ef",
    muted: "#9ca6b5",
  },
  light: {
    bg: "#eef2f7",
    surface: "#ffffff",
    elevated: "#f7f9fc",
    border: "#d4dbe6",
    text: "#172033",
    muted: "#667085",
  },
} as const;

function ThemedApplication() {
  const { settings } = useSettings();
  const dark = settings.theme === "dark";
  const palette = dark ? palettes.dark : palettes.light;
  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#4f86f7",
          colorInfo: "#4f86f7",
          colorSuccess: "#35b873",
          colorWarning: "#d99724",
          colorError: "#e0525e",
          colorBgBase: palette.bg,
          colorBgLayout: palette.bg,
          colorBgContainer: palette.surface,
          colorBgElevated: palette.elevated,
          colorBorder: palette.border,
          colorBorderSecondary: palette.border,
          colorText: palette.text,
          colorTextSecondary: palette.muted,
          borderRadius: 7,
          fontSize: 12,
          fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif',
          boxShadow: "0 18px 55px rgb(8 15 30 / 20%)",
        },
        components: {
          Button: { controlHeight: 32 },
          Input: { controlHeight: 32 },
          Select: { controlHeight: 32 },
          Tabs: {
            itemColor: palette.muted,
            itemSelectedColor: palette.text,
            inkBarColor: "#4f86f7",
          },
        },
      }}
    >
      <AntApp>
        <AppShell />
      </AntApp>
    </ConfigProvider>
  );
}

export default function App() {
  const { t } = useTranslation();
  useEffect(() => {
    const prevent = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", prevent);
    return () => document.removeEventListener("contextmenu", prevent);
  }, []);
  return (
    <RenderBoundary
      message={t("common.renderFailed")}
      reloadLabel={t("common.reload")}
    >
      <SettingsProvider>
        <ThemedApplication />
      </SettingsProvider>
    </RenderBoundary>
  );
}
