import { NextResponse } from 'next/server'
import { AUTH_CONFIG } from '@/config/auth'

export async function POST() {
  console.log('[AUTH] Logout requested')

  const res = NextResponse.json({ ok: true, message: 'Logged out successfully' })

  // Clear the auth cookie
  res.cookies.set(AUTH_CONFIG.cookieName, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0, // Expire immediately
  })

  console.log('[AUTH] Cookie cleared')
  return res
}
