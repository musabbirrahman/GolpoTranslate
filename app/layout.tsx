import type {Metadata} from 'next';
import './globals.css';

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
    <html lang="en" suppressHydrationWarning>
      <head suppressHydrationWarning>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var f=window.fetch;var d=Object.getOwnPropertyDescriptor(window,'fetch')||Object.getOwnPropertyDescriptor(Window.prototype,'fetch');if(d&&!d.set&&d.configurable!==false){Object.defineProperty(window,'fetch',{configurable:true,enumerable:true,get:function(){return f;},set:function(v){if(typeof v==='function')f=v;}});}}catch(e){}window.addEventListener('error',function(e){if(e&&((typeof e.filename==='string'&&e.filename.indexOf('chrome-extension://')===0)||(typeof e.message==='string'&&e.message.indexOf('Cannot set property fetch')!==-1))){e.stopImmediatePropagation();e.preventDefault();}},true);})();`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600;1,700&family=JetBrains+Mono:wght@400;500&family=Noto+Serif+Bengali:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body
        className="font-sans-ui bg-[#FAF8F5] text-[#1C1917] min-h-screen selection:bg-[#9A3412]/15 selection:text-[#9A3412]"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}

