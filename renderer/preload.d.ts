import type { R2DesktopApi } from "../main/preload";

declare global {
  interface Window {
    r2: R2DesktopApi;
  }
}
