import { Alert, Button, Empty, Progress, Tag } from "antd";
import {
  BadgeCheck,
  Eye,
  Film,
  FolderTree,
  ShieldCheck,
  Tv,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaGroup, OrganizerTask } from "../models";
import TmdbDetailsModal from "./TmdbDetailsModal";

export default function TaskInspector({
  task,
  group,
}: {
  task?: OrganizerTask;
  group?: MediaGroup;
}) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!task)
    return (
      <aside className="task-inspector">
        <Empty description={t("tasks.noTask")} />
      </aside>
    );
  const files = group
    ? task.files.filter((file) => group.fileIds.includes(file.id))
    : [];
  const videos = files.filter((file) => file.kind === "video").length;
  const subtitles = files.filter((file) => file.kind === "subtitle").length;
  return (
    <aside className="task-inspector">
      <header>
        <b>{t("tasks.inspector")}</b>
        {group && (
          <Tag color={group.confirmed ? "success" : "warning"}>
            {group.confirmed ? t("tasks.confirmed") : t("tasks.pendingConfirm")}
          </Tag>
        )}
      </header>
      {group ? (
        <div className="inspector-scroll">
          <section className="identity-card">
            <div className={`media-symbol ${group.mediaType}`}>
              {group.mediaType === "tv" ? <Tv /> : <Film />}
            </div>
            <div>
              <h3>{group.matched?.displayTitle || group.titleGuess}</h3>
              <p>
                {group.year || "—"} ·{" "}
                {t(`tasks.${group.mediaType}`, {
                  defaultValue: group.mediaType,
                })}
              </p>
            </div>
          </section>
          <section>
            <label>{t("tasks.groupConfidence")}</label>
            <Progress
              percent={Math.round(group.confidence * 100)}
              size="small"
              status={group.confidence < 0.75 ? "exception" : "normal"}
            />
            <small>
              {group.source === "ai"
                ? t("tasks.aiProposal")
                : group.source === "manual"
                  ? t("tasks.manualEdit")
                  : t("tasks.localRules")}
            </small>
          </section>
          <section>
            <h4>
              <FolderTree />
              {t("tasks.groupFiles")}
            </h4>
            <dl className="inspector-stats">
              <div>
                <dt>{t("tasks.totalFiles")}</dt>
                <dd>{files.length}</dd>
              </div>
              <div>
                <dt>{t("tasks.videoFiles")}</dt>
                <dd>{videos}</dd>
              </div>
              <div>
                <dt>{t("tasks.subtitleFiles")}</dt>
                <dd>{subtitles}</dd>
              </div>
              <div>
                <dt>{t("tasks.episodeMappings")}</dt>
                <dd>
                  {
                    group.episodeMappings.filter((item) => item.confirmed)
                      .length
                  }
                  /{group.episodeMappings.length}
                </dd>
              </div>
            </dl>
          </section>
          {group.matched ? (
            <section>
              <h4>
                <BadgeCheck />
                {t("tasks.tmdbIdentity")}
              </h4>
              {group.matched.candidate.posterPath && (
                <img
                  className="inspector-poster"
                  src={`https://image.tmdb.org/t/p/w342${group.matched.candidate.posterPath}`}
                  alt=""
                />
              )}
              <dl className="metadata-list">
                <div>
                  <dt>{t("tasks.tmdbId")}</dt>
                  <dd>{group.matched.candidate.id || t("tasks.manual")}</dd>
                </div>
                <div>
                  <dt>{t("tasks.originalTitle")}</dt>
                  <dd>{group.matched.candidate.originalTitle}</dd>
                </div>
                <div>
                  <dt>{t("tasks.rating")}</dt>
                  <dd>{group.matched.candidate.voteAverage.toFixed(1)}</dd>
                </div>
              </dl>
              <p className="overview">
                {group.matched.candidate.overview || t("tasks.noOverview")}
              </p>
              {group.matched.source === "tmdb" &&
                group.matched.candidate.id > 0 && (
                  <Button
                    block
                    icon={<Eye />}
                    onClick={() => setDetailsOpen(true)}
                  >
                    {t("tasks.viewDetails")}
                  </Button>
                )}
            </section>
          ) : (
            <Alert type="warning" showIcon title={t("tasks.matchRequired")} />
          )}
          <section className="safety-card">
            <h4>
              <ShieldCheck />
              {t("tasks.controlGuarantee")}
            </h4>
            <p>{t("tasks.controlGuaranteeHelp")}</p>
          </section>
          {group.matched && (
            <TmdbDetailsModal
              open={detailsOpen}
              candidate={group.matched.candidate}
              language={group.matched.language}
              onClose={() => setDetailsOpen(false)}
            />
          )}
        </div>
      ) : (
        <Empty description={t("tasks.selectGroup")} />
      )}
    </aside>
  );
}
