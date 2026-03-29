const mongoose = require('mongoose')
require('dotenv').config({ path: '.env.local' })

async function addIndexes() {
  try {
    await mongoose.connect(process.env.MONGODB_URI)
    console.log('Connected to MongoDB')

    const db = mongoose.connection.db
    const collection = db.collection('matches')

    console.log('Creating dashboard_query_index...')
    await collection.createIndex(
      {
        'analytics.evidence_v1.derived.mapsStats': 1,
        'gridSeriesId': 1,
        '_id': -1
      },
      {
        sparse: true,
        name: 'dashboard_query_index',
        background: true  // Non-blocking index build
      }
    )

    console.log('✓ Index created successfully!')

    // Verify
    const indexes = await collection.indexes()
    console.log('Current indexes:', indexes.map(i => i.name))

    await mongoose.disconnect()
    process.exit(0)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

addIndexes()
