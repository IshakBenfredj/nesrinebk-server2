// models/BonusPeriod.js
const mongoose = require("mongoose");

const BonusPeriodSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "paid", "cancelled"],
      default: "pending",
      index: true,
    },
    paidAt: Date,
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    note: {
      type: String,
      trim: true,
    },
    bonusAmount: {
      type: Number,
      default: 0, 
    },

    adjustmentsTotal: {
      type: Number,
      default: 0,
    },

    finalBonus: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

BonusPeriodSchema.index({ user: 1, status: 1, startDate: -1 });
BonusPeriodSchema.index({ user: 1, endDate: 1 });

BonusPeriodSchema.virtual("totalBonus").get(async function () {
  if (!this.user || !this.startDate) return 0;

  const result = this.finalBonus || 0;
  return result;
});

module.exports = mongoose.model("BonusPeriod", BonusPeriodSchema);
