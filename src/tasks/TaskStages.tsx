import {
  Alert,
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Tree,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DataNode } from "antd/es/tree";
import {
  Bot,
  CheckCircle2,
  File as FileIcon,
  Folder,
  FolderInput,
  Languages,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  AiGroupingProposal,
  EpisodeMapping,
  EpisodeNamingFormat,
  MediaGroup,
  OrganizerTask,
  ScannedFile,
  TaskStage,
  TmdbCandidate,
} from "../models";
import { backend } from "../services/backend";
import { localizedError } from "../services/errors";
import TmdbDetailsModal from "./TmdbDetailsModal";
import EpisodeNamingFormatModal from "./EpisodeNamingFormatModal";
import EpisodeMappingGrid, {
  type EpisodeGridField,
} from "./EpisodeMappingGrid";
import {
  ensureEditableEpisodeMappings,
  mergeAiEpisodeMappings,
  type AiEpisodeEvidence,
} from "./episodeMapping";
import {
  analyzeEpisodeMappings,
  offsetEpisodeMappings,
  renumberEpisodeMappings,
} from "./episodeMappingTools";
import {
  TmdbCandidateCard,
  TmdbCandidateViewSwitch,
  type CandidateView,
} from "./TmdbCandidateCard";
import {
  createPosterPalette,
  fallbackPosterPalette,
  type PosterPalette,
} from "../utils/posterPalette";
import {
  buildPlanTree,
  replaceTargetFileName,
  type PlanTreeNode,
} from "./planTree";

type Props = {
  task: OrganizerTask;
  stage: TaskStage;
  selectedGroup?: MediaGroup;
  busy: boolean;
  onBusy: (value: boolean, label?: string, detail?: string) => void;
  onTask: (task: OrganizerTask) => void;
  onSelectGroup: (id: string) => void;
  onStageChange: (stage: TaskStage) => void;
  onFinished: () => void;
};
const CANDIDATE_VIEW_KEY = "jellysmith-tmdb-candidate-view";
const TMDB_LANGUAGE_KEY = "jellysmith-tmdb-language";
const TMDB_SEARCH_CACHE_KEY = "jellysmith-tmdb-search-results-v1";
const TMDB_SEARCH_CACHE_LIMIT = 40;
const TMDB_LANGUAGES = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en-US", label: "English" },
  { value: "en-GB", label: "English (UK)" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "es-ES", label: "Español" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt-PT", label: "Português" },
  { value: "it-IT", label: "Italiano" },
  { value: "ru-RU", label: "Русский" },
  { value: "uk-UA", label: "Українська" },
  { value: "pl-PL", label: "Polski" },
  { value: "tr-TR", label: "Türkçe" },
  { value: "nl-NL", label: "Nederlands" },
  { value: "sv-SE", label: "Svenska" },
  { value: "da-DK", label: "Dansk" },
  { value: "nb-NO", label: "Norsk" },
  { value: "fi-FI", label: "Suomi" },
  { value: "th-TH", label: "ไทย" },
  { value: "vi-VN", label: "Tiếng Việt" },
  { value: "id-ID", label: "Bahasa Indonesia" },
  { value: "ar-SA", label: "العربية" },
  { value: "he-IL", label: "עברית" },
] as const;

type CachedTmdbSearch = {
  query: string;
  mediaType: string;
  language: string;
  candidates: TmdbCandidate[];
  posterPalettes: Record<number, PosterPalette>;
  savedAt: number;
};

type TmdbSearchCacheStore = {
  entries: Record<string, CachedTmdbSearch>;
  lastByGroup: Record<string, string>;
};

const tmdbGroupCacheKey = (taskId: string, groupId: string) =>
  `${taskId}:${groupId}`;

const tmdbSearchCacheKey = (
  taskId: string,
  groupId: string,
  query: string,
  mediaType: string,
  language: string,
) =>
  `${tmdbGroupCacheKey(taskId, groupId)}:${mediaType}:${language}:${query.trim().toLocaleLowerCase()}`;

function readTmdbSearchCache(): TmdbSearchCacheStore {
  try {
    const value = JSON.parse(
      localStorage.getItem(TMDB_SEARCH_CACHE_KEY) ?? "{}",
    ) as Partial<TmdbSearchCacheStore>;
    return {
      entries: value.entries ?? {},
      lastByGroup: value.lastByGroup ?? {},
    };
  } catch {
    return { entries: {}, lastByGroup: {} };
  }
}

function cachedTmdbSearch(taskId: string, groupId: string) {
  const store = readTmdbSearchCache();
  const key = store.lastByGroup[tmdbGroupCacheKey(taskId, groupId)];
  const entry = key ? store.entries[key] : undefined;
  return entry && Array.isArray(entry.candidates) ? entry : undefined;
}

function cacheTmdbSearch(
  taskId: string,
  groupId: string,
  value: CachedTmdbSearch,
) {
  try {
    const store = readTmdbSearchCache();
    const key = tmdbSearchCacheKey(
      taskId,
      groupId,
      value.query,
      value.mediaType,
      value.language,
    );
    store.entries[key] = value;
    store.lastByGroup[tmdbGroupCacheKey(taskId, groupId)] = key;
    const retained = Object.entries(store.entries)
      .sort(([, left], [, right]) => right.savedAt - left.savedAt)
      .slice(0, TMDB_SEARCH_CACHE_LIMIT);
    store.entries = Object.fromEntries(retained);
    const retainedKeys = new Set(retained.map(([entryKey]) => entryKey));
    store.lastByGroup = Object.fromEntries(
      Object.entries(store.lastByGroup).filter(([, entryKey]) =>
        retainedKeys.has(entryKey),
      ),
    );
    localStorage.setItem(TMDB_SEARCH_CACHE_KEY, JSON.stringify(store));
  } catch {
    // Search results still remain available for the mounted page.
  }
}

function initialCandidateView(): CandidateView {
  try {
    const saved = localStorage.getItem(CANDIDATE_VIEW_KEY);
    if (saved === "single" || saved === "double" || saved === "compact")
      return saved;
  } catch {
    // Storage can be unavailable in hardened WebViews; the view still works.
  }
  return "single";
}

function initialTmdbLanguage(applicationLanguage: string) {
  try {
    const saved = localStorage.getItem(TMDB_LANGUAGE_KEY);
    if (TMDB_LANGUAGES.some((item) => item.value === saved)) return saved!;
  } catch {
    // Storage can be unavailable; fall back to the application language.
  }
  return TMDB_LANGUAGES.some((item) => item.value === applicationLanguage)
    ? applicationLanguage
    : "en-US";
}

