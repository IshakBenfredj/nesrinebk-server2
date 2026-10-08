const Product = require("../models/Product");

const generateRandomBarcode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

exports.generateBarcode = generateRandomBarcode;

exports.generateUniqueBarcode = async () => {
  let attempts = 0;
  while (attempts < 50) {
    const candidate = generateRandomBarcode();
    const existing = await Product.findOne({ "colors.sizes.barcode": candidate })
      .select("_id")
      .lean();
    if (!existing) {
      return candidate;
    }
    attempts++;
  }
  // Fallback timestamp slice to guarantee 6 digits
  return (Date.now() % 900000 + 100000).toString();
};
