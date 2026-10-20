"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { UnreadProvider } from "./UnreadContext";
import { TransactionReceiptsProvider } from "./TransactionReceipts";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <TransactionReceiptsProvider>
          <UnreadProvider>{children}</UnreadProvider>
        </TransactionReceiptsProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