const bytes = (value: number) =>
  value > 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(2)} GB`
    : value > 1024 ** 2
      ? `${(value / 1024 ** 2).toFixed(1)} MB`
      : `${Math.ceil(value / 1024)} KB`;

function directoryTree(files: ScannedFile[]): DataNode[] {
  const roots: DataNode[] = [];
  const directories = new Map<string, DataNode>();
  for (const file of files) {
    const parts = file.relativePath.split("/");
    let children = roots;
    let path = "";
    parts.forEach((part, index) => {
      path = path ? `${path}/${part}` : part;
      if (index === parts.length - 1) {
        children.push({ key: file.id, title: part, isLeaf: true });
        return;
      }
      let node = directories.get(path);
      if (!node) {
        node = { key: `directory:${path}`, title: part, children: [] };
        directories.set(path, node);
        children.push(node);
      }
      children = node.children ?? [];
    });
  }
  return roots;
}

export default function TaskStages(props: Props) {
  if (props.stage === "scan") return <ScanStage {...props} />;
  if (props.stage === "group") return <GroupStage {...props} />;
  if (props.stage === "match") return <MatchStage {...props} />;
  if (props.stage === "episodes") return <EpisodeStage {...props} />;
  return <PlanStage {...props} />;
}

function useAction(props: Props) {
  const { message } = App.useApp();
  const { t } = useTranslation();
  return async (
    action: () => Promise<OrganizerTask>,
    success?: string,
    activityLabel = t("tasks.processing"),
  ) => {
    props.onBusy(true, activityLabel);
    try {
      const task = await action();
      props.onTask(task);
      if (success) message.success(success);
      props.onBusy(false);
    } catch (error) {
      const detail = localizedError(t, error);
      message.error(detail);
      props.onBusy(false, t("common.operationFailed"), detail);
    }
  };
}

function StageHeader({
  icon,
  title,
  description,
  extra,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  extra?: React.ReactNode;
}) {
  return (
    <header className="stage-header">
      <span>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {extra && <div className="stage-actions">{extra}</div>}
    </header>
  );
}

function GroupPicker(props: Props) {
  const { t } = useTranslation();
  return (
    <div className="group-picker">
      <span>{t("tasks.mediaGroups")}</span>
      <Select
        value={props.selectedGroup?.id}
        placeholder={t("tasks.selectGroup")}
        options={props.task.groups.map((group) => ({
          value: group.id,
          label: `${group.confirmed ? "✓" : "○"} ${group.titleGuess}`,
        }))}
        onChange={props.onSelectGroup}
      />
    </div>
  );
}

function ScanStage(props: Props) {
  const { t } = useTranslation();
  const run = useAction(props);
  const [selectedFileIds, setSelectedFileIds] = useState<React.Key[]>([]);
  const tableHostRef = useRef<HTMLElement>(null);
  const [tableBodyHeight, setTableBodyHeight] = useState(320);
  useEffect(() => {
    setSelectedFileIds(props.task.files.map((file) => file.id));
  }, [props.task.id, props.task.updatedAt, props.task.files]);
  useEffect(() => {
    const host = tableHostRef.current;
    if (!host) return;
    const updateHeight = () =>
      setTableBodyHeight(Math.max(160, Math.floor(host.clientHeight) - 40));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const tree = useMemo(
    () => directoryTree(props.task.files),
    [props.task.files],
  );
  const extensionGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const file of props.task.files) {
      const extension = file.extension.toLowerCase();
      groups.set(extension, [...(groups.get(extension) ?? []), file.id]);
    }
    return [...groups.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [props.task.files, t]);
  const selectedSet = useMemo(
    () => new Set(selectedFileIds.map(String)),
    [selectedFileIds],
  );
  const hasSelectedVideo = props.task.files.some(
    (file) => file.kind === "video" && selectedSet.has(file.id),
  );
  const columns: ColumnsType<ScannedFile> = [
    { title: t("tasks.path"), dataIndex: "relativePath", ellipsis: true },
    {
      title: t("tasks.kind"),
      dataIndex: "kind",
      width: 100,
      render: (value) => (
        <Tag>{t(`tasks.kind_${value}`, { defaultValue: value })}</Tag>
      ),
    },
    {
      title: t("tasks.parsed"),
      width: 220,
      render: (_, file) => (
        <span>
          {file.parsed.title || "—"}
          {file.parsed.season !== undefined &&
            ` · S${String(file.parsed.season).padStart(2, "0")}E${String(file.parsed.episodes[0] ?? 0).padStart(2, "0")}`}
        </span>
      ),
    },
    { title: t("tasks.size"), dataIndex: "size", width: 90, render: bytes },
    {
      title: t("tasks.state"),
      width: 110,
      render: (_, file) =>
        file.warning ? (
          <Tag color="warning">
            {t(`errors.${file.warning}`, { defaultValue: file.warning })}
          </Tag>
        ) : (
          <Tag color="success">{t("tasks.ready")}</Tag>
        ),
    },
  ];
  return (
    <section className="task-stage scan-stage">
      <StageHeader
        icon={<FolderInput />}
        title={t("tasks.stageScan")}
        description={t("tasks.stageScanHelp")}
        extra={
          <Space>
            {props.busy ? (
              <Button
                danger
                onClick={() => void backend.cancelScan(props.task.id)}
              >
                {t("common.cancel")}
              </Button>
            ) : (
              <Button
                icon={<RefreshCw />}
                onClick={() =>
                  void run(
                    () => backend.scanTask(props.task.id),
                    t("tasks.scanComplete"),
                    t("tasks.scanning"),
                  )
                }
              >
                {props.task.files.length
                  ? t("tasks.rescan")
                  : t("tasks.startScan")}
              </Button>
            )}
            <Button
              type="primary"
              disabled={props.busy || !hasSelectedVideo}
              onClick={() =>
                void run(
                  async () => {
                    const selected = await backend.confirmScanSelection(
                      props.task.id,
                      selectedFileIds.map(String),
                    );
                    return backend.groupTask(selected.id);
                  },
                  t("tasks.groupComplete"),
                  t("tasks.groupingFiles"),
                )
              }
            >
              {t("tasks.confirmSelection")}
            </Button>
          </Space>
        }
      />
      <div className="scan-file-filters">
        <b>{t("tasks.selectByExtension")}</b>
        <div>
          {extensionGroups.map(([extension, ids]) => {
            const selectedCount = ids.filter((id) =>
              selectedSet.has(id),
            ).length;
            return (
              <Checkbox
                key={extension}
                checked={selectedCount === ids.length}
                indeterminate={selectedCount > 0 && selectedCount < ids.length}
                onChange={(event) => {
                  const next = new Set(selectedSet);
                  ids.forEach((id) =>
                    event.target.checked ? next.add(id) : next.delete(id),
                  );
                  setSelectedFileIds([...next]);
                }}
              >
                <span>
                  {extension
                    ? extension.startsWith(".")
                      ? extension
                      : `.${extension}`
                    : t("tasks.noExtension")}
                </span>
                <Tag>{ids.length}</Tag>
              </Checkbox>
            );
          })}
        </div>
        <span>
          {t("tasks.selectedFiles", {
            selected: selectedFileIds.length,
            total: props.task.files.length,
          })}
        </span>
        <Button
          size="small"
          onClick={() =>
            setSelectedFileIds(props.task.files.map((file) => file.id))
          }
        >
          {t("common.selectAll")}
        </Button>
        <Button size="small" onClick={() => setSelectedFileIds([])}>
          {t("common.clear")}
        </Button>
      </div>
      <div className="scan-layout">
        <aside>
          <b>{t("tasks.sourceTree")}</b>
          <Tree
            checkable
            checkedKeys={selectedFileIds}
            onCheck={(keys) =>
              setSelectedFileIds(
                (Array.isArray(keys) ? keys : keys.checked).filter(
                  (key) => !String(key).startsWith("directory:"),
                ),
              )
            }
            showLine
            defaultExpandAll={props.task.files.length < 100}
            treeData={tree}
          />
        </aside>
        <main ref={tableHostRef}>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            rowSelection={{
              selectedRowKeys: selectedFileIds,
              onChange: setSelectedFileIds,
            }}
            scroll={{ x: 850, y: tableBodyHeight }}
            columns={columns}
            dataSource={props.task.files}
          />
        </main>
      </div>
    </section>
  );
}

function GroupStage(props: Props) {
  const { t, i18n } = useTranslation();
  const { message, modal } = App.useApp();
  const run = useAction(props);
  const [selectedFiles, setSelectedFiles] = useState<React.Key[]>([]);
  const [proposals, setProposals] = useState<AiGroupingProposal[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [view, setView] = useState<"group" | "unassigned" | "all">("group");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupYear, setGroupYear] = useState<number>();
  const [groupType, setGroupType] = useState("unknown");
  useEffect(() => {
    setGroupTitle(props.selectedGroup?.titleGuess ?? "");
    setGroupYear(props.selectedGroup?.year);
    setGroupType(props.selectedGroup?.mediaType ?? "unknown");
  }, [
    props.selectedGroup?.id,
    props.selectedGroup?.mediaType,
    props.selectedGroup?.titleGuess,
    props.selectedGroup?.year,
  ]);
  const files = props.task.files.filter((file) => {
    if (view === "all") return true;
    if (view === "unassigned") return !file.groupId;
    return props.selectedGroup?.fileIds.includes(file.id) ?? false;
  });
  const columns: ColumnsType<ScannedFile> = [
    { title: t("tasks.file"), dataIndex: "relativePath", ellipsis: true },
    {
      title: t("tasks.kind"),
      dataIndex: "kind",
      width: 95,
      render: (value) => (
        <Tag>{t(`tasks.kind_${value}`, { defaultValue: value })}</Tag>
      ),
    },
    {
      title: t("tasks.guess"),
      width: 210,
      render: (_, file) => (
        <span>
          {file.parsed.title || "—"} {file.parsed.year || ""}
        </span>
      ),
    },
  ];
  const ai = async () => {
    props.onBusy(true, t("tasks.aiGrouping"));
    try {
      setProposals(
        await backend.proposeAiGrouping(props.task.id, i18n.language),
      );
    } catch (error) {
      message.error(localizedError(t, error));
    } finally {
      props.onBusy(false);
    }
  };
  const applyProposals = async (items: AiGroupingProposal[]) => {
    props.onBusy(true, t("tasks.applyingAiProposal"));
    try {
      props.onTask(await backend.applyAiGrouping(props.task.id, items));
      setProposals((current) =>
        current.filter((item) => !items.some((value) => value.id === item.id)),
      );
      message.success(t("tasks.aiApplied"));
    } catch (error) {
      message.error(localizedError(t, error));
    } finally {
      props.onBusy(false);
    }
  };
  const saveGroup = () => {
    const group = props.selectedGroup;
    if (!group) return;
    void run(
      () =>
        backend.updateGroup(props.task.id, {
          ...group,
          titleGuess: groupTitle,
          year: groupYear,
          mediaType: groupType as MediaGroup["mediaType"],
        }),
      t("common.saved"),
    );
  };
  const deleteGroup = () => {
    const group = props.selectedGroup;
    if (!group) return;
    modal.confirm({
      title: t("tasks.deleteGroup"),
      content: t("tasks.deleteGroupConfirm", { name: group.titleGuess }),
      okText: t("common.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        await run(
          () => backend.deleteGroup(props.task.id, group.id),
          t("tasks.groupDeleted"),
        );
        setView("unassigned");
      },
    });
  };
  const unassignedCount = props.task.files.filter(
    (file) => !file.groupId,
  ).length;
  return (
    <section className="task-stage group-stage">
      <StageHeader
        icon={<Users />}
        title={t("tasks.stageGroup")}
        description={t("tasks.stageGroupHelp")}
        extra={
          <Space>
            <Button
              icon={<Bot />}
              loading={props.busy}
              onClick={() => void ai()}
            >
              {t("tasks.aiAssist")}
            </Button>
            <Button onClick={() => setNewOpen(true)}>
              {t("tasks.newGroup")}
            </Button>
          </Space>
        }
      />
      <div className="grouping-layout">
        <aside className="group-list">
          <header>
            <b>{t("tasks.mediaGroups")}</b>
            <Tag>{props.task.groups.length}</Tag>
          </header>
          <button
            className={`scope-button ${view === "all" ? "active" : ""}`}
            onClick={() => setView("all")}
          >
            <span>
              <b>{t("tasks.totalFiles")}</b>
              <small>
                {props.task.files.length} {t("tasks.files")}
              </small>
            </span>
            <Tag>{props.task.files.length}</Tag>
          </button>
          <button
            className={`scope-button ${view === "unassigned" ? "active" : ""}`}
            onClick={() => setView("unassigned")}
          >
            <span>
              <b>{t("tasks.unassigned")}</b>
              <small>{t("tasks.needsGrouping")}</small>
            </span>
            <Tag color={unassignedCount ? "warning" : "success"}>
              {unassignedCount}
            </Tag>
          </button>
          <div className="group-list-divider" />
          {props.task.groups.map((group) => (
            <button
              draggable
              key={group.id}
              className={
                props.selectedGroup?.id === group.id && view === "group"
                  ? "active"
                  : ""
              }
              onClick={() => {
                props.onSelectGroup(group.id);
                setView("group");
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData(
                  "application/jellysmith-file",
                );
                if (id)
                  void run(
                    () =>
                      backend.moveFilesToGroup(props.task.id, [id], group.id),
                    t("tasks.fileMoved"),
                  );
              }}
            >
              <span>
                <b>{group.titleGuess}</b>
                <small>
                  {group.year || "—"} ·{" "}
                  {t(`tasks.${group.mediaType}`, {
                    defaultValue: group.mediaType,
                  })}
                </small>
              </span>
              <Progress
                type="circle"
                size={30}
                percent={Math.round(group.confidence * 100)}
              />
            </button>
          ))}
        </aside>
        <main>
          <div className="group-editor">
            <Input
              disabled={!props.selectedGroup}
              value={groupTitle}
              onChange={(event) => setGroupTitle(event.target.value)}
              placeholder={t("tasks.groupTitle")}
            />
            <InputNumber
              disabled={!props.selectedGroup}
              value={groupYear}
              onChange={(value) => setGroupYear(value ?? undefined)}
              placeholder="YYYY"
            />
            <Segmented
              disabled={!props.selectedGroup}
              value={groupType}
              onChange={(value) => setGroupType(String(value))}
              options={[
                { value: "movie", label: t("tasks.movie") },
                { value: "tv", label: t("tasks.tv") },
                { value: "unknown", label: t("tasks.unknown") },
              ]}
            />
            <Button
              danger
              icon={<Trash2 />}
              disabled={!props.selectedGroup}
              onClick={deleteGroup}
            >
              {t("common.delete")}
            </Button>
            <Button
              type="primary"
              disabled={!props.selectedGroup}
              onClick={saveGroup}
            >
              {t("common.save")}
            </Button>
          </div>
          <div className="table-tools">
            <div className="file-scope-title">
              <b>
                {view === "all"
                  ? t("tasks.totalFiles")
                  : view === "unassigned"
                    ? t("tasks.unassigned")
                    : props.selectedGroup?.titleGuess || t("tasks.groupFiles")}
              </b>
              <Tag>{files.length}</Tag>
            </div>
            <Space>
              <Select
                disabled={!selectedFiles.length}
                placeholder={t("tasks.moveToGroup")}
                style={{ width: 180 }}
                options={props.task.groups
                  .filter(
                    (group) =>
                      view !== "group" || group.id !== props.selectedGroup?.id,
                  )
                  .map((group) => ({
                    value: group.id,
                    label: group.titleGuess,
                  }))}
                onChange={(groupId) =>
                  void run(
                    () =>
                      backend.moveFilesToGroup(
                        props.task.id,
                        selectedFiles.map(String),
                        groupId,
                      ),
                    t("tasks.fileMoved"),
                  )
                }
              />
            </Space>
          </div>
          <Table
            rowKey="id"
            size="small"
            pagination={{ pageSize: 100, showSizeChanger: false }}
            rowSelection={{
              selectedRowKeys: selectedFiles,
              onChange: setSelectedFiles,
            }}
            columns={columns}
            dataSource={files}
            onRow={(file) => ({
              draggable: true,
              onDragStart: (event) =>
                event.dataTransfer.setData(
                  "application/jellysmith-file",
                  file.id,
                ),
            })}
          />
        </main>
      </div>
      {proposals.length > 0 && (
        <div className="ai-proposals">
          <header>
            <Sparkles />
            <b>{t("tasks.aiProposals")}</b>
            <span />
            <Button onClick={() => setProposals([])}>
              {t("common.cancel")}
            </Button>
            <Button
              type="primary"
              onClick={() => void applyProposals(proposals)}
            >
              {t("tasks.applyProposals")}
            </Button>
          </header>
          {proposals.map((proposal) => (
            <article key={proposal.id}>
              <div>
                <b>{proposal.title}</b>
                <Tag>{proposal.year || "—"}</Tag>
                <Tag color="purple">{proposal.mediaType}</Tag>
              </div>
              <p>{proposal.reason}</p>
              <small>
                {proposal.fileIds.length} {t("tasks.files")} ·{" "}
                {Math.round(proposal.confidence * 100)}%
              </small>
              <footer>
                <Button
                  size="small"
                  onClick={() =>
                    setProposals((current) =>
                      current.filter((item) => item.id !== proposal.id),
                    )
                  }
                >
                  {t("tasks.rejectProposal")}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => void applyProposals([proposal])}
                >
                  {t("tasks.applyProposal")}
                </Button>
              </footer>
            </article>
          ))}
        </div>
      )}
      <Modal
        open={newOpen}
        title={t("tasks.newGroup")}
        okText={t("common.create")}
        onCancel={() => setNewOpen(false)}
        onOk={() => {
          void run(
            () =>
              backend.createGroup(
                props.task.id,
                newTitle,
                "unknown",
                selectedFiles.map(String),
              ),
            t("tasks.groupCreated"),
          );
          setNewOpen(false);
          setNewTitle("");
        }}
      >
        <Input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder={t("tasks.groupTitle")}
        />
      </Modal>
    </section>
  );
}

function MatchStage(props: Props) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const run = useAction(props);
  const group = props.selectedGroup;
  const activeGroupId = useRef(group?.id);
  const [query, setQuery] = useState(group?.titleGuess ?? "");
  const [mediaType, setMediaType] = useState(
    group?.mediaType === "tv" ? "tv" : "movie",
  );
  const [candidates, setCandidates] = useState<TmdbCandidate[]>([]);
  const [posterPalettes, setPosterPalettes] = useState<
    Record<number, PosterPalette>
  >({});
  const [detailCandidate, setDetailCandidate] = useState<TmdbCandidate>();
  const [candidateView, setCandidateView] =
    useState<CandidateView>(initialCandidateView);
  const [searching, setSearching] = useState(false);
  const [searchLanguage, setSearchLanguage] = useState(() =>
    initialTmdbLanguage(i18n.language),
  );
  const [titleMode, setTitleMode] = useState("localized");
  const [manualTitle, setManualTitle] = useState(group?.titleGuess ?? "");
  useEffect(() => {
    try {
      localStorage.setItem(CANDIDATE_VIEW_KEY, candidateView);
    } catch {
      // Keep the selected view for this session when storage is unavailable.
    }
  }, [candidateView]);
  useEffect(() => {
    try {
      localStorage.setItem(TMDB_LANGUAGE_KEY, searchLanguage);
    } catch {
      // The selection still remains active for this session.
    }
  }, [searchLanguage]);
  useEffect(() => {
    activeGroupId.current = group?.id;
    const cached = group
      ? cachedTmdbSearch(props.task.id, group.id)
      : undefined;
    setQuery(cached?.query ?? group?.titleGuess ?? "");
    setMediaType(
      cached?.mediaType ?? (group?.mediaType === "tv" ? "tv" : "movie"),
    );
    if (cached?.language) setSearchLanguage(cached.language);
    setManualTitle(group?.titleGuess ?? "");
    setTitleMode("localized");
    setCandidates(cached?.candidates ?? []);
    setPosterPalettes(cached?.posterPalettes ?? {});
    setDetailCandidate(undefined);
  }, [group?.id, props.task.id]);
  const search = async () => {
    if (!group) return;
    setSearching(true);
    props.onBusy(true, t("tasks.searchingTmdb"), query);
    try {
      const items = await backend.searchTmdb(
        query,
        mediaType,
        searchLanguage,
        true,
      );
      setCandidates(items);
      setPosterPalettes({});
      const cachedValue: CachedTmdbSearch = {
        query,
        mediaType,
        language: searchLanguage,
        candidates: items,
        posterPalettes: {},
        savedAt: Date.now(),
      };
      cacheTmdbSearch(props.task.id, group.id, cachedValue);
      void Promise.all(
        items.map(async (candidate) => {
          if (!candidate.posterPath) return;
          try {
            const color = await backend.getTmdbImageColor(candidate.posterPath);
            return [
              candidate.id,
              createPosterPalette({
                r: color.red,
                g: color.green,
                b: color.blue,
              }),
            ] as const;
          } catch {
            return undefined;
          }
        }),
      ).then((entries) => {
        const palettes = Object.fromEntries(
          entries.filter((entry) => entry !== undefined),
        ) as Record<number, PosterPalette>;
        if (activeGroupId.current === group.id) setPosterPalettes(palettes);
        cacheTmdbSearch(props.task.id, group.id, {
          ...cachedValue,
          posterPalettes: palettes,
        });
      });
    } catch (error) {
      message.error(localizedError(t, error));
    } finally {
      setSearching(false);
      props.onBusy(false);
    }
  };
  if (!group)
    return (
      <section className="task-stage">
        <Empty description={t("tasks.selectGroup")} />
      </section>
    );
  return (
    <section className="task-stage">
      <StageHeader
        icon={<Search />}
        title={t("tasks.stageMatch")}
        description={t("tasks.stageMatchHelp")}
        extra={
          <Tag
            color={
              props.task.groups.every((item) => item.confirmed)
                ? "success"
                : "warning"
            }
          >
            {props.task.groups.filter((item) => item.confirmed).length}/
            {props.task.groups.length} {t("tasks.confirmed")}
          </Tag>
        }
      />
      <GroupPicker {...props} />
      <div className="match-search">
        <Segmented
          value={mediaType}
          onChange={(value) => setMediaType(String(value))}
          options={[
            { value: "movie", label: t("tasks.movie") },
            { value: "tv", label: t("tasks.tv") },
          ]}
        />
        <Select
          className="tmdb-language-select"
          aria-label={t("tasks.tmdbLanguage")}
          prefix={<Languages />}
          value={searchLanguage}
          showSearch
          optionFilterProp="label"
          options={TMDB_LANGUAGES.map((item) => ({
            value: item.value,
            label: `${item.label} · ${item.value}`,
          }))}
          onChange={setSearchLanguage}
        />
        <Input.Search
          value={query}
          loading={searching}
          onChange={(event) => setQuery(event.target.value)}
          onSearch={() => void search()}
          enterButton={t("tasks.searchTmdb")}
        />
        <Button icon={<RefreshCw />} onClick={() => void search()} />
      </div>
      <div className="title-mode-row">
        <Radio.Group
          value={titleMode}
          onChange={(event) => setTitleMode(event.target.value)}
        >
          <Radio.Button value="localized">
            {t("tasks.localizedTitle")}
          </Radio.Button>
          <Radio.Button value="original">
            {t("tasks.originalTitle")}
          </Radio.Button>
          <Radio.Button value="manual">{t("tasks.manual")}</Radio.Button>
        </Radio.Group>
        {titleMode === "manual" && (
          <Input
            value={manualTitle}
            onChange={(event) => setManualTitle(event.target.value)}
            placeholder={t("tasks.groupTitle")}
          />
        )}
      </div>
      {candidates.length > 0 && (
        <div className="candidate-list-header">
          <span>{t("tasks.matchResults", { count: candidates.length })}</span>
          <TmdbCandidateViewSwitch
            value={candidateView}
            onChange={setCandidateView}
          />
        </div>
      )}
      <div className={`candidate-grid view-${candidateView}`}>
        {candidates.map((candidate) => {
          const palette =
            posterPalettes[candidate.id] ?? fallbackPosterPalette(candidate.id);
          const posterUrl = candidate.posterPath
            ? `https://image.tmdb.org/t/p/w342${candidate.posterPath}`
            : undefined;
          const cardStyle = {
            "--poster-glow": palette.accentGlow,
            "--poster-image": posterUrl ? `url(${posterUrl})` : "none",
          } as CSSProperties;
          return (
            <TmdbCandidateCard
              key={candidate.id}
              style={cardStyle}
              candidate={candidate}
              posterUrl={posterUrl}
              selected={group.matched?.candidate.id === candidate.id}
              view={candidateView}
              onDetails={() => setDetailCandidate(candidate)}
              onConfirm={() =>
                void run(
                  () =>
                    backend.confirmTmdb(
                      props.task.id,
                      group.id,
                      candidate,
                      titleMode,
                      searchLanguage,
                      manualTitle,
                    ),
                  t("tasks.matchConfirmed"),
                )
              }
            />
          );
        })}
      </div>
      {!candidates.length && <Empty description={t("tasks.searchHint")} />}
      <div className="manual-match">
        <Alert type="info" showIcon title={t("tasks.manualFallback")} />
        <Button
          onClick={() =>
            void run(
              () =>
                backend.confirmManual(
                  props.task.id,
                  group.id,
                  query,
                  group.year,
                  mediaType,
                ),
              t("tasks.matchConfirmed"),
            )
          }
        >
          {t("tasks.confirmManual")}
        </Button>
      </div>
      <TmdbDetailsModal
        open={Boolean(detailCandidate)}
        candidate={detailCandidate}
        language={searchLanguage}
        onClose={() => setDetailCandidate(undefined)}
      />
    </section>
  );
}

