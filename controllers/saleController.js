const Sale = require("../models/Sale");
const Product = require("../models/Product");
const Order = require("../models/Order");
const DailyProfit = require("../models/DailyProfit");
const { updateProductStock } = require("../utils/productUtils");
const BonusConfig = require("../models/BonusConfig");
const BonusPeriod = require("../models/BonusPeriod");
const User = require("../models/User");

const generateUniqueBarcode = async () => {
  let barcode;
  let exists = true;

  while (exists) {
    barcode = Math.floor(10000000 + Math.random() * 90000000).toString();
    const existingSale = await Sale.findOne({ barcode });
    exists = !!existingSale;
  }

  return barcode;
};

exports.createSale = async (req, res) => {
  try {
    const {
      items,
      cashier,
      originalTotal,
      total,
      profit,
      discountAmount = 0,
      isPrePaid,
      prepaidAmount,
    } = req.body;

    // التحقق الأساسي
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "لا توجد منتجات في الطلب",
      });
    }

    if (!cashier) {
      return res.status(400).json({
        success: false,
        message: "معرف الكاشير مطلوب",
      });
    }

    console.log("--- createSale Debug ---");
    console.log("originalTotal:", originalTotal, typeof originalTotal);
    console.log("total:", total, typeof total);
    console.log("profit:", profit, typeof profit);
    console.log("discountAmount:", discountAmount, typeof discountAmount);
    console.log("is discountAmount > originalTotal?", discountAmount > originalTotal);
    console.log("------------------------");

    if (
      typeof originalTotal !== "number" ||
      typeof total !== "number" ||
      typeof profit !== "number" ||
      originalTotal < 0 ||
      total < 0 ||
      profit < 0
    ) {
      console.log("❌ Financial validation failed:");
      if (typeof originalTotal !== "number") console.log("- originalTotal is not a number");
      if (typeof total !== "number") console.log("- total is not a number");
      if (typeof profit !== "number") console.log("- profit is not a number");
      if (originalTotal < 0) console.log("- originalTotal < 0");
      if (total < 0) console.log("- total < 0");
      if (profit < 0) console.log("- profit < 0");

      return res.status(400).json({
        success: false,
        message: "البيانات المالية غير صالحة",
      });
    }

    if (typeof discountAmount !== "number" || discountAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "مبلغ التخفيض يجب أن يكون رقم موجب أو صفر",
      });
    }

    // التحقق من أن التخفيض لا يتجاوز الإجمالي
    if (discountAmount > originalTotal) {
      return res.status(400).json({
        success: false,
        message: "مبلغ التخفيض لا يمكن أن يكون أكبر من الإجمالي قبل التخفيض",
      });
    }

    const saleItems = [];

    // التحقق من كل عنصر + تحديث المخزون
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(400).json({
          success: false,
          message: `المنتج غير موجود: ${item.product}`,
        });
      }

      const color = product.colors.find((c) =>
        c.sizes.some((s) => s.barcode === item.barcode),
      );
      const size = color
        ? color.sizes.find((s) => s.barcode === item.barcode)
        : null;

      if (!color || !size) {
        return res.status(400).json({
          success: false,
          message: `لم يتم العثور على الباركود: ${item.barcode}`,
        });
      }

      // Check reserved quantity (unconfirmed orders only, as confirmed orders already deducted physical stock)
      const reservedOrders = await Order.aggregate([
        {
          $match: {
            status: "غير مؤكدة",
            "items.barcode": item.barcode,
          },
        },
        { $unwind: "$items" },
        { $match: { "items.barcode": item.barcode } },
        {
          $group: {
            _id: "$items.barcode",
            reservedQty: { $sum: "$items.quantity" },
          },
        },
      ]);

      const reservedQty =
        reservedOrders.length > 0 ? reservedOrders[0].reservedQty : 0;
      const availableQty = size.quantity - reservedQty;

      if (availableQty <= 0) {
        return res.status(400).json({
          success: false,
          message: `لا يوجد مخزون متاح. الكمية في المخزن ${size.quantity} وكلها محجوزة.`,
        });
      }

      if (item.quantity > availableQty) {
        return res.status(400).json({
          success: false,
          message: `الكمية المطلوبة (${item.quantity}) أكبر من المتاحة (${availableQty}).`,
        });
      }

      saleItems.push({
        product: product._id,
        barcode: item.barcode,
        quantity: item.quantity,
        price: item.price,
        originalPrice: item.originalPrice,
        size: item.size,
        color: item.color,
      });
    }

    const uniqueBarcode = await generateUniqueBarcode();

    const sale = new Sale({
      barcode: uniqueBarcode,
      items: saleItems,
      total,
      originalTotal,
      discountAmount,
      profit,
      cashier,
      isPrePaid,
      prepaidAmount,
    });

    const config = await BonusConfig.findOne();

    if (config && config.isEnabled) {
      let period = await BonusPeriod.findOne({
        user: cashier,
        status: "pending",
        endDate: null,
      });

      if (!period) {
        period = await BonusPeriod.create({
          user: cashier,
          startDate: new Date(),
          endDate: null,
          status: "pending",
          note: "تم إنشاؤها تلقائياً عند أول عملية بيع",
          bonusAmount: 0,
          adjustmentsTotal: 0,
          finalBonus: 0,
        });
      }

      const worker = await User.findById(cashier).select("bonusPercentage");

      if (worker && worker.bonusPercentage > 0) {
        const percentage = worker.bonusPercentage / 100;
        const base = total - (discountAmount || 0);
        const bonus = Math.trunc(base * percentage);

        // Store bonus details in the sale
        sale.bonusPercentageApplied = worker.bonusPercentage;
        sale.bonusAmount = bonus;

        period.bonusAmount += bonus;
        period.finalBonus = period.bonusAmount + (period.adjustmentsTotal || 0);

        await period.save();
      }
    }

    // Update stock (Fix: quantity should be positive for soldCount increment)
    await Promise.all(
      saleItems.map((item) =>
        updateProductStock(item.product, item.barcode, -item.quantity, true),
      ),
    );

    await sale.save();

    return res.status(201).json({
      success: true,
      data: sale,
    });
  } catch (error) {
    console.error("❌ createSale error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ أثناء إنشاء الفاتورة",
    });
  }
};

