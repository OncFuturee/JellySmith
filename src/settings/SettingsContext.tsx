import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import i18n from "../i18n";
import type { AppSettings } from "../models";
import { backend } from "../services/backend";

const defaults: AppSettings = {
  language: "",
  theme: "dark",
  ffprobePath: "ffprobe",
  defaultMovieRoot: "",
  defaultShowRoot: "",
  backgroundProbe: true,
  defaultAllowOverwrite: false,
  backupBeforeOverwrite: true,
  layout: { leftWidth: 230, rightWidth: 300, bottomHeight: 350 },
  ai: { provider: "disabled", model: "gemini-3.6-flash", baseUrl: "" },
};

const normalize = (value: Partial<AppSettings>): AppSettings => ({
  ...defaults,
  ...value,
  theme: value.theme === "light" ? "light" : "dark",
  layout: { ...defaults.layout, ...value.layout },
  ai: { ...defaults.ai, ...value.ai },
});

type Value = {
  settings: AppSettings;
  ready: boolean;
  save: (next: AppSettings) => Promise<AppSettings>;
  updateLayout: (layout: AppSettings["layout"]) => Promise<void>;
};

const Context = createContext<Value>({
  settings: defaults,
  ready: false,
  save: async (value) => value,
  updateLayout: async () => {},
});

const applyTheme = (mode: AppSettings["theme"]) => {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaults);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    backend
      .loadSettings()
      .then((value) => {
        const loaded = normalize(value);
        setSettings(loaded);
        applyTheme(loaded.theme);
        if (loaded.language) void i18n.changeLanguage(loaded.language);
      })
      .catch(() => {
        setSettings(defaults);
        applyTheme(defaults.theme);
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  const save = useCallback(async (next: AppSettings) => {
    const saved = normalize(await backend.saveSettings(next));
    setSettings(saved);
    applyTheme(saved.theme);
    if (saved.language) {
      localStorage.setItem("jellysmith-language", saved.language);
      await i18n.changeLanguage(saved.language);
    } else {
      localStorage.removeItem("jellysmith-language");
      await i18n.changeLanguage(
        navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US",
      );
    }
    return saved;
  }, []);

  const updateLayout = useCallback(
    async (layout: AppSettings["layout"]) => {
      const next = { ...settings, layout };
      setSettings(next);
      try {
        await backend.saveSettings(next);
      } catch {
        // Retain the usable in-session layout.
      }
    },
    [settings],
  );

  return (
    <Context.Provider value={{ settings, ready, save, updateLayout }}>
      {children}
    </Context.Provider>
  );
}

export const useSettings = () => useContext(Context);
