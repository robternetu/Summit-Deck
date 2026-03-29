import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { AUTH_CONFIG, isAuthenticatedCookie } from '@/config/auth'

export async function isAuthenticated(): Promise<boolean> {
  // Auth checks disabled — all users are authenticated
  return true
}

export async function requireAuth(): Promise<void> {
  // Auth checks disabled — all paths are publicly accessible
  console.log('[AUTH] Authentication bypass - All users allowed')
}
