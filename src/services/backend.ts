import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  AiGroupingProposal,
  AiEpisodeMappingProposal,
  ApplicationLogEntry,
  AppSettings,
  CreateTaskRequest,
  EpisodeMapping,
  EpisodeNamingFormat,
  MediaGroup,
  OrganizerTask,
  RunResult,
  TaskSummary,
  TmdbCandidate,
  TmdbDetails,
  TmdbEpisode,
  TmdbImageColor,
  TmdbImagePalette,
} from "../models";

const invoke = async <T>(command: string, args?: Record<string, unknown>) => {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    void tauriInvoke("write_application_log", {
      level: "ERROR",
      target: `command.${command}`,
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
};

export const backend = {
  listApplicationLogs: () =>
    tauriInvoke<ApplicationLogEntry[]>("list_application_logs"),
  writeApplicationLog: (level: string, target: string, message: string) =>
    tauriInvoke<void>("write_application_log", { level, target, message }),
  clearApplicationLogs: () => tauriInvoke<void>("clear_application_logs"),
  listRuns: () => invoke<RunResult[]>("list_runs"),
  deleteRun: (runId: string) => invoke<void>("delete_run", { runId }),
  loadSettings: () => invoke<AppSettings>("load_settings"),
  saveSettings: (settings: AppSettings) =>
    invoke<AppSettings>("save_settings", { settings }),
  hasApiKey: (provider: string) => invoke<boolean>("has_api_key", { provider }),
  saveApiKey: (provider: string, apiKey: string) =>
    invoke<void>("save_api_key", { provider, apiKey }),
  listAiModels: (provider: string) =>
    invoke<string[]>("list_ai_models", { provider }),
  selectDirectory: () => invoke<string | null>("select_directory"),
  listTasks: () => invoke<TaskSummary[]>("list_organizer_tasks"),
  createTask: (request: CreateTaskRequest) =>
    invoke<OrganizerTask>("create_organizer_task", { request }),
  loadTask: (taskId: string) =>
    invoke<OrganizerTask>("load_organizer_task", { taskId }),
  archiveTask: (taskId: string) =>
    invoke<void>("archive_organizer_task", { taskId }),
  updateTaskSource: (taskId: string, sourceRoot: string) =>
    invoke<OrganizerTask>("update_organizer_task_source", {
      taskId,
      sourceRoot,
    }),
  updateTaskConfig: (taskId: string, request: CreateTaskRequest) =>
    invoke<OrganizerTask>("update_organizer_task_config", {
      taskId,
      request,
    }),
  scanTask: (taskId: string) =>
    invoke<OrganizerTask>("scan_organizer_task", { taskId }),
  cancelScan: (taskId: string) =>
    invoke<void>("cancel_organizer_scan", { taskId }),
  confirmScanSelection: (taskId: string, fileIds: string[]) =>
    invoke<OrganizerTask>("confirm_scan_selection", { taskId, fileIds }),
  groupTask: (taskId: string) =>
    invoke<OrganizerTask>("group_organizer_task", { taskId }),
  updateGroup: (taskId: string, group: MediaGroup) =>
    invoke<OrganizerTask>("update_media_group", { taskId, group }),
  deleteGroup: (taskId: string, groupId: string) =>
    invoke<OrganizerTask>("delete_media_group", { taskId, groupId }),
  createGroup: (
    taskId: string,
    title: string,
    mediaType: string,
    fileIds: string[],
  ) =>
    invoke<OrganizerTask>("create_media_group", {
      taskId,
      title,
      mediaType,
      fileIds,
    }),
  moveFilesToGroup: (taskId: string, fileIds: string[], groupId: string) =>
    invoke<OrganizerTask>("move_files_to_group", { taskId, fileIds, groupId }),
  proposeAiGrouping: (taskId: string, language: string) =>
    invoke<AiGroupingProposal[]>("propose_ai_grouping", { taskId, language }),
  applyAiGrouping: (taskId: string, proposals: AiGroupingProposal[]) =>
    invoke<OrganizerTask>("apply_ai_grouping", { taskId, proposals }),
  proposeAiEpisodeMappings: (
    taskId: string,
    groupId: string,
    language: string,
  ) =>
    invoke<AiEpisodeMappingProposal[]>("propose_ai_episode_mappings", {
      taskId,
      groupId,
      language,
    }),
  searchTmdb: (
    query: string,
    mediaType: string,
    language: string,
    refresh = false,
  ) =>
    invoke<TmdbCandidate[]>("search_tmdb", {
      query,
      mediaType,
      language,
      page: 1,
      refresh,
    }),
  getTmdbDetails: (
    tmdbId: number,
    mediaType: string,
    language: string,
    refresh = false,
  ) =>
    invoke<TmdbDetails>("get_tmdb_details", {
      tmdbId,
      mediaType,
      language,
      refresh,
    }),
  getTmdbImageColor: (posterPath: string) =>
    invoke<TmdbImageColor>("get_tmdb_image_color", { posterPath }),
  getTmdbImagePalette: (posterPath: string) =>
    invoke<TmdbImagePalette>("get_tmdb_image_palette", { posterPath }),
  getTmdbSeason: (
    tmdbId: number,
    season: number,
    language: string,
    refresh = false,
  ) =>
    invoke<TmdbEpisode[]>("get_tmdb_season", {
      tmdbId,
      season,
      language,
      refresh,
    }),
  confirmTmdb: (
    taskId: string,
    groupId: string,
    candidate: TmdbCandidate,
    titleMode: string,
    language: string,
    manualTitle?: string,
  ) =>
    invoke<OrganizerTask>("confirm_tmdb_match", {
      taskId,
      groupId,
      candidate,
      titleMode,
      language,
      manualTitle,
    }),
  confirmManual: (
    taskId: string,
    groupId: string,
    title: string,
    year: number | undefined,
    mediaType: string,
  ) =>
    invoke<OrganizerTask>("confirm_manual_match", {
      taskId,
      groupId,
      title,
      year,
      mediaType,
    }),
  updateEpisodes: (
    taskId: string,
    groupId: string,
    mappings: EpisodeMapping[],
  ) =>
    invoke<OrganizerTask>("update_episode_mappings", {
      taskId,
      groupId,
      mappings,
    }),
  updateEpisodeNamingFormat: (
    taskId: string,
    namingFormat: EpisodeNamingFormat,
  ) =>
    invoke<OrganizerTask>("update_episode_naming_format", {
      taskId,
      namingFormat,
    }),
  generatePlan: (taskId: string) =>
    invoke<OrganizerTask>("generate_organization_plan", { taskId }),
  updateOperation: (
    taskId: string,
    operationId: string,
    selected: boolean,
    target?: string,
  ) =>
    invoke<OrganizerTask>("update_plan_operation", {
      taskId,
      operationId,
      selected,
      target,
    }),
  executePlan: (taskId: string) =>
    invoke<RunResult>("execute_organization_plan", { taskId }),
};
