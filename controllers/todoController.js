// controllers/todoController.js
const Todo = require("../models/Todo");

/**
 * @desc Create a new Todo
 * @route POST /api/todos
 */
exports.createTodo = async (req, res) => {
  try {
    const { title, description, dueDate } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "العنوان مطلوب",
      });
    }

    const todo = new Todo({
      title,
      description,
      dueDate,
      createdBy: req.user._id,
    });

    await todo.save();
    await todo.populate("createdBy");

    return res.status(201).json({
      success: true,
      message: "تم إنشاء المهمة بنجاح",
      data: todo,
    });
  } catch (error) {
    console.error("❌ createTodo error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ أثناء إنشاء المهمة",
    });
  }
};

/**
 * @desc Get all Todos for the logged-in user
 * @route GET /api/todos
 */
exports.getTodos = async (req, res) => {
  try {
    const todos = await Todo.find()
      .sort({
        createdAt: -1,
      })
      .populate("createdBy");

    res.json({
      success: true,
      data: todos,
    });
  } catch (error) {
    console.error("❌ getTodos error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ أثناء جلب المهام",
    });
  }
};

/**
 * @desc Delete a single Todo
 * @route DELETE /api/todos/:id
 */
exports.deleteTodo = async (req, res) => {
  try {
    const { id } = req.params;

    const todo = await Todo.findOneAndDelete({
      _id: id,
    });

    if (!todo) {
      return res.status(404).json({
        success: false,
        message: "المهمة غير موجودة",
      });
    }

    res.json({
      success: true,
      message: "تم حذف المهمة بنجاح",
    });
  } catch (error) {
    console.error("❌ deleteTodo error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ أثناء حذف المهمة",
    });
  }
};

/**
 * @desc Mark Todo as complete or incomplete
 * @route PUT /api/todos/:id/complete
 */
exports.completeOrIncompleteTodo = async (req, res) => {
  try {
    const { id } = req.params;

    const todo = await Todo.findOne({ _id: id }).populate("createdBy");

    if (!todo) {
      return res.status(404).json({
        success: false,
        message: "المهمة غير موجودة",
      });
    }

    todo.completed = !todo.completed;
    await todo.save();

    res.json({
      success: true,
      data: todo,
    });
  } catch (error) {
    console.error("❌ completeOrIncompleteTodo error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ أثناء تحديث حالة المهمة",
    });
  }
};

/**
 * @desc Delete all Todos for the logged-in user
 * @route DELETE /api/todos
 */
exports.deleteAll = async (req, res) => {
  try {
    const result = await Todo.deleteMany({ createdBy: req.user._id });

    res.json({
      success: true,
      deletedCount: result.deletedCount,
      message: "تم حذف جميع المهام",
    });
  } catch (error) {
    console.error("❌ deleteAll error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ أثناء حذف جميع المهام",
    });
  }
};