function EpisodeStage(props: Props) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const group = props.selectedGroup;
  const initialMappings = () =>
    group?.mediaType === "tv"
      ? ensureEditableEpisodeMappings(
          group.episodeMappings,
          group.fileIds,
          props.task.files,
        )
      : (group?.episodeMappings ?? []);
  const [mappings, setMappings] = useState<EpisodeMapping[]>(initialMappings);
  const mappingsRef = useRef(mappings);
  const activeMappingGroupId = useRef(group?.id);
  const autoSaveTimer = useRef<number | undefined>(undefined);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const queuedMappingSignatures = useRef<Record<string, string>>({});
  const [autoSaveState, setAutoSaveState] = useState<
    "saved" | "saving" | "error"
  >("saved");
  const [aiEvidence, setAiEvidence] = useState<
    Record<string, AiEpisodeEvidence>
  >({});
  const [namingModalOpen, setNamingModalOpen] = useState(false);
  const [selectedMappingIds, setSelectedMappingIds] = useState<Set<string>>(
    new Set(),
  );
  const [mappingView, setMappingView] = useState<
    "all" | "issues" | "unconfirmed"
  >("all");
  const [bulkSeason, setBulkSeason] = useState(1);
  const [bulkFrom, setBulkFrom] = useState(1);
  const [bulkOffset, setBulkOffset] = useState(1);
  const [renumberStart, setRenumberStart] = useState(1);
  const [activeCell, setActiveCell] = useState<{
    row: number;
    field?: EpisodeGridField;
  }>();
  const mappingAnalysis = useMemo(
    () => analyzeEpisodeMappings(mappings),
    [mappings],
  );
  const enqueueMappingSave = (
    taskId: string,
    groupId: string,
    snapshot: EpisodeMapping[],
  ) => {
    const signature = JSON.stringify(snapshot);
    queuedMappingSignatures.current[groupId] = signature;
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const updated = await backend.updateEpisodes(
            taskId,
            groupId,
            snapshot,
          );
          props.onTask(updated);
          if (
            activeMappingGroupId.current === groupId &&
            JSON.stringify(mappingsRef.current) === signature
          )
            setAutoSaveState("saved");
        } catch (error) {
          if (activeMappingGroupId.current === groupId) {
            setAutoSaveState("error");
            message.error(localizedError(t, error));
          }
        }
      });
  };
  useEffect(() => {
    activeMappingGroupId.current = group?.id;
    const nextMappings = initialMappings();
    mappingsRef.current = nextMappings;
    if (group)
      queuedMappingSignatures.current[group.id] =
        JSON.stringify(nextMappings);
    setMappings(nextMappings);
    setAiEvidence({});
    setNamingModalOpen(false);
    setSelectedMappingIds(new Set());
    setMappingView("all");
    setBulkSeason(nextMappings[0]?.season ?? 1);
    setBulkFrom(1);
    setBulkOffset(1);
    setRenumberStart(1);
    setActiveCell(undefined);
    setAutoSaveState("saved");
    return () => {
      window.clearTimeout(autoSaveTimer.current);
      if (!group || group.mediaType !== "tv") return;
      const snapshot = mappingsRef.current;
      if (
        JSON.stringify(snapshot) !== queuedMappingSignatures.current[group.id]
      )
        enqueueMappingSave(props.task.id, group.id, snapshot);
    };
  }, [group?.id]);
  useEffect(() => {
    mappingsRef.current = mappings;
    if (!group || group.mediaType !== "tv") return;
    const signature = JSON.stringify(mappings);
    if (signature === queuedMappingSignatures.current[group.id]) return;
    setAutoSaveState("saving");
    window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(
      () => enqueueMappingSave(props.task.id, group.id, mappings),
      500,
    );
    return () => window.clearTimeout(autoSaveTimer.current);
  }, [group?.id, mappings]);
  if (!group)
    return (
      <section className="task-stage">
        <Empty description={t("tasks.selectGroup")} />
      </section>
    );
  if (group.mediaType !== "tv")
    return (
      <section className="task-stage">
        <StageHeader
          icon={<CheckCircle2 />}
          title={t("tasks.stageEpisodes")}
          description={t("tasks.moviesNeedNoEpisodes")}
        />
        <GroupPicker {...props} />
        <Alert
          type="success"
          showIcon
          title={t("tasks.movieMappingComplete")}
        />
      </section>
    );
  const files = new Map(props.task.files.map((file) => [file.id, file]));
  const seasonOptions = [...new Set(mappings.map((item) => item.season))]
    .sort((left, right) => left - right)
    .map((value) => ({
      value,
      label: t("tasks.seasonNumber", { count: value }),
    }));
  if (!seasonOptions.some((item) => item.value === bulkSeason))
    seasonOptions.push({
      value: bulkSeason,
      label: t("tasks.seasonNumber", { count: bulkSeason }),
    });
  const visibleMappings = mappings.filter((mapping) => {
    if (mappingView === "unconfirmed") return !mapping.confirmed;
    if (mappingView === "issues")
      return mappingAnalysis.issueFileIds.has(mapping.fileId);
    return true;
  });
  const selectedSet = selectedMappingIds;
  const selectScope = (fromEpisode?: number) => {
    setSelectedMappingIds(
      new Set(
        mappings
          .filter(
            (item) =>
              item.season === bulkSeason &&
              (fromEpisode === undefined || item.episode >= fromEpisode),
          )
          .map((item) => item.fileId),
      ),
    );
  };
  const requireSelection = () => {
    if (selectedSet.size) return true;
    message.warning(t("tasks.selectMappingsFirst"));
    return false;
  };
  const applyOffset = () => {
    if (!requireSelection()) return;
    setMappings((current) =>
      offsetEpisodeMappings(current, selectedSet, bulkOffset),
    );
  };
  const renumberSelected = () => {
    if (!requireSelection()) return;
    const ordered = mappings
      .filter((item) => selectedSet.has(item.fileId))
      .sort((left, right) =>
        (files.get(left.fileId)?.relativePath ?? left.fileId).localeCompare(
          files.get(right.fileId)?.relativePath ?? right.fileId,
          undefined,
          { numeric: true },
        ),
      )
      .map((item) => item.fileId);
    setMappings((current) =>
      renumberEpisodeMappings(current, ordered, bulkSeason, renumberStart),
    );
  };
  const fillDownSelected = () => {
    if (!requireSelection()) return;
    if (!activeCell) {
      message.warning(t("tasks.selectSourceCell"));
      return;
    }
    const field = activeCell.field;
    const source = visibleMappings[activeCell.row];
    if (!source || !field) return;
    setMappings((current) =>
      current.map((item) =>
        selectedSet.has(item.fileId)
          ? { ...item, [field]: source[field], confirmed: false }
          : item,
      ),
    );
  };
  const withTmdbTitles = async (items: EpisodeMapping[]) => {
    const id = group.matched?.candidate.id;
    if (!id) return items;
    const metadataLanguage = group.matched?.language || i18n.language;
    const seasons = [...new Set(items.map((item) => item.season))];
    const episodes = (
      await Promise.all(
        seasons.map((season) =>
          backend.getTmdbSeason(id, season, metadataLanguage),
        ),
      )
    ).flat();
    return items.map((item) => ({
      ...item,
      title:
        episodes.find(
          (episode) =>
            episode.season === item.season && episode.episode === item.episode,
        )?.title ?? item.title,
    }));
  };
  const fill = async () => {
    props.onBusy(true, t("tasks.loadingTmdbEpisodes"));
    try {
      setMappings(await withTmdbTitles(mappings));
    } catch (error) {
      message.error(localizedError(t, error));
    } finally {
      props.onBusy(false);
    }
  };
  const proposeWithAi = async (namingFormat: EpisodeNamingFormat) => {
    props.onBusy(true, t("tasks.aiMappingEpisodes"), group.titleGuess);
    try {
      const updatedTask = await backend.updateEpisodeNamingFormat(
        props.task.id,
        namingFormat,
      );
      props.onTask(updatedTask);
      const proposals = await backend.proposeAiEpisodeMappings(
        props.task.id,
        group.id,
        i18n.language,
      );
      if (!proposals.length) {
        message.info(t("tasks.aiMappingsEmpty"));
        return;
      }
      const merged = mergeAiEpisodeMappings(mappings, proposals);
      let next = merged.mappings;
      setAiEvidence(merged.evidence);
      try {
        next = await withTmdbTitles(next);
      } catch (error) {
        message.warning(localizedError(t, error));
      }
      setMappings(next);
      message.success(t("tasks.aiMappingsReady", { count: proposals.length }));
    } catch (error) {
      message.error(localizedError(t, error));
    } finally {
      props.onBusy(false);
      setNamingModalOpen(false);
    }
  };
  const confirmAndContinue = async () => {
    const confirmed = mappings.map((item) => ({
      ...item,
      confirmed: true,
    }));
    window.clearTimeout(autoSaveTimer.current);
    mappingsRef.current = confirmed;
    setMappings(confirmed);
    queuedMappingSignatures.current[group.id] = JSON.stringify(confirmed);
    props.onBusy(true, t("tasks.savingMappings"), group.titleGuess);
    try {
      await saveQueue.current.catch(() => undefined);
      await backend.updateEpisodes(props.task.id, group.id, confirmed);
      const planned = await backend.generatePlan(props.task.id);
      props.onTask(planned);
      setAutoSaveState("saved");
      props.onStageChange("plan");
      message.success(t("tasks.mappingsConfirmed"));
    } catch (error) {
      setAutoSaveState("error");
      message.error(localizedError(t, error));
    } finally {
      props.onBusy(false);
    }
  };
  return (
    <section className="task-stage episode-stage">
      <StageHeader
        icon={<CheckCircle2 />}
        title={t("tasks.stageEpisodes")}
        description={t("tasks.stageEpisodesHelp")}
        extra={
          <Space>
            <Tag
              color={
                autoSaveState === "error"
                  ? "error"
                  : autoSaveState === "saving"
                    ? "processing"
                    : "success"
              }
            >
              {t(`tasks.autoSave_${autoSaveState}`)}
            </Tag>
            <Button
              icon={<Bot />}
              onClick={() => setNamingModalOpen(true)}
              loading={props.busy}
            >
              {t("tasks.aiMapEpisodes")}
            </Button>
            <Button onClick={() => void fill()} loading={props.busy}>
              {t("tasks.fillTmdbTitles")}
            </Button>
            <Button
              type="primary"
              loading={props.busy}
              disabled={!mappings.length}
              onClick={() => void confirmAndContinue()}
            >
              {t("tasks.confirmMappingsAndContinue")}
            </Button>
          </Space>
        }
      />
      <GroupPicker {...props} />
      <div className="episode-mapping-dashboard">
        <div className="episode-mapping-health">
          <span>
            <b>{mappings.length}</b>
            {t("tasks.mappedFiles")}
          </span>
          <span className={mappingAnalysis.missingCount ? "has-warning" : ""}>
            <b>{mappingAnalysis.missingCount}</b>
            {t("tasks.missingEpisodes")}
          </span>
          <span className={mappingAnalysis.overlaps.length ? "has-info" : ""}>
            <b>{mappingAnalysis.overlaps.length}</b>
            {t("tasks.overlappingEpisodes")}
          </span>
          <span className={mappingAnalysis.unconfirmed ? "has-warning" : ""}>
            <b>{mappingAnalysis.unconfirmed}</b>
            {t("tasks.unconfirmedMappings")}
          </span>
          <Segmented
            size="small"
            value={mappingView}
            onChange={(value) => setMappingView(value as typeof mappingView)}
            options={[
              { value: "all", label: t("tasks.allMappings") },
              { value: "issues", label: t("tasks.issueMappings") },
              { value: "unconfirmed", label: t("tasks.unconfirmedOnly") },
            ]}
          />
        </div>
        {mappingAnalysis.gaps.length > 0 && (
          <div className="episode-gap-list">
            <span>{t("tasks.detectedGaps")}</span>
            {mappingAnalysis.gaps.map((gap) => (
              <button
                key={`${gap.season}-${gap.from}-${gap.to}`}
                onClick={() => {
                  setBulkSeason(gap.season);
                  setBulkFrom(gap.to + 1);
                  setSelectedMappingIds(
                    new Set(
                      mappings
                        .filter(
                          (item) =>
                            item.season === gap.season && item.episode > gap.to,
                        )
                        .map((item) => item.fileId),
                    ),
                  );
                }}
              >
                {t("tasks.gapRange", {
                  season: gap.season,
                  from: gap.from,
                  to: gap.to,
                })}
              </button>
            ))}
          </div>
        )}
        <div className="episode-sheet-toolbar">
          <div className="episode-sheet-scope">
            <strong>
              {t("tasks.selectedMappings", { count: selectedSet.size })}
            </strong>
            <span className="episode-toolbar-divider" />
            <Select
              aria-label={t("tasks.targetSeason")}
              value={bulkSeason}
              options={seasonOptions}
              onChange={setBulkSeason}
            />
            <Button onClick={() => selectScope()}>
              {t("tasks.selectWholeSeason")}
            </Button>
            <span className="episode-inline-field">
              {t("tasks.fromEpisode")}
              <InputNumber
                controls={false}
                min={1}
                value={bulkFrom}
                onChange={(value) => setBulkFrom(value ?? 1)}
              />
            </span>
            <Button onClick={() => selectScope(bulkFrom)}>
              {t("tasks.selectFromHere")}
            </Button>
          </div>
          <div className="episode-sheet-actions">
            <span className="episode-inline-field">
              {t("tasks.episodeOffset")}
              <InputNumber
                controls={false}
                value={bulkOffset}
                onChange={(value) => setBulkOffset(value ?? 0)}
              />
            </span>
            <Button
              disabled={!selectedSet.size || bulkOffset === 0}
              onClick={applyOffset}
            >
              {t("tasks.applyOffset")}
            </Button>
            <span className="episode-inline-field">
              {t("tasks.renumberFrom")}
              <InputNumber
                controls={false}
                min={1}
                value={renumberStart}
                onChange={(value) => setRenumberStart(value ?? 1)}
              />
            </span>
            <Button disabled={!selectedSet.size} onClick={renumberSelected}>
              {t("tasks.renumberContinuously")}
            </Button>
            <Button disabled={!selectedSet.size} onClick={fillDownSelected}>
              {t("tasks.fillDown")}
            </Button>
            <Button
              disabled={!selectedSet.size}
              onClick={() =>
                setMappings((current) =>
                  current.map((item) =>
                    selectedSet.has(item.fileId)
                      ? { ...item, confirmed: true }
                      : item,
                  ),
                )
              }
            >
              {t("tasks.confirmSelected")}
            </Button>
            <Button onClick={() => setSelectedMappingIds(new Set())}>
              {t("tasks.clearSelection")}
            </Button>
          </div>
          <small>{t("tasks.spreadsheetHint")}</small>
        </div>
      </div>
      {mappings.length ? (
        <EpisodeMappingGrid
          rows={visibleMappings}
          files={files}
          evidence={aiEvidence}
          issueFileIds={mappingAnalysis.issueFileIds}
          selectedIds={selectedMappingIds}
          labels={{
            row: "#",
            file: t("tasks.file"),
            season: t("tasks.season"),
            episode: t("tasks.episode"),
            episodeEnd: t("tasks.episodeEnd"),
            episodeTitle: t("tasks.episodeTitle"),
            aiSuggestion: t("tasks.aiSuggestion"),
            confirmed: t("tasks.confirmed"),
          }}
          onSelectedIdsChange={setSelectedMappingIds}
          onActiveFieldChange={(row, field) => setActiveCell({ row, field })}
          onRowsChange={(rows) => {
            const updates = new Map(rows.map((item) => [item.fileId, item]));
            setMappings((current) =>
              current.map((item) => {
                const next = updates.get(item.fileId);
                if (!next) return item;
                const edited =
                  next.season !== item.season ||
                  next.episode !== item.episode ||
                  next.episodeEnd !== item.episodeEnd ||
                  next.title !== item.title;
                return edited ? { ...next, confirmed: false } : next;
              }),
            );
          }}
        />
      ) : (
        <Alert type="warning" showIcon title={t("tasks.noEpisodeNumber")} />
      )}
      <EpisodeNamingFormatModal
        open={namingModalOpen}
        value={props.task.episodeNamingFormat ?? "series-year-title"}
        busy={props.busy}
        onCancel={() => setNamingModalOpen(false)}
        onConfirm={(format) => void proposeWithAi(format)}
      />
    </section>
  );
}

