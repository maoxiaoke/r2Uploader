import { IpcHandler } from "../main/preload";

declare global {
  interface Window {
    electron: IpcHandler;
  }
}
