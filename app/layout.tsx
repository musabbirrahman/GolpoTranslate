import type {Metadata} from 'next';
import {
  Cormorant_Garamond,
  Plus_Jakarta_Sans,
  Noto_Serif_Bengali,
  JetBrains_Mono,
} from 'next/font/google';
import './globals.css';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jakarta',
});

const notoSerifBengali = Noto_Serif_Bengali({
  subsets: ['bengali'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-serif-bengali',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: 'GolpoTranslate — Adaptive AI Literary Translation Studio',
  description:
    'An adaptive AI literary translation studio for translating English stories and novels into natural, expressive Bangla while preserving the author’s unique literary voice.',
  openGraph: {
    title: 'GolpoTranslate — Adaptive AI Literary Translation Studio',
    description:
      'An adaptive AI literary translation studio for translating English stories and novels into natural, expressive Bangla while preserving the author’s unique literary voice.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GolpoTranslate — Adaptive AI Literary Translation Studio',
    description:
      'An adaptive AI literary translation studio for translating English stories and novels into natural, expressive Bangla while preserving the author’s unique literary voice.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${jakarta.variable} ${notoSerifBengali.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans-ui bg-[#FAF8F5] text-[#1C1917] min-h-screen selection:bg-[#9A3412]/15 selection:text-[#9A3412]" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

