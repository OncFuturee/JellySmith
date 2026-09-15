import { Checkbox, Tag } from "antd";
import DataGrid, {
  SelectColumn,
  textEditor,
  type Column,
  type RenderEditCellProps,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { useRef, type ClipboardEvent } from "react";
import type { EpisodeMapping, ScannedFile } from "../models";
import type { AiEpisodeEvidence } from "./episodeMapping";

export type EpisodeGridField = "season" | "episode" | "episodeEnd" | "title";

const EDITABLE_FIELDS: EpisodeGridField[] = [
  "season",
  "episode",
  "episodeEnd",
  "title",
];

type Labels = {
  row: string;
  file: string;
  season: string;
  episode: string;
  episodeEnd: string;
  episodeTitle: string;
  aiSuggestion: string;
  confirmed: string;
};

type Props = {
  rows: EpisodeMapping[];
  files: ReadonlyMap<string, ScannedFile>;
  evidence: Record<string, AiEpisodeEvidence>;
  issueFileIds: ReadonlySet<string>;
  selectedIds: ReadonlySet<string>;
  labels: Labels;
  onRowsChange: (rows: EpisodeMapping[]) => void;
  onSelectedIdsChange: (ids: Set<string>) => void;
  onActiveFieldChange: (row: number, field?: EpisodeGridField) => void;
};

function parseNumber(value: string, minimum: number): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(minimum, number) : undefined;
}

function NumberEditor({
  row,
  column,
  onRowChange,
  onClose,
}: RenderEditCellProps<EpisodeMapping>) {
  const field = column.key as "season" | "episode" | "episodeEnd";
  const minimum = field === "season" ? 0 : field === "episode" ? 1 : row.episode;
  const value = row[field];
  return (
    <input
      className="episode-grid-editor"
      inputMode="numeric"
      value={value ?? ""}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const next = parseNumber(event.target.value, minimum);
        onRowChange({
          ...row,
          [field]: field === "episodeEnd" ? next : (next ?? minimum),
          confirmed: false,
        });
      }}
      onBlur={() => onClose(true)}
    />
  );
}

function pasteMatrix(
  rows: EpisodeMapping[],
  startRow: number,
  startField: EpisodeGridField,
  text: string,
) {
  const startColumn = EDITABLE_FIELDS.indexOf(startField);
  if (startColumn < 0) return rows;
  const matrix = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line, index, values) => line.length || index < values.length - 1)
    .map((line) => line.split("\t"));
  if (!matrix.length) return rows;
  const next = [...rows];
  matrix.forEach((values, rowOffset) => {
    const current = next[startRow + rowOffset];
    if (!current) return;
    let updated = { ...current, confirmed: false };
    values.forEach((value, columnOffset) => {
      const field = EDITABLE_FIELDS[startColumn + columnOffset];
      if (!field) return;
      if (field === "title") {
        updated.title = value.trim();
      } else {
        const minimum = field === "season" ? 0 : field === "episode" ? 1 : updated.episode;
        const parsed = parseNumber(value, minimum);
        if (field === "episodeEnd") updated.episodeEnd = parsed;
        else if (parsed !== undefined) updated[field] = parsed;
      }
    });
    if (updated.episodeEnd !== undefined && updated.episodeEnd < updated.episode) {
      updated.episodeEnd = updated.episode;
    }
    next[startRow + rowOffset] = updated;
  });
  return next;
}

export default function EpisodeMappingGrid(props: Props) {
  const activeCell = useRef<{ row: number; field?: EpisodeGridField } | undefined>(undefined);
  const columns: readonly Column<EpisodeMapping>[] = [
    { ...SelectColumn, width: 42, frozen: true },
    {
      key: "rowNumber",
      name: props.labels.row,
      width: 46,
      frozen: true,
      renderCell: ({ rowIdx }) => <span className="sheet-row-number">{rowIdx + 1}</span>,
    },
    {
      key: "filePath",
      name: props.labels.file,
      width: 310,
      minWidth: 190,
      resizable: true,
      frozen: true,
      renderCell: ({ row }) => props.files.get(row.fileId)?.relativePath ?? row.fileId,
    },
    {
      key: "season",
      name: props.labels.season,
      width: 86,
      editable: true,
      renderCell: ({ row, rowIdx }) => (
        <span data-episode-cell={`${rowIdx}-season`}>{row.season}</span>
      ),
      renderEditCell: NumberEditor,
    },
    {
      key: "episode",
      name: props.labels.episode,
      width: 86,
      editable: true,
      renderCell: ({ row, rowIdx }) => (
        <span data-episode-cell={`${rowIdx}-episode`}>{row.episode}</span>
      ),
      renderEditCell: NumberEditor,
    },
    {
      key: "episodeEnd",
      name: props.labels.episodeEnd,
      width: 96,
      editable: true,
      renderCell: ({ row, rowIdx }) => (
        <span data-episode-cell={`${rowIdx}-episodeEnd`}>
          {row.episodeEnd ?? "—"}
        </span>
      ),
      renderEditCell: NumberEditor,
    },
    {
      key: "title",
      name: props.labels.episodeTitle,
      width: "minmax(220px, 1fr)",
      minWidth: 220,
      resizable: true,
      editable: true,
      renderCell: ({ row, rowIdx }) => (
        <span data-episode-cell={`${rowIdx}-title`}>{row.title}</span>
      ),
      renderEditCell: textEditor,
    },
    {
      key: "aiSuggestion",
      name: props.labels.aiSuggestion,
      width: 190,
      renderCell: ({ row }) => {
        const item = props.evidence[row.fileId];
        return item ? (
          <span className="ai-episode-evidence" title={item.reason}>
            <Tag color={item.confidence >= 0.8 ? "success" : "warning"}>
              {Math.round(item.confidence * 100)}%
            </Tag>
            <span>{item.reason}</span>
          </span>
        ) : (
          <span className="muted">—</span>
        );
      },
    },
    {
      key: "confirmed",
      name: props.labels.confirmed,
      width: 86,
      renderCell: ({ row, onRowChange }) => (
        <Checkbox
          checked={row.confirmed}
          onChange={(event) => onRowChange({ ...row, confirmed: event.target.checked })}
        />
      ),
    },
  ];

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!activeCell.current?.field || (!text.includes("\t") && !text.includes("\n"))) return;
    event.preventDefault();
    props.onRowsChange(
      pasteMatrix(props.rows, activeCell.current.row, activeCell.current.field, text),
    );
  };

  return (
    <div className="episode-grid-shell" onPasteCapture={handlePaste}>
      <DataGrid
        aria-label={props.labels.file}
        className="episode-data-grid"
        columns={columns}
        rows={props.rows}
        rowKeyGetter={(row) => row.fileId}
        selectedRows={props.selectedIds}
        onSelectedRowsChange={props.onSelectedIdsChange}
        onRowsChange={props.onRowsChange}
        rowHeight={40}
        headerRowHeight={38}
        rowClass={(row) =>
          props.issueFileIds.has(row.fileId) ? "episode-mapping-row-issue" : undefined
        }
        onSelectedCellChange={({ rowIdx, column }) => {
          const field = EDITABLE_FIELDS.includes(column.key as EpisodeGridField)
            ? (column.key as EpisodeGridField)
            : undefined;
          activeCell.current = { row: rowIdx, field };
          props.onActiveFieldChange(rowIdx, field);
        }}
      />
    </div>
  );
}
