/**
 * Test script for authentication flow
 * Run with: node scripts/test-auth-flow.js
 */

const BASE_URL = 'http://localhost:3000'

async function testAuthFlow() {
  console.log('\n=== Testing Authentication Flow ===\n')

  // Test 1: Login with correct credentials
  console.log('Test 1: Login with correct credentials')
  try {
    const loginRes = await fetch(`${BASE_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'summit',
        password: 'SummitVCT2026'
      })
    })

    const loginData = await loginRes.json()
    const cookies = loginRes.headers.get('set-cookie')

    console.log('  Status:', loginRes.status)
    console.log('  Response:', loginData)
    console.log('  Cookie set:', cookies ? 'YES' : 'NO')

    if (loginRes.ok && cookies && cookies.includes('summit_auth=1')) {
      console.log('  ✓ PASS: Login successful and cookie set\n')
    } else {
      console.log('  ✗ FAIL: Login failed or cookie not set\n')
      return
    }

    // Extract cookie for next requests
    const cookieValue = cookies.split(';')[0]

    // Test 2: Access protected route with cookie
    console.log('Test 2: Access dashboard with valid cookie')
    try {
      const dashboardRes = await fetch(`${BASE_URL}/dashboard`, {
        headers: { 'Cookie': cookieValue }
      })

      console.log('  Status:', dashboardRes.status)
      console.log('  Redirected:', dashboardRes.redirected)

      if (dashboardRes.ok && !dashboardRes.url.includes('/login')) {
        console.log('  ✓ PASS: Dashboard accessible with auth\n')
      } else if (dashboardRes.redirected && dashboardRes.url.includes('/login')) {
        console.log('  ✗ FAIL: Redirected to login despite having cookie\n')
      } else {
        console.log('  ? WARN: Unexpected response\n')
      }
    } catch (error) {
      console.log('  ✗ FAIL:', error.message, '\n')
    }

    // Test 3: Logout
    console.log('Test 3: Logout')
    try {
      const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Cookie': cookieValue }
      })

      const logoutData = await logoutRes.json()
      const logoutCookies = logoutRes.headers.get('set-cookie')

      console.log('  Status:', logoutRes.status)
      console.log('  Response:', logoutData)
      console.log('  Cookie cleared:', logoutCookies && logoutCookies.includes('Max-Age=0') ? 'YES' : 'NO')

      if (logoutRes.ok) {
        console.log('  ✓ PASS: Logout successful\n')
      } else {
        console.log('  ✗ FAIL: Logout failed\n')
      }
    } catch (error) {
      console.log('  ✗ FAIL:', error.message, '\n')
    }

  } catch (error) {
    console.log('  ✗ FAIL:', error.message, '\n')
  }

  // Test 4: Login with wrong credentials
  console.log('Test 4: Login with wrong credentials')
  try {
    const badLoginRes = await fetch(`${BASE_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'wrong',
        password: 'wrong'
      })
    })

    const badLoginData = await badLoginRes.json()

    console.log('  Status:', badLoginRes.status)
    console.log('  Response:', badLoginData)

    if (badLoginRes.status === 401 && badLoginData.message) {
      console.log('  ✓ PASS: Invalid credentials rejected properly\n')
    } else {
      console.log('  ✗ FAIL: Should return 401 with error message\n')
    }
  } catch (error) {
    console.log('  ✗ FAIL:', error.message, '\n')
  }

  // Test 5: Access protected route without cookie
  console.log('Test 5: Access dashboard without cookie (should redirect)')
  try {
    const unauthedRes = await fetch(`${BASE_URL}/dashboard`, {
      redirect: 'manual'
    })

    console.log('  Status:', unauthedRes.status)
    console.log('  Location:', unauthedRes.headers.get('location'))

    if (unauthedRes.status === 307 && unauthedRes.headers.get('location')?.includes('/login')) {
      console.log('  ✓ PASS: Redirected to login as expected\n')
    } else if (unauthedRes.ok) {
      console.log('  ✗ FAIL: Dashboard accessible without auth!\n')
    } else {
      console.log('  ? WARN: Unexpected response\n')
    }
  } catch (error) {
    console.log('  ✗ FAIL:', error.message, '\n')
  }

  console.log('=== Test Complete ===\n')
}

// Run tests
testAuthFlow().catch(console.error)
