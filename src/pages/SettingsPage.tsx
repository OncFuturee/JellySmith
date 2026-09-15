import { useEffect, useState } from "react";
import { Alert, App, Button, Form, Input, Select, Switch, Tabs } from "antd";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppSettings } from "../models";
import { backend } from "../services/backend";
import { localizedError } from "../services/errors";
import { useSettings } from "../settings/SettingsContext";

const defaults = { leftWidth: 230, rightWidth: 300, bottomHeight: 350 };
const TMDB_KEY_URL = "https://www.themoviedb.org/settings/api";
const AI_KEY_URLS: Partial<Record<AppSettings["ai"]["provider"], string>> = {
  gemini: "https://aistudio.google.com/app/apikey",
  siliconflow: "https://cloud.siliconflow.cn/account/ak",
  "openai-compatible": "https://platform.openai.com/api-keys",
};
export default function SettingsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { settings, save } = useSettings();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [apiKey, setApiKey] = useState("");
  const [tmdbKey, setTmdbKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [hasTmdb, setHasTmdb] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    backend
      .hasApiKey("tmdb")
      .then(setHasTmdb)
      .catch(() => setHasTmdb(false));
  }, []);
  useEffect(() => {
    if (draft.ai.provider === "disabled") {
      setHasKey(false);
      setModels([]);
      return;
    }
    backend
      .hasApiKey(draft.ai.provider)
      .then(setHasKey)
      .catch(() => setHasKey(false));
    if (draft.ai.provider === "gemini")
      setModels(["gemini-3.6-flash", "gemini-3.5-flash"]);
  }, [draft.ai.provider]);
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setAi = (patch: Partial<AppSettings["ai"]>) =>
    setDraft((current) => ({ ...current, ai: { ...current.ai, ...patch } }));
  const submit = async () => {
    setSaving(true);
    try {
      if (apiKey && draft.ai.provider !== "disabled") {
        await backend.saveApiKey(draft.ai.provider, apiKey);
        setApiKey("");
        setHasKey(true);
      }
      if (tmdbKey) {
        await backend.saveApiKey("tmdb", tmdbKey);
        setTmdbKey("");
        setHasTmdb(true);
      }
      await save(draft);
      message.success(t("common.saved"));
    } catch (error) {
      message.error(localizedError(t, error));
    } finally {
      setSaving(false);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      if (apiKey && draft.ai.provider !== "disabled") {
        await backend.saveApiKey(draft.ai.provider, apiKey);
        setHasKey(true);
      }
      await save(draft);
      const items = await backend.listAiModels(draft.ai.provider);
      setModels(items);
      if (items.length && !items.includes(draft.ai.model))
        setAi({ model: items[0] });
      message.success(t("settings.connectionOk", { count: items.length }));
    } catch (error) {
      message.error(localizedError(t, error));
    } finally {
      setTesting(false);
    }
  };
  const providerOptions = [
    { value: "disabled", label: t("settings.disabled") },
    { value: "gemini", label: t("settings.gemini") },
    { value: "siliconflow", label: t("settings.silicon") },
    { value: "openai-compatible", label: t("settings.compatible") },
  ];
  const openKeyPage = async (url: string) => {
    try {
      await openUrl(url);
    } catch (error) {
      message.error(t("settings.openKeyPageFailed"));
      void backend.writeApplicationLog(
        "ERROR",
        "settings.open-key-page",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const credentialLabel = (label: string, url?: string) => (
    <div className="credential-label">
      <span>{label}</span>
      {url && (
        <Button
          type="link"
          size="small"
          icon={<ExternalLink size={12} />}
          onClick={() => void openKeyPage(url)}
        >
          {t("settings.getKey")}
        </Button>
      )}
    </div>
  );
  return (
    <div className="settings-page">
      <header>
        <div>
          <h2>{t("settings.title")}</h2>
          <p>{t("settings.subtitle")}</p>
        </div>
        <Button type="primary" loading={saving} onClick={() => void submit()}>
          {t("common.save")}
        </Button>
      </header>
      <div className="settings-frame">
        <Tabs
          className="settings-tabs"
          tabPlacement="start"
          items={[
            {
              key: "general",
              label: t("settings.general"),
              children: (
                <section className="settings-section">
                  <header>
                    <h3>{t("settings.general")}</h3>
                  </header>
                  <Form layout="vertical">
                    <Form.Item label={t("settings.language")}>
                      <Select
                        value={draft.language}
                        options={[
                          { value: "", label: t("settings.system") },
                          { value: "zh-CN", label: "简体中文" },
                          { value: "en-US", label: "English" },
                        ]}
                        onChange={(value) => set("language", value)}
                      />
                    </Form.Item>
                    <Form.Item label={t("settings.theme")}>
                      <Select
                        value={draft.theme}
                        options={[
                          { value: "dark", label: t("settings.darkTheme") },
                          { value: "light", label: t("settings.lightTheme") },
                        ]}
                        onChange={(value: AppSettings["theme"]) => {
                          const next = { ...draft, theme: value };
                          setDraft(next);
                          void save(next).catch((error) =>
                            message.error(localizedError(t, error)),
                          );
                        }}
                      />
                    </Form.Item>
                  </Form>
                </section>
              ),
            },
            {
              key: "media",
              label: t("settings.media"),
              children: (
                <section className="settings-section">
                  <header>
                    <h3>{t("settings.media")}</h3>
                  </header>
                  <Form layout="vertical">
                    <Form.Item label={t("settings.ffprobe")}>
                      <Input
                        value={draft.ffprobePath}
                        onChange={(e) => set("ffprobePath", e.target.value)}
                      />
                    </Form.Item>
                    <Form.Item label={t("settings.background")}>
                      <Switch
                        checked={draft.backgroundProbe}
                        onChange={(value) => set("backgroundProbe", value)}
                      />
                    </Form.Item>
                    <Alert
                      type="success"
                      showIcon
                      title={t("settings.noCmd")}
                    />
                  </Form>
                  <div className="settings-subsection">
                    <h3>{t("tasks.tmdbSettings")}</h3>
                    <Form layout="vertical">
                      {credentialLabel(t("tasks.tmdbToken"), TMDB_KEY_URL)}
                      <Form.Item
                        extra={
                          hasTmdb
                            ? t("tasks.tmdbStored")
                            : t("tasks.tmdbTokenHelp")
                        }
                      >
                        <Input.Password
                          value={tmdbKey}
                          autoComplete="new-password"
                          placeholder={t("tasks.tmdbTokenPlaceholder")}
                          onChange={(event) => setTmdbKey(event.target.value)}
                        />
                      </Form.Item>
                      <Alert
                        type="info"
                        showIcon
                        title={t("tasks.tmdbPrivacy")}
                      />
                    </Form>
                  </div>
                </section>
              ),
            },
            {
              key: "ai",
              label: t("settings.ai"),
              children: (
                <section className="settings-section">
                  <header>
                    <h3>{t("settings.ai")}</h3>
                  </header>
                  <Form layout="vertical">
                    <Form.Item label={t("settings.provider")}>
                      <Select
                        value={draft.ai.provider}
                        options={providerOptions}
                        onChange={(provider) => {
                          setApiKey("");
                          setHasKey(false);
                          setModels(
                            provider === "gemini"
                              ? ["gemini-3.6-flash", "gemini-3.5-flash"]
                              : [],
                          );
                          setAi({
                            provider,
                            model:
                              provider === "gemini" ? "gemini-3.6-flash" : "",
                          });
                        }}
                      />
                    </Form.Item>
                    {draft.ai.provider !== "disabled" && (
                      <>
                        {credentialLabel(
                          t("settings.apiKey"),
                          AI_KEY_URLS[draft.ai.provider],
                        )}
                        <Form.Item
                          extra={hasKey ? t("settings.keyStored") : undefined}
                        >
                          <Input.Password
                            value={apiKey}
                            autoComplete="new-password"
                            placeholder={t("settings.apiKeyPlaceholder")}
                            onChange={(e) => setApiKey(e.target.value)}
                          />
                        </Form.Item>
                        {draft.ai.provider === "openai-compatible" && (
                          <Form.Item label={t("settings.baseUrl")}>
                            <Input
                              value={draft.ai.baseUrl}
                              placeholder="https://example.com/v1"
                              onChange={(e) =>
                                setAi({ baseUrl: e.target.value })
                              }
                            />
                          </Form.Item>
                        )}
                        <Form.Item label={t("settings.model")}>
                          <Select
                            showSearch
                            value={draft.ai.model || undefined}
                            options={models.map((model) => ({
                              value: model,
                              label: model,
                            }))}
                            onChange={(model) => setAi({ model })}
                          />
                        </Form.Item>
                        <Button loading={testing} onClick={() => void test()}>
                          {t("settings.test")}
                        </Button>
                        <Alert
                          className="settings-note"
                          type="info"
                          showIcon
                          title={t("workflow.aiDisclaimer")}
                        />
                      </>
                    )}
                  </Form>
                </section>
              ),
            },
            {
              key: "safety",
              label: t("settings.security"),
              children: (
                <section className="settings-section">
                  <header>
                    <h3>{t("settings.security")}</h3>
                  </header>
                  <Form layout="vertical">
                    <Form.Item label={t("settings.overwrite")}>
                      <Switch
                        checked={draft.defaultAllowOverwrite}
                        onChange={(value) =>
                          set("defaultAllowOverwrite", value)
                        }
                      />
                    </Form.Item>
                    <Form.Item label={t("settings.backup")}>
                      <Switch
                        checked={draft.backupBeforeOverwrite}
                        onChange={(value) =>
                          set("backupBeforeOverwrite", value)
                        }
                      />
                    </Form.Item>
                  </Form>
                  <div className="settings-subsection">
                    <h3>{t("settings.layout")}</h3>
                    <p className="muted">{t("settings.layoutHelp")}</p>
                    <Button
                      onClick={() => {
                        set("layout", defaults);
                        message.success(t("settings.resetDone"));
                      }}
                    >
                      {t("common.reset")}
                    </Button>
                  </div>
                </section>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
