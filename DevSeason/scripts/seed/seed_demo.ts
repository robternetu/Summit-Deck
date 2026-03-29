import { loadEnvConfig } from '@next/env'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import mongoose from 'mongoose'

// 1. Load Next.js environment
loadEnvConfig(process.cwd())

let rawUri = process.env.MONGODB_URI
const DB_NAME = 'c9-stratos'

async function seed() {
  console.log('--- VERIFICATION START ---')
  
  if (!rawUri) {
    console.error('❌ ERROR: MONGODB_URI missing in .env.local')
    process.exit(1)
  }

  // --- CLEANING THE URI (The "Sanitizer") ---
  // This takes your URI, cuts off everything after the "?" and adds fresh settings
  // This prevents the "w cannot appear more than once" error
  let cleanUri = rawUri.split('?')[0]; 
  const queryParams = new URLSearchParams(rawUri.split('?')[1] || '');
  const appName = queryParams.get('appName');
  cleanUri = `${cleanUri}?retryWrites=true&w=majority${appName ? `&appName=${encodeURIComponent(appName)}` : ''}`;

  console.log('Original URI detected with duplicates. Cleaning...')
  console.log('Using Cleaned URI:', cleanUri.split('@')[1] || 'Atlas Cluster');
  console.log('---------------------------\n')

  try {
    console.log('Connecting to Atlas...')
    
    // Connect using the cleaned string
    await mongoose.connect(cleanUri, { 
      dbName: DB_NAME 
    })
    
    console.log('✅ Connected successfully!')

    // Find the JSON file
    const demoMatchesPath = join(__dirname, 'demo_matches.json')
    if (!existsSync(demoMatchesPath)) {
        console.error('❌ Cannot find demo_matches.json at:', demoMatchesPath)
        process.exit(1)
    }

    const demoMatches = JSON.parse(readFileSync(demoMatchesPath, 'utf-8'))
    const Match = mongoose.connection.collection('Match')

    console.log(`Seeding ${demoMatches.length} matches...`)

    // Clear existing matches if you want a clean seed (optional)
    // await Match.deleteMany({}); 

    for (const match of demoMatches) {
      await Match.updateOne(
        { gridSeriesId: match.gridSeriesId },
        { 
          $set: { 
            ...match, 
            updatedAt: new Date() 
          }, 
          $setOnInsert: { 
            createdAt: new Date() 
          } 
        },
        { upsert: true }
      )
    }

    console.log('\n🚀 SEED SUCCESSFUL!')
    console.log('Your database has been updated with the demo matches.')
    
    await mongoose.disconnect()
    process.exit(0)
  } catch (err: any) {
    console.error('❌ Connection Error:', err.message)
    console.log('\nTIP: Open your .env.local and make sure MONGODB_URI looks like:')
    console.log('MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/dbname')
    process.exit(1)
  }
}

seed()