import { App, Button, Dropdown, Progress, Spin, Steps, Tag } from "antd";
import type { MenuProps } from "antd";
import {
  CheckCircle2,
  Clapperboard,
  Film,
  FolderCog,
  FolderSearch,
  Layers3,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  SearchCheck,
  Square,
  Trash2,
  Tv,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type {
  CreateTaskRequest,
  MediaGroup,
  OrganizerTask,
  ScanProgress,
  TaskStage,
  TaskSummary,
} from "../models";
import { backend } from "../services/backend";
import { localizedError } from "../services/errors";
import { useSettings } from "../settings/SettingsContext";
import NewTaskModal from "./NewTaskModal";
import TaskInspector from "./TaskInspector";
import TaskStages from "./TaskStages";

const stages: TaskStage[] = [
  "scan",
  "group",
  "match",
  "episodes",
  "plan",
];
const visibleStage = (stage: string): TaskStage =>
  stage === "execute"
    ? "plan"
    : stages.includes(stage as TaskStage)
      ? (stage as TaskStage)
      : "scan";
const sourceFolderName = (path: string, fallback: string) => {
  const parts = path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean);
  return parts[parts.length - 1] || fallback;
};
const stageIcon = (stage: TaskStage) =>
  stage === "scan" ? (
    <FolderSearch />
  ) : stage === "group" ? (
    <Layers3 />
  ) : stage === "match" ? (
    <SearchCheck />
  ) : stage === "episodes" ? (
    <Tv />
  ) : (
    <CheckCircle2 />
  );

