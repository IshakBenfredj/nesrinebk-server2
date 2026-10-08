// controllers/bonusController.js
const User = require("../models/User");
const BonusConfig = require("../models/BonusConfig");
const BonusPeriod = require("../models/BonusPeriod");
const BonusAdjustment = require("../models/BonusAdjustment");

const getConfig = async () => {
  let config = await BonusConfig.findOne();
  if (!config) {
    config = new BonusConfig({ isEnabled: false });
    await config.save();
  }
  return config;
};

exports.toggleBonus = async (req, res) => {
  try {
    const { isEnabled } = req.body;

    if (typeof isEnabled !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isEnabled يجب أن يكون boolean (true/false)",
      });
    }

    const config = await getConfig();
    const wasEnabled = config.isEnabled;
    config.isEnabled = isEnabled;
    await config.save();

    const now = new Date();

    // ─────────────────────────────────────────────────────────────
    // When ENABLE bonus
    // ─────────────────────────────────────────────────────────────
    if (isEnabled && !wasEnabled) {
      const workers = await User.find({ role: "worker" }).select("_id");

      const newPeriods = [];

      for (const worker of workers) {
        // Check if worker already has a pending (open) period
        const existingPending = await BonusPeriod.findOne({
          user: worker._id,
          status: "pending",
          endDate: null,
        });

        // Only create new period if no open pending period exists
        if (!existingPending) {
          newPeriods.push({
            user: worker._id,
            startDate: now,
            endDate: null,
            status: "pending",
            note: "فتح تلقائي عند تفعيل نظام البونص",
            bonusAmount: 0,
            adjustmentsTotal: 0,
            finalBonus: 0,
          });
        }
      }

      if (newPeriods.length > 0) {
        await BonusPeriod.insertMany(newPeriods);
      }

      return res.json({
        success: true,
        isEnabled: true,
        message: `تم تفعيل نظام البونص. تم إنشاء ${newPeriods.length} فترة جديدة.`,
        newPeriodsCreated: newPeriods.length,
      });
    }

    // ─────────────────────────────────────────────────────────────
    // When DISABLE bonus
    // ─────────────────────────────────────────────────────────────
    if (!isEnabled && wasEnabled) {
      // Do NOT close pending periods (as per your request)
      // Just disable the system

      return res.json({
        success: true,
        isEnabled: false,
        message: "تم تعطيل نظام البونص. الفترات المعلقة لم يتم إغلاقها.",
      });
    }

    // If no change happened
    return res.json({
      success: true,
      isEnabled: config.isEnabled,
      message: "لم يتم تغيير حالة النظام",
    });
  } catch (err) {
    console.error("Toggle bonus error:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث حالة البونص",
    });
  }
};

exports.getBonusStatus = async (req, res) => {
  try {
    const config = await getConfig();
    return res.json({
      success: true,
      data: { isEnabled: config.isEnabled },
    });
  } catch (err) {
    console.error("Get bonus status error:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ في جلب حالة البونص",
    });
  }
};

// exports.getWorkerBonus = async (req, res) => {
//   try {
//     const { workerId } = req.params;

//     const worker = await User.findById(workerId);
//     if (!worker || worker.role !== "worker") {
//       return;
//     }

//     const periods = await BonusPeriod.find({
//       user: workerId,
//       status: "pending",
//     });

//     const periodIds = periods.map((p) => p._id);
//     const adjustments = await BonusAdjustment.find({
//       period: { $in: periodIds },
//       type : "cash_deduction",
//     })
//       .select("period amount reason createdBy createdAt")
//       .populate("createdBy", "name")
//       .sort({ createdAt: -1 })
//       .lean();

//     let totalUnpaid = 0;
//     const resultPeriods = [];

//     for (const period of periods) {
//       const bonusValue = await period.finalBonus;
//       const fullDetails = await BonusPeriod.calculateForPeriod(period);
//       console.log("fullDetails", fullDetails);

//       totalUnpaid += bonusValue;

//       resultPeriods.push({
//         _id: period._id,
//         startDate: period.startDate,
//         endDate: period.endDate || "مفتوحة",
//         status: period.status,
//         totalBonus: period.finalBonus,
//         details: {
//           salesBonus: period.bonusAmount,
//           adjustments: period.adjustmentsTotal,
//           cashDeduction: adjustments.cashDeduction,
//         },
//       });
//     }

