const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const { protect } = require("../middleware/authMiddleware");

router.post("/", protect, orderController.createOrder);
router.get("/", protect, orderController.getOrders);
router.get("/:id", protect, orderController.getOrderById);
router.put("/:id", protect, orderController.updateOrder);
router.put("/:id/status", protect, orderController.updateOrderStatus);
router.post("/:id/exchange", protect, orderController.exchangeOrder);
router.delete("/:id", protect, orderController.deleteOrder);

module.exports = router;
