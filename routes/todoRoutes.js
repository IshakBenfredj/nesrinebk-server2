const express = require("express");
const router = express.Router();
const todoController = require("../controllers/todoController");
const { protect } = require("../middleware/authMiddleware");

router.post("/", protect, todoController.createTodo);
router.get("/", protect, todoController.getTodos);
router.delete("/:id", protect, todoController.deleteTodo);
router.put("/:id/complete", protect, todoController.completeOrIncompleteTodo);
router.delete("/", protect, todoController.deleteAll);

module.exports = router;