//     return res.json({
//       success: true,
//       worker: {
//         _id: worker._id,
//         name: worker.name,
//         phone: worker.phone,
//         bonusPercentage: worker.bonusPercentage || 0,
//       },
//       unpaidPeriods: resultPeriods,
//       totalUnpaidBonus: totalUnpaid,
//     });
//   } catch (err) {
//     console.error("Get worker bonus error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "حدث خطأ في جلب بيانات البونص لهذا العامل",
//     });
//   }
// };

// exports.getWorkerBonus = async (req, res) => {
//   try {
//     const { workerId } = req.params;

//     const worker = await User.findById(workerId);
//     if (!worker || worker.role !== "worker") {
//       return res.status(404).json({
//         success: false,
//         message: "العامل غير موجود",
//       });
//     }

//     const periods = await BonusPeriod.find({
//       user: workerId,
//       status: "pending",
//     });

//     const periodIds = periods.map((p) => p._id);

//     // 🔹 bonus_only adjustments
//     const bonusAdjustments = await BonusAdjustment.find({
//       period: { $in: periodIds },
//       type: "bonus_only",
//     }).lean();

//     // 🔹 cash_deduction adjustments
//     const cashAdjustments = await BonusAdjustment.find({
//       period: { $in: periodIds },
//       type: "cash_deduction",
//     }).lean();

//     let totalUnpaidBonus = 0;
//     let totalCashWithdrawn = 0;

//     const resultPeriods = [];

//     for (const period of periods) {
//       // 🟢 البونص النهائي (جاهز)
//       const bonusValue = period.finalBonus || 0;

//       totalUnpaidBonus += bonusValue;

//       // 🟠 cash deductions لهذا period
//       const periodCash = cashAdjustments
//         .filter((a) => a.period.toString() === period._id.toString())
//         .reduce((sum, a) => sum + Math.abs(a.amount), 0);

//       totalCashWithdrawn += periodCash;

//       resultPeriods.push({
//         _id: period._id,
//         startDate: period.startDate,
//         endDate: period.endDate || "مفتوحة",
//         status: period.status,

//         // 🟢 البونص
//         totalBonus: bonusValue,

//         details: {
//           salesBonus: period.bonusAmount || 0,
//           bonusAdjustments: period.adjustmentsTotal || 0,
//           cashWithdrawn: periodCash,
//         },
//       });
//     }

//     // 🔥 المبلغ المتبقي للسحب من الكاش
//     const remainingToDeduct = Math.max(
//       0,
//       totalCashWithdrawn - totalUnpaidBonus,
//     );

//     return res.json({
//       success: true,
//       worker: {
//         _id: worker._id,
//         name: worker.name,
//         phone: worker.phone,
//         bonusPercentage: worker.bonusPercentage || 0,
//       },

//       unpaidPeriods: resultPeriods,

//       totalUnpaidBonus,

//       totalCashWithdrawn,

//       remainingToDeduct,
//     });

//   } catch (err) {
//     console.error("Get worker bonus error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "حدث خطأ في جلب بيانات البونص لهذا العامل",
//     });
//   }
// };

// exports.payWorkerBonus = async (req, res) => {
//   try {
//     const { workerId } = req.params;

//     const worker = await User.findById(workerId);
//     if (!worker || worker.role !== "worker") {
//       return res.status(404).json({
//         success: false,
//         message: "العامل غير موجود أو ليس له صلاحية worker",
//       });
//     }

//     const periods = await BonusPeriod.find({
//       user: workerId,
//       status: "pending",
//     });

//     if (periods.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "لا توجد فترات معلقة للدفع",
//       });
//     }

//     let totalToPay = 0;
//     for (const period of periods) {
//       totalToPay += await period.totalBonus;
//     }

//     if (totalToPay <= 0) {
//       return res.status(400).json({
//         success: false,
//         message: "لا يوجد بونص مستحق للدفع",
//       });
//     }

//     // Mark all pending as paid
//     const updateResult = await BonusPeriod.updateMany(
//       { user: workerId, status: "pending" },
//       {
//         $set: {
//           status: "paid",
//           paidAt: new Date(),
//           paidBy: req.user._id,
//           note: "دفع تلقائي كامل",
//         },
//       },
//     );

//     return res.json({
//       success: true,
//       paidAmount: totalToPay,
//       updatedPeriods: updateResult.modifiedCount,
//       message: `تم دفع البونص الكامل بقيمة ${totalToPay} د.ج`,
//     });
//   } catch (err) {
//     console.error("Pay worker bonus error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "حدث خطأ في دفع البونص",
//     });
//   }
// };

