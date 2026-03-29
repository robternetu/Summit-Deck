import mongoose from 'mongoose'

let cached: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null } = {
  conn: null,
  promise: null,
}

function normalizeMongoUri(rawUri: string) {
  const trimmedUri = rawUri.trim()

  let parsedUri: URL
  try {
    parsedUri = new URL(trimmedUri)
  } catch {
    throw new Error('MONGODB_URI is not a valid MongoDB connection string.')
  }

  if (!parsedUri.pathname || parsedUri.pathname === '/') {
    parsedUri.pathname = '/c9-stratos'
  }

  if (!parsedUri.searchParams.has('retryWrites')) {
    parsedUri.searchParams.set('retryWrites', 'true')
  }

  if (!parsedUri.searchParams.has('w')) {
    parsedUri.searchParams.set('w', 'majority')
  }

  return parsedUri.toString()
}

export async function connectToDB() {
  if (cached.conn) return cached.conn

  if (!cached.promise) {
    const rawUri = process.env.MONGODB_URI
    if (!rawUri) {
      throw new Error('MONGODB_URI is not set. Set it in .env.local to enable database access.')
    }

    const cleanUri = normalizeMongoUri(rawUri)

    console.log('Mongo URI:', cleanUri.split('@')[1] || 'Atlas Cluster')

    cached.promise = mongoose.connect(cleanUri).catch((error: unknown) => {
      cached.promise = null

      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        'message' in error &&
        error.name === 'MongoServerError' &&
        typeof error.message === 'string' &&
        /Authentication failed/i.test(error.message)
      ) {
        throw new Error('MongoDB authentication failed. Verify the MONGODB_URI username, password, and database in .env.local.')
      }

      throw error
    })
  }

  cached.conn = await cached.promise
  return cached.conn
}

/**
 * Alias maintained for consistency with documentation and new components.
 */
export async function connectToDatabase() {
  return connectToDB()
}
