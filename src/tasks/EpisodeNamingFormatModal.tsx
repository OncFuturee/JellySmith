import { Button, Modal, Radio } from "antd";
import { FileCheck2, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EpisodeNamingFormat } from "../models";

type Props = {
  open: boolean;
  value: EpisodeNamingFormat;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (value: EpisodeNamingFormat) => void;
};

const formats: EpisodeNamingFormat[] = [
  "series-year-title",
  "series-title",
  "episode-title",
  "series-compact",
];

export default function EpisodeNamingFormatModal({
  open,
  value,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<EpisodeNamingFormat>(value);

  useEffect(() => {
    if (open) setSelected(value);
  }, [open, value]);

  return (
    <Modal
      open={open}
      width={720}
      centered
      destroyOnHidden
      rootClassName="episode-naming-modal-root"
      className="episode-naming-modal"
      title={
        <div className="episode-naming-title">
          <span className="episode-naming-title-icon">
            <FileCheck2 />
          </span>
          <span>
            <strong>{t("tasks.chooseEpisodeNaming")}</strong>
            <small>{t("tasks.chooseEpisodeNamingHelp")}</small>
          </span>
        </div>
      }
      footer={
        <div className="episode-naming-footer">
          <span>
            <ShieldCheck />
            {t("tasks.namingSafetyHint")}
          </span>
          <div>
            <Button disabled={busy} onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button
              type="primary"
              icon={<Sparkles />}
              loading={busy}
              onClick={() => onConfirm(selected)}
            >
              {t("tasks.startAiMapping")}
            </Button>
          </div>
        </div>
      }
      onCancel={busy ? undefined : onCancel}
    >
      <Radio.Group
        className="episode-naming-options"
        value={selected}
        onChange={(event) =>
          setSelected(event.target.value as EpisodeNamingFormat)
        }
      >
        {formats.map((format, index) => (
          <label
            key={format}
            className={`episode-naming-option${selected === format ? " is-selected" : ""}`}
          >
            <Radio value={format} />
            <span className="episode-naming-option-content">
              <span className="episode-naming-option-heading">
                <strong>{t(`tasks.naming_${format}`)}</strong>
                {index === 0 && <em>{t("common.recommended")}</em>}
              </span>
              <small>{t(`tasks.naming_${format}Help`)}</small>
              <code>{t(`tasks.naming_${format}Example`)}</code>
            </span>
          </label>
        ))}
      </Radio.Group>
    </Modal>
  );
}
