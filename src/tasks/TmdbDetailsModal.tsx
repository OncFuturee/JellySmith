import { Alert, Button, Empty, Modal, Select, Skeleton, Tag } from "antd";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Database,
  Languages,
  Layers3,
  PlayCircle,
  RefreshCw,
  Star,
  Tv2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { TmdbCandidate, TmdbDetails, TmdbEpisode } from "../models";
import { backend } from "../services/backend";
import { localizedError } from "../services/errors";
import { createDetailTheme, type DetailTheme } from "./detailTheme";

type Props = {
  open: boolean;
  candidate?: TmdbCandidate;
  language?: string;
  onClose: () => void;
};

const imageUrl = (path: string, size: "w300" | "w780" | "w1280") =>
  `https://image.tmdb.org/t/p/${size}${path}`;

const loadDetailTheme = (posterPath: string) =>
  new Promise<DetailTheme | undefined>((resolve) => {
    let settled = false;
    let timeout = 0;
    const finish = (theme?: DetailTheme) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(theme);
    };
    timeout = window.setTimeout(() => finish(), 700);
    void backend
      .getTmdbImagePalette(posterPath)
      .then((palette) => finish(createDetailTheme(palette.colors)))
      .catch(() => finish());
  });

export default function TmdbDetailsModal({
  open,
  candidate,
  language,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation();
  const [details, setDetails] = useState<TmdbDetails>();
  const [episodes, setEpisodes] = useState<TmdbEpisode[]>([]);
  const [season, setSeason] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [seasonLoading, setSeasonLoading] = useState(false);
  const [seasonDocked, setSeasonDocked] = useState(false);
  const [detailTheme, setDetailTheme] = useState<DetailTheme>();
  const [error, setError] = useState("");
  const detailsScrollRef = useRef<HTMLDivElement>(null);
  const detailsRequestRef = useRef(0);
  const requestLanguage = language || i18n.language;

  const loadDetails = useCallback(
    async (refresh = false) => {
      if (!candidate) return;
      const requestId = ++detailsRequestRef.current;
      setLoading(true);
      setError("");
      try {
        const value = await backend.getTmdbDetails(
          candidate.id,
          candidate.mediaType,
          requestLanguage,
          refresh,
        );
        const theme = value.posterPath
          ? await loadDetailTheme(value.posterPath)
          : undefined;
        if (requestId !== detailsRequestRef.current) return;
        setDetailTheme(theme);
        setDetails(value);
        setSeason((current) => {
          if (value.seasons.some((item) => item.season === current))
            return current;
          return (
            value.seasons.find((item) => item.season > 0)?.season ??
            value.seasons[0]?.season
          );
        });
      } catch (reason) {
        if (requestId === detailsRequestRef.current)
          setError(localizedError(t, reason));
      } finally {
        if (requestId === detailsRequestRef.current) setLoading(false);
      }
    },
    [candidate, requestLanguage, t],
  );

  const loadSeason = useCallback(
    async (value: number, refresh = false) => {
      if (!candidate || candidate.mediaType !== "tv") return;
      setSeasonLoading(true);
      setError("");
      try {
        setEpisodes(
          await backend.getTmdbSeason(
            candidate.id,
            value,
            requestLanguage,
            refresh,
          ),
        );
      } catch (reason) {
        setEpisodes([]);
        setError(localizedError(t, reason));
      } finally {
        setSeasonLoading(false);
      }
    },
    [candidate, requestLanguage, t],
  );

  useEffect(() => {
    if (!open || !candidate) {
      detailsRequestRef.current += 1;
      return;
    }
    setSeasonDocked(false);
    setDetailTheme(undefined);
    detailsScrollRef.current?.scrollTo?.({ top: 0 });
    setDetails(undefined);
    setEpisodes([]);
    setSeason(undefined);
    void loadDetails();
  }, [candidate?.id, candidate?.mediaType, open, requestLanguage]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("tmdb-details-open");
    return () => document.body.classList.remove("tmdb-details-open");
  }, [open]);

  useEffect(() => {
    if (!open || season === undefined || candidate?.mediaType !== "tv") return;
    void loadSeason(season);
  }, [candidate?.id, candidate?.mediaType, open, requestLanguage, season]);

  const selectedSeason = details?.seasons.find(
    (item) => item.season === season,
  );

  const handleDetailsScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    setSeasonDocked(maximum > 0 && element.scrollTop >= maximum - 1);
  };

  return (
    <Modal
      open={open}
      centered
      className="tmdb-details-modal"
      rootClassName="tmdb-details-root"
      classNames={{
        wrapper: "tmdb-details-wrap",
        container: "tmdb-details-container",
        body: "tmdb-details-body",
      }}
      width="min(1280px, calc(100vw - 24px))"
      style={{
        maxHeight: "calc(100dvh - 20px)",
        paddingBottom: 0,
      }}
      styles={{
        wrapper: { overflow: "hidden" },
        container: {
          ...(detailTheme?.style ?? {}),
          display: "grid",
          gridTemplateRows: "minmax(0, auto)",
          minHeight: 0,
          maxHeight: "calc(100dvh - 20px)",
          overflow: "hidden",
          padding: 0,
        },
        body: { minHeight: 0, overflow: "hidden", padding: 0 },
      }}
      title={null}
      closable={false}
      destroyOnHidden
      footer={null}
      onCancel={onClose}
    >
      {loading && !details ? (
        <div className="tmdb-details-state">
          <Skeleton active paragraph={{ rows: 10 }} />
        </div>
      ) : error && !details ? (
        <div className="tmdb-details-state">
          <Alert type="error" showIcon title={error} />
        </div>
      ) : details ? (
        <div
          className="tmdb-details"
          style={
            {
              ...(detailTheme?.style ?? {}),
              ...(details.backdropPath
                ? {
                    "--tmdb-backdrop": `url(${imageUrl(details.backdropPath, "w1280")})`,
                  }
                : {}),
            } as CSSProperties
          }
        >
          <div className="tmdb-details-toolbar">
            <div>
              <strong>{t("tasks.tmdbDetails")}</strong>
              <span>{t("tasks.tmdbDetailsSubtitle")}</span>
            </div>
            <div className="tmdb-details-toolbar-actions">
              <Button
                className="tmdb-details-refresh"
                icon={<RefreshCw color="#ffffff" />}
                loading={loading}
                style={{ color: "#ffffff", opacity: 1 }}
                onClick={() => void loadDetails(true)}
              >
                <span className="tmdb-details-refresh-label">
                  {t("tasks.refreshDetails")}
                </span>
              </Button>
              <button
                type="button"
                className="tmdb-details-close-icon"
                aria-label={t("common.close")}
                onClick={onClose}
              >
                <X />
              </button>
            </div>
          </div>

          <div
            ref={detailsScrollRef}
            className={`tmdb-details-scroll${seasonDocked ? " is-season-docked" : ""}`}
            onScroll={handleDetailsScroll}
          >
            <section className="tmdb-details-hero">
            <div className="tmdb-details-poster">
              {details.posterPath ? (
                <img
                  src={imageUrl(details.posterPath, "w300")}
                  alt={details.title}
                />
              ) : (
                <div className="tmdb-details-poster-empty">
                  <Tv2 />
                </div>
              )}
            </div>
            <div className="tmdb-details-summary">
              <div className="tmdb-details-title">
                <h2>{details.title}</h2>
              </div>
              <p className="tmdb-original-title">
                {details.originalTitle} · {details.year || "—"}
              </p>
              <div className="tmdb-details-tags">
                <Tag color="gold">
                  <Star /> {details.voteAverage.toFixed(1)} ·{" "}
                  {t("tasks.voteCount", { count: details.voteCount })}
                </Tag>
                {details.genres.map((genre) => (
                  <Tag key={genre}>{genre}</Tag>
                ))}
              </div>
              <p className="tmdb-full-overview">
                {details.overview || t("tasks.noOverview")}
              </p>
              <dl className="tmdb-facts">
                <div>
                  <Database />
                  <dt>{t("tasks.tmdbId")}</dt>
                  <dd>{details.id}</dd>
                </div>
                <div>
                  <Languages />
                  <dt>{t("tasks.originalLanguage")}</dt>
                  <dd>{details.originalLanguage || "—"}</dd>
                </div>
                {details.runtime !== undefined && (
                  <div>
                    <Clock3 />
                    <dt>{t("tasks.runtime")}</dt>
                    <dd>{t("tasks.minutes", { count: details.runtime })}</dd>
                  </div>
                )}
                {details.numberOfSeasons !== undefined && (
                  <div>
                    <Layers3 />
                    <dt>{t("tasks.seasons")}</dt>
                    <dd>{details.numberOfSeasons}</dd>
                  </div>
                )}
                {details.numberOfEpisodes !== undefined && (
                  <div>
                    <PlayCircle />
                    <dt>{t("tasks.totalEpisodes")}</dt>
                    <dd>{details.numberOfEpisodes}</dd>
                  </div>
                )}
              </dl>
              {details.tagline && <blockquote>{details.tagline}</blockquote>}
            </div>
            </section>

            {details.mediaType === "tv" && (
              <section
                className={`tmdb-season-browser ${
                  episodes.length > 3 ? "is-scrollable" : "is-compact"
                }`}
              >
              <header>
                <div>
                  <h3>{t("tasks.episodeDetails")}</h3>
                  <p>
                    {selectedSeason?.overview ||
                      t("tasks.episodesInSeason", {
                        count: selectedSeason?.episodeCount ?? episodes.length,
                      })}
                  </p>
                </div>
                <Select
                  className="tmdb-season-select"
                  classNames={{
                    popup: {
                      root: "tmdb-season-popup",
                      list: "tmdb-season-popup-list",
                      listItem: "tmdb-season-popup-item",
                    },
                  }}
                  styles={{
                    root: {
                      height: 36,
                      paddingInline: 12,
                      border: "1px solid rgb(169 220 255 / 0.52)",
                      borderRadius: 9,
                      background: "var(--detail-control, #1884c4)",
                      color: "white",
                      boxShadow:
                        "inset 0 1px rgb(255 255 255 / 0.12), 0 6px 18px rgb(1 20 39 / 0.18)",
                    },
                    content: { color: "white" },
                    suffix: { color: "rgb(210 237 255)" },
                    popup: {
                      root: {
                        background:
                          detailTheme?.popup ??
                          "linear-gradient(145deg, rgb(31 105 164 / 0.99), rgb(18 72 122 / 0.99))",
                        border: `1px solid ${detailTheme?.popupBorder ?? "rgb(169 220 255 / 0.52)"}`,
                        borderRadius: 12,
                        "--detail-popup-control":
                          detailTheme?.control ?? "#236fae",
                        "--detail-popup-hover":
                          detailTheme?.controlHover ?? "#2d8acc",
                      } as CSSProperties,
                    },
                  }}
                  value={season}
                  placeholder={t("tasks.selectSeason")}
                  options={details.seasons.map((item) => ({
                    value: item.season,
                    label: `${item.name || `${t("tasks.season")} ${item.season}`} (${item.episodeCount})`,
                  }))}
                  onChange={setSeason}
                />
                <Button
                  className="tmdb-season-refresh"
                  icon={<RefreshCw />}
                  disabled={season === undefined}
                  loading={seasonLoading}
                  onClick={() =>
                    season !== undefined && void loadSeason(season, true)
                  }
                />
              </header>
              {seasonLoading && !episodes.length ? (
                <Skeleton active paragraph={{ rows: 6 }} />
              ) : episodes.length ? (
                <div className="tmdb-episode-list">
                  {episodes.map((episode) => (
                    <article key={`${episode.season}-${episode.episode}`}>
                      <div className="tmdb-episode-still">
                        {episode.stillPath ? (
                          <img
                            src={imageUrl(episode.stillPath, "w300")}
                            alt=""
                          />
                        ) : (
                          <div className="tmdb-episode-still-empty">
                            <Tv2 />
                          </div>
                        )}
                        <PlayCircle />
                      </div>
                      <div className="tmdb-episode-content">
                        <h4>
                          S{String(episode.season).padStart(2, "0")}E
                          {String(episode.episode).padStart(2, "0")} ·{" "}
                          {episode.title || t("tasks.untitledEpisode")}
                        </h4>
                        <p className="tmdb-episode-meta">
                          {episode.airDate && (
                            <span>
                              <CalendarDays /> {episode.airDate}
                            </span>
                          )}
                          {episode.runtime !== undefined && (
                            <span>
                              <Clock3 />{" "}
                              {t("tasks.minutes", { count: episode.runtime })}
                            </span>
                          )}
                          {episode.voteAverage > 0 && (
                            <span>
                              <Star /> {episode.voteAverage.toFixed(1)}
                            </span>
                          )}
                        </p>
                        <p>{episode.overview || t("tasks.noOverview")}</p>
                      </div>
                      <ChevronRight className="tmdb-episode-chevron" />
                    </article>
                  ))}
                </div>
              ) : (
                <Empty description={t("tasks.noEpisodes")} />
              )}
              </section>
            )}
          </div>
          {error && <Alert type="error" showIcon title={error} />}
          <footer className="tmdb-details-bottom">
            <span>{t("tasks.tmdbDetailsFooter")}</span>
            <Button type="primary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </footer>
        </div>
      ) : null}
    </Modal>
  );
}
