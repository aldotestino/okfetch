import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import { appDescription, appName, siteUrl } from '@/lib/shared';

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
  description: appDescription,
  openGraph: {
    siteName: appName,
    type: 'website',
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
  },
};

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
