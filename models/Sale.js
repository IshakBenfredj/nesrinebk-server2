const mongoose = require("mongoose");

const SaleItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    barcode: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    size: {
      type: String,
      required: true,
      uppercase: true,
    },
    color: {
      type: String,
      required: true,
      match: [/^#([A-Fa-f0-9]{6})$/, "Hex color code"],
    },
    originalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const ExchangeItemSchema = new mongoose.Schema(
  {
    originalItem: {
      type: SaleItemSchema,
      required: true,
    },
    exchangedWith: {
      type: SaleItemSchema,
      required: true,
    },
    exchangedAt: {
      type: Date,
      default: Date.now,
    },
    priceDifference: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
);

const SaleSchema = new mongoose.Schema(
  {
    items: {
      type: [SaleItemSchema],
      required: true,
    },
    originalTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    profit: {
      type: Number,
      required: true,
    },
    totalBeforeExchange: {
      type: Number,
      min: 0,
    },
    profitBeforeExchange: {
      type: Number,
      min: 0,
    },
    prepaidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    originalTotalBeforeExchange: {
      type: Number,
      min: 0,
    },
    cashier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    exchangeCashier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    finalCashier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    exchanges: {
      type: [ExchangeItemSchema],
      default: [],
    },
    barcode: {
      type: String,
      required: true,
    },
    isExchanged: {
      type: Boolean,
      default: false,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    bonusPercentageApplied: {
      type: Number,
      min: 0,
      default: 0,
    },
    bonusAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    isPrePaid: {
      type: Boolean,
      default: false,
    },
    finalPaymentAt: {
      type: Date,
    },
    exchangedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for faster queries
SaleSchema.index({ createdAt: 1 });
SaleSchema.index({ barcode: 1 });
SaleSchema.index({ cashier: 1 });
SaleSchema.index({ "items.product": 1 });
SaleSchema.index({ isPrePaid: 1, finalPaymentAt: 1 });
SaleSchema.index({ isExchanged: 1, exchangedAt: 1 });

SaleSchema.virtual("remainingAmount").get(function () {
  return this.total - (this.prepaidAmount || 0);
});

SaleSchema.virtual("isFullyPaid").get(function () {
  if (!this.isPrePaid) return true;
  return !!this.finalPaymentAt || this.prepaidAmount >= this.total;
});

SaleSchema.virtual("paymentStatus").get(function () {
  if (!this.isPrePaid) return "completed";
  if (this.prepaidAmount >= this.total) return "completed_at_creation";
  if (this.finalPaymentAt) return "completed_later";
  return "prepaid_pending";
});

module.exports = mongoose.model("Sale", SaleSchema);
