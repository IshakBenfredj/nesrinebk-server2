const express = require("express");
const router = express.Router();
const dailyProfitController = require("../controllers/dailyProfitController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

router.get(
  "/:date",
  protect,
  authorizeRoles("admin", "manager"),
  dailyProfitController.getDailyProfit
);
router.get(
  "/",
  protect,
  authorizeRoles("admin", "manager"),
  dailyProfitController.getProfitSummary
);

module.exports = router;