exports.getWorkerBonus = async (req, res) => {
  try {
    const { workerId } = req.params;

    const worker = await User.findById(workerId);
    if (!worker || worker.role !== "worker") {
      return res.status(404).json({
        success: false,
        message: "العامل غير موجود",
      });
    }

    // Find the single pending period
    const period = await BonusPeriod.findOne({
      user: workerId,
      status: "pending",
    }).lean();

    if (!period) {
      return res.json({
        success: true,
        worker: {
          _id: worker._id,
          name: worker.name,
          phone: worker.phone,
          bonusPercentage: worker.bonusPercentage || 0,
        },
        unpaidPeriods: [],
        adjustments: [],
        totalUnpaidBonus: 0,
        totalCashWithdrawn: 0,
      });
    }

    // Get ALL adjustments for this period
    const allAdjustments = await BonusAdjustment.find({
      period: period._id,
    })
      .populate("createdBy", "name")
      .lean();

    console.log("All adjustments for period:", allAdjustments);

    const bonusValue = period.finalBonus || 0;

    const periodCash = allAdjustments
      .filter((a) => a.type === "cash_deduction")
      .reduce((sum, a) => sum + Math.abs(a.amount), 0);

    const resultPeriod = {
      _id: period._id,
      startDate: period.startDate,
      endDate: period.endDate || "مفتوحة",
      status: period.status,
      totalBonus: bonusValue,
      details: {
        salesBonus: period.bonusAmount || 0,
        bonusAdjustments: period.adjustmentsTotal || 0,
        cashWithdrawn: periodCash,
      },
    };

    return res.json({
      success: true,
      worker: {
        _id: worker._id,
        name: worker.name,
        phone: worker.phone,
        bonusPercentage: worker.bonusPercentage || 0,
      },
      unpaidPeriods: [resultPeriod], // always one pending period
      adjustments: allAdjustments, // all adjustments for this period
      totalUnpaidBonus: bonusValue,
      totalCashWithdrawn: periodCash,
    });
  } catch (err) {
    console.error("Get worker bonus error:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ في جلب بيانات البونص",
    });
  }
};

exports.payWorkerBonus = async (req, res) => {
  try {
    const { workerId } = req.params;
    const { amount } = req.body;

    // Authorization: Admin or Worker themselves
    if (
      req.user.role !== "admin" &&
      req.user._id.toString() !== workerId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "غير مصرح لك بإجراء هذه العملية",
      });
    }

    const worker = await User.findById(workerId);
    if (!worker || worker.role !== "worker") {
      return res.status(404).json({
        success: false,
        message: "العامل غير موجود أو ليس له صلاحية worker",
      });
    }

    const period = await BonusPeriod.findOne({
      user: workerId,
      status: "pending",
    });

    if (!period) {
      return res.status(400).json({
        success: false,
        message: "لا توجد فترات معلقة للدفع أو السحب",
      });
    }

    const availableBonus = period.finalBonus || 0;
    if (availableBonus <= 0) {
      return res.status(400).json({
        success: false,
        message: "لا يوجد رصيد بونص مستحق للسحب",
      });
    }

    // Use the amount sent from frontend instead of recalculating
    const totalToPay = Number(amount);

    if (isNaN(totalToPay) || totalToPay <= 0) {
      return res.status(400).json({
        success: false,
        message: "المبلغ المطلوب للسحب غير صالح",
      });
    }

    if (totalToPay > availableBonus) {
      return res.status(400).json({
        success: false,
        message: `المبلغ المطلوب (${totalToPay.toLocaleString("ar-DZ")} د.ج) أكبر من الرصيد المتاح (${availableBonus.toLocaleString("ar-DZ")} د.ج)`,
      });
    }

    const remainingAmount = availableBonus - totalToPay;
    const now = new Date();
    const isWorkerSelf = req.user._id.toString() === workerId.toString();
    const actionNote = isWorkerSelf
      ? "سحب مستحقات من طرف العامل"
      : "دفع مستحقات من قبل الإدارة";

    // Close the pending period with the paid/withdrawn amount
    period.status = "paid";
    period.paidAt = now;
    period.finalBonus = totalToPay;
    period.paidBy = req.user._id;
    period.endDate = now;
    period.note = actionNote;
    await period.save();

    // Check BonusConfig for auto new period
    let config = await BonusConfig.findOne();
    if (!config) {
      config = await BonusConfig.create({ isEnabled: false });
    }

    let newPeriod = null;
    // Always open a new pending period if bonus system is enabled OR if there is remaining balance to preserve!
    if (config.isEnabled || remainingAmount > 0) {
      newPeriod = await BonusPeriod.create({
        user: workerId,
        startDate: now,
        endDate: null,
        status: "pending",
        note:
          remainingAmount > 0
            ? "رصيد متبقي محجوز ومرحل من سحب سابق"
            : "تم إنشاؤها تلقائياً بعد السحب",
        bonusAmount: 0,
        adjustmentsTotal: remainingAmount,
        finalBonus: remainingAmount,
      });

      // Create carryover adjustment if there is a remainder
      if (remainingAmount > 0) {
        await BonusAdjustment.create({
          period: newPeriod._id,
          amount: remainingAmount,
          reason: "رصيد متبقي محجوز ومرحل من سحب سابق",
          createdBy: req.user._id,
          type: "bonus_only",
        });
      }
    }

    return res.json({
      success: true,
      paidAmount: totalToPay,
      remainingAmount,
      newPeriodCreated: !!newPeriod,
      message:
        remainingAmount > 0
          ? `تم سحب ${totalToPay.toLocaleString("ar-DZ")} د.ج بنجاح، والمبلغ المتبقي ${remainingAmount.toLocaleString("ar-DZ")} د.ج محجوز في رصيدك.`
          : `تم سحب ${totalToPay.toLocaleString("ar-DZ")} د.ج بنجاح بالكامل.`,
    });
  } catch (err) {
    console.error("Pay worker bonus error:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ في سحب البونص",
    });
  }
};

