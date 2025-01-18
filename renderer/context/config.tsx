import { createContext, useEffect, useState, useContext } from "react";

import type { Config } from "../../shared/types";

export const ConfigContext = createContext<{
  config: Config;
}>(null);

export const ConfigProvider = ({ children }) => {
  const [config, setConfig] = useState<Config>(null);

  useEffect(() => {
    window.electron.ipc.invoke("get-config").then((config) => {
      setConfig(config);
    });
  }, []);

  useEffect(() => {
    const removeFun = window.electron.ipc.on(
      "config-updated",
      (config: Config) => {
        setConfig(config);
      }
    );

    return () => {
      removeFun();
    };
  }, []);

  return (
    <ConfigContext.Provider
      value={{
        config,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfigContext = () => {
  return useContext(ConfigContext);
};
