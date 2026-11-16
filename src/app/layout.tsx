import type { Metadata } from 'next';
import { factoryProfile } from '@/config/factory-profile';
import '@fontsource/noto-sans-arabic/arabic-400.css';
import '@fontsource/noto-sans-arabic/arabic-600.css';
import '@fontsource/noto-sans-arabic/latin-400.css';
import '@fontsource/noto-sans-arabic/latin-600.css';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${factoryProfile.name} — إدارة المصنع`, template: `%s | ${factoryProfile.name}` },
  description: `نظام إدارة مصنع ${factoryProfile.name}`,
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
