const Order = require("../models/Order");
const Product = require("../models/Product");
const { updateProductStock } = require("../utils/productUtils");

async function getNextOrderNumber() {
  const lastOrder = await Order.findOne().sort({ orderNumber: -1 });
  return lastOrder ? lastOrder.orderNumber + 1 : 1;
}

exports.createOrder = async (req, res) => {
  try {
    const {
      fullName,
      phone,
      state,
      deliveryType,
      address,
      items,
      notes,
      isPaid,
      status = "غير مؤكدة",
      originalTotal,
      total,
      profit,
      discountAmount = 0,
      accountName,
      source,
      handedToShipping = false,
    } = req.body;

    if (!items || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "محتوى الطلبية فارغ" });
    }

    if (!deliveryType || !["مكتب", "منزل"].includes(deliveryType)) {
      return res
        .status(400)
        .json({ success: false, message: "نوع التوصيل غير صالح" });
    }

    if (deliveryType === "منزل" && (!address || address.trim() === "")) {
      return res.status(400).json({
        success: false,
        message: "العنوان مطلوب في حالة التوصيل للمنزل",
      });
    }

    // Validate financial fields (sent from frontend)
    if (
      typeof originalTotal !== "number" ||
      typeof total !== "number" ||
      typeof profit !== "number" ||
      originalTotal < 0 ||
      total < 0
    ) {
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

    if (discountAmount > originalTotal) {
      return res.status(400).json({
        success: false,
        message: "مبلغ التخفيض لا يمكن أن يكون أكبر من الإجمالي الأصلي",
      });
    }

    let shouldDecreaseStock = status !== "غير مؤكدة" && status !== "ارجاع";

    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res
          .status(404)
          .json({ success: false, message: "المنتج غير موجود" });
      }

      let foundSize = null;
      for (const color of product.colors) {
        for (const size of color.sizes) {
          if (size.barcode === item.barcode) {
            foundSize = size;
            break;
          }
        }
        if (foundSize) break;
      }

      if (!foundSize) {
        return res.status(400).json({
          success: false,
          message: `الباركود ${item.barcode} غير موجود`,
        });
      }

      // Check reserved quantity (unconfirmed orders only, as confirmed orders already deduct physical stock)
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
      const availableQty = foundSize.quantity - reservedQty;

      if (item.quantity > availableQty) {
        return res.status(400).json({
          success: false,
          message: `الكمية غير متوفرة للمنتج ${product.name}. المتبقي ${availableQty} بعد حجز الطلبات.`,
        });
      }

      // Decrease stock if needed
      if (shouldDecreaseStock) {
        foundSize.quantity = Math.max(foundSize.quantity - item.quantity, 0);
      }
    }

    const orderNumber = await getNextOrderNumber();

    const newOrder = await Order.create({
      fullName,
      phone,
      state,
      deliveryType,
      address: deliveryType === "منزل" ? address : "",
      orderNumber,
      items,
      total,
      originalTotal,
      profit,
      discountAmount,
      notes,
      isPaid,
      status,
      source,
      createdBy: req.user._id,
      accountName,
      handedToShipping,
    });

    // Update stock in DB if needed
    if (shouldDecreaseStock) {
      for (const item of items) {
        await Product.updateOne(
          { _id: item.product, "colors.sizes.barcode": item.barcode },
          { $inc: { "colors.$[].sizes.$[s].quantity": -item.quantity } },
          { arrayFilters: [{ "s.barcode": item.barcode }] },
        );
      }
    }

    res
      .status(201)
      .json({ success: true, data: newOrder, message: "تم إنشاء طلبية بنجاح" });
  } catch (err) {
    console.error("Error creating order:", err);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء إنشاء الطلبية" });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, handedToShipping } = req.body;

    const order = await Order.findById(id);
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "الطلبية غير موجودة" });

    const oldStatus = order.status;
    if (status !== undefined) {
      order.status = status;
      order.statusUpdatedAt = new Date();
    }
    if (handedToShipping !== undefined) {
      order.handedToShipping = handedToShipping;
    }
    await order.save();

    const shouldDecreaseNew = status !== "غير مؤكدة" && status !== "ارجاع";
    const shouldDecreaseOld =
      oldStatus !== "غير مؤكدة" && oldStatus !== "ارجاع";

    // ✅ إذا كانت الحالة الجديدة يجب أن تنقص المخزون والحالة القديمة لا
    if (shouldDecreaseNew && !shouldDecreaseOld) {
      for (const item of order.items) {
        await updateProductStock(
          item.product,
          item.barcode,
          -item.quantity,
          true,
        );
      }
    }

    // ✅ إذا كانت الحالة القديمة ناقصة المخزون والحالة الجديدة رجعت إلى غير مؤكدة / ارجاع
    if (!shouldDecreaseNew && shouldDecreaseOld) {
      for (const item of order.items) {
        await updateProductStock(
          item.product,
          item.barcode,
          item.quantity,
          true,
        );
      }
    }

    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Error updating order status:", err);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء تحديث حالة الطلبية" });
  }
};

