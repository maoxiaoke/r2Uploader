import type { DomainStatus } from "./contracts";

const ready = (value?: string) => !value || /^(active|ready|valid|ok)$/i.test(value);

export const isDomainReady = (domain: DomainStatus) =>
  domain.type === "managed" || (ready(domain.ownership) && ready(domain.ssl));

export const isUsableDomain = (domain: DomainStatus) => domain.enabled && isDomainReady(domain);
