const Coordination = require("../models/Coordination");
const { deleteMultipleFilesByUrls } = require("../utils/r2Storage");

/**
 * @desc Get all coordinations
 * @route GET /api/coordinations
 * @access Admin & Social Media
 */
exports.getCoordinations = async (req, res) => {
  try {
    const coordinations = await Coordination.find()
      .populate("createdBy", "name phone role")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: coordinations,
    });
  } catch (error) {
    console.error("Error fetching coordinations:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب التنسيقات",
      error: error.message,
    });
  }
};

/**
 * @desc Get single coordination by ID
 * @route GET /api/coordinations/:id
 * @access Admin & Social Media
 */
exports.getCoordinationById = async (req, res) => {
  try {
    const coordination = await Coordination.findById(req.params.id).populate(
      "createdBy",
      "name phone role"
    );

    if (!coordination) {
      return res.status(404).json({
        success: false,
        message: "التنسيق غير موجود",
      });
    }

    res.status(200).json({
      success: true,
      data: coordination,
    });
  } catch (error) {
    console.error("Error fetching coordination:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب بيانات التنسيق",
      error: error.message,
    });
  }
};

/**
 * @desc Create new main coordination
 * @route POST /api/coordinations
 * @access Admin only
 */
exports.createCoordination = async (req, res) => {
  try {
    const { title, description, items } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "اسم التنسيق الرئيسي مطلوب",
      });
    }

    const coordination = new Coordination({
      title: title.trim(),
      description: description ? description.trim() : "",
      items: Array.isArray(items) ? items : [],
      createdBy: req.user._id,
    });

    await coordination.save();
    await coordination.populate("createdBy", "name phone role");

    res.status(201).json({
      success: true,
      message: "تم إنشاء التنسيق بنجاح",
      data: coordination,
    });
  } catch (error) {
    console.error("Error creating coordination:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إنشاء التنسيق",
      error: error.message,
    });
  }
};

/**
 * @desc Update main coordination details
 * @route PUT /api/coordinations/:id
 * @access Admin only
 */
exports.updateCoordination = async (req, res) => {
  try {
    const { title, description } = req.body;

    const coordination = await Coordination.findById(req.params.id);
    if (!coordination) {
      return res.status(404).json({
        success: false,
        message: "التنسيق غير موجود",
      });
    }

    if (title && title.trim()) {
      coordination.title = title.trim();
    }
    if (description !== undefined) {
      coordination.description = description.trim();
    }

    await coordination.save();
    await coordination.populate("createdBy", "name phone role");

    res.status(200).json({
      success: true,
      message: "تم تحديث التنسيق بنجاح",
      data: coordination,
    });
  } catch (error) {
    console.error("Error updating coordination:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث التنسيق",
      error: error.message,
    });
  }
};

/**
 * @desc Delete a main coordination
 * @route DELETE /api/coordinations/:id
 * @access Admin only
 */
exports.deleteCoordination = async (req, res) => {
  try {
    const coordination = await Coordination.findById(req.params.id);
    if (!coordination) {
      return res.status(404).json({
        success: false,
        message: "التنسيق غير موجود",
      });
    }

    // Collect all image URLs for cleanup
    const imageUrls = [];
    if (Array.isArray(coordination.items)) {
      coordination.items.forEach((item) => {
        if (Array.isArray(item.images)) {
          imageUrls.push(...item.images);
        }
      });
    }

    await Coordination.findByIdAndDelete(req.params.id);

    // Asynchronously delete stored images from R2
    if (imageUrls.length > 0) {
      deleteMultipleFilesByUrls(imageUrls).catch((err) =>
        console.error("Failed to delete images from R2:", err.message)
      );
    }

    res.status(200).json({
      success: true,
      message: "تم حذف التنسيق بنجاح",
    });
  } catch (error) {
    console.error("Error deleting coordination:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف التنسيق",
      error: error.message,
    });
  }
};

/**
 * @desc Add sub-item to coordination
 * @route POST /api/coordinations/:id/items
 * @access Admin only
 */
exports.addSubItem = async (req, res) => {
  try {
    const { title, images } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: "تسمية التنسيق الفرعي مطلوبة",
      });
    }

    const coordination = await Coordination.findById(req.params.id);
    if (!coordination) {
      return res.status(404).json({
        success: false,
        message: "التنسيق الرئيسي غير موجود",
      });
    }

    const newItem = {
      title: title.trim(),
      images: Array.isArray(images) ? images : [],
    };

    coordination.items.push(newItem);
    await coordination.save();
    await coordination.populate("createdBy", "name phone role");

    res.status(201).json({
      success: true,
      message: "تمت إضافة التنسيق الفرعي بنجاح",
      data: coordination,
    });
  } catch (error) {
    console.error("Error adding sub-item:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إضافة التنسيق الفرعي",
      error: error.message,
    });
  }
};

/**
 * @desc Update sub-item in coordination
 * @route PUT /api/coordinations/:id/items/:itemId
 * @access Admin only
 */
exports.updateSubItem = async (req, res) => {
  try {
    const { title, images } = req.body;
    const { id, itemId } = req.params;

    const coordination = await Coordination.findById(id);
    if (!coordination) {
      return res.status(404).json({
        success: false,
        message: "التنسيق الرئيسي غير موجود",
      });
    }

    const item = coordination.items.id(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "التنسيق الفرعي غير موجود",
      });
    }

    if (title && title.trim()) {
      item.title = title.trim();
    }

    if (Array.isArray(images)) {
      // Find removed images for cleanup
      const removedImages = item.images.filter((img) => !images.includes(img));
      if (removedImages.length > 0) {
        deleteMultipleFilesByUrls(removedImages).catch((err) =>
          console.error("Failed to delete removed images from R2:", err.message)
        );
      }
      item.images = images;
    }

    await coordination.save();
    await coordination.populate("createdBy", "name phone role");

    res.status(200).json({
      success: true,
      message: "تم تحديث التنسيق الفرعي بنجاح",
      data: coordination,
    });
  } catch (error) {
    console.error("Error updating sub-item:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث التنسيق الفرعي",
      error: error.message,
    });
  }
};

/**
 * @desc Delete sub-item from coordination
 * @route DELETE /api/coordinations/:id/items/:itemId
 * @access Admin only
 */
exports.deleteSubItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;

    const coordination = await Coordination.findById(id);
    if (!coordination) {
      return res.status(404).json({
        success: false,
        message: "التنسيق الرئيسي غير موجود",
      });
    }

    const item = coordination.items.id(itemId);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: "التنسيق الفرعي غير موجود",
      });
    }

    const imagesToDelete = [...item.images];

    coordination.items.pull({ _id: itemId });
    await coordination.save();
    await coordination.populate("createdBy", "name phone role");

    // Clean up images from R2
    if (imagesToDelete.length > 0) {
      deleteMultipleFilesByUrls(imagesToDelete).catch((err) =>
        console.error("Failed to delete removed images from R2:", err.message)
      );
    }

    res.status(200).json({
      success: true,
      message: "تم حذف التنسيق الفرعي بنجاح",
      data: coordination,
    });
  } catch (error) {
    console.error("Error deleting sub-item:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف التنسيق الفرعي",
      error: error.message,
    });
  }
};

