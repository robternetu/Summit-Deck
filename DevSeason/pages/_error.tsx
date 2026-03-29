import type { NextPageContext } from 'next'

type ErrorPageProps = {
  statusCode?: number
}

function ErrorPage({ statusCode }: ErrorPageProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'rgb(28, 17, 14)',
        color: 'rgb(249, 244, 239)',
        fontFamily: 'Quicksand, Segoe UI, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
        <p style={{ opacity: 0.75 }}>{statusCode ? `Error ${statusCode}` : 'Unexpected client error'}</p>
      </div>
    </div>
  )
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 404
  return { statusCode }
}

export default ErrorPage