import type { FileKind, FileOperation, ScannedFile } from "../models";

export type PlanTreeNode = {
  key: string;
  name: string;
  path: string;
  nodeType: "folder" | "file";
  children?: PlanTreeNode[];
  operation?: FileOperation;
  fileKind?: FileKind;
  extension?: string;
};

const withoutExtendedPrefix = (value: string) =>
  value.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");

const normalizedPath = (value: string) =>
  withoutExtendedPrefix(value)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLocaleLowerCase();

const targetParts = (value: string) => {
  const normalized = withoutExtendedPrefix(value);
  const unc = normalized.startsWith("\\\\");
  const absolute = normalized.startsWith("/");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  if (unc && parts.length >= 2)
    return [`\\\\${parts[0]}\\${parts[1]}`, ...parts.slice(2)];
  if (absolute) return ["/", ...parts];
  return parts;
};

const extensionOf = (path: string) => {
  const parts = targetParts(path);
  const name = parts[parts.length - 1] ?? "";
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLocaleLowerCase() : "";
};

const kindFromExtension = (extension: string): FileKind => {
  if (["mkv", "mp4", "avi", "mov", "wmv", "m4v", "ts"].includes(extension))
    return "video";
  if (["srt", "ass", "ssa", "sub", "vtt", "sup"].includes(extension))
    return "subtitle";
  if (["aac", "ac3", "dts", "flac", "mka", "mp3", "wav"].includes(extension))
    return "audio";
  if (["jpg", "jpeg", "png", "webp"].includes(extension)) return "image";
  if (extension === "nfo") return "nfo";
  return "unknown";
};

const fileMetadata = (operation: FileOperation, files: ScannedFile[]) => {
  const source = normalizedPath(operation.source);
  const file = files.find((candidate) => {
    const relative = normalizedPath(candidate.relativePath);
    return source === relative || source.endsWith(`/${relative}`);
  });
  const innerSubtitle = source.match(/\.(srt|ass|ssa|sub|vtt|sup)\.txt$/)?.[1];
  const targetExtension = extensionOf(operation.target);
  const extension =
    targetExtension ||
    (innerSubtitle ? `${innerSubtitle}.txt` : file?.extension) ||
    extensionOf(operation.source);
  const detectedKind = innerSubtitle
    ? "subtitle"
    : kindFromExtension(targetExtension || file?.extension || extension);
  return {
    extension,
    fileKind:
      file?.kind && file.kind !== "unknown" ? file.kind : detectedKind,
  };
};

const sortNodes = (nodes: PlanTreeNode[]) => {
  nodes.sort(
    (left, right) =>
      Number(left.nodeType === "file") - Number(right.nodeType === "file") ||
      left.name.localeCompare(right.name, undefined, { numeric: true }),
  );
  nodes.forEach((node) => node.children && sortNodes(node.children));
};

export function buildPlanTree(
  operations: FileOperation[],
  files: ScannedFile[],
  missingTargetLabel: string,
) {
  const roots: PlanTreeNode[] = [];
  operations.forEach((operation) => {
    const parts = targetParts(operation.target || operation.source);
    const fileName = parts.pop() || operation.source;
    const folders = operation.target ? parts : [missingTargetLabel];
    let level = roots;
    let currentPath = "";
    folders.forEach((name) => {
      currentPath = currentPath ? `${currentPath}/${name}` : name;
      let node = level.find(
        (item) => item.nodeType === "folder" && item.name === name,
      );
      if (!node) {
        node = {
          key: `folder:${currentPath}`,
          name,
          path: currentPath,
          nodeType: "folder",
          children: [],
        };
        level.push(node);
      }
      level = node.children!;
    });
    level.push({
      key: `file:${operation.id}`,
      name: fileName,
      path: operation.target,
      nodeType: "file",
      operation,
      ...fileMetadata(operation, files),
    });
  });
  sortNodes(roots);
  return roots;
}

export function replaceTargetFileName(target: string, fileName: string) {
  const separator = target.includes("\\") ? "\\" : "/";
  const index = Math.max(target.lastIndexOf("\\"), target.lastIndexOf("/"));
  return index < 0 ? fileName : `${target.slice(0, index)}${separator}${fileName}`;
}
