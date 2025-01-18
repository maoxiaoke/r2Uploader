import { createContext, useEffect, useState, useContext } from "react";

import type { Bucket } from "../../shared/types";

export const BucketsContext = createContext<{
  buckets: Bucket[];
  setBuckets: any;
}>({
  buckets: [],
  setBuckets: () => {},
});

export const BucketsProvider = ({ children }) => {
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  useEffect(() => {
    window.electron.ipc.invoke("get-buckets").then((config) => {
      setBuckets(config);
    });

    const removeFun = window.electron.ipc.on(
      "buckets-updated",
      (bks: Bucket[]) => {
        setBuckets(bks);
      }
    );

    return () => {
      removeFun();
    };
  }, []);

  return (
    <BucketsContext.Provider
      value={{
        buckets,
        setBuckets,
      }}
    >
      {children}
    </BucketsContext.Provider>
  );
};

export const useBucketsContext = () => {
  return useContext(BucketsContext);
};
