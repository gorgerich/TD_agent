import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Onest, Source_Serif_4, Cormorant_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

// Дисплейная гарнитура — высококонтрастный гуманистический серив (Cormorant
// Garamond, есть кириллица). Память, достоинство, «тихая» редакционная подача.
const display = Cormorant_Garamond({
  subsets: ["latin", "cyrillic"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600"],
});

const serif = Source_Serif_4({
  subsets: ["latin", "cyrillic"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const mono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Тихий дом — кабинет агента",
  description: "Кабинет агента Тихого дома: лиды, встречи, сметы и комиссии.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${sans.variable} ${serif.variable} ${display.variable} ${mono.variable}`}>
      <body>
        <a href="#main-content" className="skip-link">К основному содержимому</a>
        {children}
      </body>
    </html>
  );
}
