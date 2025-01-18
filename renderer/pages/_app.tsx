import React from "react";
import type { AppProps } from "next/app";
import { motion, AnimatePresence } from "motion/react";
import { ConfigProvider } from "@/context/config";
import { BucketsProvider } from "@/context/buckets";

import "../styles/globals.css";

const transition = {
  type: "spring",
  stiffness: 100,
  damping: 20,
  duration: 0.1,
};

const AnimatedPage = ({ children, down = false }) => {
  return (
    <motion.div
      initial={{ opacity: 0, translateY: down ? 0 : 40 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, translateY: down ? 0 : 140 }}
      transition={transition}
    >
      {children}
    </motion.div>
  );
};

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ConfigProvider>
      <BucketsProvider>
        {/* <AnimatePresence mode="wait"> */}
        <div className="w-full h-screen relative">
          {/* <AnimatedPage> */}
          <Component {...pageProps} />
          {/* </AnimatedPage> */}
        </div>
        {/* </AnimatePresence> */}
      </BucketsProvider>
    </ConfigProvider>
  );
}

export default MyApp;
