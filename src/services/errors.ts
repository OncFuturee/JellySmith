import type { TFunction } from "i18next";

export function localizedError(t: TFunction, error: unknown) {
  const raw = String(error).replace(/^Error:\s*/, "");
  const code = raw.includes(": ") ? raw.slice(raw.lastIndexOf(": ") + 2) : raw;
  return t(`errors.${code}`, {
    defaultValue: t("errors.unknown", { error: code }),
  });
}
