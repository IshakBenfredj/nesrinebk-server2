const Sale = require("../models/Sale");
const Order = require("../models/Order");
const Expense = require("../models/Expense");
const Product = require("../models/Product");
const RevenueChanges = require("../models/RevenuesChanges");
const BonusAdjustment = require("../models/BonusAdjustment");
const BonusPeriod = require("../models/BonusPeriod");

function makeDateMatcher(type, singleDate, from, to) {
  if (type === "day") {
    return (d) => d.toISOString().slice(0, 10) === singleDate;
  }
  // range
  const fromMs = new Date(from).setHours(0, 0, 0, 0);
  const toMs = new Date(to).setHours(23, 59, 59, 999);
  return (d) => d >= fromMs && d <= toMs;
}

function computeSalesForPeriod(sales, dateMatches) {
  let totalSales = 0;
  let profitSales = 0;

  sales.forEach((sale) => {
    const createdAt = new Date(sale.createdAt);
    const finalPaymentAt = sale.finalPaymentAt
      ? new Date(sale.finalPaymentAt)
      : null;
    const exchangedAt = sale.exchangedAt ? new Date(sale.exchangedAt) : null;

    const discount = sale.discountAmount || 0;
    const prepaid = sale.prepaidAmount || 0;
    const isPrePaid = sale.isPrePaid;
    const isExchanged = sale.isExchanged;
    const isCompleted = !!finalPaymentAt;

    // فارق السعر بعد الاستبدال = total الجديد - totalBeforeExchange
    const priceDiff = isExchanged
      ? sale.total - (sale.totalBeforeExchange || 0)
      : 0;

    // فارق الربح بعد الاستبدال
    const profitDiff = isExchanged
      ? sale.profit - (sale.profitBeforeExchange || 0)
      : 0;

    /* ══════════════════════════════════
       A. بيع عادي (بدون دفع مسبق)
       ══════════════════════════════════ */
    if (!isPrePaid) {
      if (!isExchanged) {
        // بيع عادي بسيط
        if (dateMatches(createdAt)) {
          totalSales += sale.total - discount;
          profitSales += sale.profit - discount;
        }
      } else {
        // بيع عادي + استبدال
        // القيمة الأصلية يوم البيع
        if (dateMatches(createdAt)) {
          totalSales += sale.totalBeforeExchange || 0;
          profitSales += sale.profitBeforeExchange || 0;
        }
        // فارق الاستبدال يوم exchangedAt
        if (exchangedAt && dateMatches(exchangedAt)) {
          totalSales += priceDiff;
          profitSales += profitDiff;
        }
      }
    }

    /* ══════════════════════════════════
       B & C. دفع مسبق
       ══════════════════════════════════ */
    if (isPrePaid) {
      // B. المبلغ المسبق دائماً يوم الإنشاء
      if (dateMatches(createdAt)) {
        totalSales += prepaid;
      }

      if (!isExchanged) {
        // C. دفع مسبق بدون استبدال — إكمال الدفع
        if (isCompleted && dateMatches(finalPaymentAt)) {
          const remaining = sale.total - prepaid;
          if (remaining > 0) totalSales += remaining;
          totalSales -= discount; // التخفيض مرة واحدة عند الاكتمال
          profitSales += sale.profit; // الربح الكامل عند الاكتمال
        }
      } else {
        // دفع مسبق + استبدال
        if (!isCompleted) {
          // الدفع لم يكتمل بعد — أضف فارق الاستبدال يوم exchangedAt
          // مع الحماية: إذا total الجديد < prepaid والفارق سالب → لا خصم
          if (exchangedAt && dateMatches(exchangedAt)) {
            const safeDiff =
              priceDiff < 0 && sale.total < prepaid ? 0 : priceDiff;
            totalSales += safeDiff;
            profitSales += profitDiff;
          }
        } else {
          // الدفع اكتمل بعد الاستبدال
          // فارق الاستبدال يوم exchangedAt
          if (exchangedAt && dateMatches(exchangedAt)) {
            totalSales += priceDiff;
            profitSales += profitDiff;
          }
          // إكمال الدفع يوم finalPaymentAt
          if (dateMatches(finalPaymentAt)) {
            const remaining = sale.total - prepaid;
            if (remaining > 0) totalSales += remaining;
            // لا discount في حالة الاستبدال
            profitSales += sale.profit - (sale.profitBeforeExchange || 0);
          }
        }
      }
    }
  });

  return { totalSales, profitSales };
}

function computeSalesAllTime(sales) {
  let allTimeSales = 0;
  let allTimeSalesProfit = 0;

  sales.forEach((sale) => {
    const discount = sale.discountAmount || 0;
    const prepaid = sale.prepaidAmount || 0;
    const isPrePaid = sale.isPrePaid;
    const completed = !!sale.finalPaymentAt;

    if (!isPrePaid) {
      allTimeSales += sale.total - discount;
      allTimeSalesProfit += sale.profit - discount;
      return;
    }

    // PrePaid
    if (!completed) {
      allTimeSales += prepaid; // only prepaid has been received
      // profit deferred
    } else {
      allTimeSales += sale.total - discount; // full amount
      allTimeSalesProfit += sale.profit;
    }

    // Exchanges for pending prepaid (guard)
    if (sale.isExchanged && sale.exchanges && !completed) {
      sale.exchanges.forEach((ex) => {
        if (ex.priceDifference < 0 && sale.total < prepaid) return;
        allTimeSales += ex.priceDifference;
      });
    }
  });

  return { allTimeSales, allTimeSalesProfit };
}

async function computeOrdersForPeriod(dateMatches, filterQuery) {
  const orders = await Order.find(filterQuery)
    .select(
      "statusUpdatedAt exchangedAt isExchanged discountAmount total profit totalBeforeExchange profitBeforeExchange exchanges"
    )
    .lean();
  let totalOrders = 0;
  let profitOrders = 0;

  orders.forEach((order) => {
    const updatedAt = new Date(order.statusUpdatedAt);
    const exchangedAt = order.exchangedAt ? new Date(order.exchangedAt) : null;
    const isExchanged = order.isExchanged;
    const discount = order.discountAmount || 0;

    if (!isExchanged) {
      if (dateMatches(updatedAt)) {
        totalOrders += order.total - discount;
        profitOrders += order.profit - discount;
      }
    } else {
      // Original values on delivery day (statusUpdatedAt)
      if (dateMatches(updatedAt)) {
        totalOrders += (order.totalBeforeExchange || order.total) - discount;
        profitOrders += (order.profitBeforeExchange || order.profit) - discount;
      }
      // Individual exchange differences on their respective days
      if (order.exchanges && order.exchanges.length > 0) {
        order.exchanges.forEach((ex) => {
          const exAt = new Date(ex.exchangedAt);
          if (dateMatches(exAt)) {
            totalOrders += ex.priceDifference;
            profitOrders += ex.profitDifference || 0;
          }
        });
      } else if (exchangedAt && dateMatches(exchangedAt)) {
        // Fallback for orders without exchanges array
        const priceDiff =
          order.total - (order.totalBeforeExchange || order.total);
        const profitDiff =
          order.profit - (order.profitBeforeExchange || order.profit);
        totalOrders += priceDiff;
        profitOrders += profitDiff;
      }
    }
  });

  return { totalOrders, profitOrders };
}

function computeExpenses(expenses, type, singleDate, from, to) {
  let totalExpenses = 0;
  let adminExpenses = 0;
  let nonFixedExpenses = 0;

  expenses.forEach((exp) => {
    const createdAt = new Date(exp.createdAt);
    const createdDay = createdAt.getDate();
    const createdStart = new Date(createdAt);
    createdStart.setHours(0, 0, 0, 0);

    /* ══════════════════════════════════════════════════════════════
       FIXED DAILY
       يُحسب في كل يوم >= يوم الإنشاء
       NOTE: يأتي قبل فحص admin لأن admin+isFixed يجب أن يسلك
             مسار fixed وليس مسار admin العادي
       ══════════════════════════════════════════════════════════════ */
    if (exp.isFixed && exp.recurrence === "daily") {
      if (type === "day") {
        const selectedDay = new Date(singleDate);
        selectedDay.setHours(0, 0, 0, 0);
        if (selectedDay >= createdStart) {
          totalExpenses += exp.amount;
        }
      } else {
        const rangeStart = new Date(from);
        rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(to);
        rangeEnd.setHours(23, 59, 59, 999);
        const effectiveStart =
          createdStart > rangeStart ? createdStart : rangeStart;
        if (effectiveStart > rangeEnd) return;
        const msPerDay = 86400000;
        const days = Math.round((rangeEnd - effectiveStart) / msPerDay) + 1;
        totalExpenses += exp.amount * days;
      }
      return; // ← handled, skip other branches
    }

    /* ══════════════════════════════════════════════════════════════
       FIXED MONTHLY
       يُحسب في نفس رقم اليوم من كل شهر >= شهر الإنشاء
       ══════════════════════════════════════════════════════════════ */
    if (exp.isFixed && exp.recurrence === "monthly") {
      if (type === "day") {
        const selectedDate = new Date(singleDate);
        selectedDate.setHours(12, 0, 0, 0);
        if (
          selectedDate.getDate() === createdDay &&
          selectedDate >= createdStart
        ) {
          totalExpenses += exp.amount;
        }
      } else {
        const rangeStart = new Date(from);
        rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(to);
        rangeEnd.setHours(23, 59, 59, 999);
        const effectiveStart =
          createdStart > rangeStart ? createdStart : rangeStart;
        if (effectiveStart > rangeEnd) return;

        let count = 0;
        const cursor = new Date(effectiveStart);
        cursor.setDate(1); // أول الشهر الفعّال

        while (cursor <= rangeEnd) {
          const dueDate = new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            createdDay,
          );
          dueDate.setHours(12, 0, 0, 0);
          if (
            dueDate >= effectiveStart &&
            dueDate >= rangeStart &&
            dueDate <= rangeEnd
          ) {
            count++;
          }
          cursor.setMonth(cursor.getMonth() + 1);
        }
        totalExpenses += exp.amount * count;
      }
      return; // ← handled
    }

    /* ══════════════════════════════════════════════════════════════
       ADMIN (non-fixed) — counted once on createdAt
       ══════════════════════════════════════════════════════════════ */
    if (exp.admin) {
      const inPeriod = isInPeriod(createdAt, type, singleDate, from, to);
      if (inPeriod) {
        adminExpenses += exp.amount;
        totalExpenses += exp.amount;
      }
      return;
    }

    /* ══════════════════════════════════════════════════════════════
       NON-FIXED, NON-ADMIN — counted once on createdAt
       ══════════════════════════════════════════════════════════════ */
    const inPeriod = isInPeriod(createdAt, type, singleDate, from, to);
    if (inPeriod) {
      nonFixedExpenses += exp.amount;
      totalExpenses += exp.amount;
    }
  });

  return { totalExpenses, adminExpenses, nonFixedExpenses };
}