// PUT /orders/:id
exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      fullName,
      phone,
      state,
      deliveryType,
      address,
      items,
      notes,
      isPaid,
      status,
      originalTotal,
      total,
      profit,
      discountAmount = 0,
      source,
      accountName,
      handedToShipping,
    } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "الطلبية غير موجودة" });
    }

    // Validate required fields
    if (!items || items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "المنتجات مطلوبة" });
    }

    if (!deliveryType || !["مكتب", "منزل"].includes(deliveryType)) {
      return res
        .status(400)
        .json({ success: false, message: "نوع التوصيل غير صالح" });
    }

    if (deliveryType === "منزل" && (!address || address.trim() === "")) {
      return res
        .status(400)
        .json({ success: false, message: "العنوان مطلوب للتوصيل للمنزل" });
    }

    // Financial validation
    if (
      typeof originalTotal !== "number" ||
      typeof total !== "number" ||
      typeof profit !== "number" ||
      originalTotal < 0 ||
      total < 0 ||
      profit < 0 ||
      discountAmount < 0 ||
      discountAmount > originalTotal
    ) {
      return res
        .status(400)
        .json({ success: false, message: "البيانات المالية غير صالحة" });
    }

    // Stock rollback (add back old quantities if stock was decreased)
    const oldShouldDecrease =
      order.status !== "غير مؤكدة" && order.status !== "ارجاع";
    const newShouldDecrease = status !== "غير مؤكدة" && status !== "ارجاع";

    if (oldShouldDecrease) {
      // Add back old stock (rollback)
      for (const item of order.items) {
        await Product.updateOne(
          { _id: item.product, "colors.sizes.barcode": item.barcode },
          { $inc: { "colors.$[].sizes.$[s].quantity": item.quantity } },
          { arrayFilters: [{ "s.barcode": item.barcode }] },
        );
      }
    }

    // Validate new items stock
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product)
        return res
          .status(404)
          .json({ success: false, message: "منتج غير موجود" });

      const foundSize = product.colors
        .flatMap((c) => c.sizes)
        .find((s) => s.barcode === item.barcode);

      if (!foundSize)
        return res
          .status(400)
          .json({ success: false, message: "باركود غير موجود" });

      // Check available stock (considering current unconfirmed orders except this one)
      const reserved = await Order.aggregate([
        {
          $match: {
            _id: { $ne: order._id }, // exclude current order
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

      const reservedQty = reserved[0]?.reservedQty || 0;
      const available = foundSize.quantity - reservedQty;

      if (item.quantity > available) {
        return res.status(400).json({
          success: false,
          message: `الكمية غير متاحة لـ ${product.name} - متبقي ${available}`,
        });
      }
    }

    // Apply new stock decrease if needed
    if (newShouldDecrease) {
      for (const item of items) {
        await Product.updateOne(
          { _id: item.product, "colors.sizes.barcode": item.barcode },
          { $inc: { "colors.$[].sizes.$[s].quantity": -item.quantity } },
          { arrayFilters: [{ "s.barcode": item.barcode }] },
        );
      }
    }

    // Update order
    const updatedOrder = await Order.findByIdAndUpdate(
      id,
      {
        fullName,
        phone,
        state,
        deliveryType,
        address: deliveryType === "منزل" ? address : "",
        items,
        total,
        originalTotal,
        profit,
        discountAmount,
        notes,
        isPaid,
        source,
        status,
        accountName,
        handedToShipping,
      },
      { new: true, runValidators: true },
    );

    res.json({
      success: true,
      data: updatedOrder,
      message: "تم تحديث الطلبية بنجاح",
    });
  } catch (err) {
    console.error("Error updating order:", err);
    res.status(500).json({
      success: false,
      message: err.message || "حدث خطأ أثناء تحديث الطلبية",
    });
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "الطلبية غير موجودة" });

    // If order had already deducted stock, roll it back before deleting
    const hadDeductedStock =
      order.status !== "غير مؤكدة" && order.status !== "ارجاع";
    if (hadDeductedStock && order.items && order.items.length > 0) {
      for (const item of order.items) {
        await updateProductStock(
          item.product,
          item.barcode,
          item.quantity,
          false
        );
      }
    }

    await order.deleteOne();

    res.json({
      success: true,
      message: "تم حذف الطلبية وإرجاع المخزون بنجاح",
    });
  } catch (err) {
    console.error("Error deleting order:", err);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء حذف الطلبية" });
  }
};

