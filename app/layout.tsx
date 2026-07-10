import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Golos_Text, JetBrains_Mono } from "next/font/google";
import { ViewTransitions } from "next-view-transitions";
import "./globals.css";

// Golos Text — общая B2C/B2B гарнитура «Тихого дома».
const sans = Golos_Text({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Тихий дом - кабинет агента",
  description: "Кабинет агента «Тихого дома»: кейсы, встречи, сметы, документы и задачи.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // ViewTransitions: crossfade между маршрутами + shared-element морф
    // имени клиента (список ↔ кейс). Браузеры без View Transitions API
    // навигируют как раньше (DELIGHT, пункт View Transitions).
    <ViewTransitions>
      <html lang="ru" className={`${sans.variable} ${mono.variable}`}>
        <body>
          <a href="#main-content" className="skip-link">К основному содержимому</a>
          {children}
        </body>
      </html>
    </ViewTransitions>
  );
}
