import { Button, Form, Input, Modal, Radio, Segmented } from "antd";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CreateTaskRequest } from "../models";
import { backend } from "../services/backend";

const empty: CreateTaskRequest = {
  name: "",
  mode: "single",
  sourceRoot: "",
  movieRoot: "",
  showRoot: "",
  operation: "move",
};

type Props = {
  open: boolean;
  loading: boolean;
  initial?: CreateTaskRequest;
  defaultMovieRoot?: string;
  defaultShowRoot?: string;
  title?: string;
  submitText?: string;
  onCancel: () => void;
  onCreate: (request: CreateTaskRequest) => void;
};

export default function NewTaskModal({
  open,
  loading,
  initial,
  defaultMovieRoot = "",
  defaultShowRoot = "",
  title,
  submitText,
  onCancel,
  onCreate,
}: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<CreateTaskRequest>(empty);

  useEffect(() => {
    if (open) {
      setDraft(
        initial
          ? { ...initial }
          : { ...empty, movieRoot: defaultMovieRoot, showRoot: defaultShowRoot },
      );
    }
  }, [open]);
  useEffect(() => {
    if (!open || initial) return;
    setDraft((current) => ({
      ...current,
      movieRoot: current.movieRoot || defaultMovieRoot,
      showRoot: current.showRoot || defaultShowRoot,
    }));
  }, [open, initial, defaultMovieRoot, defaultShowRoot]);

  const directory = async (
    key: "sourceRoot" | "movieRoot" | "showRoot",
  ) => {
    const value = await backend.selectDirectory();
    if (value) setDraft((current) => ({ ...current, [key]: value }));
  };
  const directoryField = (
    key: "sourceRoot" | "movieRoot" | "showRoot",
    label: string,
  ) => (
    <Form.Item label={label} required>
      <Input
        value={draft[key]}
        onChange={(event) =>
          setDraft((current) => ({ ...current, [key]: event.target.value }))
        }
        addonAfter={
          <Button
            type="text"
            aria-label={label}
            icon={<FolderOpen size={15} />}
            onClick={() => void directory(key)}
          />
        }
      />
    </Form.Item>
  );
  const valid = Boolean(
    draft.sourceRoot && draft.movieRoot && draft.showRoot,
  );

  return (
    <Modal
      open={open}
      title={title ?? t("tasks.newTask")}
      width={650}
      okText={submitText ?? t("tasks.createAndScan")}
      cancelText={t("common.cancel")}
      confirmLoading={loading}
      okButtonProps={{ disabled: !valid }}
      onCancel={onCancel}
      onOk={() => onCreate(draft)}
    >
      <Form layout="vertical">
        <Form.Item label={t("tasks.taskName")}>
          <Input
            value={draft.name}
            placeholder={t("tasks.taskNamePlaceholder")}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
        </Form.Item>
        <Form.Item label={t("tasks.scanMode")}>
          <Segmented
            block
            value={draft.mode}
            onChange={(mode) =>
              setDraft((current) => ({
                ...current,
                mode: mode as CreateTaskRequest["mode"],
              }))
            }
            options={[
              { value: "single", label: t("tasks.singleWork") },
              { value: "batch", label: t("tasks.batchLibrary") },
            ]}
          />
          <p className="field-help">
            {t(
              draft.mode === "single" ? "tasks.singleHelp" : "tasks.batchHelp",
            )}
          </p>
        </Form.Item>
        {directoryField("sourceRoot", t("tasks.sourceRoot"))}
        {directoryField("movieRoot", t("tasks.movieRoot"))}
        {directoryField("showRoot", t("tasks.showRoot"))}
        <Form.Item label={t("tasks.operation")}>
          <Radio.Group
            value={draft.operation}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                operation: event.target.value,
              }))
            }
          >
            <Radio value="move">{t("tasks.move")}</Radio>
            <Radio value="copy">{t("tasks.copy")}</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
}