exports.exchangeProducts = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { exchanges } = req.body;
    const cashier = req.user._id;

    if (!exchanges || !Array.isArray(exchanges) || exchanges.length === 0) {
      return res.status(400).json({
        success: false,
        message: "لا توجد عناصر للاستبدال",
      });
    }

    const sale = await Sale.findById(saleId);
    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "الفاتورة غير موجودة",
      });
    }

    const now = new Date();
    const saleTime = new Date(sale.createdAt);
    const hoursDiff = (now - saleTime) / (1000 * 60 * 60);

    if (hoursDiff > 48) {
      return res.json({
        success: false,
        expired: true,
        message: "انتهت فترة الـ 48 ساعة المسموح بها للاستبدال",
      });
    }

    // ────────────────────────────────────────────────
    // إذا كانت هذه أول عملية استبدال، احفظ القيم قبل الاستبدال
    // ────────────────────────────────────────────────
    if (!sale.isExchanged) {
      sale.totalBeforeExchange = sale.total;
      sale.originalTotalBeforeExchange = sale.originalTotal;
      sale.profitBeforeExchange = sale.profit;
    }

    const stockUpdates = [];
    const exchangeRecords = [];
    let totalOriginalAmount = 0;
    let totalNewAmount = 0;
    let totalOriginalCost = 0;
    let totalNewCost = 0;
    let totalNewProfit = 0;

    for (const exchange of exchanges) {
      const { originalBarcode, newBarcode, newQuantity } = exchange;

      if (newQuantity < 1) {
        return res.status(400).json({
          success: false,
          message: `الكمية يجب أن تكون أكبر من الصفر للباركود: ${newBarcode}`,
        });
      }

      const originalItem = sale.items.find(
        (item) => item.barcode === originalBarcode,
      );
      if (!originalItem) {
        return res.status(404).json({
          success: false,
          message: `المنتج الأصلي غير موجود في الفاتورة: ${originalBarcode}`,
        });
      }

      const newProduct = await Product.findOne({
        "colors.sizes.barcode": newBarcode,
      });
      if (!newProduct) {
        return res.status(404).json({
          success: false,
          message: `المنتج الجديد غير موجود: ${newBarcode}`,
        });
      }

      let newSize = null;
      let newColor = null;

      for (const color of newProduct.colors) {
        for (const size of color.sizes) {
          if (size.barcode === newBarcode) {
            newSize = size;
            newColor = color;
            break;
          }
        }
        if (newSize) break;
      }

      if (!newSize || !newColor) {
        return res.status(404).json({
          success: false,
          message: `لم يتم العثور على المقاس أو اللون للباركود: ${newBarcode}`,
        });
      }

      if (newSize.quantity < newQuantity) {
        return res.status(400).json({
          success: false,
          message: `الكمية غير متوفرة للمنتج: ${newProduct.name} (${newSize.size}) - يتوفر ${newSize.quantity}`,
        });
      }

      const exchangedItem = {
        product: newProduct._id,
        barcode: newBarcode,
        quantity: newQuantity,
        price: newProduct.price,
        originalPrice: newProduct.originalPrice,
        size: newSize.size,
        color: newColor.color,
      };

      const originalAmount = originalItem.quantity * originalItem.price;
      const newAmount = newQuantity * newProduct.price;
      const priceDifference = newAmount - originalAmount;

      const originalCost = originalItem.quantity * originalItem.originalPrice;
      const newCost = newQuantity * newProduct.originalPrice;
      const newProfit =
        newQuantity * (newProduct.price - newProduct.originalPrice);

      stockUpdates.push(
        updateProductStock(
          originalItem.product,
          originalItem.barcode,
          originalItem.quantity,
          false,
        ),
        updateProductStock(newProduct._id, newBarcode, -newQuantity, false), // remove from stock
      );

      // Update the sale items (replace old with new)
      sale.items = sale.items.map((item) =>
        item.barcode === originalBarcode ? exchangedItem : item,
      );

      exchangeRecords.push({
        originalItem,
        exchangedWith: exchangedItem,
        exchangedAt: now,
        priceDifference,
      });

      totalOriginalAmount += originalAmount;
      totalNewAmount += newAmount;
      totalOriginalCost += originalCost;
      totalNewCost += newCost;
      totalNewProfit += newProfit;
    }

    await Promise.all(stockUpdates);

    sale.totalBeforeExchange = sale.total;
    sale.profitBeforeExchange = sale.profit;
    sale.originalTotalBeforeExchange = sale.originalTotal;

    // Recalculate current totals after exchange
    sale.total = sale.items.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0,
    );
    sale.originalTotal = sale.items.reduce(
      (sum, item) => sum + item.quantity * item.originalPrice,
      0,
    );
    sale.profit = sale.total - sale.originalTotal;

    // Mark as exchanged (only once)
    sale.isExchanged = true;
    sale.exchanges.push(...exchangeRecords);
    sale.exchangeCashier = cashier;
    sale.exchangedAt = new Date();

    await sale.save();

    res.json({
      success: true,
      data: sale,
    });
  } catch (error) {
    console.error("Error exchanging products:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء عملية الاستبدال",
    });
  }
};

