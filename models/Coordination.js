const mongoose = require("mongoose");

const subItemSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "تسمية التنسيق الفرعي مطلوبة"],
      trim: true,
    },
    images: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

const coordinationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "اسم التنسيق الرئيسي مطلوب"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    items: [subItemSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Coordination", coordinationSchema);

