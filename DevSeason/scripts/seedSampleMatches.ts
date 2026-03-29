// scripts/seedSampleMatches.ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongoose from "mongoose";
import { connectToDB } from "../lib/db";
import { Team } from "../models/Team";
import { Match } from "../models/Match";

async function main() {
  try {
    await connectToDB();
    console.log("Connected to MongoDB");

    // Ensure team exists
    const teamName = "Summit Valorant";
    let team = await Team.findOne({ name: teamName });

    if (!team) {
      team = await Team.create({
        name: teamName,
        region: "Americas",
      });
      console.log("Created team:", team.name);
    } else {
      console.log("Team already exists:", team.name);
    }

    const samples = [
      {
        gridMatchId: "sample-1",
        team: team._id,
        opponentName: "NRG",
        map: "Ascent",
        eventName: "Test Event 1",
        date: new Date("2024-01-10"),
      },
      {
        gridMatchId: "sample-2",
        team: team._id,
        opponentName: "Sentinels",
        map: "Bind",
        eventName: "Test Event 2",
        date: new Date("2024-02-05"),
      },
      {
        gridMatchId: "sample-3",
        team: team._id,
        opponentName: "Leviatan",
        map: "Split",
        eventName: "Test Event 3",
        date: new Date("2024-03-15"),
      },
    ];

    for (const sample of samples) {
      const exists = await Match.findOne({ gridMatchId: sample.gridMatchId });
      if (exists) {
        console.log("Match already exists:", sample.gridMatchId);
        continue;
      }
      const created = await Match.create({
        ...sample,
        rawData: null,
      });
      console.log("Created match:", created.gridMatchId);
    }
  } catch (err) {
    console.error("Seed error:", err);
  } finally {
    await mongoose.connection.close();
    console.log("Disconnected from MongoDB");
    process.exit(0);
  }
}

main();
