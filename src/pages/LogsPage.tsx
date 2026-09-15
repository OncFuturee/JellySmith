import { useCallback, useEffect, useMemo, useState } from "react";
import {
  App,
  Button,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Table,
  Tabs,
  Tag,
} from "antd";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileWarning,
  Filter,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { ColumnsType } from "antd/es/table";
import type {
  FileOperation,
  LogLine,
  OrganizationPlan,
  RunResult,
} from "../models";
import { useTranslation } from "react-i18next";
import { backend } from "../services/backend";
import { localizedError } from "../services/errors";

type PlanItem = FileOperation;

const statusColor = (status: string) =>
  status === "completed"
    ? "success"
    : status === "failed" || status === "conflict"
      ? "error"
      : status === "rolled-back"
        ? "warning"
        : "processing";
const planFrom = (run?: RunResult) => {
  const value = run?.outputs.plan as
    | (OrganizationPlan & {
        items?: Array<
          Partial<FileOperation> & {
            id: string;
            source: string;
            target: string;
          }
        >;
      })
    | undefined;
  if (value && Array.isArray(value.operations)) return value;
  if (!value || !Array.isArray(value.items) || !run) return undefined;
  return {
    id: value.id ?? run.id,
    taskId: run.workflowId,
    taskRevision: 0,
    createdAt: run.startedAt,
    status: run.status,
    operations: value.items.map((item) => ({
      id: item.id,
      groupId: item.groupId ?? "legacy",
      source: item.source,
      target: item.target,
      operation: item.operation ?? "move",
      selected: item.selected ?? true,
      size: item.size ?? 0,
      modifiedAt: item.modifiedAt ?? 0,
      status: item.status ?? "skipped",
      reason: item.reason,
    })),
  };
};