/**
 * @route   POST /api/sales/:id/complete-payment
 * @desc    Mark a prepaid/reserved sale as fully paid by setting finalPaymentAt
 * @access  Private (cashier / admin)
 */
exports.completeSalePayment = async (req, res) => {
  try {
    const { id } = req.params; // sale _id
    const cashierId = req.user._id; // assuming JWT / auth middleware sets req.user

    const sale = await Sale.findById(id);
    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "الفاتورة غير موجودة",
      });
    }

    if (!sale.isPrePaid) {
      return res.status(400).json({
        success: false,
        message: "هذه الفاتورة ليست من نوع الدفع المسبق",
      });
    }

    if (sale.finalPaymentAt) {
      return res.status(400).json({
        success: false,
        message: "تم إتمام الدفع لهذه الفاتورة مسبقًا",
      });
    }

    sale.finalPaymentAt = new Date();

    sale.finalCashier = cashierId;

    await sale.save();

    // ── Response ───────────────────────────────────────────────────

    return res.status(200).json({
      success: true,
      message: "تم إتمام الدفع بنجاح",
      data: {
        saleId: sale._id,
        barcode: sale.barcode,
        total: sale.total,
        prepaidAmount: sale.prepaidAmount,
        remainingWas: sale.total - sale.prepaidAmount,
        completedAt: sale.finalPaymentAt.toISOString(),
        // status can be computed on frontend or via virtual if you add it
      },
    });
  } catch (error) {
    console.error("completeSalePayment error:", error);

    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إتمام عملية الدفع",
      error: error.message,
    });
  }
};

