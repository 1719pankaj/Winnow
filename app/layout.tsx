import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Winnow - Intent-Aware Personal Search Engine',
  description: 'Intent-aware metasearch with LLM reranking and legible pipeline progress.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
