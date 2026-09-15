import { backend } from "./backend";

const stringifyReason = (reason: unknown) => {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
};

export function recordApplicationError(target: string, reason: unknown) {
  return backend
    .writeApplicationLog("ERROR", target, stringifyReason(reason))
    .catch(() => undefined);
}

export function installApplicationLogging() {
  const onError = (event: ErrorEvent) =>
    void recordApplicationError("window.error", event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) =>
    void recordApplicationError("window.unhandledrejection", event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