// exports.createSale = async (req, res) => {
//   try {
//     const { items, cashier } = req.body;

//     if (!items || items.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "لا توجد منتجات في الطلب",
//       });
//     }

//     let total = 0;
//     let originalTotal = 0;
//     let profit = 0;
//     const saleItems = [];

//     for (const item of items) {
//       const product = await Product.findById(item.product);
//       if (!product) {
//         return res.status(400).json({
//           success: false,
//           message: `المنتج غير موجود: ${item.product}`,
//         });
//       }

//       const color = product.colors.find((c) =>
//         c.sizes.some((s) => s.barcode === item.barcode)
//       );
//       const size = color
//         ? color.sizes.find((s) => s.barcode === item.barcode)
//         : null;

//       if (!color || !size) {
//         return res.status(400).json({
//           success: false,
//           message: `لم يتم العثور على الباركود: ${item.barcode}`,
//         });
//       }

//       // ✅ Check reserved quantity
//       const reservedOrders = await Order.aggregate([
//         {
//           $match: {
//             status: { $in: ["غير مؤكدة", "مؤكدة"] },
//             "items.barcode": item.barcode,
//           },
//         },
//         { $unwind: "$items" },
//         { $match: { "items.barcode": item.barcode } },
//         {
//           $group: {
//             _id: "$items.barcode",
//             reservedQty: { $sum: "$items.quantity" },
//           },
//         },
//       ]);

//       const reservedQty =
//         reservedOrders.length > 0 ? reservedOrders[0].reservedQty : 0;
//       const availableQty = size.quantity - reservedQty;

//       if (availableQty <= 0) {
//         return res.status(400).json({
//           success: false,
//           message: `لا يوجد مخزون متاح لهذا المنتج. الكمية في المخزن ${size.quantity} وكلها محجوزة.`,
//         });
//       }

//       if (item.quantity > availableQty) {
//         return res.status(400).json({
//           success: false,
//           message: `الكمية المطلوبة (${item.quantity}) أكبر من المتاحة (${availableQty}) بسبب الطلبيات المحجوزة.`,
//         });
//       }

//       const itemTotal = item.quantity * product.price;
//       const itemOriginalTotal = item.quantity * product.originalPrice;
//       const itemProfit = itemTotal - itemOriginalTotal;

//       total += itemTotal;
//       originalTotal += itemOriginalTotal;
//       profit += itemProfit;

//       saleItems.push({
//         product: product._id,
//         barcode: item.barcode,
//         quantity: item.quantity,
//         price: product.price,
//         originalPrice: product.originalPrice,
//         size: size.size,
//         color: color.color,
//       });
//     }

//     // ✅ Generate unique barcode
//     const uniqueBarcode = await generateUniqueBarcode();

