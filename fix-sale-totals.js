const mongoose = require("mongoose");
const Sale = require("./models/Sale"); // Make sure this path is correct

// ====================== CONFIGURATION ======================
const MONGO_URI = "mongodb+srv://nesrinebka21:nesrinebka21@cluster0.2yyiwtw.mongodb.net/nesrinebka?retryWrites=true&w=majority&appName=Cluster0";

const DAYS_TO_CHECK = 14;
// ===========================================================

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB successfully");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

function calculateCorrectTotal(items) {
  if (!items || !Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const price = item.price || 0;
    const qty = item.quantity || 1;
    return sum + price * qty;
  }, 0);
}

function calculateCorrectOriginalTotal(items) {
  if (!items || !Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const originalPrice = item.originalPrice || 0;
    const qty = item.quantity || 1;
    return sum + originalPrice * qty;
  }, 0);
}

// ==================== FIND AFFECTED SALES ====================
async function findAffectedSales() {
  console.log("🔍 Searching for sales with incorrect 'total'...");

  let query = {
    discountAmount: { $gt: 0 },
    total: { $gt: 0 },
    items: { $exists: true, $ne: [] },
  };

  if (DAYS_TO_CHECK) {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - DAYS_TO_CHECK);
    query.createdAt = { $gte: fromDate };
    console.log(`📅 Limiting search to last ${DAYS_TO_CHECK} days`);
  }

  const sales = await Sale.find(query)
    .select("barcode total discountAmount items originalTotal profit createdAt")
    .sort({ createdAt: -1 });

  let affected = [];
  let checked = 0;

  for (const sale of sales) {
    checked++;
    const calculatedTotal = calculateCorrectTotal(sale.items);
    const savedTotal = sale.total || 0;
    const discount = sale.discountAmount || 0;
    const savedProfit = sale.profit || 0;
    const calculatedOriginalTotal = calculateCorrectOriginalTotal(sale.items);
    const correctProfit = calculatedTotal - calculatedOriginalTotal;

    const isTotalAffected =
      Math.abs(savedTotal - (calculatedTotal - discount)) < 0.1 ||
      Math.abs(savedTotal + discount - calculatedTotal) < 0.1;
    
    const isProfitAffected = 
      Math.abs(savedProfit - (correctProfit - discount)) < 0.1;

    if ((isTotalAffected && calculatedTotal > savedTotal + 0.01) || (isProfitAffected && correctProfit > savedProfit + 0.01)) {
      affected.push({
        _id: sale._id,
        barcode: sale.barcode,
        createdAt: sale.createdAt,
        savedTotal: Number(savedTotal.toFixed(2)),
        savedProfit: Number(savedProfit.toFixed(2)),
        discountAmount: Number(discount.toFixed(2)),
        calculatedTotal: Number(calculatedTotal.toFixed(2)),
        correctProfit: Number(correctProfit.toFixed(2)),
        totalDiff: Number((calculatedTotal - savedTotal).toFixed(2)),
        profitDiff: Number((correctProfit - savedProfit).toFixed(2)),
      });
    }
  }

  console.log(`\n📊 Checked ${checked} sales with discount`);
  console.log(`🚨 Found ${affected.length} affected sales\n`);

  if (affected.length > 0) {
    console.table(
      affected.map((s) => ({
        Barcode: s.barcode,
        Date: s.createdAt.toISOString().split("T")[0],
        "Saved Tot": s.savedTotal,
        "Corr Tot": s.calculatedTotal,
        "Tot Diff": "+" + s.totalDiff,
        "Saved Prof": s.savedProfit,
        "Corr Prof": s.correctProfit,
        "Prof Diff": "+" + s.profitDiff,
        Discount: s.discountAmount,
      }))
    );
  } else {
    console.log("✅ No affected sales found.");
  }

  return affected;
}

// ==================== FIX FUNCTION ====================
async function fixAffectedSales(affectedSales) {
  if (affectedSales.length === 0) {
    console.log("✅ Nothing to fix.");
    return;
  }

  console.log(`\n🔧 Starting to fix ${affectedSales.length} sales...`);

  let fixedCount = 0;
  let failedCount = 0;

  for (const saleData of affectedSales) {
    try {
      const sale = await Sale.findById(saleData._id);
      if (!sale) {
        console.log(`⚠️ Sale ${saleData.barcode} not found`);
        continue;
      }

      const newTotal = calculateCorrectTotal(sale.items);
      const newOriginalTotal = calculateCorrectOriginalTotal(sale.items);
      const newProfit = newTotal - newOriginalTotal;

      const oldTotal = sale.total;
      const oldProfit = sale.profit;

      sale.total = Number(newTotal.toFixed(2));
      sale.originalTotal = Number(newOriginalTotal.toFixed(2));
      sale.profit = Number(newProfit.toFixed(2));

      await sale.save({ validateBeforeSave: false });

      console.log(`✅ FIXED → ${sale.barcode} | Total: ${oldTotal}→${sale.total} | Profit: ${oldProfit}→${sale.profit}`);
      fixedCount++;
    } catch (error) {
      console.error(`❌ Failed to fix ${saleData.barcode}:`, error.message);
      failedCount++;
    }
  }

  console.log(`\n🎉 Fix completed!`);
  console.log(`   Successfully fixed : ${fixedCount}`);
  console.log(`   Failed             : ${failedCount}`);
}

// ====================== MAIN ======================
async function main() {
  await connectDB();

  const affectedSales = await findAffectedSales();

  if (affectedSales.length === 0) {
    await mongoose.disconnect();
    return;
  }

  console.log("\n" + "=".repeat(70));
  console.log(`⚠️  READY TO FIX ${affectedSales.length} SALES`);
  console.log("This will update 'total', 'originalTotal', and 'profit' fields.");
  console.log("=".repeat(70));

  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  readline.question('\nType "YES" to proceed with the fix: ', async (answer) => {
    if (answer.trim().toUpperCase() === "YES") {
      console.log("\n🚀 Starting database update...\n");
      await fixAffectedSales(affectedSales);
    } else {
      console.log("❌ Operation cancelled by user. No changes made.");
    }

    readline.close();
    await mongoose.disconnect();
    console.log("✅ Disconnected from MongoDB.");
  });
}

main().catch((err) => {
  console.error("❌ Script error:", err);
  mongoose.disconnect();
});