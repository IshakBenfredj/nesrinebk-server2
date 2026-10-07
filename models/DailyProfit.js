const mongoose = require("mongoose");

const DailyProfitSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
      unique: true,
    },
    totalSales: {
      type: Number,
      required: true,
      default: 0,
    },
    totalOriginal: {
      type: Number,
      required: true,
      default: 0,
    },
    totalProfit: {
      type: Number,
      required: true,
      default: 0,
    },
    exchangeAdjustments: {
      type: Number,
      default: 0,
    },
    finalProfit: {
      type: Number,
      required: true,
      default: 0,
    },
    salesCount: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true }
);

DailyProfitSchema.index({ date: 1 }, { unique: true });

module.exports = mongoose.model("DailyProfit", DailyProfitSchema);
