// routes/productHistory.js
const express = require("express");
const router = express.Router();
const ProductHistory = require("../models/ProductHistory");

// GET all
router.get("/", async (req, res) => {
  const history = await ProductHistory.find()
    .sort({ createdAt: -1 })
    .populate("worker", "name");
  res.json({ success: true, data: history });
});

// DELETE all (clear)
router.delete("/clear", async (req, res) => {
  await ProductHistory.deleteMany({});
  res.json({ success: true, message: "تم مسح السجل بنجاح" });
});

module.exports = router;