function isInPeriod(d, type, singleDate, from, to) {
  if (type === "day") {
    return d.toISOString().slice(0, 10) === singleDate;
  }
  const fromMs = new Date(from).setHours(0, 0, 0, 0);
  const toMs = new Date(to).setHours(23, 59, 59, 999);
  return d >= fromMs && d <= toMs;
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN CONTROLLER
   ═══════════════════════════════════════════════════════════════════ */
exports.getFullSummary = async (req, res) => {
  try {
    const { type = "day", date, from, to } = req.query;

    /* ── Validate inputs ── */
    if (type === "day" && !date) {
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد التاريخ" });
    }
    if (type === "range" && (!from || !to)) {
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد من وإلى" });
    }

    const singleDate = type === "day" ? date : null;
    const dateMatches = makeDateMatcher(type, singleDate, from, to);

    /* ── 1. Sales ── */
    const allSales = await Sale.find()
      .select(
        "createdAt finalPaymentAt exchangedAt discountAmount prepaidAmount isPrePaid isExchanged total totalBeforeExchange profit profitBeforeExchange exchanges"
      )
      .lean();
    const { totalSales, profitSales } = computeSalesForPeriod(
      allSales,
      dateMatches,
    );
    const { allTimeSales, allTimeSalesProfit } = computeSalesAllTime(allSales);

    /* ── 2. Orders (period) ── */
    // Fetch all "تم الاستلام" orders then filter by statusUpdatedAt in JS
    // (avoids complex $expr for range queries)
    const { totalOrders, profitOrders } = await computeOrdersForPeriod(
      dateMatches,
      { status: "تم الاستلام" },
    );

    /* ── 3. Orders (all-time) ── */
    const allOrders = await Order.find({ status: "تم الاستلام" })
      .select("total profit discountAmount")
      .lean();
    let allTimeOrders = 0;
    let allTimeOrdersProfit = 0;
    allOrders.forEach((o) => {
      allTimeOrders += o.total - (o.discountAmount || 0);
      allTimeOrdersProfit += o.profit - (o.discountAmount || 0);
    });

    /* ── 4. Expenses ── */
    const allExpenses = await Expense.find()
      .select("createdAt isFixed recurrence amount admin")
      .lean();
    const { totalExpenses, adminExpenses } = computeExpenses(
      allExpenses,
      type,
      singleDate,
      from,
      to,
    );

    /* ── 5. All-time non-fixed, non-admin expenses (for totalRevenue) ── */
    const allNonFixedExpenses = await Expense.find({
      isFixed: false,
      admin: false,
    })
      .select("amount")
      .lean();
    const allTimeNonFixed = allNonFixedExpenses.reduce(
      (s, e) => s + e.amount,
      0,
    );

    /* ── 6. Revenue changes (all-time, for totalRevenue) ── */
    const allRevenueChangesDocs = await RevenueChanges.find()
      .select("amount")
      .lean();
    const allTimeRevenueChanges = allRevenueChangesDocs.reduce(
      (s, r) => s + r.amount,
      0,
    );

    /* ── 7. Capital ── */
    const products = await Product.find()
      .select("originalPrice price colors.sizes.quantity")
      .lean();
    let totalOCapital = 0;
    let totalCapital = 0;
    products.forEach((product) => {
      product.colors.forEach((color) => {
        color.sizes.forEach((size) => {
          totalOCapital += size.quantity * product.originalPrice;
          totalCapital += size.quantity * product.price;
        });
      });
    });

    // 1. All adjustments (global sum)
    const allAdjustments = await BonusAdjustment.find({
      type: "cash_deduction",
    })
      .select("amount createdAt")
      .lean();
    const allTimeAdjustmentsTotal = allAdjustments.reduce(
      (sum, adj) => sum + adj.amount,
      0,
    );

    // 2. Filtered adjustments (by selected day or range)
    let filteredAdjustmentsTotal = 0;
    if (allAdjustments.length > 0) {
      const adjDateMatches = makeDateMatcher(type, singleDate, from, to);
      filteredAdjustmentsTotal = allAdjustments.reduce((sum, adj) => {
        const adjDate = new Date(adj.createdAt);
        return adjDateMatches(adjDate) ? sum + adj.amount : sum;
      }, 0);
    }

    // 3. All periods bonus (global sum)
    const allPeriods = await BonusPeriod.find({ status: "paid" })
      .select("finalBonus bonusAmount startDate paidAt")
      .lean();
    const allTimePeriodsBonus = allPeriods.reduce((sum, period) => {
      return sum + (period.finalBonus || period.bonusAmount || 0);
    }, 0);

    // 4. Filtered periods bonus (by paidAt || startDate)
    let filteredPeriodsBonus = 0;
    if (allPeriods.length > 0) {
      const periodDateMatches = makeDateMatcher(type, singleDate, from, to);
      filteredPeriodsBonus = allPeriods.reduce((sum, period) => {
        const periodDate = new Date(period.paidAt || period.startDate);
        return periodDateMatches(periodDate)
          ? sum + (period.finalBonus || 0)
          : sum;
      }, 0);
    }

    /* ── 8. Final totals ── */

    // TURNOVER: sum of sales revenue + orders revenue in the selected period
    const turnover = totalSales + totalOrders;

    // NET PROFIT: period profits (sales + orders) minus ALL period expenses
    const netProfit =
      profitSales +
      profitOrders -
      totalExpenses +
      filteredAdjustmentsTotal -
      filteredPeriodsBonus;

    const totalRevenue =
      allTimeSales -
      allTimeNonFixed +
      allTimeRevenueChanges +
      allTimeAdjustmentsTotal -
      allTimePeriodsBonus;

    return res.json({
      success: true,
      date: type === "day" ? date : undefined,
      from: type === "range" ? from : undefined,
      to: type === "range" ? to : undefined,
      type,
      sales: {
        totalSales,
        profitSales,
        allTimeSales,
        allTimeSalesProfit,
      },
      orders: {
        totalOrders,
        profitOrders,
        allTimeOrders,
        allTimeOrdersProfit,
      },
      expenses: {
        dateFiltered: totalExpenses,
        adminExpenses,
        allTimeNonFixed,
      },
      revenueChanges: allTimeRevenueChanges,
      capital: {
        totalCapital,
        totalOCapital,
      },
      totals: {
        turnover,
        totalRevenue,
        netProfit,
      },
    });
  } catch (err) {
    console.error("❌ Error in getFullSummary:", err);
    return res
      .status(500)
      .json({ success: false, message: "خطأ في حساب الملخص" });
  }
};

function computeSalesRevenue(sales, filter, opts = {}) {
  const { upTo } = opts;

  // دالة مساعدة: هل التاريخ d يقع ضمن الحد المسموح؟
  const withinBound = (d) => !upTo || d <= upTo;

  let revenue = 0;

  sales.forEach((sale) => {
    // تطبيق الفلتر الخارجي إن وُجد
    if (filter && !filter(sale)) return;

    const discount = sale.discountAmount || 0;
    const prepaid = sale.prepaidAmount || 0;
    const isPrePaid = sale.isPrePaid;
    const finalAt = sale.finalPaymentAt ? new Date(sale.finalPaymentAt) : null;
    const createdAt = new Date(sale.createdAt);

    /* ── A. بيع عادي ── */
    if (!isPrePaid) {
      if (withinBound(createdAt)) {
        revenue += sale.total - discount;
      }
      return;
    }

    /* ── B / C. دفع مسبق ── */
    // B: المبلغ المسبق دائماً يُحسب يوم الإنشاء
    if (withinBound(createdAt)) {
      revenue += prepaid;
    }

    // C: الإكمال
    if (finalAt && withinBound(finalAt)) {
      const remaining = sale.total - prepaid;
      if (remaining > 0) revenue += remaining;
      revenue -= discount; // التخفيض مرة واحدة عند الاكتمال
    }

    /* ── D. استبدال قبل الاكتمال فقط ── */
    // إذا اكتمل الدفع: priceDifference مدمج في sale.total → لا نضيفه مجدداً
    if (sale.isExchanged && sale.exchanges?.length > 0 && !finalAt) {
      sale.exchanges.forEach((ex) => {
        const exAt = new Date(ex.exchangedAt);
        if (!withinBound(exAt)) return;

        let diff = ex.priceDifference;

        // حماية: total الجديد أقل من المسبق + الفارق سالب → لا خصم
        if (diff < 0 && sale.total < prepaid) {
          diff = 0;
        }

        revenue += diff;
      });
    }
  });

  return revenue;
}

exports.getTotalRevenue = async (req, res) => {
  try {
    const allSales = await Sale.find()
      .select(
        "discountAmount prepaidAmount isPrePaid finalPaymentAt createdAt isExchanged exchanges total"
      )
      .lean();

    // كل مبيعات المتجر بدون فلتر تاريخ
    const salesRevenue = computeSalesRevenue(allSales);

    // المصاريف غير الثابتة وغير الإدارية فقط
    const nonFixedExpenses = await Expense.find({
      isFixed: false,
      admin: false,
    })
      .select("amount")
      .lean();
    const totalNonFixed = nonFixedExpenses.reduce((s, e) => s + e.amount, 0);

    const allAdjustments = await BonusAdjustment.find({
      type: "cash_deduction",
    })
      .select("amount")
      .lean();
    const allTimeAdjustmentsTotal = allAdjustments.reduce(
      (sum, adj) => sum + adj.amount,
      0
    );

    // 3. All periods bonus (global sum)
    const allPeriods = await BonusPeriod.find({ status: "paid" })
      .select("finalBonus bonusAmount")
      .lean();
    const allTimePeriodsBonus = allPeriods.reduce((sum, period) => {
      return sum + (period.finalBonus || period.bonusAmount || 0);
    }, 0);

    // تغييرات الخزينة
    const allRC = await RevenueChanges.find().select("amount").lean();
    const totalRC = allRC.reduce((s, r) => s + r.amount, 0);

    const totalRevenue = salesRevenue - totalNonFixed + totalRC + allTimeAdjustmentsTotal - allTimePeriodsBonus;

    return res.json({
      success: true,
      totalRevenue,
      breakdown: {
        salesRevenue,
        nonFixedExpenses: totalNonFixed,
        revenueChanges: totalRC,
      },
    });
  } catch (err) {
    console.error("❌ getTotalRevenue error:", err);
    return res
      .status(500)
      .json({ success: false, message: "خطأ في حساب الإيرادات الكلية" });
  }
};

// exports.getRevenueHistory = async (req, res) => {
//   try {
//     let { date } = req.query;
//     if (!date) date = new Date().toISOString().split("T")[0];

//     const startOfDay = new Date(date);
//     startOfDay.setHours(0, 0, 0, 0);

//     const endOfDay = new Date(date);
//     endOfDay.setHours(23, 59, 59, 999);

//     // نهاية اليوم السابق
//     const prevDayEnd = new Date(startOfDay.getTime() - 1);

//     // ─────────────────────────────────────────
//     //  A. رصيد الماكينة قبل هذا اليوم (revenueBeforeChanges)
//     // ─────────────────────────────────────────
//     const salesBeforeDay = await Sale.find({
//       $or: [
//         { createdAt: { $lte: prevDayEnd } },
//         { finalPaymentAt: { $lte: prevDayEnd } },
//         { "exchanges.exchangedAt": { $lte: prevDayEnd } },
//       ],
//     }).lean();

//     const revenueBefore = (() => {
//       // نستخدم computeSalesRevenue مع upTo = prevDayEnd
//       const sr = computeSalesRevenue(salesBeforeDay, null, {
//         upTo: prevDayEnd,
//       });

//       const expBefore = 0; // سيُحسب أدناه بشكل منفصل للدقة
//       return sr;
//     })();

//     // المصاريف قبل اليوم
//     const expensesBefore = await Expense.find({
//       createdAt: { $lte: prevDayEnd },
//       isFixed: false,
//       admin: false,
//     }).lean();
//     const totalExpBefore = expensesBefore.reduce((s, e) => s + e.amount, 0);

//     // تغييرات الخزينة قبل اليوم
//     const rcBefore = await RevenueChanges.find({
//       createdAt: { $lte: prevDayEnd },
//     }).lean();
//     const totalRCBefore = rcBefore.reduce((s, r) => s + r.amount, 0);

//     const revenueBeforeDay = Math.round(
//       revenueBefore - totalExpBefore + totalRCBefore,
//     );

//     // ─────────────────────────────────────────
//     //  B. الرصيد الكلي حتى نهاية اليوم المحدد
//     // ─────────────────────────────────────────
//     const salesUpToDate = await Sale.find({
//       $or: [
//         { createdAt: { $lte: endOfDay } },
//         { finalPaymentAt: { $lte: endOfDay } },
//         { "exchanges.exchangedAt": { $lte: endOfDay } },
//       ],
//     }).lean();

//     const salesRevUpToDate = computeSalesRevenue(salesUpToDate, null, {
//       upTo: endOfDay,
//     });

//     const expUpToDate = await Expense.find({
//       createdAt: { $lte: endOfDay },
//       isFixed: false,
//       admin: false,
//     }).lean();
//     const totalExpUpToDate = expUpToDate.reduce((s, e) => s + e.amount, 0);

//     const rcUpToDate = await RevenueChanges.find({
//       createdAt: { $lte: endOfDay },
//     }).lean();
//     const totalRCUpToDate = rcUpToDate.reduce((s, r) => s + r.amount, 0);

//     const totalRevenueUpToDate = Math.round(
//       salesRevUpToDate - totalExpUpToDate + totalRCUpToDate,
//     );

//     // ─────────────────────────────────────────
//     //  C. الأحداث التي وقعت خلال اليوم المحدد
//     // ─────────────────────────────────────────
//     const daySales = await Sale.find({
//       $or: [
//         { createdAt: { $gte: startOfDay, $lte: endOfDay } },
//         { finalPaymentAt: { $gte: startOfDay, $lte: endOfDay } },
//         { "exchanges.exchangedAt": { $gte: startOfDay, $lte: endOfDay } },
//       ],
//     }).lean();

//     const dayExpenses = await Expense.find({
//       createdAt: { $gte: startOfDay, $lte: endOfDay },
//       isFixed: false,
//       admin: false,
//     }).lean();

//     const dayRC = await RevenueChanges.find({
//       createdAt: { $gte: startOfDay, $lte: endOfDay },
//     }).lean();

//     const changes = [];

//     // ── معالجة المبيعات ──
//     daySales.forEach((sale) => {
//       const discount = sale.discountAmount || 0;
//       const prepaid = sale.prepaidAmount || 0;
//       const isPrePaid = sale.isPrePaid;
//       const finalAt = sale.finalPaymentAt
//         ? new Date(sale.finalPaymentAt)
//         : null;
//       const createdAt = new Date(sale.createdAt);

//       const createdInDay = createdAt >= startOfDay && createdAt <= endOfDay;
//       const completedInDay =
//         finalAt && finalAt >= startOfDay && finalAt <= endOfDay;

//       const exchangesInDay = (sale.exchanges || []).filter((ex) => {
//         const d = new Date(ex.exchangedAt);
//         return d >= startOfDay && d <= endOfDay;
//       });

//       /* ── بيع عادي ── */
//       if (!isPrePaid) {
//         if (createdInDay) {
//           changes.push({
//             type: "sale",
//             description: `بيع عادي — ${sale.barcode}`,
//             amount: sale.total,
//             timestamp: sale.createdAt,
//           });
//         }
//       }

//       /* ── دفع مسبق ── */
//       if (isPrePaid) {
//         // المبلغ المسبق
//         if (createdInDay) {
//           changes.push({
//             type: "prepaid",
//             description: `دفع مسبق — ${sale.barcode}`,
//             amount: prepaid,
//             timestamp: sale.createdAt,
//           });
//         }

//         // إكمال الدفع
//         if (completedInDay) {
//           const remaining = sale.total - prepaid;

//           if (remaining > 0) {
//             changes.push({
//               type: "final_payment",
//               description: `إكمال الدفع المتبقي — ${sale.barcode}`,
//               amount: remaining,
//               timestamp: sale.finalPaymentAt,
//             });
//           }

//           // التخفيض مرة واحدة عند الاكتمال
//           if (discount > 0) {
//             changes.push({
//               type: "discount",
//               description: `تطبيق التخفيض — ${sale.barcode}`,
//               amount: -discount,
//               timestamp: sale.finalPaymentAt,
//             });
//           }
//         }
//       }

//       /* ── استبدالات اليوم ── */
//       // نُضيف priceDifference فقط إذا لم يكتمل الدفع بعد
//       // (إذا اكتمل: priceDifference مدمج في sale.total المحسوب أعلاه)
//       if (!finalAt) {
//         exchangesInDay.forEach((ex) => {
//           let amount = ex.priceDifference;

//           // حماية: total جديد < prepaid + فارق سالب → لا خصم
//           if (amount < 0 && sale.total < prepaid) {
//             amount = 0;
//           }

//           changes.push({
//             type: "exchange",
//             description: `استبدال — فرق ${ex.priceDifference > 0 ? "+" : ""}${ex.priceDifference} دج — ${sale.barcode}`,
//             amount,
//             timestamp: ex.exchangedAt,
//           });
//         });
//       }
//     });

//     // ── المصاريف ──
//     dayExpenses.forEach((exp) => {
//       changes.push({
//         type: "expense",
//         description: exp.description,
//         amount: -exp.amount,
//         timestamp: exp.createdAt,
//       });
//     });

//     // ── تغييرات الخزينة ──
//     dayRC.forEach((rc) => {
//       changes.push({
//         type: "revenue_change",
//         description: rc.description,
//         amount: rc.amount,
//         timestamp: rc.createdAt,
//       });
//     });

//     // ── ترتيب زمني + رصيد متراكم ──
//     changes.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

//     let running = revenueBeforeDay;
//     const dailyHistory = changes.map((c) => {
//       running += c.amount;
//       return {
//         ...c,
//         runningTotalAfter: Math.round(running),
//         time: new Date(c.timestamp).toLocaleTimeString("ar-DZ", {
//           hour: "2-digit",
//           minute: "2-digit",
//           hour12: false,
//         }),
//       };
//     });

//     return res.json({
//       success: true,
//       selectedDate: date,
//       revenueBeforeChanges: revenueBeforeDay,
//       totalRevenueUpToDate,
//       dailyChangesCount: changes.length,
//       dailyHistory,
//     });
//   } catch (err) {
//     console.error("❌ getRevenueHistory error:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "خطأ في جلب تاريخ الإيرادات" });
//   }
// };

exports.getRevenueHistory = async (req, res) => {
  try {
    let { date } = req.query;
    if (!date) date = new Date().toISOString().split("T")[0];

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // نهاية اليوم السابق
    const prevDayEnd = new Date(startOfDay.getTime() - 1);

    // ─────────────────────────────────────────
    // A. الرصيد قبل بداية هذا اليوم
    // ─────────────────────────────────────────
    const salesBeforeDay = await Sale.find({
      $or: [
        { createdAt: { $lte: prevDayEnd } },
        { finalPaymentAt: { $lte: prevDayEnd } },
        { "exchanges.exchangedAt": { $lte: prevDayEnd } },
      ],
    })
      .select(
        "createdAt finalPaymentAt exchanges isPrePaid prepaidAmount total discountAmount isExchanged"
      )
      .lean();

    const revenueBefore = computeSalesRevenue(salesBeforeDay, null, {
      upTo: prevDayEnd,
    });

    const expensesBefore = await Expense.find({
      createdAt: { $lte: prevDayEnd },
      isFixed: false,
      admin: false,
    })
      .select("amount")
      .lean();
    const totalExpBefore = expensesBefore.reduce((s, e) => s + e.amount, 0);

    const rcBefore = await RevenueChanges.find({
      createdAt: { $lte: prevDayEnd },
    })
      .select("amount")
      .lean();
    const totalRCBefore = rcBefore.reduce((s, r) => s + r.amount, 0);

    // Bonus Adjustments before this day
    const adjustmentsBefore = await BonusAdjustment.find({
      type: "cash_deduction",
      createdAt: { $lte: prevDayEnd },
    })
      .select("amount")
      .lean();
    const totalAdjBefore = adjustmentsBefore.reduce((s, a) => s + a.amount, 0);

    // Paid Bonus Periods before this day
    const paidPeriodsBefore = await BonusPeriod.find({
      status: "paid",
      paidAt: { $lte: prevDayEnd },
    })
      .select("finalBonus bonusAmount")
      .lean();
    const totalPaidBonusBefore = paidPeriodsBefore.reduce(
      (s, p) => s + (p.finalBonus || p.bonusAmount || 0),
      0
    );

    const revenueBeforeDay = Math.round(
      revenueBefore -
        totalExpBefore +
        totalRCBefore +
        totalAdjBefore -
        totalPaidBonusBefore
    );

    // ─────────────────────────────────────────
    // B. الرصيد الكلي حتى نهاية اليوم المحدد
    // ─────────────────────────────────────────
    const salesUpToDate = await Sale.find({
      $or: [
        { createdAt: { $lte: endOfDay } },
        { finalPaymentAt: { $lte: endOfDay } },
        { "exchanges.exchangedAt": { $lte: endOfDay } },
      ],
    })
      .select(
        "createdAt finalPaymentAt exchanges isPrePaid prepaidAmount total discountAmount isExchanged"
      )
      .lean();

    const salesRevUpToDate = computeSalesRevenue(salesUpToDate, null, {
      upTo: endOfDay,
    });

    const expUpToDate = await Expense.find({
      createdAt: { $lte: endOfDay },
      isFixed: false,
      admin: false,
    })
      .select("amount")
      .lean();
    const totalExpUpToDate = expUpToDate.reduce((s, e) => s + e.amount, 0);

    const rcUpToDate = await RevenueChanges.find({
      createdAt: { $lte: endOfDay },
    })
      .select("amount")
      .lean();
    const totalRCUpToDate = rcUpToDate.reduce((s, r) => s + r.amount, 0);

    const adjUpToDate = await BonusAdjustment.find({
      type: "cash_deduction",
      createdAt: { $lte: endOfDay },
    })
      .select("amount")
      .lean();
    const totalAdjUpToDate = adjUpToDate.reduce((s, a) => s + a.amount, 0);

    const paidPeriodsUpToDate = await BonusPeriod.find({
      status: "paid",
      paidAt: { $lte: endOfDay },
    })
      .select("finalBonus bonusAmount")
      .lean();
    const totalPaidBonusUpToDate = paidPeriodsUpToDate.reduce(
      (s, p) => s + (p.finalBonus || 0),
      0
    );

    const totalRevenueUpToDate = Math.round(
      salesRevUpToDate -
        totalExpUpToDate +
        totalRCUpToDate +
        totalAdjUpToDate -
        totalPaidBonusUpToDate
    );

    // ─────────────────────────────────────────
    // C. الأحداث التي حدثت خلال اليوم فقط
    // ─────────────────────────────────────────
    const daySales = await Sale.find({
      $or: [
        { createdAt: { $gte: startOfDay, $lte: endOfDay } },
        { finalPaymentAt: { $gte: startOfDay, $lte: endOfDay } },
        { "exchanges.exchangedAt": { $gte: startOfDay, $lte: endOfDay } },
      ],
    })
      .select(
        "createdAt finalPaymentAt exchanges isPrePaid prepaidAmount total discountAmount isExchanged barcode"
      )
      .lean();

    const dayExpenses = await Expense.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      isFixed: false,
      admin: false,
    })
      .select("description amount createdAt")
      .lean();

    const dayRC = await RevenueChanges.find({
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .select("description amount createdAt")
      .lean();

    // Bonus Adjustments during this day
    const dayAdjustments = await BonusAdjustment.find({
      type: "cash_deduction",
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .select("amount createdAt reason")
      .lean();

    // Bonus Periods paid during this day
    const dayPaidPeriods = await BonusPeriod.find({
      status: "paid",
      paidAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .select("finalBonus bonusAmount paidAt user startDate note")
      .lean();

    const changes = [];

    // ── 1. المبيعات (الكود الأصلي الخاص بك - محافظ عليه) ──
    daySales.forEach((sale) => {
      const discount = sale.discountAmount || 0;
      const prepaid = sale.prepaidAmount || 0;
      const isPrePaid = sale.isPrePaid;
      const finalAt = sale.finalPaymentAt ? new Date(sale.finalPaymentAt) : null;
      const createdAt = new Date(sale.createdAt);

      const createdInDay = createdAt >= startOfDay && createdAt <= endOfDay;
      const completedInDay = finalAt && finalAt >= startOfDay && finalAt <= endOfDay;

      const exchangesInDay = (sale.exchanges || []).filter((ex) => {
        const d = new Date(ex.exchangedAt);
        return d >= startOfDay && d <= endOfDay;
      });

      /* بيع عادي */
      if (!isPrePaid) {
        if (createdInDay) {
          changes.push({
            type: "sale",
            description: `بيع عادي — ${sale.barcode || "غير معروف"}`,
            amount: sale.total - discount,
            timestamp: sale.createdAt,
          });
        }
      }

      /* دفع مسبق */
      if (isPrePaid) {
        if (createdInDay) {
          changes.push({
            type: "prepaid",
            description: `دفع مسبق — ${sale.barcode || "غير معروف"}`,
            amount: prepaid,
            timestamp: sale.createdAt,
          });
        }

        if (completedInDay) {
          const remaining = sale.total - prepaid;
          if (remaining > 0) {
            changes.push({
              type: "final_payment",
              description: `إكمال الدفع — ${sale.barcode || "غير معروف"}`,
              amount: remaining,
              timestamp: sale.finalPaymentAt,
            });
          }

          if (discount > 0) {
            changes.push({
              type: "discount",
              description: `تخفيض — ${sale.barcode || "غير معروف"}`,
              amount: -discount,
              timestamp: sale.finalPaymentAt,
            });
          }
        }
      }

      /* استبدالات */
      if (exchangesInDay.length > 0) {
        exchangesInDay.forEach((ex) => {
          let amount = ex.priceDifference || 0;
          const prepaidAmount = sale.prepaidAmount || 0;

          // حماية ضد الخصم الزائد
          if (amount < 0 && sale.total < prepaidAmount) {
            amount = 0;
          }

          changes.push({
            type: "exchange",
            description: `استبدال — فرق السعر ${amount >= 0 ? "+" : ""}${amount} دج — ${sale.barcode || "غير معروف"}`,
            amount,
            timestamp: ex.exchangedAt,
          });
        });
      }
    });

    // ── 2. المصاريف ──
    dayExpenses.forEach((exp) => {
      changes.push({
        type: "expense",
        description: exp.description || "مصروف غير محدد",
        amount: -exp.amount,
        timestamp: exp.createdAt,
      });
    });

    // ── 3. تغييرات الخزينة ──
    dayRC.forEach((rc) => {
      changes.push({
        type: "revenue_change",
        description: rc.description || "تغيير في الإيرادات",
        amount: rc.amount,
        timestamp: rc.createdAt,
      });
    });

    // ── 4. تعديلات البونص (الجديد) ──
    dayAdjustments.forEach((adj) => {
      const isCashDeduction = adj.type === "cash_deduction";
      const amount = isCashDeduction ? -Math.abs(adj.amount) : adj.amount;

      changes.push({
        type: isCashDeduction ? "cash_deduction" : "bonus_adjustment",
        description: `${isCashDeduction ? "سحب نقدي" : "تعديل بونص"} — ${adj.reason}`,
        amount: amount,
        timestamp: adj.createdAt,
        relatedId: adj._id,
      });
    });

    // ── 5. دفع فترات البونص ──
    dayPaidPeriods.forEach((period) => {
      const bonusAmount = period.finalBonus || period.bonusAmount || 0;
      if (bonusAmount > 0) {
        changes.push({
          type: "bonus_payment",
          description: `دفع بونص — ${period.note ? period.note : "فترة بونص"}`,
          amount: -Math.abs(bonusAmount),           // خروج نقدي من ماكينة الدفع
          timestamp: period.paidAt,
          relatedId: period._id,
        });
      }
    });

    // ── ترتيب حسب الوقت + حساب الرصيد المتراكم ──
    changes.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    let running = revenueBeforeDay;
    const dailyHistory = changes.map((c) => {
      running += c.amount;
      return {
        ...c,
        runningTotalAfter: Math.round(running),
        time: new Date(c.timestamp).toLocaleTimeString("ar-DZ", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      };
    });

    return res.json({
      success: true,
      selectedDate: date,
      revenueBeforeChanges: revenueBeforeDay,
      totalRevenueUpToDate,
      dailyChangesCount: changes.length,
      dailyHistory,

      // ملخص اليوم (اختياري لكن مفيد)
      daySummary: {
        salesNet: daySales.length > 0 ? /* يمكنك حسابه إذا أردت */ 0 : 0,
        expenses: dayExpenses.reduce((s, e) => s - e.amount, 0),
        revenueChanges: dayRC.reduce((s, r) => s + r.amount, 0),
        bonusAdjustments: dayAdjustments.reduce((s, a) => s + a.amount, 0),
        bonusPaid: dayPaidPeriods.reduce((s, p) => s + (p.finalBonus || p.bonusAmount || 0), 0),
      },
    });
  } catch (err) {
    console.error("❌ getRevenueHistory error:", err);
    return res
      .status(500)
      .json({ success: false, message: "خطأ في جلب تاريخ الإيرادات" });
  }
};

exports.getTopProducts = async (req, res) => {
  try {
    const { period, day, month, year } = req.query;

    const yearNum = parseInt(year);
    const monthNum = month ? parseInt(month) : null;
    const dayNum = day ? parseInt(day) : null;

    // Build date match based on period
    const matchDate = (dateField) => {
      const expr = [{ $eq: [{ $year: `$${dateField}` }, yearNum] }];

      if (period === "month" || period === "day") {
        if (!monthNum)
          throw new Error("يجب تحديد الشهر عند اختيار الفترة month أو day");
        expr.push({ $eq: [{ $month: `$${dateField}` }, monthNum] });
      }

      if (period === "day") {
        if (!dayNum) throw new Error("يجب تحديد اليوم عند اختيار الفترة day");
        expr.push({ $eq: [{ $dayOfMonth: `$${dateField}` }, dayNum] });
      }

      return { $expr: { $and: expr } };
    };

    // ===== Helper to get top products =====
    const getTop = (Model, qtyField, totalField) =>
      Model.aggregate([
        { $match: matchDate("createdAt") },
        { $unwind: "$items" },
        {
          $group: {
            _id: {
              product: "$items.product",
              barcode: "$items.barcode",
              color: "$items.color",
              size: "$items.size",
            },
            [totalField]: { $sum: `$items.${qtyField}` },
          },
        },
        { $sort: { [totalField]: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "products",
            localField: "_id.product",
            foreignField: "_id",
            as: "productData",
          },
        },
        { $unwind: "$productData" },
        {
          $project: {
            name: "$productData.name",
            barcode: "$_id.barcode",
            color: "$_id.color",
            size: "$_id.size",
            [totalField]: 1,
          },
        },
      ]);

    const topSales = await getTop(Sale, "quantity", "totalSold");
    const topOrders = await getTop(Order, "quantity", "totalOrdered");

    res.json({ success: true, topSales, topOrders });
  } catch (err) {
    console.error("❌ Error in getTopProducts:", err);
    res.status(500).json({
      success: false,
      message: err.message || "خطأ في جلب أفضل المنتجات",
    });
  }
};

// 📊 Revenue Trend Analysis
exports.getRevenueTrend = async (req, res) => {
  try {
    const { range = "6months" } = req.query;

    let startDate = new Date();
    let groupBy = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };

    switch (range) {
      case "7days":
        startDate.setDate(startDate.getDate() - 7);
        groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
        break;
      case "30days":
        startDate.setDate(startDate.getDate() - 30);
        groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
        break;
      case "3months":
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case "1year":
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default: // 6months
        startDate.setMonth(startDate.getMonth() - 6);
    }

    // Sales trend
    const salesTrend = await Sale.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: groupBy,
          totalSales: { $sum: "$total" },
          totalProfit: { $sum: "$profit" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Orders trend
    const ordersTrend = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          $or: [{ status: "تم الاستلام" }, { isPaid: true }],
          status: { $ne: "ارجاع" },
        },
      },
      {
        $group: {
          _id: groupBy,
          totalOrders: { $sum: "$totalPrice" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Combine data
    const combinedData = [];
    const dateMap = new Map();

    salesTrend.forEach((item) => {
      dateMap.set(item._id, {
        date: item._id,
        sales: item.totalSales,
        salesProfit: item.totalProfit,
        salesCount: item.count,
        orders: 0,
        ordersCount: 0,
      });
    });

    ordersTrend.forEach((item) => {
      if (dateMap.has(item._id)) {
        dateMap.get(item._id).orders = item.totalOrders;
        dateMap.get(item._id).ordersCount = item.count;
      } else {
        dateMap.set(item._id, {
          date: item._id,
          sales: 0,
          salesProfit: 0,
          salesCount: 0,
          orders: item.totalOrders,
          ordersCount: item.count,
        });
      }
    });

    const data = Array.from(dateMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    res.json({ success: true, data });
  } catch (error) {
    console.error("Error in getRevenueTrend:", error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في جلب اتجاه الإيرادات" });
  }
};

// 📦 Product Performance Analysis
exports.getProductPerformance = async (req, res) => {
  try {
    const { range = "6months", limit = 10 } = req.query;

    let startDate = new Date();
    switch (range) {
      case "7days":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30days":
        startDate.setDate(startDate.getDate() - 30);
        break;
      case "3months":
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case "1year":
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default: // 6months
        startDate.setMonth(startDate.getMonth() - 6);
    }

    // Sales performance
    const salesPerformance = await Sale.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          totalSold: { $sum: "$items.quantity" },
          totalRevenue: {
            $sum: { $multiply: ["$items.price", "$items.quantity"] },
          },
          totalProfit: {
            $sum: {
              $multiply: [
                { $subtract: ["$items.price", "$items.originalPrice"] },
                "$items.quantity",
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $project: {
          name: "$product.name",
          totalSold: 1,
          totalRevenue: 1,
          totalProfit: 1,
          currentStock: {
            $sum: {
              $map: {
                input: "$product.colors",
                as: "color",
                in: {
                  $sum: "$$color.sizes.quantity",
                },
              },
            },
          },
        },
      },
      { $sort: { totalSold: -1 } },
      { $limit: parseInt(limit) },
    ]);

    // Orders performance
    const ordersPerformance = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          $or: [{ status: "تم الاستلام" }, { isPaid: true }],
          status: { $ne: "ارجاع" },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          totalOrdered: { $sum: "$items.quantity" },
          orderRevenue: {
            $sum: { $multiply: ["$items.price", "$items.quantity"] },
          },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $project: {
          name: "$product.name",
          totalOrdered: 1,
          orderRevenue: 1,
        },
      },
      { $sort: { totalOrdered: -1 } },
      { $limit: parseInt(limit) },
    ]);

    res.json({
      success: true,
      salesPerformance,
      ordersPerformance,
    });
  } catch (error) {
    console.error("Error in getProductPerformance:", error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في جلب أداء المنتجات" });
  }
};

// 👥 Customer Analysis
exports.getCustomerAnalysis = async (req, res) => {
  try {
    const { range = "6months" } = req.query;

    let startDate = new Date();
    switch (range) {
      case "7days":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30days":
        startDate.setDate(startDate.getDate() - 30);
        break;
      case "3months":
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case "1year":
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default: // 6months
        startDate.setMonth(startDate.getMonth() - 6);
    }

    // Order customer analysis
    const customerData = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          $or: [{ status: "تم الاستلام" }, { isPaid: true }],
          status: { $ne: "ارجاع" },
        },
      },
      {
        $group: {
          _id: { phone: "$phone", name: "$fullName" },
          orderCount: { $sum: 1 },
          totalSpent: { $sum: "$totalPrice" },
          avgOrderValue: { $avg: "$totalPrice" },
          lastOrderDate: { $max: "$createdAt" },
        },
      },
      {
        $addFields: {
          customerSegment: {
            $switch: {
              branches: [
                { case: { $gte: ["$orderCount", 10] }, then: "عملاء مميزون" },
                { case: { $gte: ["$orderCount", 5] }, then: "عملاء منتظمون" },
                { case: { $gte: ["$orderCount", 2] }, then: "عملاء متكررون" },
              ],
              default: "عملاء جدد",
            },
          },
        },
      },
      {
        $group: {
          _id: "$customerSegment",
          count: { $sum: 1 },
          totalRevenue: { $sum: "$totalSpent" },
          avgOrderValue: { $avg: "$avgOrderValue" },
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);

    // Top customers
    const topCustomers = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          $or: [{ status: "تم الاستلام" }, { isPaid: true }],
          status: { $ne: "ارجاع" },
        },
      },
      {
        $group: {
          _id: { phone: "$phone", name: "$fullName" },
          orderCount: { $sum: 1 },
          totalSpent: { $sum: "$totalPrice" },
          lastOrder: { $max: "$createdAt" },
        },
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 },
      {
        $project: {
          customerName: "$_id.name",
          phone: "$_id.phone",
          orderCount: 1,
          totalSpent: 1,
          lastOrder: 1,
        },
      },
    ]);

    res.json({
      success: true,
      customerSegments: customerData,
      topCustomers,
    });
  } catch (error) {
    console.error("Error in getCustomerAnalysis:", error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في جلب تحليل العملاء" });
  }
};

// 📈 Sales Channels Analysis
exports.getSalesChannels = async (req, res) => {
  try {
    const { range = "6months" } = req.query;

    let startDate = new Date();
    switch (range) {
      case "7days":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30days":
        startDate.setDate(startDate.getDate() - 30);
        break;
      case "3months":
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case "1year":
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default: // 6months
        startDate.setMonth(startDate.getMonth() - 6);
    }

    // Sales (in-store)
    const salesData = await Sale.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: "$total" },
          profit: { $sum: "$profit" },
        },
      },
    ]);

    // Orders (online)
    const ordersData = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          $or: [{ status: "تم الاستلام" }, { isPaid: true }],
          status: { $ne: "ارجاع" },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: "$totalPrice" },
        },
      },
    ]);

    const sales = salesData[0] || { count: 0, revenue: 0, profit: 0 };
    const orders = ordersData[0] || { count: 0, revenue: 0 };

    const totalRevenue = sales.revenue + orders.revenue;

    const channelsData = [
      {
        channel: "المتجر الفعلي",
        count: sales.count,
        revenue: sales.revenue,
        percentage:
          totalRevenue > 0
            ? ((sales.revenue / totalRevenue) * 100).toFixed(1)
            : 0,
        profit: sales.profit,
      },
      {
        channel: "الطلبات أونلاين",
        count: orders.count,
        revenue: orders.revenue,
        percentage:
          totalRevenue > 0
            ? ((orders.revenue / totalRevenue) * 100).toFixed(1)
            : 0,
      },
    ];

    res.json({ success: true, data: channelsData, totalRevenue });
  } catch (error) {
    console.error("Error in getSalesChannels:", error);
    res.status(500).json({ success: false, message: "خطأ في جلب قنوات البيع" });
  }
};

