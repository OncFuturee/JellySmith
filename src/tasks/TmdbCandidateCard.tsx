import { Button, Segmented } from "antd";
import {
  CheckCircle2,
  ChevronRight,
  Columns2,
  Eye,
  LayoutGrid,
  Rows3,
  Star,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { TmdbCandidate } from "../models";

export type CandidateView = "single" | "double" | "compact";

type CardProps = {
  candidate: TmdbCandidate;
  posterUrl?: string;
  style: CSSProperties;
  selected: boolean;
  view: CandidateView;
  onDetails: () => void;
  onConfirm: () => void;
};

type ViewSwitchProps = {
  value: CandidateView;
  onChange: (value: CandidateView) => void;
};

export function TmdbCandidateViewSwitch({ value, onChange }: ViewSwitchProps) {
  const { t } = useTranslation();
  return (
    <Segmented
      className="candidate-view-switch"
      aria-label={t("tasks.candidateView")}
      value={value}
      options={[
        {
          value: "single",
          label: (
            <span>
              <Rows3 /> {t("tasks.viewSingle")}
            </span>
          ),
        },
        {
          value: "double",
          label: (
            <span>
              <Columns2 /> {t("tasks.viewDouble")}
            </span>
          ),
        },
        {
          value: "compact",
          label: (
            <span>
              <LayoutGrid /> {t("tasks.viewCompact")}
            </span>
          ),
        },
      ]}
      onChange={(next) => onChange(next as CandidateView)}
    />
  );
}

export function TmdbCandidateCard({
  candidate,
  posterUrl,
  style,
  selected,
  view,
  onDetails,
  onConfirm,
}: CardProps) {
  const { t } = useTranslation();
  const compact = view === "compact";
  return (
    <article
      style={style}
      className={`tmdb-candidate-card${selected ? " selected" : ""}${compact ? " is-compact" : ""}`}
    >
      <div className="candidate-poster-wrap">
        {posterUrl ? (
          <img src={posterUrl} alt={candidate.title} />
        ) : (
          <div className="poster-empty" />
        )}
        <span>{t(`tasks.${candidate.mediaType}`)}</span>
      </div>
      <div className="candidate-content">
        <div className="candidate-info">
          <header>
            <div>
              <h3>{candidate.title}</h3>
              <p>
                {candidate.originalTitle} · {candidate.year || "—"}
              </p>
            </div>
            <strong className="candidate-rating">
              <Star /> {candidate.voteAverage.toFixed(1)}
            </strong>
          </header>
          {compact ? (
            <div className="candidate-compact-overview">
              <p>{candidate.overview || t("tasks.noOverview")}</p>
              <button type="button" onClick={onDetails}>
                {t("tasks.viewMore")}
                <ChevronRight />
              </button>
            </div>
          ) : (
            <p className="overview">
              {candidate.overview || t("tasks.noOverview")}
            </p>
          )}
        </div>
        <div className="candidate-actions">
          {!compact && (
            <Button icon={<Eye />} onClick={onDetails}>
              {t("tasks.viewDetails")}
            </Button>
          )}
          <Button type="primary" icon={<CheckCircle2 />} onClick={onConfirm}>
            {t("tasks.confirmThis")}
          </Button>
        </div>
      </div>
    </article>
  );
}
