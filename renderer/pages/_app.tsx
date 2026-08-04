import type { AppProps } from "next/app";
import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { AppStateProvider } from "../context/app-state";
import { TransferProvider } from "../context/transfers";
import { AppShell } from "../components/new/app-shell";

import "../styles/globals.css";

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AppsSDKUIProvider linkComponent="a">
      <AppStateProvider>
        <TransferProvider>
          <AppShell><Component {...pageProps} /></AppShell>
        </TransferProvider>
      </AppStateProvider>
    </AppsSDKUIProvider>
  );
}

export default MyApp;