exports.getOrdersSourcesData = async (req, res) => {
  try {
    const { range = "30days" } = req.query;

    let startDate = new Date();
    if (range === "1year") {
      startDate.setFullYear(startDate.getFullYear() - 1);
    } else if (range === "3months") {
      startDate.setMonth(startDate.getMonth() - 3);
    } else if (range === "1day") {
      startDate.setDate(startDate.getDate() - 1);
    } else {
      // default 30 days
      startDate.setDate(startDate.getDate() - 30);
    }

    const sources = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: "$source",
          count: { $sum: 1 },
          // Optional: total revenue per source
          // revenue: { $sum: "$total" },
        },
      },
      {
        $project: {
          source: "$_id",
          count: 1,
          // revenue: 1,
          _id: 0,
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json({ success: true, data: sources });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ⚠️ Inventory Alerts
exports.getInventoryAlerts = async (req, res) => {
  try {
    const { lowStockThreshold = 5 } = req.query; // default threshold = 5

    // Low stock: quantity <= 5 AND quantity > 0
    const lowStockProducts = await Product.aggregate([
      { $unwind: "$colors" },
      { $unwind: "$colors.sizes" },
      {
        $match: {
          $and: [
            { "colors.sizes.quantity": { $gt: 0 } }, // not zero
            { "colors.sizes.quantity": { $lte: parseInt(lowStockThreshold) } }, // <= threshold
          ],
        },
      },
      {
        $project: {
          name: 1,
          color: "$colors.color",
          size: "$colors.sizes.size",
          barcode: "$colors.sizes.barcode",
          quantity: "$colors.sizes.quantity",
          price: 1,
          originalPrice: 1,
          status: "low_stock", // fixed status
        },
      },
      { $sort: { quantity: 1 } }, // lowest first
    ]);

    // Out of stock: quantity exactly 0
    const outOfStockProducts = await Product.aggregate([
      { $unwind: "$colors" },
      { $unwind: "$colors.sizes" },
      {
        $match: {
          "colors.sizes.quantity": 0,
        },
      },
      {
        $project: {
          name: 1,
          color: "$colors.color",
          size: "$colors.sizes.size",
          barcode: "$colors.sizes.barcode",
          quantity: "$colors.sizes.quantity",
          price: 1,
          originalPrice: 1,
          status: "out_of_stock",
        },
      },
      { $sort: { name: 1 } }, // alphabetical for out-of-stock
    ]);

    res.json({
      success: true,
      lowStock: lowStockProducts,
      outOfStock: outOfStockProducts,
      summary: {
        lowStockCount: lowStockProducts.length,
        outOfStockCount: outOfStockProducts.length,
        // No critical count anymore
        totalAlerts: lowStockProducts.length + outOfStockProducts.length,
      },
    });
  } catch (error) {
    console.error("Error in getInventoryAlerts:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب تنبيهات المخزون",
    });
  }
};

// ⏰ Hourly Sales Pattern
exports.getHourlySalesPattern = async (req, res) => {
  try {
    const { date } = req.query;
    let targetDate;

    if (date) {
      targetDate = new Date(date);
    } else {
      targetDate = new Date();
    }

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Sales pattern
    const salesPattern = await Sale.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        },
      },
      {
        $group: {
          _id: { $hour: "$createdAt" },
          count: { $sum: 1 },
          revenue: { $sum: "$total" },
          profit: { $sum: "$profit" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Orders pattern
    const ordersPattern = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        },
      },
      {
        $group: {
          _id: { $hour: "$createdAt" },
          count: { $sum: 1 },
          revenue: { $sum: "$totalPrice" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Create hourly data (0-23)
    const hourlyData = [];
    for (let hour = 0; hour < 24; hour++) {
      const salesData = salesPattern.find((s) => s._id === hour) || {
        count: 0,
        revenue: 0,
        profit: 0,
      };
      const ordersData = ordersPattern.find((o) => o._id === hour) || {
        count: 0,
        revenue: 0,
      };

      hourlyData.push({
        hour: `${hour.toString().padStart(2, "0")}:00`,
        salesCount: salesData.count,
        salesRevenue: salesData.revenue,
        salesProfit: salesData.profit,
        ordersCount: ordersData.count,
        ordersRevenue: ordersData.revenue,
        totalRevenue: salesData.revenue + ordersData.revenue,
      });
    }

    res.json({
      success: true,
      data: hourlyData,
      date: targetDate.toISOString().split("T")[0],
    });
  } catch (error) {
    console.error("Error in getHourlySalesPattern:", error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في جلب نمط المبيعات اليومي" });
  }
};

// 💰 Expense Analysis
exports.getExpenseAnalysis = async (req, res) => {
  try {
    const { range = "6months" } = req.query;

    let startDate = new Date();
    switch (range) {
      case "7days":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30days":
        startDate.setDate(startDate.getDate() - 30);
        break;
      case "3months":
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case "1year":
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default: // 6months
        startDate.setMonth(startDate.getMonth() - 6);
    }

    const expenseAnalysis = await Expense.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            category: {
              $cond: {
                if: "$admin",
                then: "مصاريف إدارية",
                else: {
                  $cond: {
                    if: "$isFixed",
                    then: "مصاريف ثابتة",
                    else: "مصاريف متغيرة",
                  },
                },
              },
            },
            month: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          },
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]);

    // Category totals
    const categoryTotals = await Expense.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            $cond: {
              if: "$admin",
              then: "مصاريف إدارية",
              else: {
                $cond: {
                  if: "$isFixed",
                  then: "مصاريف ثابتة",
                  else: "مصاريف متغيرة",
                },
              },
            },
          },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    res.json({
      success: true,
      monthlyExpenses: expenseAnalysis,
      categoryTotals,
    });
  } catch (error) {
    console.error("Error in getExpenseAnalysis:", error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في جلب تحليل المصروفات" });
  }
};
function buildDateRange(type, date, from, to) {
  if (type === "day") {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  // range
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/* ═══════════════════════════════════════════════════════
   GET EXPENSES HISTORY
   Query params:
     type  = "day" | "range"   (default: "day")
     date  = "YYYY-MM-DD"      (required if type=day)
     from  = "YYYY-MM-DD"      (required if type=range)
     to    = "YYYY-MM-DD"      (required if type=range)
   ═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   HELPER: هل يوم معين يُطابق المصروف الثابت الشهري؟
   monthly → يظهر في نفس رقم اليوم من كل شهر
   ═══════════════════════════════════════════════════════ */
function isMonthlyExpenseDueOnDate(expense, date) {
  const createdDay = new Date(expense.createdAt).getDate(); // رقم اليوم عند الإنشاء (مثلاً 26)
  const checkDay = new Date(date).getDate(); // رقم اليوم المراد فحصه
  return createdDay === checkDay;
}

/* ═══════════════════════════════════════════════════════
   HELPER: جلب الأيام الفريدة في نطاق تاريخ
   ═══════════════════════════════════════════════════════ */
function getDaysInRange(from, to) {
  const days = [];
  const current = new Date(from);
  current.setHours(12, 0, 0, 0); // منتصف النهار لتجنب مشاكل DST
  const end = new Date(to);
  end.setHours(12, 0, 0, 0);

  while (current <= end) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

/* ═══════════════════════════════════════════════════════
   GET EXPENSES HISTORY
   type = "day"   → date
   type = "range" → from, to
   ═══════════════════════════════════════════════════════ */
exports.getExpensesHistory = async (req, res) => {
  try {
    const { type = "day", date, from, to } = req.query;

    if (type === "day" && !date) {
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد التاريخ" });
    }
    if (type === "range" && (!from || !to)) {
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد من وإلى" });
    }

    // ── نطاق التاريخ ──
    const startDate = type === "day" ? date : from;
    const endDate = type === "day" ? date : to;

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // ── جلب كل المصاريف ──
    const allExpenses = await Expense.find()
      .populate("user", "name username")
      .sort({ createdAt: 1 })
      .lean();

    const history = [];
    let totalExpenses = 0;
    let adminTotal = 0;
    let operationalTotal = 0;
    let fixedTotal = 0;

    if (type === "day") {
      /* ════════════════════════════════
         وضع يوم محدد
         ════════════════════════════════ */
      allExpenses.forEach((exp) => {
        const createdAt = new Date(exp.createdAt);

        if (!exp.isFixed) {
          // مصروف عادي → يظهر فقط في يوم إنشائه
          const expDate = createdAt.toISOString().slice(0, 10);
          if (expDate !== date) return;

          const entry = buildEntry(exp, exp.amount, createdAt);
          history.push(entry);
          totalExpenses += exp.amount;
          if (exp.admin) adminTotal += exp.amount;
          else operationalTotal += exp.amount;
        } else if (exp.recurrence === "daily") {
          // ثابت يومي → يظهر دائماً في كل يوم
          // نستخدم تاريخ اليوم المحدد كـ timestamp للعرض
          const entry = buildEntry(
            exp,
            exp.amount,
            new Date(date + "T00:00:00"),
            "ثابت يومي",
          );
          history.push(entry);
          totalExpenses += exp.amount;
          fixedTotal += exp.amount;
        } else if (exp.recurrence === "monthly") {
          // ثابت شهري → يظهر فقط إذا كان رقم اليوم مطابقاً ليوم الإنشاء
          if (!isMonthlyExpenseDueOnDate(exp, date)) return;
          const entry = buildEntry(
            exp,
            exp.amount,
            new Date(date + "T00:00:00"),
            "ثابت شهري",
          );
          history.push(entry);
          totalExpenses += exp.amount;
          fixedTotal += exp.amount;
        }
      });
    } else {
      /* ════════════════════════════════
         وضع مجال تاريخ
         ════════════════════════════════ */
      const daysInRange = getDaysInRange(startDate, endDate);

      allExpenses.forEach((exp) => {
        const createdAt = new Date(exp.createdAt);

        if (!exp.isFixed) {
          // مصروف عادي → يظهر فقط في يوم إنشائه إذا كان ضمن النطاق
          if (createdAt < start || createdAt > end) return;

          const entry = buildEntry(exp, exp.amount, createdAt);
          history.push(entry);
          totalExpenses += exp.amount;
          if (exp.admin) adminTotal += exp.amount;
          else operationalTotal += exp.amount;
        } else if (exp.recurrence === "daily") {
          // ثابت يومي → يظهر في كل يوم ضمن النطاق
          daysInRange.forEach((day) => {
            const entry = buildEntry(exp, exp.amount, day, "ثابت يومي");
            history.push(entry);
            totalExpenses += exp.amount;
            fixedTotal += exp.amount;
          });
        } else if (exp.recurrence === "monthly") {
          // ثابت شهري → يظهر في كل يوم ضمن النطاق يُطابق رقم يوم الإنشاء
          const createdDay = createdAt.getDate();
          daysInRange.forEach((day) => {
            if (day.getDate() !== createdDay) return;
            const entry = buildEntry(exp, exp.amount, day, "ثابت شهري");
            history.push(entry);
            totalExpenses += exp.amount;
            fixedTotal += exp.amount;
          });
        }
      });

      // ترتيب زمني بعد الجمع
      history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    return res.json({
      success: true,
      type,
      date: type === "day" ? date : undefined,
      from: type === "range" ? from : undefined,
      to: type === "range" ? to : undefined,
      summary: {
        total: totalExpenses,
        admin: adminTotal,
        operational: operationalTotal,
        fixed: fixedTotal,
        count: history.length,
      },
      history,
    });
  } catch (err) {
    console.error("❌ getExpensesHistory error:", err);
    return res
      .status(500)
      .json({ success: false, message: "خطأ في جلب تاريخ المصاريف" });
  }
};

/* ═══════════════════════════════════════════════════════
   HELPER: بناء كائن العرض لكل مصروف
   ═══════════════════════════════════════════════════════ */
function buildEntry(exp, amount, timestamp, fixedLabel = null) {
  const d = new Date(timestamp);
  return {
    _id: exp._id,
    description: exp.description,
    amount,
    isAdmin: exp.admin,
    isFixed: exp.isFixed,
    recurrence: exp.recurrence || null,
    fixedLabel, // "ثابت يومي" | "ثابت شهري" | null
    category: exp.isFixed
      ? exp.recurrence === "daily"
        ? "fixed_daily"
        : "fixed_monthly"
      : exp.admin
        ? "admin"
        : "operational",
    user: exp.user?.name || exp.user?.username || "—",
    timestamp: d.toISOString(),
    time: d.toLocaleTimeString("ar-DZ", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    date: d.toLocaleDateString("ar-DZ"),
  };
}

/* ═══════════════════════════════════════════════════════
   GET ORDERS HISTORY  (status = "تم الاستلام" only)
   Query params:
     type  = "day" | "range"
     date  = "YYYY-MM-DD"
     from  = "YYYY-MM-DD"
     to    = "YYYY-MM-DD"
   Date field used: statusUpdatedAt
   ═══════════════════════════════════════════════════════ */
exports.getOrdersHistory = async (req, res) => {
  try {
    const { type = "day", date, from, to } = req.query;

    if (type === "day" && !date) {
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد التاريخ" });
    }
    if (type === "range" && (!from || !to)) {
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد من وإلى" });
    }

    const effectiveDate =
      type === "day" ? date : new Date().toISOString().slice(0, 10);
    const { start, end } = buildDateRange(type, effectiveDate, from, to);

    const orders = await Order.find({
      status: "تم الاستلام",
      statusUpdatedAt: { $gte: start, $lte: end },
    })
      .populate("createdBy", "name username")
      .sort({ statusUpdatedAt: 1 })
      .lean();

    // Summary
    let totalRevenue = 0;
    let totalProfit = 0;
    let totalItems = 0;

    // Group by source
    const bySource = {};

    const history = orders.map((order) => {
      const net = order.total - (order.discountAmount || 0);
      const profit = order.profit - (order.discountAmount || 0);

      totalRevenue += net;
      totalProfit += profit;
      totalItems += order.items.reduce((s, i) => s + i.quantity, 0);

      const src = order.source || "أخرى";
      if (!bySource[src]) bySource[src] = { count: 0, revenue: 0 };
      bySource[src].count += 1;
      bySource[src].revenue += net;

      return {
        _id: order._id,
        orderNumber: order.orderNumber,
        fullName: order.fullName,
        phone: order.phone,
        state: order.state,
        deliveryType: order.deliveryType,
        source: order.source,
        total: net,
        profit,
        discount: order.discountAmount || 0,
        itemsCount: order.items.reduce((s, i) => s + i.quantity, 0),
        isPaid: order.isPaid,
        createdBy: order.createdBy?.name || order.createdBy?.username || "—",
        timestamp: order.statusUpdatedAt,
        time: new Date(order.statusUpdatedAt).toLocaleTimeString("ar-DZ", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        date: new Date(order.statusUpdatedAt).toLocaleDateString("ar-DZ"),
      };
    });

    const sourceBreakdown = Object.entries(bySource).map(([source, data]) => ({
      source,
      count: data.count,
      revenue: data.revenue,
    }));

    return res.json({
      success: true,
      type,
      date: type === "day" ? date : undefined,
      from: type === "range" ? from : undefined,
      to: type === "range" ? to : undefined,
      summary: {
        totalRevenue,
        totalProfit,
        totalItems,
        count: orders.length,
        sources: sourceBreakdown,
      },
      history,
    });
  } catch (err) {
    console.error("❌ getOrdersHistory error:", err);
    return res
      .status(500)
      .json({ success: false, message: "خطأ في جلب تاريخ الطلبيات" });
  }
};
function getDaysInRange(from, to) {
  const days = [];
  const cur = new Date(from);
  cur.setHours(12, 0, 0, 0);
  const end = new Date(to);
  end.setHours(12, 0, 0, 0);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/* ═══════════════════════════════════════════════════════════════
   GET PROFIT HISTORY
   Query: type=day|range  date=YYYY-MM-DD  from=  to=
   ═══════════════════════════════════════════════════════════════ */
exports.getProfitHistory = async (req, res) => {
  try {
    const { type = "day", date, from, to } = req.query;

    if (type === "day" && !date)
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد التاريخ" });
    if (type === "range" && (!from || !to))
      return res
        .status(400)
        .json({ success: false, message: "يرجى تحديد من وإلى" });

    /* ── helpers ── */
    const startDate = type === "day" ? date : from;
    const endDate = type === "day" ? date : to;

    const periodStart = new Date(startDate);
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date(endDate);
    periodEnd.setHours(23, 59, 59, 999);

    const inPeriod = (d) => d >= periodStart && d <= periodEnd;

    const days =
      type === "range"
        ? getDaysInRange(startDate, endDate)
        : [new Date(startDate)];

    /* ══════════════════════════════════════════════════════════
       1.  SALES PROFIT  (same logic as computeSalesForPeriod)
       ══════════════════════════════════════════════════════════ */
    const allSales = await Sale.find().lean();
    const saleEntries = []; // for the timeline
    let totalSalesProfit = 0;

    allSales.forEach((sale) => {
      const createdAt = new Date(sale.createdAt);
      const finalPaymentAt = sale.finalPaymentAt
        ? new Date(sale.finalPaymentAt)
        : null;
      const exchangedAt = sale.exchangedAt ? new Date(sale.exchangedAt) : null;

      const discount = sale.discountAmount || 0;
      const prepaid = sale.prepaidAmount || 0;
      const isPrePaid = sale.isPrePaid;
      const isExchanged = sale.isExchanged;
      const isCompleted = !!finalPaymentAt;

      const profitDiff = isExchanged
        ? sale.profit - (sale.profitBeforeExchange || 0)
        : 0;

      /* A. Normal sale, no exchange */
      if (!isPrePaid && !isExchanged) {
        if (inPeriod(createdAt)) {
          const p = sale.profit - discount;
          totalSalesProfit += p;
          saleEntries.push({
            timestamp: createdAt,
            label: `بيع — ${sale.barcode}`,
            profit: p,
            type: "sale",
          });
        }
      }

      /* B. Normal sale + exchange */
      if (!isPrePaid && isExchanged) {
        if (inPeriod(createdAt)) {
          const p = sale.profitBeforeExchange || 0;
          totalSalesProfit += p;
          saleEntries.push({
            timestamp: createdAt,
            label: `بيع — ${sale.barcode}`,
            profit: p,
            type: "sale",
          });
        }
        if (exchangedAt && inPeriod(exchangedAt)) {
          totalSalesProfit += profitDiff;
          saleEntries.push({
            timestamp: exchangedAt,
            label: `استبدال — ${sale.barcode}`,
            profit: profitDiff,
            type: "exchange",
          });
        }
      }

      /* C. PrePaid, no exchange */
      if (isPrePaid && !isExchanged) {
        // profit deferred until completion
        if (isCompleted && finalPaymentAt && inPeriod(finalPaymentAt)) {
          const p = sale.profit;
          totalSalesProfit += p;
          saleEntries.push({
            timestamp: finalPaymentAt,
            label: `إكمال دفع — ${sale.barcode}`,
            profit: p,
            type: "prepaid_complete",
          });
        }
      }

      /* D. PrePaid + exchange, not completed */
      if (isPrePaid && isExchanged && !isCompleted) {
        if (exchangedAt && inPeriod(exchangedAt)) {
          totalSalesProfit += profitDiff;
          saleEntries.push({
            timestamp: exchangedAt,
            label: `استبدال (دفع مسبق) — ${sale.barcode}`,
            profit: profitDiff,
            type: "exchange",
          });
        }
      }

      /* E. PrePaid + exchange, completed */
      if (isPrePaid && isExchanged && isCompleted) {
        if (exchangedAt && inPeriod(exchangedAt)) {
          totalSalesProfit += profitDiff;
          saleEntries.push({
            timestamp: exchangedAt,
            label: `استبدال — ${sale.barcode}`,
            profit: profitDiff,
            type: "exchange",
          });
        }
        if (finalPaymentAt && inPeriod(finalPaymentAt)) {
          const baseProfit = sale.profitBeforeExchange || 0;
          totalSalesProfit += baseProfit;
          saleEntries.push({
            timestamp: finalPaymentAt,
            label: `إكمال دفع — ${sale.barcode}`,
            profit: baseProfit,
            type: "prepaid_complete",
          });
        }
      }
    });

    /* ══════════════════════════════════════════════════════════
       2.  ORDERS PROFIT
       ══════════════════════════════════════════════════════════ */
    const allOrders = await Order.find({ status: "تم الاستلام" }).lean();
    const orderEntries = [];
    let totalOrdersProfit = 0;

    allOrders.forEach((order) => {
      const d = new Date(order.statusUpdatedAt);
      if (!inPeriod(d)) return;
      const p = order.profit - (order.discountAmount || 0);
      totalOrdersProfit += p;
      orderEntries.push({
        timestamp: d,
        label: `طلبية #${order.orderNumber} — ${order.fullName}`,
        profit: p,
        type: "order",
      });
    });

    /* ══════════════════════════════════════════════════════════
       3.  EXPENSES  (deducted from profit)
       ══════════════════════════════════════════════════════════ */
    const allExpenses = await Expense.find().lean();
    const expenseEntries = [];
    let totalExpenses = 0;

    allExpenses.forEach((exp) => {
      const createdAt = new Date(exp.createdAt);
      const createdStart = new Date(createdAt);
      createdStart.setHours(0, 0, 0, 0);
      const createdDay = createdAt.getDate();

      /* admin / non-fixed → count once on createdAt */
      if (!exp.isFixed) {
        if (inPeriod(createdAt)) {
          totalExpenses += exp.amount;
          expenseEntries.push({
            timestamp: createdAt,
            label: exp.description,
            amount: exp.amount,
            category: exp.admin ? "admin" : "operational",
          });
        }
        return;
      }

      /* fixed daily → one entry per day in period, starting from createdAt */
      if (exp.recurrence === "daily") {
        days.forEach((day) => {
          const dayStart = new Date(day);
          dayStart.setHours(0, 0, 0, 0);
          if (dayStart < createdStart) return; // لم يُنشأ بعد
          totalExpenses += exp.amount;
          expenseEntries.push({
            timestamp: new Date(dayStart),
            label: `${exp.description} (يومي)`,
            amount: exp.amount,
            category: "fixed_daily",
          });
        });
        return;
      }

      /* fixed monthly → one entry on the matching day-of-month each month */
      if (exp.recurrence === "monthly") {
        days.forEach((day) => {
          const dayStart = new Date(day);
          dayStart.setHours(0, 0, 0, 0);
          if (dayStart < createdStart) return;
          if (day.getDate() !== createdDay) return;
          totalExpenses += exp.amount;
          expenseEntries.push({
            timestamp: new Date(dayStart),
            label: `${exp.description} (شهري)`,
            amount: exp.amount,
            category: "fixed_monthly",
          });
        });
      }
    });

    /* ══════════════════════════════════════════════════════════
       3.5.  BONUS PAYMENTS (deducted from profit, like expenses)
       ══════════════════════════════════════════════════════════ */
    const allPaidPeriods = await BonusPeriod.find({ status: "paid" }).lean();
    const bonusEntries = [];
    let totalBonusPaid = 0;

    allPaidPeriods.forEach((period) => {
      const paidDate = new Date(period.paidAt || period.startDate);
      if (inPeriod(paidDate)) {
        const bonusAmount = period.finalBonus || period.bonusAmount || 0;
        if (bonusAmount > 0) {
          totalBonusPaid += bonusAmount;
          bonusEntries.push({
            timestamp: paidDate,
            label: `دفع بونص — ${period.note || "مستحقات بونص"}`,
            amount: bonusAmount,
            type: "bonus_payment",
          });
        }
      }
    });

    /* ══════════════════════════════════════════════════════════
       4.  BUILD TIMELINE
       ══════════════════════════════════════════════════════════ */
    const timeline = [];

    saleEntries.forEach((e) => {
      timeline.push({
        timestamp: e.timestamp,
        time: fmtTime(e.timestamp),
        date: fmtDate(e.timestamp),
        type: e.type,
        label: e.label,
        impact: e.profit, // + adds to profit
        expenseAmount: null,
      });
    });

    orderEntries.forEach((e) => {
      timeline.push({
        timestamp: e.timestamp,
        time: fmtTime(e.timestamp),
        date: fmtDate(e.timestamp),
        type: e.type,
        label: e.label,
        impact: e.profit,
        expenseAmount: null,
      });
    });

    expenseEntries.forEach((e) => {
      timeline.push({
        timestamp: e.timestamp,
        time: fmtTime(e.timestamp),
        date: fmtDate(e.timestamp),
        type: "expense",
        category: e.category,
        label: e.label,
        impact: -e.amount, // − deducts from profit
        expenseAmount: e.amount,
      });
    });

    bonusEntries.forEach((e) => {
      timeline.push({
        timestamp: e.timestamp,
        time: fmtTime(e.timestamp),
        date: fmtDate(e.timestamp),
        type: "bonus_payment",
        label: e.label,
        impact: -e.amount, // − deducts from profit
        expenseAmount: e.amount,
      });
    });

    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    /* running profit */
    let running = 0;
    timeline.forEach((entry) => {
      running += entry.impact;
      entry.runningProfit = Math.round(running);
    });

    const netProfit = totalSalesProfit + totalOrdersProfit - totalExpenses - totalBonusPaid;

    /* ── group by date for chart ── */
    const byDate = {};
    timeline.forEach((e) => {
      const d = e.date;
      if (!byDate[d])
        byDate[d] = {
          date: d,
          salesProfit: 0,
          ordersProfit: 0,
          expenses: 0,
          net: 0,
        };
      if (e.type === "order") byDate[d].ordersProfit += e.impact;
      else if (e.type === "expense" || e.type === "bonus_payment") byDate[d].expenses += e.expenseAmount;
      else byDate[d].salesProfit += e.impact;
      byDate[d].net += e.impact;
    });
    const chartData = Object.values(byDate);

    return res.json({
      success: true,
      type,
      date: type === "day" ? date : undefined,
      from: type === "range" ? from : undefined,
      to: type === "range" ? to : undefined,
      summary: {
        salesProfit: Math.round(totalSalesProfit),
        ordersProfit: Math.round(totalOrdersProfit),
        expenses: Math.round(totalExpenses),
        bonusPaid: Math.round(totalBonusPaid),
        netProfit: Math.round(netProfit),
        count: timeline.length,
      },
      chartData,
      timeline,
    });
  } catch (err) {
    console.error("❌ getProfitHistory:", err);
    return res
      .status(500)
      .json({ success: false, message: "خطأ في جلب تاريخ الأرباح" });
  }
};

/* ── utils ── */
function fmtTime(d) {
  return new Date(d).toLocaleTimeString("ar-DZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("ar-DZ");
}
