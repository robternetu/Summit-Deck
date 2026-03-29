import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTH_CONFIG } from '@/config/auth'

// Define which paths require authentication
// const protectedPaths = ['/dashboard', '/matches']

// Define public paths that should redirect to dashboard if authenticated
// const publicPaths = ['/login']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const authCookie = request.cookies.get(AUTH_CONFIG.cookieName)
  const isAuthenticated = authCookie?.value === '1'

  console.log('[MIDDLEWARE] Path:', pathname)
  console.log('[MIDDLEWARE] Looking for cookie:', AUTH_CONFIG.cookieName)
  console.log('[MIDDLEWARE] Cookie found:', authCookie ? 'YES' : 'NO')
  console.log('[MIDDLEWARE] Cookie value:', authCookie?.value)
  console.log('[MIDDLEWARE] Is authenticated:', isAuthenticated)
  console.log('[MIDDLEWARE] All cookies:', request.cookies.getAll().map(c => `${c.name}=${c.value}`).join(', '))

  // Auth checks disabled — all paths are publicly accessible
  // const isProtectedPath = protectedPaths.some(path => pathname.startsWith(path))
  // const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

  // Redirect to dashboard if accessing root or login
  if (pathname === '/' || pathname === '/login') {
    console.log('[MIDDLEWARE] Root or login path, redirecting to dashboard')
    const dashboardUrl = new URL('/dashboard', request.url)
    return NextResponse.redirect(dashboardUrl)
  }

  return NextResponse.next()
}

// Configure which routes use this middleware
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api routes (handled separately)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
