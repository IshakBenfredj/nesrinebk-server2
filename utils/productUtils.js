const Product = require("../models/Product");

// Update product stock and sold count atomically
exports.updateProductStock = async (
  productId,
  barcode,
  quantity,
  incrementSoldCount = false
) => {
  try {
    const filter = {
      _id: productId,
      "colors.sizes.barcode": barcode,
    };

    // If deducting stock, ensure current stock is sufficient (prevent negative stock)
    if (quantity < 0) {
      filter["colors.sizes"] = {
        $elemMatch: {
          barcode: barcode,
          quantity: { $gte: Math.abs(quantity) },
        },
      };
    }

    const update = {
      $inc: {
        "colors.$[].sizes.$[s].quantity": quantity,
      },
    };

    if (incrementSoldCount) {
      if (quantity < 0) {
        update.$inc.soldCount = Math.abs(quantity);
      } else if (quantity > 0) {
        update.$inc.soldCount = -quantity;
      }
    }

    const result = await Product.updateOne(filter, update, {
      arrayFilters: [{ "s.barcode": barcode }],
    });

    if (result.matchedCount === 0) {
      // Check if product/barcode exists or if it was insufficient stock
      const exists = await Product.findOne({
        _id: productId,
        "colors.sizes.barcode": barcode,
      }).lean();

      if (!exists) {
        throw new Error(`لم يتم العثور على الصنف أو الباركود: ${barcode}`);
      } else {
        throw new Error(
          `الكمية المتوفرة في المخزن غير كافية للباركود: ${barcode}`
        );
      }
    }

    return result;
  } catch (error) {
    console.error("Error updating product stock:", error.message);
    throw error;
  }
};

