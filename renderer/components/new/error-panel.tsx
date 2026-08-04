import { Alert } from "@openai/apps-sdk-ui/components/Alert";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { AppErrorData } from "../../../shared/contracts";
import { useAppState } from "../../context/app-state";

const zhErrors: Record<AppErrorData["kind"], { title: string; action: string }> = {
  AUTHENTICATION: { title: "认证失败", action: "请检查凭据、Account ID 与项目权限。" },
  PERMISSION: { title: "权限不足", action: "请为当前凭据补充此操作所需的最小权限。" },
  NETWORK: { title: "网络连接失败", action: "请检查网络或代理，然后重试。" },
  TIMEOUT: { title: "请求超时", action: "远端服务未及时响应，可以安全重试。" },
  RATE_LIMIT: { title: "请求频率受限", action: "请稍后重试，或降低并发数。" },
  CONFLICT: { title: "目标已存在", action: "请选择跳过、覆盖或自动改名。" },
  NOT_FOUND: { title: "远端对象不存在", action: "请刷新列表并确认对象未被其他客户端移动或删除。" },
  VALIDATION: { title: "输入无法执行", action: "请检查标出的输入或确认范围。" },
  UNAVAILABLE: { title: "服务暂时不可用", action: "请稍后重试；现有数据不会因此被清空。" },
  PARTIAL_SUCCESS: { title: "操作部分完成", action: "请阅读详细结果；应用会保留可恢复的来源数据。" },
  UNKNOWN: { title: "发生未知错误", action: "请复制脱敏详情并导出诊断包。" },
};

export const ErrorPanel = ({ error, onRetry }: { error: AppErrorData; onRetry?: () => void }) => {
  const { bootstrap, t, tx } = useAppState();
  const localized = bootstrap?.preferences.locale === "zh-CN" ? zhErrors[error.kind] : null;
  const details = JSON.stringify({ kind: error.kind, code: error.code, message: error.message, action: error.action, status: error.status, requestId: error.requestId, retryable: error.retryable }, null, 2);
  return <Alert
    color="danger"
    variant="soft"
    title={localized?.title ?? error.message}
    description={
      <div className="space-y-1">
        {localized ? <><p>{localized.action}</p><p className="text-xs opacity-80">{error.message}{error.action ? ` · ${error.action}` : ""}</p></> : error.action ? <p>{error.action}</p> : null}
        <p className="font-mono text-xs opacity-70">
          {error.code}{error.requestId ? ` · request ${error.requestId}` : ""}
        </p>
      </div>
    }
    actions={<div className="flex gap-2"><Button color="danger" variant="ghost" size="sm" onClick={() => void window.r2.system.copyText(details)}>{tx("Copy error details")}</Button>{error.retryable && onRetry ? <Button color="danger" variant="outline" size="sm" onClick={onRetry}>{t("retry")}</Button> : null}</div>}
  />
};
