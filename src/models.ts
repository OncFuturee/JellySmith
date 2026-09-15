export type Page = "tasks" | "logs" | "appLogs" | "settings";
export type PanelLayout = {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
};
export type AiSettings = {
  provider: "disabled" | "gemini" | "siliconflow" | "openai-compatible";
  model: string;
  baseUrl: string;
};
export type AppSettings = {
  language: string;
  theme: "dark" | "light";
  ffprobePath: string;
  defaultMovieRoot: string;
  defaultShowRoot: string;
  backgroundProbe: boolean;
  defaultAllowOverwrite: boolean;
  backupBeforeOverwrite: boolean;
  layout: PanelLayout;
  ai: AiSettings;
};

export type TaskMode = "single" | "batch";
export type TransferMode = "move" | "copy";
export type MediaType = "movie" | "tv" | "unknown";
export type TaskStage =
  "scan" | "group" | "match" | "episodes" | "plan";
export type FileKind =
  "video" | "subtitle" | "audio" | "image" | "nfo" | "extra" | "unknown";
export type CreateTaskRequest = {
  name: string;
  mode: TaskMode;
  sourceRoot: string;
  movieRoot: string;
  showRoot: string;
  operation: TransferMode;
};
export type TaskSummary = {
  id: string;
  name: string;
  mode: TaskMode;
  status: string;
  stage: TaskStage;
  updatedAt: number;
  fileCount: number;
  groupCount: number;
};
export type ParsedMedia = {
  title: string;
  year?: number;
  season?: number;
  episodes: number[];
  resolution?: string;
  edition?: string;
  languageSuffix?: string;
};
export type ScannedFile = {
  id: string;
  relativePath: string;
  name: string;
  extension: string;
  kind: FileKind;
  size: number;
  modifiedAt: number;
  groupId?: string;
  parsed: ParsedMedia;
  warning?: string;
};
export type TmdbCandidate = {
  id: number;
  mediaType: MediaType;
  title: string;
  originalTitle: string;
  year?: number;
  overview: string;
  posterPath?: string;
  voteAverage: number;
};
export type ConfirmedMatch = {
  candidate: TmdbCandidate;
  displayTitle: string;
  source: "tmdb" | "manual";
  language?: string;
  confirmedAt: number;
};
export type EpisodeMapping = {
  fileId: string;
  season: number;
  episode: number;
  episodeEnd?: number;
  title: string;
  confirmed: boolean;
};
export type EpisodeNamingFormat =
  | "series-year-title"
  | "series-title"
  | "episode-title"
  | "series-compact";
export type MediaGroup = {
  id: string;
  titleGuess: string;
  year?: number;
  mediaType: MediaType;
  confidence: number;
  source: "local" | "manual" | "ai";
  confirmed: boolean;
  fileIds: string[];
  matched?: ConfirmedMatch;
  episodeMappings: EpisodeMapping[];
};
export type FileOperation = {
  id: string;
  groupId: string;
  source: string;
  target: string;
  operation: TransferMode;
  selected: boolean;
  size: number;
  modifiedAt: number;
  status:
    "planned" | "conflict" | "completed" | "failed" | "rolled-back" | "skipped";
  reason?: string;
};
export type PlanItem = FileOperation;
export type OrganizationPlan = {
  id: string;
  taskId: string;
  taskRevision: number;
  createdAt: number;
  status: string;
  operations: FileOperation[];
};
export type OrganizerTask = {
  id: string;
  name: string;
  mode: TaskMode;
  sourceRoot: string;
  movieRoot: string;
  showRoot: string;
  operation: TransferMode;
  episodeNamingFormat?: EpisodeNamingFormat;
  status: string;
  stage: TaskStage;
  revision: number;
  createdAt: number;
  updatedAt: number;
  files: ScannedFile[];
  groups: MediaGroup[];
  plan?: OrganizationPlan;
};
export type AiGroupingProposal = {
  id: string;
  title: string;
  year?: number;
  mediaType: MediaType;
  fileIds: string[];
  confidence: number;
  reason: string;
};
export type AiEpisodeMappingProposal = {
  fileId: string;
  season: number;
  episode: number;
  episodeEnd?: number;
  title: string;
  confidence: number;
  reason: string;
};
export type TmdbEpisode = {
  season: number;
  episode: number;
  title: string;
  overview: string;
  airDate?: string;
  stillPath?: string;
  runtime?: number;
  voteAverage: number;
};
export type TmdbSeasonSummary = {
  season: number;
  name: string;
  overview: string;
  airDate?: string;
  posterPath?: string;
  episodeCount: number;
};
export type TmdbDetails = {
  id: number;
  mediaType: MediaType;
  title: string;
  originalTitle: string;
  year?: number;
  overview: string;
  tagline: string;
  posterPath?: string;
  backdropPath?: string;
  voteAverage: number;
  voteCount: number;
  status: string;
  originalLanguage: string;
  genres: string[];
  runtime?: number;
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  seasons: TmdbSeasonSummary[];
};
export type TmdbImageColor = {
  red: number;
  green: number;
  blue: number;
};
export type TmdbImagePalette = {
  colors: TmdbImageColor[];
};
export type ScanProgress = {
  taskId: string;
  scanned: number;
  currentPath: string;
};
export type LogLine = { time: number; level: string; message: string };
export type ApplicationLogEntry = {
  time: number;
  level: string;
  target: string;
  message: string;
};
export type RunResult = {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: string;
  status: string;
  startedAt: number;
  finishedAt: number;
  nodeStates: Record<string, string>;
  logs: LogLine[];
  outputs: Record<string, unknown>;
};