export default function LogsPage() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [query, setQuery] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [itemFilter, setItemFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const time = (value: number) =>
    new Date(value).toLocaleString(i18n.language, { hour12: false });
  const duration = (start: number, end: number) => {
    const value = Math.max(0, end - start);
    return value < 1000
      ? `${value} ms`
      : value < 60000
        ? `${(value / 1000).toFixed(1)} s`
        : `${Math.floor(value / 60000)}m ${Math.round((value % 60000) / 1000)}s`;
  };
  const loadRuns = useCallback(() => {
    setLoading(true);
    void backend
      .listRuns()
      .then((items) => {
        setRuns(items);
        setSelectedId((current) =>
          items.some((item) => item.id === current) ? current : items[0]?.id,
        );
      })
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    loadRuns();
    window.addEventListener("jellysmith-refresh-runs", loadRuns);
    return () =>
      window.removeEventListener("jellysmith-refresh-runs", loadRuns);
  }, [loadRuns]);
  const filteredRuns = useMemo(
    () =>
      runs.filter((run) =>
        `${run.id}${run.workflowName}${run.status}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query, runs],
  );
  const selected = runs.find((run) => run.id === selectedId);
  const deleteSelectedRun = async () => {
    if (!selected) return;
    try {
      await backend.deleteRun(selected.id);
      const remaining = runs.filter((run) => run.id !== selected.id);
      setRuns(remaining);
      setSelectedId(remaining[0]?.id);
      message.success(t("logs.runDeleted"));
    } catch (error) {
      message.error(localizedError(t, error));
    }
  };
  const plan = planFrom(selected);
  const items = plan?.operations ?? [];
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (itemFilter === "all" || item.status === itemFilter) &&
          `${item.source}${item.target}${item.operation}${item.reason ?? ""}`
            .toLowerCase()
            .includes(itemQuery.toLowerCase()),
      ),
    [itemFilter, itemQuery, items],
  );
  const selectedItem =
    items.find((item) => item.id === selectedItemId) ?? visibleItems[0];
  useEffect(() => setSelectedItemId(undefined), [selectedId]);
  const counts = useMemo(
    () =>
      items.reduce(
        (value, item) => {
          value.total++;
          if (item.status === "completed") value.completed++;
          else if (item.status === "failed" || item.status === "conflict")
            value.failed++;
          else value.skipped++;
          return value;
        },
        { total: 0, completed: 0, failed: 0, skipped: 0 },
      ),
    [items],
  );
  const itemColumns: ColumnsType<PlanItem> = [
    { title: "#", width: 42, render: (_, __, index) => index + 1 },
    {
      title: t("logView.operation"),
      dataIndex: "operation",
      width: 90,
      render: (value) => <Tag color="blue">{value}</Tag>,
    },
    { title: t("logView.source"), dataIndex: "source", ellipsis: true },
    { title: t("logView.target"), dataIndex: "target", ellipsis: true },
    {
      title: t("logView.result"),
      dataIndex: "status",
      width: 100,
      render: (value) => (
        <Tag color={statusColor(value)}>
          {t(`logView.status.${value}`, { defaultValue: value })}
        </Tag>
      ),
    },
    {
      title: t("logView.reason"),
      dataIndex: "reason",
      width: 150,
      ellipsis: true,
      render: (value) => value || "—",
    },
  ];
  const logColumns: ColumnsType<LogLine> = [
    {
      title: t("logs.time"),
      dataIndex: "time",
      width: 180,
      render: (value) => time(value),
    },
    {
      title: t("logs.level"),
      dataIndex: "level",
      width: 85,
      render: (value) => (
        <Tag color={value === "ERROR" ? "error" : "blue"}>{value}</Tag>
      ),
    },
    { title: t("logs.message"), dataIndex: "message" },
  ];
  return (
    <div className="logs-workbench">
      <aside className="run-history">
        <div className="module-title">
          <b>{t("logs.history")}</b>
          <Tag>{runs.length}</Tag>
          <Filter size={14} />
          <Popconfirm
            title={t("logs.deleteRun")}
            description={t("logs.deleteRunConfirm")}
            okText={t("common.delete")}
            okButtonProps={{ danger: true }}
            cancelText={t("common.cancel")}
            disabled={!selected}
            onConfirm={() => void deleteSelectedRun()}
          >
            <Button
              type="text"
              size="small"
              danger
              disabled={!selected}
              icon={<Trash2 size={14} />}
              aria-label={t("logs.deleteRun")}
            />
          </Popconfirm>
        </div>
        <Input
          prefix={<Search size={13} />}
          placeholder={t("logs.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="history-list">
          {filteredRuns.map((run) => (
            <button
              key={run.id}
              className={run.id === selectedId ? "active" : ""}
              onClick={() => setSelectedId(run.id)}
            >
              <span>
                <b>{run.id}</b>
                <Tag color={statusColor(run.status)}>
                  {t(`logView.status.${run.status}`, {
                    defaultValue: run.status,
                  })}
                </Tag>
              </span>
              <strong>{run.workflowName}</strong>
              <small>v{run.workflowVersion}</small>
              <footer>
                <time>{time(run.startedAt)}</time>
                <em>{duration(run.startedAt, run.finishedAt)}</em>
              </footer>
            </button>
          ))}
          {!loading && !filteredRuns.length && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("logs.empty")}
            />
          )}
        </div>
      </aside>
      <main className="log-center">
        {selected ? (
          <>
            <header className="run-summary">
              <div>
                <h2>
                  {selected.id}
                  <Tag color={statusColor(selected.status)}>
                    {t(`logView.status.${selected.status}`, {
                      defaultValue: selected.status,
                    })}
                  </Tag>
                </h2>
                <p>
                  {selected.workflowName}
                  <Tag>v{selected.workflowVersion}</Tag>
                </p>
              </div>
              <dl>
                <div>
                  <dt>{t("logs.start")}</dt>
                  <dd>{time(selected.startedAt)}</dd>
                </div>
                <div>
                  <dt>{t("logs.duration")}</dt>
                  <dd>{duration(selected.startedAt, selected.finishedAt)}</dd>
                </div>
                <div>
                  <dt>{t("logView.runId")}</dt>
                  <dd>{selected.id}</dd>
                </div>
              </dl>
            </header>
            <div className="stage-line">
              {Object.entries(selected.nodeStates).map(
                ([id, status], index) => (
                  <div key={id} className={`stage-${status}`}>
                    <i>
                      {status === "failed" ? (
                        <AlertTriangle size={14} />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                    </i>
                    <b>{id}</b>
                    <small>
                      {t(`logView.status.${status}`, { defaultValue: status })}
                    </small>
                    {index < Object.keys(selected.nodeStates).length - 1 && (
                      <span />
                    )}
                  </div>
                ),
              )}
            </div>
            <section className="transaction-panel">
              <Tabs
                items={[
                  {
                    key: "transactions",
                    label: t("logs.transactions") + ` (${items.length})`,
                    children: (
                      <>
                        <div className="log-table-tools">
                          <Segmented
                            size="small"
                            value={itemFilter}
                            onChange={(value) => setItemFilter(String(value))}
                            options={[
                              { label: t("logView.all"), value: "all" },
                              {
                                label: t("logView.status.completed"),
                                value: "completed",
                              },
                              {
                                label: t("logView.status.failed"),
                                value: "failed",
                              },
                              {
                                label: t("logView.status.skipped"),
                                value: "skipped",
                              },
                            ]}
                          />
                          <Input
                            allowClear
                            prefix={<Search size={13} />}
                            value={itemQuery}
                            onChange={(event) =>
                              setItemQuery(event.target.value)
                            }
                            placeholder={t("logView.searchOperations")}
                          />
                          <span />
                          {t("logView.total", { count: visibleItems.length })}
                        </div>
                        {visibleItems.length ? (
                          <Table
                            rowKey="id"
                            size="small"
                            pagination={{
                              pageSize: 12,
                              size: "small",
                              showSizeChanger: false,
                            }}
                            scroll={{ x: 850 }}
                            columns={itemColumns}
                            dataSource={visibleItems}
                            onRow={(item) => ({
                              onClick: () => setSelectedItemId(item.id),
                              className:
                                item.id === selectedItem?.id
                                  ? "selected-row"
                                  : "",
                            })}
                          />
                        ) : (
                          <Empty description={t("logs.noTransactions")} />
                        )}
                      </>
                    ),
                  },
                  {
                    key: "logs",
                    label: t("logs.logCount", { count: selected.logs.length }),
                    children: (
                      <Table
                        rowKey={(row, index) => `${row.time}-${index}`}
                        size="small"
                        pagination={false}
                        columns={logColumns}
                        dataSource={selected.logs}
                      />
                    ),
                  },
                  {
                    key: "rollback",
                    label: t("logs.rollback"),
                    children: (
                      <div className="rollback-list">
                        {items
                          .filter((item) =>
                            ["rolled-back", "failed", "conflict"].includes(
                              item.status,
                            ),
                          )
                          .map((item) => (
                            <article key={item.id}>
                              <RotateCcw size={15} />
                              <b>{item.source}</b>
                              <span>{item.reason ?? item.status}</span>
                            </article>
                          ))}
                        {!items.some((item) =>
                          ["rolled-back", "failed", "conflict"].includes(
                            item.status,
                          ),
                        ) && <Empty description={t("logs.noRollback")} />}
                      </div>
                    ),
                  },
                  {
                    key: "context",
                    label: t("logs.context"),
                    children: (
                      <pre className="run-context">
                        {JSON.stringify(selected.outputs, null, 2)}
                      </pre>
                    ),
                  },
                ]}
              />
            </section>
            <section className="log-metrics">
              <article>
                <header>
                  <FileCheck2 />
                  {t("logView.summary")}
                </header>
                <strong>{counts.total}</strong>
                <span>{t("logView.operations")}</span>
                <dl>
                  <div>
                    <dt>{t("logView.status.completed")}</dt>
                    <dd className="ok">{counts.completed}</dd>
                  </div>
                  <div>
                    <dt>{t("logView.status.failed")}</dt>
                    <dd className="bad">{counts.failed}</dd>
                  </div>
                  <div>
                    <dt>{t("logView.status.skipped")}</dt>
                    <dd>{counts.skipped}</dd>
                  </div>
                </dl>
              </article>
              <article>
                <header>
                  <Clock3 />
                  {t("logView.performance")}
                </header>
                <strong>
                  {duration(selected.startedAt, selected.finishedAt)}
                </strong>
                <span>{t("logs.duration")}</span>
                <dl>
                  <div>
                    <dt>{t("logView.logEntries")}</dt>
                    <dd>{selected.logs.length}</dd>
                  </div>
                  <div>
                    <dt>{t("logView.nodes")}</dt>
                    <dd>{Object.keys(selected.nodeStates).length}</dd>
                  </div>
                </dl>
              </article>
              <article>
                <header>
                  <ShieldCheck />
                  {t("logView.safety")}
                </header>
                <div className="safety-check">
                  <CheckCircle2 />
                  {t("logView.noOverwrite")}
                </div>
                <div className="safety-check">
                  <CheckCircle2 />
                  {t("logView.localAudit")}
                </div>
              </article>
            </section>
          </>
        ) : (
          <Empty description={t("logs.empty")} />
        )}
      </main>
      <aside className="transaction-detail">
        <div className="module-title">
          <b>{t("logs.detail")}</b>
        </div>
        {selectedItem ? (
          <>
            <header>
              <FileWarning />
              <div>
                <b>{selectedItem.operation}</b>
                <Tag color={statusColor(selectedItem.status)}>
                  {t(`logView.status.${selectedItem.status}`, {
                    defaultValue: selectedItem.status,
                  })}
                </Tag>
              </div>
            </header>
            <Tabs
              items={[
                {
                  key: "detail",
                  label: t("logView.detail"),
                  children: (
                    <dl className="detail-list">
                      <div>
                        <dt>{t("logView.transactionId")}</dt>
                        <dd>{selectedItem.id}</dd>
                      </div>
                      <div>
                        <dt>{t("logView.source")}</dt>
                        <dd>{selectedItem.source}</dd>
                      </div>
                      <div>
                        <dt>{t("logView.target")}</dt>
                        <dd>{selectedItem.target || "—"}</dd>
                      </div>
                      <div>
                        <dt>{t("logView.size")}</dt>
                        <dd>
                          {(selectedItem.size / 1024 / 1024).toFixed(2)} MB
                        </dd>
                      </div>
                      <div>
                        <dt>{t("logView.result")}</dt>
                        <dd>
                          {t(`logView.status.${selectedItem.status}`, {
                            defaultValue: selectedItem.status,
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("logView.reason")}</dt>
                        <dd>{selectedItem.reason || "—"}</dd>
                      </div>
                    </dl>
                  ),
                },
                {
                  key: "context",
                  label: t("logs.context"),
                  children: (
                    <pre className="detail-json">
                      {JSON.stringify(selectedItem, null, 2)}
                    </pre>
                  ),
                },
              ]}
            />
          </>
        ) : (
          <Empty description={t("logs.selectTransaction")} />
        )}
      </aside>
    </div>
  );
}
