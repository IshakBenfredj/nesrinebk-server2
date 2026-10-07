const mongoose = require("mongoose");

const SizeSchema = new mongoose.Schema(
  {
    size: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    barcode: {
      type: String,
      required: true,
      unique: true,
      maxlength: 6,
    },
  },
  { _id: false },
);

const ColorVariantSchema = new mongoose.Schema(
  {
    color: {
      type: String,
      required: true,
      match: [/^#([A-Fa-f0-9]{6})$/, "Hex color code"],
    },
    images: {
      type: [String],
      default: [],
    },
    sizes: {
      type: [SizeSchema],
    },
  },
  { _id: false },
);

const ProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    originalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    fabric: {
      type: String,
      default: "غير محدد",
    },
    colors: {
      type: [ColorVariantSchema],
      required: true,
    },
    category: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Category",
      required: true,
    },
    soldCount: {
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

ProductSchema.index({ name: "text", description: "text" });
ProductSchema.index({ "colors.sizes.barcode": 1 });
ProductSchema.index({ "colors.color": 1 });
ProductSchema.index({ category: 1 });
ProductSchema.index({ price: 1 });
ProductSchema.index({ createdAt: -1 });

ProductSchema.virtual("totalStock").get(function () {
  if (!this.variants || !Array.isArray(this.variants)) return 0;
  return this.variants.reduce((sum, variant) => sum + variant.stock, 0);
});

module.exports = mongoose.model("Product", ProductSchema);