//     const sale = new Sale({
//       barcode: uniqueBarcode,
//       items: saleItems,
//       total,
//       originalTotal,
//       profit,
//       cashier,
//     });

//     // Update stock
//     await Promise.all(
//       saleItems.map((item) =>
//         updateProductStock(item.product, item.barcode, -item.quantity, true)
//       )
//     );

//     await sale.save();

//     return res.status(201).json({
//       success: true,
//       // message: "تم إنشاء الفاتورة بنجاح",
//       data: sale,
//     });
//   } catch (error) {
//     console.error("❌ createSale error:", error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || "حدث خطأ أثناء إنشاء الفاتورة",
//     });
//   }
// };

exports.getSaleById = async (req, res) => {
  try {
    const { id } = req.params;

    const sale = await Sale.findById(id)
      .populate("cashier", "name")
      .populate("exchangeCashier", "name")
      .populate({
        path: "items.product",
        select: "name price colors barcode",
      })
      .populate({
        path: "exchanges.originalItem.product",
        select: "name price colors barcode",
      })
      .populate({
        path: "exchanges.exchangedWith.product",
        select: "name price colors barcode",
      });

    if (!sale) {
      return res.status(404).json({
        success: false,
        error: "الفاتورة غير موجودة",
      });
    }

    const now = new Date();
    const saleTime = new Date(sale.createdAt);
    const hoursDiff = (now - saleTime) / (1000 * 60 * 60);

    res.json({
      success: true,
      expired: hoursDiff > 50,
      data: sale,
    });
  } catch (error) {
    console.error("Error finding sale by ID:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.getSaleByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;

    let sale = await Sale.findOne({ barcode })
      .populate("cashier", "name")
      .populate("exchangeCashier", "name")
      .populate({
        path: "items.product",
        model: "Product",
        select: "name price colors barcode",
      });

    if (!sale) {
      sale = await Sale.findOne({ "items.barcode": barcode })
        .populate("cashier", "name")
        .populate("exchangeCashier", "name")
        .populate({
          path: "items.product",
          model: "Product",
          select: "name price colors barcode",
        });
    }

    if (!sale) {
      return res.status(404).json({
        success: false,
        error: "الفاتورة غير موجودة",
      });
    }

    const now = new Date();
    const saleTime = new Date(sale.createdAt);
    const hoursDiff = (now - saleTime) / (1000 * 60 * 60);

    res.json({
      success: true,
      expired: hoursDiff > 50,
      data: sale,
    });
  } catch (error) {
    console.error("Error finding sale by barcode:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.exchangeProducts = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { exchanges } = req.body;
    const cashier = req.user._id;

    if (!exchanges || !Array.isArray(exchanges) || exchanges.length === 0) {
      return res.status(400).json({
        success: false,
        message: "لا توجد عناصر للاستبدال",
      });
    }

    const sale = await Sale.findById(saleId);
    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "الفاتورة غير موجودة",
      });
    }

    const now = new Date();
    const saleTime = new Date(sale.createdAt);
    const hoursDiff = (now - saleTime) / (1000 * 60 * 60);

    if (hoursDiff > 50) {
      return res.json({
        success: false,
        expired: true,
        message: "انتهت فترة الـ 50 ساعة المسموح بها للاستبدال",
      });
    }

    const stockUpdates = [];
    const exchangeRecords = [];
    let totalOriginalAmount = 0;
    let totalNewAmount = 0;
    let totalOriginalCost = 0;
    let totalNewCost = 0;

    for (const exchange of exchanges) {
      const { originalBarcode, newBarcode, newQuantity } = exchange;

      if (newQuantity < 1) {
        return res.status(400).json({
          success: false,
          message: `الكمية يجب أن تكون أكبر من الصفر للباركود: ${newBarcode}`,
        });
      }

      const originalItem = sale.items.find(
        (item) => item.barcode === originalBarcode,
      );
      if (!originalItem) {
        return res.status(404).json({
          success: false,
          message: `المنتج الأصلي غير موجود في الفاتورة: ${originalBarcode}`,
        });
      }

      const newProduct = await Product.findOne({
        "colors.sizes.barcode": newBarcode,
      });
      if (!newProduct) {
        return res.status(404).json({
          success: false,
          message: `المنتج الجديد غير موجود: ${newBarcode}`,
        });
      }

      let newSize = null;
      let newColor = null;

      for (const color of newProduct.colors) {
        for (const size of color.sizes) {
          if (size.barcode === newBarcode) {
            newSize = size;
            newColor = color;
            break;
          }
        }
        if (newSize) break;
      }

      if (!newSize || !newColor) {
        return res.status(404).json({
          success: false,
          message: `لم يتم العثور على المقاس أو اللون للباركود: ${newBarcode}`,
        });
      }

      if (newSize.quantity < newQuantity) {
        return res.status(400).json({
          success: false,
          message: `الكمية غير متوفرة للمنتج: ${newProduct.name} (${newSize.size}) - يتوفر ${newSize.quantity}`,
        });
      }

      const exchangedItem = {
        product: newProduct._id,
        barcode: newBarcode,
        quantity: newQuantity,
        price: newProduct.price,
        originalPrice: newProduct.originalPrice,
        size: newSize.size,
        color: newColor.color,
      };

      const originalAmount = originalItem.quantity * originalItem.price;
      const newAmount = newQuantity * newProduct.price;
      const priceDifference = newAmount - originalAmount;

      const originalCost = originalItem.quantity * originalItem.originalPrice;
      const newCost = newQuantity * newProduct.originalPrice;

      stockUpdates.push(
        updateProductStock(
          originalItem.product,
          originalItem.barcode,
          originalItem.quantity,
          false,
        ),

        updateProductStock(newProduct._id, newBarcode, -newQuantity, false),
      );

      sale.items = sale.items.map((item) =>
        item.barcode === originalBarcode ? exchangedItem : item,
      );

      exchangeRecords.push({
        originalItem,
        exchangedWith: exchangedItem,
        exchangedAt: now,
        priceDifference,
      });

      totalOriginalAmount += originalAmount;
      totalNewAmount += newAmount;
      totalOriginalCost += originalCost;
      totalNewCost += newCost;
    }

    await Promise.all(stockUpdates);

    sale.total = sale.items.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0,
    );
    sale.originalTotal = sale.items.reduce(
      (sum, item) => sum + item.quantity * item.originalPrice,
      0,
    );
    sale.profit = sale.total - sale.originalTotal;

    // Adjust bonus if totals changed after exchange
    const oldBonusAmount = sale.bonusAmount || 0;
    let percentage = sale.bonusPercentageApplied;

    if (percentage === undefined || percentage === null) {
      const worker = await User.findById(sale.cashier).select("bonusPercentage");
      percentage = worker ? worker.bonusPercentage : 0;
      sale.bonusPercentageApplied = percentage;
    }

    if (percentage > 0) {
      const base = sale.total - (sale.discountAmount || 0);
      const newBonusAmount = Math.trunc(base * (percentage / 100));
      const diff = newBonusAmount - oldBonusAmount;

      if (diff !== 0) {
        const period = await BonusPeriod.findOne({
          user: sale.cashier,
          status: "pending",
          endDate: null,
        });

        if (period) {
          period.bonusAmount += diff;
          if (period.bonusAmount < 0) period.bonusAmount = 0;
          period.finalBonus = period.bonusAmount + (period.adjustmentsTotal || 0);
          await period.save();
          
          sale.bonusAmount = newBonusAmount;
        }
      }
    }

    sale.isExchanged = true;
    sale.exchanges.push(...exchangeRecords);
    sale.exchangeCashier = cashier;

    await sale.save();

    // await Promise.all([
    //   updateDailyProfit(
    //     saleTime,
    //     -totalOriginalAmount,
    //     -totalOriginalCost,
    //     -(totalOriginalAmount - totalOriginalCost)
    //   ),
    //   updateDailyProfit(
    //     now,
    //     totalNewAmount,
    //     totalNewCost,
    //     totalNewAmount - totalNewCost
    //   ),
    // ]);

    res.json({
      success: true,
      data: sale,
    });
  } catch (error) {
    console.error("Error exchanging products:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء عملية الاستبدال",
    });
  }
};

