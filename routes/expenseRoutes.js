const express = require("express");
const router = express.Router();
const {
  addExpense,
  getExpenses,
  getExpense,
  updateExpense,
  deleteExpense,
  getFixedExpenses,
  getAdminExpenses,
} = require("../controllers/expenseController");
const { protect } = require("../middleware/authMiddleware");

router.post("/", protect, addExpense);
router.get("/", protect, getExpenses);
router.get("/fixed", protect, getFixedExpenses);
router.get("/admin", protect, getAdminExpenses);
router.get("/:id", protect, getExpense);
router.put("/:id", protect, updateExpense);
router.delete("/:id", protect, deleteExpense);

module.exports = router;
