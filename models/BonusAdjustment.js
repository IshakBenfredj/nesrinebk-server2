const mongoose = require("mongoose");

const BonusAdjustmentSchema = new mongoose.Schema(
  {
    period: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BonusPeriod",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      required: true,
    },
    type: {
      type: String,
      enum: ["bonus_only", "cash_deduction"],
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("BonusAdjustment", BonusAdjustmentSchema);