exports.getOrders = async (req, res) => {
  try {
    const { status, date, state, isPaid, search, orderNumber, page, limit } =
      req.query;

    const query = {};

    // status filter
    if (status && status !== "") {
      query.status = status;
    }

    // state (wilaya) filter
    if (state && state !== "") {
      query.state = state;
    }

    // isPaid filter
    if (isPaid !== undefined && isPaid !== "") {
      query.isPaid = isPaid === "true" || isPaid === true;
    }

    // orderNumber filter
    if (orderNumber) {
      const num = parseInt(orderNumber, 10);
      if (!isNaN(num)) {
        query.orderNumber = num;
      }
    }

    // single day filter
    if (date) {
      const startDate = new Date(date);
      if (!isNaN(startDate.getTime())) {
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt = { $gte: startDate, $lte: endDate };
      }
    }

    // search filter
    if (search && search.trim()) {
      const cleanSearch = search.trim();
      const escaped = cleanSearch.replace(/[-[\]{}()*+?.,\\^$|#]/g, "\\$&");
      const numSearch = parseInt(cleanSearch.replace(/^#/, ""), 10);

      // Find matching products by name
      const matchingProducts = await Product.find({
        name: { $regex: escaped, $options: "i" },
      })
        .select("_id")
        .lean();
      const productIds = matchingProducts.map((p) => p._id);

      const orConditions = [
        { fullName: { $regex: escaped, $options: "i" } },
        { phone: { $regex: escaped, $options: "i" } },
        { state: { $regex: escaped, $options: "i" } },
        { source: { $regex: escaped, $options: "i" } },
        { "items.barcode": { $regex: escaped, $options: "i" } },
        { "items.product": { $in: productIds } },
      ];

      if (!isNaN(numSearch)) {
        orConditions.push({ orderNumber: numSearch });
      }

      query.$or = orConditions;
    }

    // Build base query
    let ordersQuery = Order.find(query)
      .sort({ createdAt: -1 })
      .populate("createdBy", "name")
      .populate(
        "items.product",
        req.user && req.user.role === "worker"
          ? "name"
          : "name originalPrice",
      )
      .lean();

    let pagination = null;
    let total = await Order.countDocuments(query);

    // ───────────────────────────────────────────────
    // PAGINATION only when BOTH page AND limit exist
    // ───────────────────────────────────────────────
    if (page && limit) {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;

      const skip = (pageNum - 1) * limitNum;
      ordersQuery = ordersQuery.skip(skip).limit(limitNum);

      pagination = {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum) || 1,
        hasNext: skip + limitNum < total,
        hasPrev: pageNum > 1,
      };
    } else {
      pagination = {
        total,
        all: true,
        pages: 1,
        page: 1,
        message: "جميع الطلبيات (بدون تقسيم صفحات)",
      };
    }

    const orders = await ordersQuery;

    res.json({
      success: true,
      data: orders,
      pagination,
      total,
      pages: pagination ? pagination.pages : 1,
      currentPage: pagination ? pagination.page : 1,
    });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب الطلبيات",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id)
      .populate("createdBy", "name")
      .populate(
        "items.product",
        req.user.role === "worker" ? "name" : "name originalPrice",
      );

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "الطلبية غير موجودة" });
    }

    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Error fetching order:", err);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء جلب الطلبية" });
  }
};

