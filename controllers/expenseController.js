const Expense = require("../models/Expense");
const { getMonthlyFirstDueDate } = require("../utils/expenseHelpers");

// ➤ Add Expense
exports.addExpense = async (req, res) => {
  try {
    const {
      description,
      amount,
      admin = false,
      isFixed = false,
      recurrence = "monthly",
      dueDay,
    } = req.body;
    const user = req.user._id;

    if (!description || !amount || !user) {
      return res
        .status(400)
        .json({ success: false, message: "كل الحقول مطلوبة" });
    }

    const now = new Date();
    const expenseData = {
      description,
      amount,
      user,
      admin,
      isFixed,
      recurrence,
    };

    if (isFixed && recurrence === "monthly") {
      const parsedDueDay = dueDay ? parseInt(dueDay, 10) : now.getDate();
      expenseData.dueDay = parsedDueDay;
      expenseData.firstDueDate = getMonthlyFirstDueDate(now, parsedDueDay);
    }

    const expense = await Expense.create(expenseData);

    await expense.populate("user", "name role");
    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في إضافة المصروف",
    });
  }
};

// ➤ Get All Expenses (المصاريف العامة)
exports.getExpenses = async (req, res) => {
  try {
    const query = { admin: false, isFixed: { $ne: true } };
    const expenses = await Expense.find(query)
      .populate("user", "name role")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: expenses });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب المصروفات",
    });
  }
};

// ➤ Get Fixed Expenses (المصاريف الثابتة)
exports.getFixedExpenses = async (req, res) => {
  try {
    const fixedExpenses = await Expense.find({ isFixed: true })
      .populate("user", "name role")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: fixedExpenses });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب المصروفات الثابتة",
    });
  }
};

// ➤ Get Admin Expenses (مصاريف المسؤولين)
exports.getAdminExpenses = async (req, res) => {
  try {
    const adminExpenses = await Expense.find({ admin: true, isFixed: { $ne: true } })
      .populate("user", "name role")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: adminExpenses });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب مصروفات المدير",
    });
  }
};

// ➤ Get Single Expense
exports.getExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id).populate("user");
    if (!expense)
      return res
        .status(404)
        .json({ success: false, message: "المصروف غير موجود" });
    res.json({ success: true, data: expense });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب المصروف",
    });
  }
};

// ➤ Update Expense
exports.updateExpense = async (req, res) => {
  try {
    const { description, amount, admin, isFixed, recurrence, dueDay } = req.body;

    const updateData = {
      description,
      amount,
      admin,
      isFixed,
      recurrence,
    };

    if (isFixed && recurrence === "monthly") {
      const now = new Date();
      const existing = await Expense.findById(req.params.id);
      if (existing) {
        const parsedDueDay = dueDay
          ? parseInt(dueDay, 10)
          : existing.dueDay || new Date(existing.createdAt).getDate();
        updateData.dueDay = parsedDueDay;

        // If dueDay changed or firstDueDate is missing, recalculate firstDueDate
        if (!existing.firstDueDate || existing.dueDay !== parsedDueDay) {
          updateData.firstDueDate = getMonthlyFirstDueDate(now, parsedDueDay);
        }
      }
    }

    const expense = await Expense.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    }).populate("user", "name role");

    if (!expense)
      return res
        .status(404)
        .json({ success: false, message: "المصروف غير موجود" });

    res.json({ success: true, data: expense });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في تعديل المصروف",
    });
  }
};

// ➤ Delete Expense
exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);

    if (!expense)
      return res
        .status(404)
        .json({ success: false, message: "المصروف غير موجود" });

    if (expense.admin && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "غير مصرح لك بحذف هذا المصروف",
      });
    }

    await expense.deleteOne();

    res.json({ success: true, message: "تم حذف المصروف بنجاح" });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في حذف المصروف",
    });
  }
};
