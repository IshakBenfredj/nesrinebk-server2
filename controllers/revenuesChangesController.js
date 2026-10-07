const RevenuesChanges = require("../models/RevenuesChanges");

// ➤ Add Revenue Change
exports.addRevenueChange = async (req, res) => {
  try {
    const { description, amount } = req.body;
    const user = req.user._id;

    if (!description || amount === undefined) {
      return res
        .status(400)
        .json({ success: false, message: "الوصف والمبلغ مطلوبان" });
    }

    const revenue = await RevenuesChanges.create({ description, amount, user });
    await revenue.populate("user");

    res.status(201).json({ success: true, data: revenue });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في إضافة التغيير",
    });
  }
};

// ➤ Get All Revenue Changes
exports.getRevenueChanges = async (req, res) => {
  try {
    const revenues = await RevenuesChanges.find().populate("user");
    res.json({ success: true, data: revenues });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب التغييرات",
    });
  }
};

// ➤ Get Single Change
exports.getRevenueChange = async (req, res) => {
  try {
    const revenue = await RevenuesChanges.findById(req.params.id).populate("user");
    if (!revenue)
      return res
        .status(404)
        .json({ success: false, message: "التغيير غير موجود" });
    res.json({ success: true, data: revenue });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في جلب التغيير",
    });
  }
};

// ➤ Update Change
exports.updateRevenueChange = async (req, res) => {
  try {
    const { description, amount } = req.body;
    const revenue = await RevenuesChanges.findByIdAndUpdate(
      req.params.id,
      { description, amount },
      { new: true }
    );
    if (!revenue)
      return res
        .status(404)
        .json({ success: false, message: "التغيير غير موجود" });
    res.json({ success: true, data: revenue });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في تعديل التغيير",
    });
  }
};

// ➤ Delete Change
exports.deleteRevenueChange = async (req, res) => {
  try {
    const revenue = await RevenuesChanges.findByIdAndDelete(req.params.id);
    if (!revenue)
      return res
        .status(404)
        .json({ success: false, message: "التغيير غير موجود" });
    res.json({ success: true, message: "تم حذف التغيير بنجاح" });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "خطأ في حذف التغيير",
    });
  }
};
