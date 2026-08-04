import { randomUUID } from "node:crypto";
import type { OperationAction, OperationRecord } from "../../shared/contracts";
import { readJson, writeJson } from "./json-store";

const FILE = "operation-history.json";
const LIMIT = 2_000;
export const OPERATION_HISTORY_RETENTION_DAYS = 90;

const retained = (history: OperationRecord[]) => {
  const cutoff = Date.now() - OPERATION_HISTORY_RETENTION_DAYS * 86_400_000;
  return history.filter((record) => {
    const created = Date.parse(record.createdAt);
    return Number.isFinite(created) && created >= cutoff;
  }).slice(0, LIMIT);
};

export const recordOperation = (input: Omit<OperationRecord, "id" | "createdAt">) => {
  const history = retained(readJson<OperationRecord[]>(FILE, []));
  const record: OperationRecord = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  writeJson(FILE, [record, ...history].slice(0, LIMIT));
  return record;
};

export const listOperationHistory = () => {
  const history = readJson<OperationRecord[]>(FILE, []);
  const current = retained(history);
  if (current.length !== history.length) writeJson(FILE, current);
  return current;
};
export const clearOperationHistory = () => { writeJson(FILE, []); return []; };
export const getOperationRecord = (id: string) => listOperationHistory().find((record) => record.id === id);
