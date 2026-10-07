const mongoose = require("mongoose");

const ProductHistorySchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    productName: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "product_updated",
        "product_deleted",
        "color_added",
        "color_removed",
        "color_updated",
        "size_added",
        "size_removed",
        "size_updated",
        "image_added",
        "image_removed",
        "stock_changed", // for quantity changes
      ],
    },
    details: {
      type: mongoose.Schema.Types.Mixed, // flexible object for different actions
      required: true,
    },
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // or whatever your user model is
      required: true,
    },
    // For easy searching/filtering
    color: { type: String, index: true }, // hex code if relevant
    size: { type: String },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
ProductHistorySchema.index({ productId: 1, createdAt: -1 });
ProductHistorySchema.index({ action: 1, createdAt: -1 });
ProductHistorySchema.index({ worker: 1, createdAt: -1 });

module.exports = mongoose.model("ProductHistory", ProductHistorySchema);