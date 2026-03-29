'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { APP_NAME, APP_SHORT_NAME } from '@/lib/branding'

export function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [logoError, setLogoError] = useState(false)
  
  // Don't show nav on root page
  if (pathname === '/') return null

  const navItems = [
    { href: '/dashboard', label: 'Overview' },
    { href: '/matches', label: 'Scouting' },
    { href: '/about', label: 'Project' },
  ]

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-[rgba(255,255,255,0.12)] bg-[rgba(0,0,0,0.92)] shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur-2xl animate-fade-in">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-4 group">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.04)] transition-all group-hover:border-[rgba(255,255,255,0.42)] group-hover:bg-[rgba(255,255,255,0.1)]">
            {!logoError ? (
              <Image
                src="/logos/summit-mark-v2.svg"
                alt={APP_SHORT_NAME}
                width={40}
                height={40}
                className="h-full w-full object-contain"
                onError={() => setLogoError(true)}
                unoptimized
              />
            ) : (
              <span className="text-sm font-bold text-[rgb(var(--accent-strong))]">SD</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold text-white">{APP_NAME}</div>
            <div className="truncate text-xs uppercase tracking-[0.24em] text-[rgb(var(--muted-foreground))]">Performance workspace</div>
          </div>
        </Link>

        <div className="hidden items-center gap-2 rounded-full border border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)] p-1 md:flex">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <button
                  className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all ${
                    pathname === item.href || pathname?.startsWith(item.href + '/')
                      ? 'bg-white text-black shadow-lg shadow-[rgba(255,255,255,0.28)]'
                      : 'text-[rgb(var(--muted-foreground))] hover:text-white hover:bg-[rgba(255,255,255,0.1)]'
                  }`}
                >
                  {item.label}
                </button>
              </Link>
            ))}
          </div>

        <div className="hidden text-right md:block">
          <div className="text-xs uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">Live workspace</div>
          <div className="text-sm text-white">Review, scout, and coach from one surface.</div>
        </div>
      </div>
    </nav>
  )
}
