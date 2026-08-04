import type { AppErrorData } from "../../shared/contracts";

const recent: Array<AppErrorData & { occurredAt: string }> = [];

export const rememberError = (error: AppErrorData) => {
  recent.unshift({ ...error, occurredAt: new Date().toISOString() });
  if (recent.length > 100) recent.length = 100;
};

export const recentErrors = () => recent.map(({ occurredAt: _time, ...error }) => error);
