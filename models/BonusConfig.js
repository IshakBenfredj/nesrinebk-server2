const mongoose = require("mongoose");

const BonusConfigSchema = new mongoose.Schema(
  {
    isEnabled: {
      type: Boolean,
      default: false,  // ابدأ معطلة
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BonusConfig", BonusConfigSchema);