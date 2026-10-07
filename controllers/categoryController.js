const Category = require("../models/Category");
const Product = require("../models/Product");

// @route   POST /api/categories
// @desc    Create a new category
// @access  Private/Admin
exports.createCategory = async (req, res) => {
  try {
    const { name } = req.body;

    const categoryExists = await Category.findOne({ name });
    if (categoryExists) {
      return res.status(400).json({
        success: false,
        message: "هذا التصنيف موجود بالفعل",
        data: null,
      });
    }

    const category = new Category({ name });
    const createdCategory = await category.save();

    res.status(201).json({
      success: true,
      message: "تم إنشاء التصنيف بنجاح",
      data: createdCategory,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إنشاء التصنيف",
      data: null,
    });
  }
};

// @route   GET /api/categories
// @desc    Get all categories
// @access  Public
exports.getCategories = async (req, res) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1 });

    // Get product counts for each category
    const counts = await Product.aggregate([
      { $unwind: "$category" },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]);
    const countsMap = new Map();
    counts.forEach((c) => countsMap.set(String(c._id), c.count));

    const enrichedCategories = categories.map((cat) => ({
      ...cat.toObject(),
      productCount: countsMap.get(String(cat._id)) || 0,
    }));

    res.json({
      success: true,
      data: enrichedCategories,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب التصنيفات",
    });
  }
};

// @route   PUT /api/categories/:id
// @desc    Update a category
// @access  Private/Admin
exports.updateCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "اسم التصنيف مطلوب",
        data: null,
      });
    }

    const trimmedName = name.trim();
    const existing = await Category.findOne({
      name: trimmedName,
      _id: { $ne: req.params.id },
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "يوجد تصنيف آخر بهذا الاسم بالفعل",
        data: null,
      });
    }

    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "التصنيف غير موجود",
        data: null,
      });
    }

    category.name = trimmedName;
    const updated = await category.save();

    res.json({
      success: true,
      message: "تم تعديل التصنيف بنجاح",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تعديل التصنيف",
      data: null,
    });
  }
};

// @route   DELETE /api/categories/:id
// @desc    Delete a category
// @access  Private/Admin
exports.deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "التصنيف غير موجود",
        data: null,
      });
    }

    const productsCount = await Product.countDocuments({
      category: req.params.id,
    });
    if (productsCount > 0) {
      return res.status(400).json({
        success: false,
        message: "لا يمكن حذف تصنيف يحتوي على منتجات",
        data: null,
      });
    }

    await category.deleteOne();

    res.json({
      success: true,
      message: "تم حذف التصنيف بنجاح",
      data: null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف التصنيف",
      data: null,
    });
  }
};