export default function TaskWorkbench() {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const { settings, save: saveSettings } = useSettings();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [task, setTask] = useState<OrganizerTask>();
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [stage, setStage] = useState<TaskStage>("scan");
  const [loading, setLoading] = useState(true);
  const [switchingTaskId, setSwitchingTaskId] = useState<string>();
  const loadSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [busyActivity, setBusyActivity] = useState<{
    label: string;
    detail?: string;
    status?: "running" | "error";
  }>();
  const activityTimer = useRef<number | undefined>(undefined);
  const [newOpen, setNewOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<OrganizerTask>();
  const [progress, setProgress] = useState<ScanProgress>();
  const setBusyState = useCallback(
    (value: boolean, label?: string, detail?: string) => {
      window.clearTimeout(activityTimer.current);
      if (value && label === t("tasks.scanning")) setProgress(undefined);
      setBusy(value);
      if (value) {
        setBusyActivity({
          label: label || t("tasks.processing"),
          detail,
          status: "running",
        });
      } else if (label) {
        setBusyActivity({ label, detail, status: "error" });
        activityTimer.current = window.setTimeout(
          () => setBusyActivity(undefined),
          8_000,
        );
      } else {
        setBusyActivity(undefined);
      }
    },
    [t],
  );
  const refresh = useCallback(
    async (preferred?: string | null) => {
      const values = await backend.listTasks();
      setTasks(values);
      const id =
        preferred === null
          ? values[0]?.id
          : (preferred ?? task?.id ?? values[0]?.id);
      if (id) {
        const loaded = await backend.loadTask(id);
        setTask(loaded);
        setStage(visibleStage(loaded.stage));
        setSelectedGroupId((current) =>
          loaded.groups.some((group) => group.id === current)
            ? current
            : loaded.groups[0]?.id,
        );
      } else setTask(undefined);
    },
    [task?.id],
  );
  useEffect(() => {
    refresh()
      .catch((error) => message.error(localizedError(t, error)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const isScanning = busy && busyActivity?.label === t("tasks.scanning");
    const scanProgress =
      isScanning && progress?.taskId === task?.id ? progress : undefined;
    window.dispatchEvent(
      new CustomEvent("jellysmith-task-activity", {
        detail: busyActivity
          ? {
              label: scanProgress ? t("tasks.scanning") : busyActivity?.label,
              detail: scanProgress
                ? `${t("tasks.scanningCount", { count: scanProgress.scanned })} · ${scanProgress.currentPath}`
                : busyActivity?.detail,
              status: busyActivity.status,
            }
          : null,
      }),
    );
  }, [busy, busyActivity, progress, task?.id, t]);
  useEffect(
    () => () => {
      window.clearTimeout(activityTimer.current);
      window.dispatchEvent(
        new CustomEvent("jellysmith-task-activity", { detail: null }),
      );
    },
    [],
  );
  useEffect(() => {
    let dispose: (() => void) | undefined;
    listen<ScanProgress>("organizer-progress", (event) =>
      setProgress(event.payload),
    ).then((value) => (dispose = value));
    return () => dispose?.();
  }, []);
  const load = async (id: string) => {
    if (id === task?.id) {
      if (switchingTaskId) {
        loadSequence.current += 1;
        setSwitchingTaskId(undefined);
      }
      return;
    }
    const sequence = ++loadSequence.current;
    setSwitchingTaskId(id);
    try {
      const value = await backend.loadTask(id);
      if (sequence !== loadSequence.current) return;
      setTask(value);
      setStage(visibleStage(value.stage));
      setSelectedGroupId(value.groups[0]?.id);
    } catch (error) {
      if (sequence === loadSequence.current)
        message.error(localizedError(t, error));
    } finally {
      if (sequence === loadSequence.current) setSwitchingTaskId(undefined);
    }
  };
  const update = (value: OrganizerTask) => {
    setTask(value);
    setSelectedGroupId((current) =>
      value.groups.some((group) => group.id === current)
        ? current
        : value.groups[0]?.id,
    );
    void backend.listTasks().then(setTasks);
  };
  const rememberLibraryRoots = async (request: CreateTaskRequest) => {
    if (
      settings.defaultMovieRoot === request.movieRoot &&
      settings.defaultShowRoot === request.showRoot
    ) {
      return;
    }
    try {
      await saveSettings({
        ...settings,
        defaultMovieRoot: request.movieRoot,
        defaultShowRoot: request.showRoot,
      });
    } catch (error) {
      void backend.writeApplicationLog(
        "WARN",
        "settings.library-roots",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const create = async (request: CreateTaskRequest) => {
    setBusyState(true, t("tasks.scanning"), request.name);
    try {
      const value = await backend.createTask(request);
      await rememberLibraryRoots(request);
      setNewOpen(false);
      update(value);
      setStage("scan");
      setSelectedGroupId(undefined);
      message.success(t("tasks.taskCreated"));
      const scanned = await backend.scanTask(value.id);
      update(scanned);
      setStage("scan");
      setBusyState(false);
    } catch (error) {
      const detail = localizedError(t, error);
      message.error(detail);
      setBusyState(false, t("common.operationFailed"), detail);
    } finally {
      setProgress(undefined);
    }
  };
  const replaceTaskSource = async (item: TaskSummary) => {
    try {
      const sourceRoot = await backend.selectDirectory();
      if (!sourceRoot) return;
      const updateSource = async () => {
        setBusyState(true, t("tasks.updatingSource"), item.name);
        try {
          const value = await backend.updateTaskSource(item.id, sourceRoot);
          if (task?.id === item.id) {
            update(value);
            setStage(visibleStage(value.stage));
          } else {
            await refresh(task?.id);
          }
          message.success(t("tasks.sourceUpdated"));
        } catch (error) {
          message.error(localizedError(t, error));
        } finally {
          setBusyState(false);
        }
      };
      if (!item.fileCount) {
        await updateSource();
        return;
      }
      modal.confirm({
        title: t("tasks.changeSource"),
        content: t("tasks.changeSourceWarning"),
        okText: t("tasks.changeSourceConfirm"),
        cancelText: t("common.cancel"),
        onOk: updateSource,
      });
    } catch (error) {
      message.error(localizedError(t, error));
    }
  };
  const openTaskConfiguration = async (item: TaskSummary) => {
    try {
      setEditingTask(
        task?.id === item.id ? task : await backend.loadTask(item.id),
      );
    } catch (error) {
      message.error(localizedError(t, error));
    }
  };
  const saveTaskConfiguration = async (request: CreateTaskRequest) => {
    if (!editingTask) return;
    const persist = async () => {
      setBusyState(true, t("tasks.updatingTaskConfig"), editingTask.name);
      try {
        const value = await backend.updateTaskConfig(editingTask.id, request);
        await rememberLibraryRoots(request);
        setEditingTask(undefined);
        if (task?.id === value.id) {
          update(value);
          setStage(visibleStage(value.stage));
        } else {
          await refresh(task?.id);
        }
        message.success(t("tasks.taskConfigUpdated"));
      } catch (error) {
        message.error(localizedError(t, error));
      } finally {
        setBusyState(false);
      }
    };
    const resetsScan =
      editingTask.sourceRoot !== request.sourceRoot ||
      editingTask.mode !== request.mode;
    if (resetsScan && editingTask.files.length) {
      modal.confirm({
        title: t("tasks.editConfiguration"),
        content: t("tasks.changeConfigurationWarning"),
        okText: t("common.save"),
        cancelText: t("common.cancel"),
        onOk: persist,
      });
      return;
    }
    await persist();
  };
  const removeTask = (item: TaskSummary) => {
    modal.confirm({
      title: t("tasks.deleteTask"),
      content: t("tasks.deleteTaskConfirm"),
      okText: t("tasks.deleteTask"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        await backend.archiveTask(item.id);
        if (task?.id === item.id) {
          setTask(undefined);
          setSelectedGroupId(undefined);
          await refresh(null);
        } else {
          await refresh(task?.id);
        }
      },
    });
  };
  useEffect(() => {
    const currentSummary = () => tasks.find((item) => item.id === task?.id);
    const newTask = () => setNewOpen(true);
    const editTask = () => {
      const item = currentSummary();
      if (item) void openTaskConfiguration(item);
    };
    const changeSource = () => {
      const item = currentSummary();
      if (item) void replaceTaskSource(item);
    };
    const refreshTask = () => void refresh(task?.id);
    window.addEventListener("jellysmith-new-task", newTask);
    window.addEventListener("jellysmith-edit-current-task", editTask);
    window.addEventListener("jellysmith-change-current-source", changeSource);
    window.addEventListener("jellysmith-refresh-task", refreshTask);
    return () => {
      window.removeEventListener("jellysmith-new-task", newTask);
      window.removeEventListener("jellysmith-edit-current-task", editTask);
      window.removeEventListener(
        "jellysmith-change-current-source",
        changeSource,
      );
      window.removeEventListener("jellysmith-refresh-task", refreshTask);
    };
  }, [task, tasks, refresh]);
  const cancelScan = async () => {
    if (!task) return;
    try {
      await backend.cancelScan(task.id);
    } catch (error) {
      message.error(localizedError(t, error));
    }
  };
  const group = useMemo<MediaGroup | undefined>(
    () => task?.groups.find((item) => item.id === selectedGroupId),
    [selectedGroupId, task],
  );
  const stageItems = stages.map((item) => ({
    key: item,
    title: t(`tasks.stage_${item}`),
    icon: stageIcon(item),
    status: (item === stage
      ? "process"
      : stages.indexOf(item) <
          stages.indexOf(visibleStage(task?.stage ?? "scan"))
        ? "finish"
        : "wait") as "process" | "finish" | "wait",
  }));
  if (loading)
    return (
      <div className="page-loading">
        <Spin />
        {t("common.loading")}
      </div>
    );
  return (
    <div className="task-workbench">
      <aside className="task-sidebar">
        <header>
          <div>
            <Clapperboard />
            <b>{t("tasks.title")}</b>
          </div>
          <Button
            type="primary"
            icon={<Plus />}
            onClick={() => setNewOpen(true)}
          >
            {t("tasks.newTask")}
          </Button>
        </header>
        <div className="task-list">
          {tasks.map((item) => {
            const menu: MenuProps = {
              items: [
                {
                  key: "configure",
                  icon: <Pencil />,
                  label: t("tasks.editConfiguration"),
                },
                {
                  key: "source",
                  icon: <FolderCog />,
                  label: t("tasks.changeSource"),
                },
                { type: "divider" as const },
                {
                  key: "delete",
                  danger: true,
                  icon: <Trash2 />,
                  label: t("tasks.deleteTask"),
                },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === "configure") void openTaskConfiguration(item);
                else if (key === "source") void replaceTaskSource(item);
                else if (key === "delete") removeTask(item);
              },
            };
            const cardClassName = [
              "task-card",
              task?.id === item.id ? "active" : "",
              switchingTaskId === item.id ? "switching" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <Dropdown key={item.id} menu={menu} trigger={["contextMenu"]}>
                <div
                  className={cardClassName}
                  role="button"
                  tabIndex={0}
                  aria-busy={switchingTaskId === item.id}
                  onClick={() => void load(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      void load(item.id);
                  }}
                >
                  <span>
                    <b>{item.name}</b>
                    {switchingTaskId === item.id ? (
                      <Spin size="small" />
                    ) : (
                      <Tag
                        color={
                          item.status === "completed" ? "success" : "blue"
                        }
                      >
                        {t(`tasks.${item.status}`, {
                          defaultValue: item.status,
                        })}
                      </Tag>
                    )}
                    <Dropdown menu={menu} trigger={["click"]}>
                      <button
                        className="task-card-menu"
                        aria-label={t("tasks.taskMenu")}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal />
                      </button>
                    </Dropdown>
                  </span>
                  <small>
                    {item.mode === "single" ? <Film /> : <Layers3 />}
                    {t(
                      item.mode === "single"
                        ? "tasks.singleWork"
                        : "tasks.batchLibrary",
                    )}{" "}
                    · {item.fileCount} {t("tasks.files")}
                  </small>
                  <footer>
                    <time>{new Date(item.updatedAt).toLocaleString()}</time>
                    <em>{t(`tasks.stage_${visibleStage(item.stage)}`)}</em>
                  </footer>
                </div>
              </Dropdown>
            );
          })}
        </div>
      </aside>
      <main className="task-main">
        {task ? (
          <>
            <header className="task-toolbar">
              <div>
                <h1>{sourceFolderName(task.sourceRoot, task.name)}</h1>
                <p>{task.sourceRoot}</p>
              </div>
              <Tag color={task.mode === "single" ? "blue" : "purple"}>
                {t(
                  task.mode === "single"
                    ? "tasks.singleWork"
                    : "tasks.batchLibrary",
                )}
              </Tag>
              <Button
                icon={<RefreshCw />}
                onClick={() => void refresh(task.id)}
              >
                {t("common.refresh")}
              </Button>
            </header>
            <nav className="task-steps">
              <Steps
                responsive={false}
                size="small"
                current={stages.indexOf(stage)}
                items={stageItems}
                onChange={(index) => setStage(stages[index])}
              />
            </nav>
            {busyActivity?.label === t("tasks.scanning") &&
              progress?.taskId === task.id && (
                <div className="scan-progress">
                  <Progress percent={0} status="active" showInfo={false} />
                  <span>
                    {t("tasks.scanningCount", { count: progress.scanned })}
                  </span>
                  <small>{progress.currentPath}</small>
                  <Button
                    danger
                    size="small"
                    icon={<Square />}
                    onClick={() => void cancelScan()}
                  >
                    {t("common.cancel")}
                  </Button>
                </div>
              )}
            <TaskStages
              task={task}
              stage={stage}
              selectedGroup={group}
              busy={busy}
              onBusy={setBusyState}
              onTask={update}
              onSelectGroup={setSelectedGroupId}
              onStageChange={setStage}
              onFinished={() => void refresh(task.id)}
            />
          </>
        ) : (
          <div className="task-empty">
            <Clapperboard />
            <h2>{t("tasks.emptyTitle")}</h2>
            <p>{t("tasks.emptyHelp")}</p>
            <Button
              type="primary"
              size="large"
              icon={<Plus />}
              onClick={() => setNewOpen(true)}
            >
              {t("tasks.newTask")}
            </Button>
          </div>
        )}
      </main>
      <TaskInspector task={task} group={group} />
      <NewTaskModal
        open={newOpen}
        loading={busy}
        defaultMovieRoot={settings.defaultMovieRoot}
        defaultShowRoot={settings.defaultShowRoot}
        onCancel={() => setNewOpen(false)}
        onCreate={(request) => void create(request)}
      />
      <NewTaskModal
        open={Boolean(editingTask)}
        loading={busy}
        initial={
          editingTask
            ? {
                name: editingTask.name,
                mode: editingTask.mode,
                sourceRoot: editingTask.sourceRoot,
                movieRoot: editingTask.movieRoot,
                showRoot: editingTask.showRoot,
                operation: editingTask.operation,
              }
            : undefined
        }
        title={t("tasks.editConfiguration")}
        submitText={t("common.save")}
        onCancel={() => setEditingTask(undefined)}
        onCreate={(request) => void saveTaskConfiguration(request)}
      />
    </div>
  );
}
