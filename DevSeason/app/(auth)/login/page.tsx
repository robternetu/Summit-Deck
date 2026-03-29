'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Lock, User, AlertCircle } from 'lucide-react'
import { APP_NAME, APP_SHORT_NAME, APP_TAGLINE } from '@/lib/branding'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Safety timeout to prevent stuck loading screen
    const timeoutId = setTimeout(() => {
      setLoading(false)
      setError('Login timeout. Please try again.')
      console.error('Login timeout after 10 seconds')
    }, 10000)

    try {
      console.log('Attempting login...')
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'same-origin', // Ensure cookies are included
      })

      console.log('Login response status:', res.status)

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        console.log('Login successful, cookie should be set')

        // Clear timeout since we got a response
        clearTimeout(timeoutId)

        // Verify the cookie was actually set
        console.log('Verifying cookie was set...')
        await new Promise(resolve => setTimeout(resolve, 300))
        
        // Check if cookie exists in document.cookie (httpOnly cookies won't show here)
        // The cookie is httpOnly so we can't verify it client-side, just proceed
        console.log('Cookie should be set (httpOnly, cannot verify client-side)')

        console.log('Redirecting to dashboard...')
        // Use replace to avoid back-button issues
        window.location.replace('/dashboard')
        // Note: loading state stays true during navigation - this is intentional
      } else {
        clearTimeout(timeoutId)
        const data = await res.json().catch(() => ({}))
        console.error('Login failed:', data)
        setError(data.message || 'Invalid credentials')
        setLoading(false)
      }
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('Login error:', err)
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
      {/* VCT Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <Image
          src="/VCT2026.png"
          alt="VCT Background"
          fill
          className="object-cover opacity-5"
          priority
        />
      </div>

      {/* Full Page Loading Screen */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              {/* Outer spinning ring */}
              <div className="w-20 h-20 border-4 border-[rgb(var(--accent-soft))]/30 border-t-[rgb(var(--accent-strong))] rounded-full animate-spin" />
              {/* Inner pulsing circle */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-12 bg-[rgb(var(--accent-strong))]/20 rounded-full animate-pulse" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-white text-lg font-medium">Signing in...</p>
              <p className="text-gray-400 text-sm mt-1">Please wait</p>
            </div>
          </div>
        </div>
      )}

      {/* Animated Background */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div
          className="absolute left-[10%] top-[18%] h-80 w-80 rounded-full blur-3xl"
          style={{ background: 'rgba(255, 184, 107, 0.18)', animation: 'pulse 4s ease-in-out infinite' }}
        />
        <div
          className="absolute bottom-[18%] right-[10%] h-80 w-80 rounded-full blur-3xl"
          style={{ background: 'rgba(95, 211, 207, 0.16)', animation: 'pulse 4s ease-in-out infinite 2s' }}
        />
      </div>

      <div className="relative z-10 grid w-full max-w-5xl gap-6 px-4 md:grid-cols-[1.1fr_0.9fr]">
        <section className="card hidden min-h-[620px] overflow-hidden p-8 md:block">
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] px-4 py-2 text-xs uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
                Competitive review workspace
              </div>
              <h1 className="max-w-xl text-5xl font-bold leading-[1.05] text-white">
                Tactical review with a sharper point of view.
              </h1>
              <p className="mt-5 max-w-xl text-lg text-[rgb(var(--muted-foreground))]">
                {APP_NAME} turns match evidence into a scouting surface built for fast review, clear scouting, and tighter prep.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[22px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">Focus</div>
                <div className="mt-2 text-lg font-semibold text-white">Round flow</div>
              </div>
              <div className="rounded-[22px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">Signal</div>
                <div className="mt-2 text-lg font-semibold text-white">Opponent patterns</div>
              </div>
              <div className="rounded-[22px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">Output</div>
                <div className="mt-2 text-lg font-semibold text-white">Coach-ready briefs</div>
              </div>
            </div>
          </div>
        </section>

        {/* Login Card */}
        <div className="relative z-10 w-full animate-fade-in-up">
          <div className="card p-8 md:p-10">
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)]">
                <Image
                  src="/logos/summit-mark.png"
                  alt={APP_SHORT_NAME}
                  width={56}
                  height={56}
                  className="h-full w-full object-contain"
                  priority
                />
              </div>
              <h2 className="text-3xl font-bold text-white">{APP_NAME}</h2>
              <p className="mt-2 max-w-sm text-sm text-[rgb(var(--muted-foreground))]">{APP_TAGLINE}</p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[rgb(var(--muted-foreground))]">Username</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[rgb(var(--muted-foreground))]" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input-field pl-12 pr-4"
                    placeholder="Enter your username"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[rgb(var(--muted-foreground))]">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[rgb(var(--muted-foreground))]" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field pl-12 pr-4"
                    placeholder="Enter your password"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[rgb(var(--surface-900))] border-t-transparent" />
                    Signing in...
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
