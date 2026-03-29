import { NextResponse } from 'next/server'
import { AUTH_CONFIG } from '@/config/auth'

export async function POST(req: Request) {
  try {
    console.log('[AUTH] Received login request')

    const body = await req.json().catch(() => {
      console.error('[AUTH] Failed to parse request body')
      return {}
    })

    const { username, password } = body

    console.log('[AUTH] Login attempt for username:', username)

    if (!username || !password) {
      console.error('[AUTH] Missing username or password')
      return NextResponse.json(
        { message: 'Username and password are required' },
        { status: 400 }
      )
    }

    if (username === AUTH_CONFIG.username && password === AUTH_CONFIG.password) {
      console.log('[AUTH] Credentials valid, setting cookie')

      const res = NextResponse.json({ ok: true, message: 'Login successful' })

      // Set auth cookie with proper configuration
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      }

      console.log('[AUTH] Cookie options:', cookieOptions)
      res.cookies.set(AUTH_CONFIG.cookieName, '1', cookieOptions)

      console.log('[AUTH] Cookie set successfully:', AUTH_CONFIG.cookieName, '= 1')
      console.log('[AUTH] Response headers will include Set-Cookie')
      return res
    }

    console.error('[AUTH] Invalid credentials provided')
    return NextResponse.json(
      { message: 'Invalid credentials' },
      { status: 401 }
    )
  } catch (error) {
    console.error('[AUTH] Unexpected error:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}
