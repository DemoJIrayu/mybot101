import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/500.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ออฟฟิศบอท",
  description: "ดู Lead, Dev และ QA ทำงานแบบสดในออฟฟิศ 3D",
};

// Runs before the page paints, so there's no light/dark flash. Default: follow the OS
// (Windows) setting; a choice made with the toggle is remembered in this browser.
const themeScript = `(function(){var d=document.documentElement,m=window.matchMedia('(prefers-color-scheme: dark)'),p='system';try{p=localStorage.getItem('office-theme')||'system'}catch(e){}d.dataset.themePref=p;d.dataset.theme=(p==='dark'||(p==='system'&&m.matches))?'dark':'light'})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
