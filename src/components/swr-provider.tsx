'use client';
import { SWRConfig } from 'swr';

export function SwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateIfStale: true,
        revalidateOnReconnect: true,
        dedupingInterval: 2000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
