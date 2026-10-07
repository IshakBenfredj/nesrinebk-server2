const mongoose = require("mongoose");

const OrderItemSchema = new mongoose.Schema(
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
    size: {
      type: String,
      required: true,
      uppercase: true,
    },
    color: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
);

const ExchangeItemSchema = new mongoose.Schema(
  {
    originalItem: {
      type: OrderItemSchema,
      required: true,
    },
    exchangedWith: {
      type: OrderItemSchema,
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
    profitDifference: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
);

const OrderSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    state: { type: String, required: true },
    deliveryType: {
      type: String,
      enum: ["مكتب", "منزل"],
      required: true,
    },
    address: {
      type: String,
      default: "",
    },
    orderNumber: { type: Number, required: true, unique: true },
    items: { type: [OrderItemSchema], required: true },
    total: { type: Number, required: true, min: 0 },
    originalTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    profit: {
      type: Number,
      required: true,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: { type: String, default: "" },
    isPaid: { type: Boolean, default: false },
    accountName: { type: String },
    source: {
      type: String,
      enum: [
        "صفحة فيسبوك",
        "إنستغرام",
        "واتساب",
        "هاتف",
        "أخرى",
        "حساب فيسبوك",
      ],
      default: "أخرى",
      required: true,
    },
    status: {
      type: String,
      enum: ["غير مؤكدة", "مؤكدة", "قيد التوصيل", "تم الاستلام", "ارجاع"],
      default: "غير مؤكدة",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    handedToShipping: {
      type: Boolean,
      default: false,
    },
    isExchanged: {
      type: Boolean,
      default: false,
    },
    exchangedAt: {
      type: Date,
    },
    totalBeforeExchange: {
      type: Number,
      default: 0,
    },
    profitBeforeExchange: {
      type: Number,
      default: 0,
    },
    exchangeCashier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    exchanges: {
      type: [ExchangeItemSchema],
      default: [],
    },
    statusUpdatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

OrderSchema.index({ status: 1, "items.barcode": 1 });
OrderSchema.index({ status: 1, statusUpdatedAt: 1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ createdBy: 1 });

OrderSchema.pre("validate", function (next) {
  if (
    this.deliveryType === "منزل" &&
    (!this.address || this.address.trim() === "")
  ) {
    return next(new Error("العنوان مطلوب عند اختيار التوصيل للمنزل"));
  }
  next();
});

module.exports = mongoose.model("Order", OrderSchema);
