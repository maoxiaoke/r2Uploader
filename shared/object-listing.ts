import type { ObjectItem, ObjectListPage } from "./contracts";

export const mergeObjectPages = (current: ObjectListPage | null, incoming: ObjectListPage, append: boolean): ObjectListPage => append && current ? {
  ...incoming,
  objects: [...current.objects, ...incoming.objects].filter((item, index, all) => all.findIndex((candidate) => candidate.key === item.key) === index),
  folders: [...new Set([...current.folders, ...incoming.folders])],
} : incoming;

export const isConfirmedEmptyListing = (page: ObjectListPage | null, visibleObjects: ObjectItem[], loading: boolean, hasError: boolean) =>
  Boolean(!hasError && !loading && page && page.folders.length === 0 && visibleObjects.length === 0);
