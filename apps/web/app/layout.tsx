import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Cabo — a card game for friends', description: 'Play Cabo online with friends.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#11100F' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@400;500;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
