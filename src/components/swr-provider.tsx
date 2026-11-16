'use client';
import { SWRConfig } from 'swr';

export function SwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateIfStale: false,
        revalidateOnReconnect: false,
        dedupingInterval: 60000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
