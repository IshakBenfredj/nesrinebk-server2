const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const Sale = require("./models/Sale");
const Product = require("./models/Product");

// Load env vars from .env file
dotenv.config();

const cleanupTodaySales = async () => {
  try {
    // 1. Connect to MongoDB
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined in .env");
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // 2. Define "today" range
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    console.log(`🔍 Finding sales between ${startOfToday.toISOString()} and ${endOfToday.toISOString()}...`);

    // 3. Find sales
    const sales = await Sale.find({
      createdAt: { $gte: startOfToday, $lte: endOfToday },
    });

    console.log(`📊 Found ${sales.length} sales to cleanup.`);

    if (sales.length === 0) {
      console.log("ℹ️ No sales found for today. Exiting.");
      process.exit(0);
    }

    // 4. Process each sale
    for (const sale of sales) {
      console.log(`\n📄 Processing Sale: ${sale.barcode} (_id: ${sale._id})`);

      for (const item of sale.items) {
        console.log(`   📦 Reversing Item: ${item.barcode} (Qty: ${item.quantity})`);

        // Find the product
        const product = await Product.findById(item.product);
        if (!product) {
          console.warn(`   ⚠️ Product ${item.product} not found! Skipping stock update for this item.`);
          continue;
        }

        // Find the specific size to update
        let sizeUpdated = false;
        product.colors.forEach((color) => {
          color.sizes.forEach((size) => {
            if (size.barcode === item.barcode) {
              size.quantity += item.quantity; // Increment stock
              sizeUpdated = true;
            }
          });
        });

        if (sizeUpdated) {
          // Decrement sold count
          product.soldCount = Math.max(0, (product.soldCount || 0) - item.quantity);
          
          // Save product changes
          await product.save();
          console.log(`   ✅ Stock incremented and soldCount decremented for ${product.name}`);
        } else {
          console.warn(`   ⚠️ Variant with barcode ${item.barcode} not found in product ${product.name}!`);
        }
      }

      // 5. Delete the sale
      await Sale.findByIdAndDelete(sale._id);
      console.log(`   🗑️ Sale ${sale.barcode} deleted.`);
    }

    console.log("\n✨ Cleanup completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Cleanup failed:", error);
    process.exit(1);
  }
};

cleanupTodaySales();