exports.createAdjustment = async (req, res) => {
  try {
    const { amount, reason, type } = req.body;
    const { periodId } = req.params;

    if (!periodId || !amount || !reason) {
      return res.status(400).json({
        success: false,
        message: "الفترة والمبلغ والسبب مطلوبة",
      });
    }

    if (!["bonus_only", "cash_deduction"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "نوع التعديل غير صالح",
      });
    }

    const period = await BonusPeriod.findById(periodId);
    if (!period) {
      return res.status(404).json({
        success: false,
        message: "الفترة غير موجودة",
      });
    }

    if (period.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "لا يمكن إضافة تعديلات إلى فترة مغلقة أو مدفوعة",
      });
    }
    const adjustment = await BonusAdjustment.create({
      period: periodId,
      amount: Number(amount),
      reason,
      createdBy: req.user._id,
      type,
    });

    if (type === "bonus_only") {
      period.adjustmentsTotal += Number(amount);
      period.finalBonus += Number(amount);
      await period.save();
    } else if (type === "cash_deduction") {
      period.finalBonus += Number(amount);
      await period.save();
    }
    return res.status(201).json({
      success: true,
      data: adjustment,
      message: "تم إضافة التعديل بنجاح",
    });
  } catch (err) {
    console.error("Create adjustment error:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إضافة التعديل",
    });
  }
};

exports.getAdjustmentsForPeriod = async (req, res) => {
  try {
    const { periodId } = req.params;

    const adjustments = await BonusAdjustment.find({ period: periodId })
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      count: adjustments.length,
      data: adjustments,
    });
  } catch (err) {
    console.error("Get adjustments error:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ في جلب التعديلات",
    });
  }
};

exports.deleteAdjustment = async (req, res) => {
  try {
    const { adjustmentId } = req.params;

    const adjustment = await BonusAdjustment.findById(adjustmentId);
    if (!adjustment) {
      return res.status(404).json({
        success: false,
        message: "التعديل غير موجود",
      });
    }

    const period = await BonusPeriod.findById(adjustment.period);
    if (period.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "لا يمكن حذف تعديلات من فترة مغلقة أو مدفوعة",
      });
    }

    await BonusAdjustment.findByIdAndDelete(adjustmentId);

    if (adjustment.type === "bonus_only") {
      period.adjustmentsTotal -= adjustment.amount;
      period.finalBonus -= adjustment.amount
      await period.save();
    } else if (adjustment.type === "cash_deduction") {
      period.finalBonus -= adjustment.amount
      await period.save();
    }

    return res.json({
      success: true,
      message: "تم حذف التعديل بنجاح",
    });
  } catch (err) {
    console.error("Delete adjustment error:", err);
    return res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف التعديل",
    });
  }
};
