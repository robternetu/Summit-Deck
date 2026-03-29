// scripts/recompute-dashboard-stats.ts
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import mongoose from 'mongoose'
import { connectToDB } from '../lib/db'
import { Match } from '../models/Match'
import { DashboardStats } from '../models/DashboardStats'
import { computeDashboardStatsForStorage } from '../lib/analytics/computeDashboardStatsForStorage'

async function recomputeDashboardStats() {
  try {
    console.log('Connecting to MongoDB...')
    await connectToDB()
    console.log('✓ Connected to MongoDB')

    console.log('\nFetching all matches with evidence...')
    const matches = await Match.find({
      'analytics.evidence_v1.derived.mapsStats': { $exists: true }
    })
      .select('gridSeriesId opponentName analytics.evidence_v1')
      .lean()

    console.log(`✓ Found ${matches.length} matches with evidence data`)

    if (matches.length === 0) {
      console.log('\n⚠ No matches found. Skipping stats computation.')
      await mongoose.disconnect()
      process.exit(0)
    }

    console.log('\nComputing dashboard statistics...')
    const statsData = computeDashboardStatsForStorage(
      matches as Array<{ gridSeriesId?: string; opponentName?: string; analytics?: any }>
    )

    console.log('✓ Computed stats:')
    console.log(`  - Total Series: ${statsData.totalSeries}`)
    console.log(`  - Series Wins: ${statsData.seriesWins}`)
    console.log(`  - Series Losses: ${statsData.seriesLosses}`)
    console.log(`  - Maps Played: ${Object.keys(Object.fromEntries(statsData.mapsPlayed)).length} unique maps`)
    console.log(`  - Attack Win Rate: ${(statsData.attackWinRate * 100).toFixed(1)}%`)
    console.log(`  - Defense Win Rate: ${(statsData.defenseWinRate * 100).toFixed(1)}%`)
    console.log(`  - Recent Series: ${statsData.recentSeries.length} series`)
    console.log(`  - Struggling Against: ${statsData.strugglingAgainst.length} opponents`)

    console.log('\nSaving to DashboardStats collection...')
    await DashboardStats.findOneAndUpdate(
      { _id: 'featured-team' },
      {
        ...statsData,
        _id: 'featured-team',
      },
      { upsert: true, new: true }
    )

    console.log('✓ Dashboard stats saved successfully!')

    // Verify the saved data
    console.log('\nVerifying saved stats...')
    const savedStats = await DashboardStats.findOne({ _id: 'featured-team' })
    console.log('✓ Verification:')
    console.log(`  - Document ID: ${savedStats?._id}`)
    console.log(`  - Last Updated: ${savedStats?.lastUpdated}`)
    console.log(`  - Matches Processed: ${savedStats?.matchesProcessed}`)

    await mongoose.disconnect()
    console.log('\n✅ Dashboard stats recomputation complete!')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Error:', error)
    await mongoose.disconnect()
    process.exit(1)
  }
}

recomputeDashboardStats()

