const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

router.post("/", protect, authorizeRoles('admin', 'inventory_manager'), productController.createProduct);

router.get("/", protect, productController.getProducts);

router.get("/by-barcode/:barcode", protect, productController.getProductByBarcode);

router.get("/:id", protect, productController.getProductById);

router.put("/:id", protect, authorizeRoles('admin', 'inventory_manager'), productController.updateProduct);

router.delete("/:id", protect, authorizeRoles('admin', 'inventory_manager'), productController.deleteProduct);

router.put(
  "/:productId/colors/:colorIndex/sizes/:sizeIndex/quantity",
  protect,
  authorizeRoles('admin', 'inventory_manager'),
  productController.updateSizeQuantity
);
module.exports = router;