exports.exchangeOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { exchanges } = req.body;
    const userRole = req.user.role;

    if (!exchanges || !Array.isArray(exchanges) || exchanges.length === 0) {
      return res.status(400).json({
        success: false,
        message: "لا توجد عناصر للاستبدال",
      });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "الطلبية غير موجودة",
      });
    }

    if (order.status !== "تم الاستلام") {
      return res.status(400).json({
        success: false,
        message: "يمكن استبدال الطلبيات المستلمة فقط",
      });
    }

    // Save pre-exchange values if this is the first exchange
    if (!order.isExchanged) {
      order.totalBeforeExchange = order.total;
      order.profitBeforeExchange = order.profit;
    }

    const stockUpdates = [];
    const exchangeRecords = [];
    const now = new Date();
    const cashier = req.user._id;

    for (const exchange of exchanges) {
      const { originalBarcode, newBarcode, newQuantity } = exchange;

      if (newQuantity < 1) {
        return res.status(400).json({
          success: false,
          message: `الكمية يجب أن تكون أكبر من الصفر للباركود: ${newBarcode}`,
        });
      }

      const originalItem = order.items.find(
        (item) => item.barcode === originalBarcode,
      );
      if (!originalItem) {
        return res.status(404).json({
          success: false,
          message: `المنتج الأصلي غير موجود في الطلبية: ${originalBarcode}`,
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
        size: newSize.size,
        color: newColor.color,
      };

      const originalAmount = originalItem.quantity * originalItem.price;
      const newAmount = newQuantity * newProduct.price;
      const priceDifference = newAmount - originalAmount;

      const originalCost =
        originalItem.quantity * (originalItem.originalPrice || 0);
      const newCost = newQuantity * (newProduct.originalPrice || 0);
      const profitDifference =
        newAmount - newCost - (originalAmount - originalCost);

      // Return original to stock
      stockUpdates.push(
        updateProductStock(
          originalItem.product,
          originalItem.barcode,
          originalItem.quantity,
          false,
        ),
      );
      // Deduct new from stock
      stockUpdates.push(
        updateProductStock(newProduct._id, newBarcode, -newQuantity, false),
      );

      // Save exchange record
      exchangeRecords.push({
        originalItem: { ...originalItem.toObject() },
        exchangedWith: exchangedItem,
        exchangedAt: now,
        priceDifference,
        profitDifference,
      });

      // Update order items list
      order.items = order.items.map((item) =>
        item.barcode === originalBarcode ? exchangedItem : item,
      );
    }

    await Promise.all(stockUpdates);

    // Recalculate totals
    let newTotal = 0;
    let newOriginalTotal = 0;

    for (const item of order.items) {
      const prod = await Product.findById(item.product);
      newTotal += item.quantity * item.price;
      newOriginalTotal += item.quantity * (prod.originalPrice || 0);
    }

    order.total = newTotal;
    order.originalTotal = newOriginalTotal;
    order.profit = newTotal - newOriginalTotal;

    order.isExchanged = true;
    order.exchangedAt = now;
    order.exchangeCashier = cashier;
    order.exchanges.push(...exchangeRecords);

    await order.save();

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Error exchanging order products:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء عملية الاستبدال",
    });
  }
};
