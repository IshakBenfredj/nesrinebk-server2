const express = require("express");
const router = express.Router();
const StockHistory = require("../models/StockHistory");
const { protect } = require("../middleware/authMiddleware");

router.get("/", protect, async (req, res) => {
  const history = await StockHistory.find().populate("worker", "name").sort({ createdAt: -1 });
  res.json({ success: true, data: history });
});

router.delete("/clear", protect, async (req, res) => {
  await StockHistory.deleteMany({});
  res.json({ success: true, message: "تم حذف جميع السجلات" });
});

module.exports = router;
