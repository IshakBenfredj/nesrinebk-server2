const mongoose = require("mongoose");

const authHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    time: {
      type: Date,
      default: Date.now,
      required: true,
    },
    userAgent: {
      type: String,
      required: true,
    },
    isMobile: { type: Boolean, default: false },
    isTablet: { type: Boolean, default: false },
    isDesktop: { type: Boolean, default: false },
    browser: String,
    os: String,
    deviceBrand: String,
    type: {
      type: String,
      enum: ["login", "logout", "tab_closed"],
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

authHistorySchema.index({ user: 1, time: -1 });

module.exports = mongoose.model("AuthHistory", authHistorySchema);
