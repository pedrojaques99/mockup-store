import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/Tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BOXY® Mockup Store",
  description:
    "Acervo de mockups da BOXY®: navegue, enquadre a arte e renderize localmente.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /* `lang` estava em `en` num produto inteiramente em português: leitor de tela
       pronuncia "Preencher a superfície" com fonemas ingleses, e o navegador oferece
       traduzir a própria língua. É uma palavra, e ela muda como o app soa. */
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* O provider do Tooltip só existia dentro do rail do editor de foto — e o
          `page.tsx` carregava um comentário dizendo que por isso não dava para usar os
          primitivos com tooltip na home. Um provider na raiz destrava `Tooltip` e
          `IconSegmented` em todo lugar, que é o ponto de existir primitivo. */}
      <body className="min-h-full flex flex-col">
        <TooltipProvider delayDuration={250} skipDelayDuration={100}>
          {children}
        </TooltipProvider>
      </body>
    </html>
  );
}
