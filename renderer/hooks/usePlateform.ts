import { useState, useEffect } from "react";

export const usePlateform = () => {
  const [flatform, setFlatform] = useState<string>("darwin");

  useEffect(() => {
    setFlatform(window.electron.platform ?? "darwin");
  }, []);

  const isMac = flatform === "darwin";
  const isWindows = flatform === "win32";
  const isLinux = flatform === "linux";

  return {
    flatform,
    isMac,
    isWindows,
    isLinux,
  };
};
