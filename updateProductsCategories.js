// add-bonus-percentage-to-users.js
// Run this script once to add bonusPercentage: 0 to all existing users

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User'); // Adjust path to your User model

// ──────────────────────────────────────────────
// CONFIGURATION
// ──────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/yourdbname';

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI is not defined in .env file');
  process.exit(1);
}

// ──────────────────────────────────────────────
// CONNECT TO MONGODB
// ──────────────────────────────────────────────
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB successfully');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// ADD bonusPercentage = 0 TO ALL USERS
// ──────────────────────────────────────────────
async function addBonusPercentage() {
  try {
    console.log('Starting update...');

    // Find all users that do NOT have bonusPercentage set
    const usersWithoutBonus = await User.find({
      bonusPercentage: { $exists: true },
    }).select('_id name role phone');

    if (usersWithoutBonus.length === 0) {
      console.log('No users need updating — all already have bonusPercentage field.');
      return;
    }

    console.log(`Found ${usersWithoutBonus.length} users without bonusPercentage field.`);

    // Update them in bulk
    const result = await User.updateMany(
      { bonusPercentage: { $exists: true } },
      { $set: { bonusPercentage: 0 } }
    );

    console.log('Update completed successfully:');
    console.log(`- Matched users: ${result.matchedCount}`);
    console.log(`- Modified users: ${result.modifiedCount}`);

    // Optional: show a few examples
    if (usersWithoutBonus.length > 0) {
      console.log('\nSample users updated:');
      usersWithoutBonus.slice(0, 5).forEach(u => {
        console.log(`- ${u.name} (${u.role}) - phone: ${u.phone}`);
      });
      if (usersWithoutBonus.length > 5) {
        console.log(`... and ${usersWithoutBonus.length - 5} more`);
      }
    }
  } catch (err) {
    console.error('Error during update:', err.message);
  }
}

// ──────────────────────────────────────────────
// RUN THE SCRIPT
// ──────────────────────────────────────────────
(async () => {
  await connectDB();
  await addBonusPercentage();

  console.log('\nScript finished. Disconnecting...');
  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
  process.exit(0);
})();