function PlanStage(props: Props) {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const run = useAction(props);
  const operations = props.task.plan?.operations ?? [];
  const tree = useMemo(
    () => buildPlanTree(operations, props.task.files, t("tasks.missingTarget")),
    [operations, props.task.files, t],
  );
  const columns: ColumnsType<PlanTreeNode> = [
    {
      title: t("tasks.execute"),
      width: 58,
      align: "center",
      render: (_, node) =>
        node.operation ? (
          <Checkbox
            checked={node.operation.selected}
            disabled={node.operation.status !== "planned"}
            onChange={(event) =>
              void run(
                () =>
                  backend.updateOperation(
                    props.task.id,
                    node.operation!.id,
                    event.target.checked,
                  ),
                undefined,
              )
            }
          />
        ) : null,
    },
    {
      title: t("tasks.outputTree"),
      dataIndex: "name",
      render: (value, node) =>
        node.nodeType === "folder" ? (
          <span className="plan-tree-folder">
            <Folder />
            <b>{value}</b>
          </span>
        ) : node.operation ? (
          <Tooltip title={node.operation.source} placement="topLeft">
            <span className="plan-tree-file">
              <FileIcon />
              {node.operation.status === "planned" ||
              node.operation.status === "conflict" ? (
                <Input
                  key={node.operation.target}
                  defaultValue={value}
                  status={
                    node.operation.status === "conflict" ? "error" : undefined
                  }
                  aria-label={t("tasks.targetFileName")}
                  onBlur={(event) => {
                    const fileName = event.target.value.trim();
                    if (!fileName || /[\\/]/.test(fileName)) {
                      event.target.value = value;
                      message.error(t("tasks.invalidTargetFileName"));
                      return;
                    }
                    const target = replaceTargetFileName(
                      node.operation!.target,
                      fileName,
                    );
                    if (target !== node.operation!.target)
                      void run(
                        () =>
                          backend.updateOperation(
                            props.task.id,
                            node.operation!.id,
                            node.operation!.selected,
                            target,
                          ),
                        t("tasks.targetUpdated"),
                      );
                  }}
                />
              ) : (
                <span>{value}</span>
              )}
            </span>
          </Tooltip>
        ) : (
          value
        ),
    },
    {
      title: t("tasks.fileType"),
      width: 132,
      render: (_, node) =>
        node.operation ? (
          <span className="plan-file-type">
            {node.extension && <Tag>{`.${node.extension}`}</Tag>}
            <span>{t(`tasks.kind_${node.fileKind ?? "unknown"}`)}</span>
          </span>
        ) : null,
    },
    {
      title: t("tasks.operation"),
      width: 92,
      render: (_, node) =>
        node.operation ? (
          <Tag color={node.operation.operation === "move" ? "blue" : "cyan"}>
            {t(`tasks.${node.operation.operation}`)}
          </Tag>
        ) : null,
    },
    {
      title: t("tasks.state"),
      width: 180,
      render: (_, node) => {
        const operation = node.operation;
        if (!operation) return null;
        const color =
          operation.status === "planned" || operation.status === "completed"
            ? "success"
            : operation.status === "skipped"
              ? "default"
              : operation.status === "conflict" ||
                  operation.status === "rolled-back"
                ? "warning"
                : "error";
        return (
          <Tag color={color}>
            {operation.reason
              ? t(`errors.${operation.reason}`, {
                  defaultValue: operation.reason,
                })
              : t(`tasks.${operation.status}`, {
                  defaultValue: operation.status,
                })}
          </Tag>
        );
      },
    },
  ];
  const ready = operations.filter(
    (item) => item.selected && item.status === "planned",
  ).length;
  const execute = () =>
    modal.confirm({
      title: t("tasks.finalConfirmation"),
      content: (
        <div className="execute-confirm">
          <Alert
            type="warning"
            showIcon
            title={t("tasks.executeWarning")}
            description={t("tasks.hashSafety")}
          />
          <dl>
            <div>
              <dt>{t("tasks.task")}</dt>
              <dd>{props.task.name}</dd>
            </div>
            <div>
              <dt>{t("tasks.files")}</dt>
              <dd>{ready}</dd>
            </div>
            <div>
              <dt>{t("tasks.operation")}</dt>
              <dd>{t(`tasks.${props.task.operation}`)}</dd>
            </div>
          </dl>
        </div>
      ),
      okText: t("tasks.executeNow"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        props.onBusy(true, t("tasks.executingFiles"));
        try {
          await backend.executePlan(props.task.id);
          props.onTask(await backend.loadTask(props.task.id));
          props.onFinished();
          message.success(t("tasks.executionComplete"));
        } catch (error) {
          message.error(localizedError(t, error));
          try {
            props.onTask(await backend.loadTask(props.task.id));
          } catch {
            // The history entry still records the execution failure.
          }
        } finally {
          window.dispatchEvent(new Event("jellysmith-runs-changed"));
          props.onBusy(false);
        }
      },
    });
  return (
    <section className="task-stage plan-stage">
      <StageHeader
        icon={<ShieldCheck />}
        title={t("tasks.stagePlan")}
        description={t("tasks.stagePlanHelp")}
        extra={
          <Space>
            <Button
              loading={props.busy}
              onClick={() =>
                void run(
                  () => backend.generatePlan(props.task.id),
                  t("tasks.planGenerated"),
                  t("tasks.generatingPlan"),
                )
              }
            >
              {operations.length
                ? t("tasks.regeneratePlan")
                : t("tasks.generatePlan")}
            </Button>
            <Button
              danger
              type="primary"
              icon={<Play />}
              loading={props.busy}
              disabled={
                !ready ||
                props.task.plan?.taskRevision !== props.task.revision
              }
              onClick={execute}
            >
              {t("tasks.executeNow")}
            </Button>
          </Space>
        }
      />
      {operations.length ? (
        <>
          <div className="plan-summary">
            <Tag color="success">
              {ready} {t("tasks.ready")}
            </Tag>
            <Tag color="error">
              {operations.filter((item) => item.status === "conflict").length}{" "}
              {t("tasks.conflicts")}
            </Tag>
            <Tag>
              {operations.filter((item) => item.status === "skipped").length}{" "}
              {t("logView.status.skipped")}
            </Tag>
            <span>{t("tasks.noOverwrite")}</span>
          </div>
          <Table
            className="plan-tree-table"
            rowKey="key"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={tree}
            expandable={{
              defaultExpandAllRows: true,
              expandIconColumnIndex: 1,
              indentSize: 18,
            }}
            rowClassName={(node) =>
              node.nodeType === "folder" ? "plan-folder-row" : "plan-file-row"
            }
            scroll={{ x: 860 }}
          />
        </>
      ) : (
        <Empty description={t("tasks.planEmpty")} />
      )}
    </section>
  );
}
