import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Segmented, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Bug, RotateCcw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ApplicationLogEntry } from "../models";
import { backend } from "../services/backend";

const levelColor = (level: string) => {
  if (level === "ERROR") return "error";
  if (level === "WARN") return "warning";
  if (level === "DEBUG" || level === "TRACE") return "default";
  return "processing";
};

export default function ApplicationLogsPage() {
  const { t, i18n } = useTranslation();
  const { message, modal } = App.useApp();
  const [entries, setEntries] = useState<ApplicationLogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    void backend
      .listApplicationLogs()
      .then(setEntries)
      .catch((error) => message.error(String(error)))
      .finally(() => setLoading(false));
  }, [message]);
  useEffect(() => {
    load();
    window.addEventListener("jellysmith-refresh-app-logs", load);
    return () =>
      window.removeEventListener("jellysmith-refresh-app-logs", load);
  }, [load]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        (level === "ALL" || entry.level === level) &&
        (!needle ||
          `${entry.target} ${entry.message}`.toLowerCase().includes(needle)),
    );
  }, [entries, level, query]);
  const columns: ColumnsType<ApplicationLogEntry> = [
    {
      title: t("applicationLogs.time"),
      dataIndex: "time",
      width: 180,
      render: (value: number) =>
        new Date(value).toLocaleString(i18n.language, { hour12: false }),
    },
    {
      title: t("applicationLogs.level"),
      dataIndex: "level",
      width: 90,
      render: (value: string) => <Tag color={levelColor(value)}>{value}</Tag>,
    },
    {
      title: t("applicationLogs.source"),
      dataIndex: "target",
      width: 190,
      ellipsis: true,
    },
    {
      title: t("applicationLogs.message"),
      dataIndex: "message",
      render: (value: string) => <pre>{value}</pre>,
    },
  ];
  const clear = () =>
    modal.confirm({
      title: t("applicationLogs.clearConfirm"),
      okText: t("applicationLogs.clear"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        await backend.clearApplicationLogs();
        setEntries([]);
      },
    });
  return (
    <main className="application-logs-page">
      <header>
        <div className="application-logs-title">
          <Bug />
          <div>
            <h2>{t("applicationLogs.title")}</h2>
            <p>{t("applicationLogs.description")}</p>
          </div>
        </div>
        <div className="application-log-actions">
          <Button icon={<Trash2 size={14} />} danger onClick={clear}>
            {t("applicationLogs.clear")}
          </Button>
          <Button icon={<RotateCcw size={14} />} onClick={load} loading={loading}>
            {t("common.refresh")}
          </Button>
        </div>
      </header>
      <div className="application-log-tools">
        <Segmented
          value={level}
          onChange={(value) => setLevel(String(value))}
          options={["ALL", "ERROR", "WARN", "INFO", "DEBUG"]}
        />
        <Input
          allowClear
          prefix={<Search size={14} />}
          placeholder={t("applicationLogs.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>{t("applicationLogs.count", { count: filtered.length })}</span>
      </div>
      <section className="application-log-table">
        {filtered.length || loading ? (
          <Table
            rowKey={(entry) => `${entry.time}-${entry.target}-${entry.message}`}
            size="small"
            loading={loading}
            pagination={{ pageSize: 50, showSizeChanger: false, size: "small" }}
            columns={columns}
            dataSource={filtered}
          />
        ) : (
          <Empty description={t("applicationLogs.empty")} />
        )}
      </section>
    </main>
  );
}