exports.getAllSales = async (req, res) => {
  try {
    const { date, page, limit } = req.query;

    let query = {};
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      query.createdAt = { $gte: startDate, $lte: endDate };
    }

    let salesQuery = Sale.find(query)
      .sort({ createdAt: -1 })
      .populate("cashier", "name")
      .populate("exchangeCashier", "name")
      .populate("items.product", "name price fabric")
      .lean();

    const total = await Sale.countDocuments(query);
    let pagination = null;

    if (page && limit) {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const skip = (pageNum - 1) * limitNum;
      salesQuery = salesQuery.skip(skip).limit(limitNum);
      pagination = {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
      };
    }

    let sales = await salesQuery;

    // Collect all exchange product IDs to batch-fetch instead of N+1 individual queries
    const exchangeProductIds = new Set();
    sales.forEach((sale) => {
      if (sale.exchanges && sale.exchanges.length > 0) {
        sale.exchanges.forEach((ex) => {
          if (ex.originalItem?.product)
            exchangeProductIds.add(String(ex.originalItem.product));
          if (ex.exchangedWith?.product)
            exchangeProductIds.add(String(ex.exchangedWith.product));
        });
      }
    });

    if (exchangeProductIds.size > 0) {
      const productsMap = new Map();
      const products = await Product.find({
        _id: { $in: Array.from(exchangeProductIds) },
      })
        .select("name price")
        .lean();

      products.forEach((p) => productsMap.set(String(p._id), p));

      sales.forEach((sale) => {
        if (sale.exchanges && sale.exchanges.length > 0) {
          sale.exchanges.forEach((ex) => {
            if (
              ex.originalItem?.product &&
              productsMap.has(String(ex.originalItem.product))
            ) {
              ex.originalItem.product = productsMap.get(
                String(ex.originalItem.product)
              );
            }
            if (
              ex.exchangedWith?.product &&
              productsMap.has(String(ex.exchangedWith.product))
            ) {
              ex.exchangedWith.product = productsMap.get(
                String(ex.exchangedWith.product)
              );
            }
          });
        }
      });
    }

    res.json({
      success: true,
      data: {
        sales,
        total,
        ...(pagination
          ? { pages: pagination.pages, currentPage: pagination.page }
          : {}),
      },
    });
  } catch (error) {
    console.error("Error getting sales:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.updateSale = async (req, res) => {
  try {
    const { id } = req.params;
    const { items, discountAmount } = req.body;

    const sale = await Sale.findById(id);
    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "الفاتورة غير موجودة",
      });
    }

    const oldItems = sale.items;
    const newItems = items;

    // Map of net changes for each barcode
    const variantChanges = new Map();

    // Track old quantities
    for (const item of oldItems) {
      variantChanges.set(item.barcode, {
        productId: item.product,
        oldQty: item.quantity,
        newQty: 0,
      });
    }

    // Track new quantities
    for (const item of newItems) {
      if (variantChanges.has(item.barcode)) {
        variantChanges.get(item.barcode).newQty = item.quantity;
      } else {
        variantChanges.set(item.barcode, {
          productId: item.product,
          oldQty: 0,
          newQty: item.quantity,
        });
      }
    }

    const stockUpdates = [];
    for (const [barcode, info] of variantChanges.entries()) {
      const diff = info.oldQty - info.newQty; // if positive, we add back to stock. if negative, we remove.
      if (diff !== 0) {
        stockUpdates.push(
          updateProductStock(info.productId, barcode, diff, true),
        );
      }
    }

    await Promise.all(stockUpdates);

    // Update sale items and totals
    sale.items = newItems.map((item) => ({
      product: item.product,
      barcode: item.barcode,
      quantity: item.quantity,
      price: item.price,
      originalPrice: item.originalPrice,
      size: item.size,
      color: item.color,
    }));

    sale.discountAmount = discountAmount || 0;
    sale.total = sale.items.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0,
    );
    sale.originalTotal = sale.items.reduce(
      (sum, item) => sum + item.quantity * item.originalPrice,
      0,
    );
    sale.profit =
      sale.total - (sale.discountAmount || 0) - sale.originalTotal;

    // Adjust bonus if totals changed
    const oldBonusAmount = sale.bonusAmount || 0;
    let percentage = sale.bonusPercentageApplied;

    // If percentage is not stored (old sale), try to get it from the user
    if (percentage === undefined || percentage === null) {
      const worker = await User.findById(sale.cashier).select("bonusPercentage");
      percentage = worker ? worker.bonusPercentage : 0;
      sale.bonusPercentageApplied = percentage;
    }

    if (percentage > 0) {
      const base = sale.total - (sale.discountAmount || 0);
      const newBonusAmount = Math.trunc(base * (percentage / 100));
      const diff = newBonusAmount - oldBonusAmount;

      if (diff !== 0) {
        const period = await BonusPeriod.findOne({
          user: sale.cashier,
          status: "pending",
          endDate: null,
        });

        if (period) {
          period.bonusAmount += diff;
          if (period.bonusAmount < 0) period.bonusAmount = 0;
          period.finalBonus = period.bonusAmount + (period.adjustmentsTotal || 0);
          await period.save();
          
          sale.bonusAmount = newBonusAmount;
        }
      }
    }

    await sale.save();

    res.json({
      success: true,
      message: "تم تحديث الفاتورة بنجاح",
      data: sale,
    });
  } catch (error) {
    console.error("Error updating sale:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث الفاتورة",
    });
  }
};

