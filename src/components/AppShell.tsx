import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { App as AntApp, Dropdown, Spin } from "antd";
import type { MenuProps } from "antd";
import {
  CheckCircle2,
  ClipboardList,
  FileText,
  LoaderCircle,
  Maximize2,
  Minus,
  Settings,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Page } from "../models";

const TaskWorkbench = lazy(() => import("../tasks/TaskWorkbench"));
const LogsPage = lazy(() => import("../pages/LogsPage"));
const ApplicationLogsPage = lazy(() => import("../pages/ApplicationLogsPage"));
const SettingsPage = lazy(() => import("../pages/SettingsPage"));
const mainWindow = getCurrentWindow();

function Header({
  page,
  onChange,
}: {
  page: Page;
  onChange: (page: Page) => void;
}) {
  const { t } = useTranslation();
  const { modal } = AntApp.useApp();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void mainWindow.isMaximized().then(setMaximized);
    void mainWindow
      .onResized(() => void mainWindow.isMaximized().then(setMaximized))
      .then((value) => (dispose = value));
    return () => dispose?.();
  }, []);
  const toggle = () =>
    void mainWindow
      .toggleMaximize()
      .then(() => mainWindow.isMaximized())
      .then(setMaximized);
  const menus: { label: string; menu: MenuProps }[] = [
    {
      label: t("nav.fileMenu"),
      menu: {
        items: [
          { key: "new", label: t("tasks.newTask") },
          { type: "divider" },
          { key: "settings", label: t("nav.settings") },
        ],
        onClick: ({ key }) => {
          if (key === "new") {
            onChange("tasks");
            requestAnimationFrame(() =>
              window.dispatchEvent(new Event("jellysmith-new-task")),
            );
          } else if (key === "settings") onChange("settings");
        },
      },
    },
    {
      label: t("nav.editMenu"),
      menu: {
        items: [
          { key: "configure", label: t("tasks.editConfiguration") },
          { key: "source", label: t("tasks.changeSource") },
        ],
        onClick: ({ key }) => {
          onChange("tasks");
          requestAnimationFrame(() =>
            window.dispatchEvent(
              new Event(
                key === "configure"
                  ? "jellysmith-edit-current-task"
                  : "jellysmith-change-current-source",
              ),
            ),
          );
        },
      },
    },
    {
      label: t("nav.viewMenu"),
      menu: {
        selectable: true,
        selectedKeys: [page],
        items: [
          { key: "tasks", label: t("nav.tasks") },
          { key: "logs", label: t("nav.taskHistory") },
          { key: "appLogs", label: t("nav.logs") },
          { key: "settings", label: t("nav.settings") },
        ],
        onClick: ({ key }) => onChange(key as Page),
      },
    },
    {
      label: t("nav.runMenu"),
      menu: {
        items: [
          {
            key: "refresh",
            label: t("common.refresh"),
            disabled: page === "settings",
          },
          { key: "appLogs", label: t("nav.logs") },
        ],
        onClick: ({ key }) => {
          if (key === "appLogs") onChange("appLogs");
          else
            window.dispatchEvent(
              new Event(
                page === "logs"
                  ? "jellysmith-refresh-runs"
                  : page === "appLogs"
                    ? "jellysmith-refresh-app-logs"
                  : "jellysmith-refresh-task",
              ),
            );
        },
      },
    },
    {
      label: t("nav.helpMenu"),
      menu: {
        items: [{ key: "about", label: t("nav.about") }],
        onClick: () =>
          modal.info({
            title: "JellySmith",
            content: t("nav.aboutDescription"),
            okText: t("common.close"),
          }),
      },
    },
  ];
  return (
    <header className="topbar">
      <button
        className="brand"
        aria-label={t("nav.tasks")}
        title={t("nav.tasks")}
        onClick={() => onChange("tasks")}
      >
        <img src="/icon.png" alt="" />
      </button>
      <nav className="app-toolbar" aria-label={t("nav.toolbar")}>
        {menus.map((item) => (
          <Dropdown key={item.label} menu={item.menu} trigger={["click"]}>
            <button>{item.label}</button>
          </Dropdown>
        ))}
      </nav>
      <div
        className="titlebar-drag"
        data-tauri-drag-region
        onDoubleClick={toggle}
      />
      <div className="window-actions">
        <button
          aria-label={t("window.minimize")}
          onClick={() => void mainWindow.minimize()}
        >
          <Minus />
        </button>
        <button
          aria-label={t(maximized ? "window.restore" : "window.maximize")}
          onClick={toggle}
        >
          {maximized ? <span className="restore-icon" /> : <Maximize2 />}
        </button>
        <button
          aria-label={t("window.close")}
          onClick={() => void mainWindow.close()}
        >
          <X />
        </button>
      </div>
    </header>
  );
}

function Rail({
  page,
  onChange,
}: {
  page: Page;
  onChange: (page: Page) => void;
}) {
  const { t } = useTranslation();
  const items: { key: Page; icon: ReactNode; label: string }[] = [
    { key: "tasks", icon: <ClipboardList />, label: t("nav.tasks") },
    { key: "logs", icon: <FileText />, label: t("nav.history") },
    { key: "settings", icon: <Settings />, label: t("nav.settings") },
  ];
  return (
    <nav className="rail" aria-label={t("nav.pages")}>
      {items.map((item) => (
        <button
          key={item.key}
          className={page === item.key ? "active" : ""}
          onClick={() => onChange(item.key)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function AppShell() {
  const { t } = useTranslation();
  const [page, setPage] = useState<Page>("tasks");
  const [activity, setActivity] = useState<{
    label: string;
    detail?: string;
    status?: "running" | "error";
  }>();
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setActivity(detail || undefined);
    };
    window.addEventListener("jellysmith-task-activity", update);
    return () => window.removeEventListener("jellysmith-task-activity", update);
  }, []);
  return (
    <div className="app-root">
      <Header page={page} onChange={setPage} />
      <div className="page-host">
        <Suspense
          fallback={
            <div className="page-loading">
              <Spin />
              {t("common.loading")}
            </div>
          }
        >
          {page === "tasks" ? (
            <TaskWorkbench />
          ) : page === "logs" ? (
            <LogsPage />
          ) : page === "appLogs" ? (
            <ApplicationLogsPage />
          ) : (
            <SettingsPage />
          )}
        </Suspense>
      </div>
      <Rail page={page} onChange={setPage} />
      <footer
        className={`global-statusbar${activity?.status === "error" ? " is-error" : activity ? " is-running" : " is-idle"}`}
      >
        <span className="status-activity">
          {activity?.status === "error" ? (
            <X />
          ) : activity ? (
            <LoaderCircle />
          ) : (
            <CheckCircle2 />
          )}
          <b>{activity?.label ?? t("tasks.ready")}</b>
          {activity?.detail && <small>{activity.detail}</small>}
        </span>
        {activity && activity.status !== "error" && (
          <span className="status-progress" aria-hidden="true">
            <i />
          </span>
        )}
      </footer>
    </div>
  );
}
