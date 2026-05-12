import localFont from 'next/font/local'

export const inter = localFont({
  src: [
    { path: '../soehne/soehne-leicht.woff2', weight: '300', style: 'normal' },
    { path: '../soehne/soehne-leicht-kursiv.woff2', weight: '300', style: 'italic' },
    { path: '../soehne/soehne-buch.woff2', weight: '400', style: 'normal' },
    { path: '../soehne/soehne-buch-kursiv.woff2', weight: '400', style: 'italic' },
    { path: '../soehne/soehne-kraftig.woff2', weight: '500', style: 'normal' },
    { path: '../soehne/soehne-kraftig-kursiv.woff2', weight: '500', style: 'italic' },
    { path: '../soehne/soehne-halbfett.woff2', weight: '600', style: 'normal' },
    { path: '../soehne/soehne-halbfett-kursiv.woff2', weight: '600', style: 'italic' },
    { path: '../soehne/soehne-dreiviertelfett.woff2', weight: '700', style: 'normal' },
    { path: '../soehne/soehne-dreiviertelfett-kursiv.woff2', weight: '700', style: 'italic' },
  ],
  display: 'swap',
  preload: true,
  variable: '--font-inter',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans'],
  adjustFontFallback: 'Arial',
})