exports.deleteSale = async (req, res) => {
  try {
    const { id } = req.params;

    const sale = await Sale.findById(id);
    if (!sale) {
      return res.status(404).json({
        success: false,
        message: "الفاتورة غير موجودة",
      });
    }

    // Increment stock back for all items in the sale
    const stockUpdates = sale.items.map((item) =>
      updateProductStock(item.product, item.barcode, item.quantity, true),
    );

    await Promise.all(stockUpdates);

    // Subtract bonus from worker's pending period if applicable
    if (sale.bonusAmount > 0) {
      const period = await BonusPeriod.findOne({
        user: sale.cashier,
        status: "pending",
        endDate: null,
      });

      if (period) {
        period.bonusAmount -= sale.bonusAmount;
        // Ensure bonusAmount doesn't go below 0 (optional, but safer)
        if (period.bonusAmount < 0) period.bonusAmount = 0;
        
        period.finalBonus = period.bonusAmount + (period.adjustmentsTotal || 0);
        await period.save();
      }
    }

    // Delete the sale
    await Sale.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "تم حذف الفاتورة بنجاح وإرجاع المنتجات للمخزن وتعديل البونص",
    });
  } catch (error) {
    console.error("Error deleting sale:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف الفاتورة",
    });
  }
};

const updateDailyProfit = async (date, totalSales, totalOriginal, profit) => {
  try {
    const saleDate = new Date(date);
    saleDate.setHours(0, 0, 0, 0);

    await DailyProfit.findOneAndUpdate(
      { date: saleDate },
      {
        $inc: {
          totalSales,
          totalOriginal,
          totalProfit: profit,
          salesCount: profit > 0 ? 1 : 0,
          exchangeAdjustments: profit < 0 ? profit : 0,
          finalProfit: profit,
        },
      },
      { upsert: true, new: true },
    );
  } catch (error) {
    console.error("Error updating daily profit:", error);
  }
};
