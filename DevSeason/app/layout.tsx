import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Quicksand } from 'next/font/google'
import { Navigation } from '@/components/layout/Navigation'
import { APP_DESCRIPTION, APP_NAME } from '@/lib/branding'

const quicksand = Quicksand({
  subsets: ['latin'],
  variable: '--font-quicksand',
  display: 'swap',
})

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  icons: {
    icon: '/logos/summit-mark-v2.svg',
    shortcut: '/logos/summit-mark-v2.svg',
    apple: '/logos/summit-mark-v2.svg',
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${quicksand.variable} min-h-screen flex flex-col antialiased`}>
        <Navigation />
        <main className="flex-1">
          {children}
        </main>
        <footer className="border-t border-[rgba(255,255,255,0.08)] bg-black backdrop-blur-xl">
          <div className="container-base flex flex-col gap-1 py-5 text-sm text-[rgb(var(--muted-foreground))] md:flex-row md:items-center md:justify-between">
            <span>© {new Date().getFullYear()} {APP_NAME}</span>
            <span>Built for high-signal match intelligence, scouting, and review workflows.</span>
          </div>
        </footer>
      </body>
    </html>
  )
}
