import type { ObjectItem, ShareLink } from "../../shared/contracts";

export type ShareTemplate = "url" | "markdown" | "html" | "css" | "json" | string;

const safeLabel = (value: string) => value.replace(/[\[\]<>"']/g, "");

export const formatShare = (
  item: Pick<ObjectItem, "displayName" | "key" | "contentType">,
  share: ShareLink,
  template: ShareTemplate,
  customTemplates: Record<string, string> = {}
) => {
  const url = share.url;
  const name = safeLabel(item.displayName);
  const contentType = item.contentType ?? "application/octet-stream";
  if (template === "markdown") return contentType.startsWith("image/") ? `![${name}](${url})` : `[${name}](${url})`;
  if (template === "html") return contentType.startsWith("image/") ? `<img src="${url}" alt="${name}" />` : `<a href="${url}">${name}</a>`;
  if (template === "css") return `url("${url.replace(/"/g, "%22")}")`;
  if (template === "json") return JSON.stringify({ name: item.displayName, key: item.key, url, expiresAt: share.expiresAt ?? null }, null, 2);
  if (customTemplates[template]) {
    const replacements: Record<string, string> = { url, name: item.displayName, key: item.key, expiresAt: share.expiresAt ?? "", contentType };
    return customTemplates[template].replace(/\{(url|name|key|expiresAt|contentType)\}/g, (_match, key: string) => replacements[key] ?? "");
  }
  return url;
};
