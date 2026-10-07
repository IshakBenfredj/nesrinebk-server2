const Expense = require("../models/Expense");

// ➤ Add Expense
exports.addExpense = async (req, res) => {
  try {
    const { description, amount, admin = false, isFixed = false, recurrence = 'monthly' } = req.body;
    const user = req.user._id;

    if (!description || !amount || !user) {
      return res
        .status(400)
        .json({ success: false, message: "كل الحقول مطلوبة" });
    }

    const expense = await Expense.create({
      description,
      amount,
      user,
      admin,
      isFixed,
      recurrence
    });

    await expense.populate("user", "name role");
    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في إضافة المصروف",
    });
  }
};

// ➤ Get All Expenses
exports.getExpenses = async (req, res) => {
  try {
    const query = {};
    if (req.user.role === "worker") {
      query.admin = false;
    }
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

// ➤ Get Fixed Expenses
exports.getFixedExpenses = async (req, res) => {
  try {
    const fixedExpenses = await Expense.find({ isFixed: true })
      .populate("user", "name role")
      .lean();
    res.json({ success: true, data: fixedExpenses });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب المصروفات الثابتة",
    });
  }
};

// ➤ Get Admin Expenses
exports.getAdminExpenses = async (req, res) => {
  try {
    const adminExpenses = await Expense.find({ admin: true })
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
    const { description, amount, admin, isFixed, recurrence } = req.body;

    const updateData = {
      description,
      amount,
      admin,
      isFixed,
      recurrence
    };

    const expense = await Expense.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
    });

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
