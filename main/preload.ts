import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

const ipcHandler = {
  send(channel: string, value?: unknown) {
    ipcRenderer.send(channel, value);
  },
  on(channel: string, callback: (...args: unknown[]) => void) {
    const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, subscription);

    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
  invoke: ipcRenderer.invoke,
};

const handlers = {
  ipc: ipcHandler,
  platform: process.platform,
};

contextBridge.exposeInMainWorld("electron", handlers);

export type IpcHandler = typeof handlers;
