const express = require("express");
const router = express.Router();
const bonusCtrl = require("../controllers/bonusController");
const { authorizeRoles, protect } = require("../middleware/authMiddleware");

router.put("/toggle", protect, authorizeRoles("admin"), bonusCtrl.toggleBonus);
router.get(
  "/status",
  protect,
  authorizeRoles("admin"),
  bonusCtrl.getBonusStatus,
);
router.get("/worker/:workerId", protect, bonusCtrl.getWorkerBonus);
router.get("/periods/:periodId/adjustments", protect, authorizeRoles("admin"), bonusCtrl.getAdjustmentsForPeriod);
router.post("/pay/:workerId", protect, bonusCtrl.payWorkerBonus);
router.post("/:periodId/adjustments", protect, authorizeRoles("admin"), bonusCtrl.createAdjustment);
router.delete("/adjustments/:adjustmentId", protect, authorizeRoles("admin"), bonusCtrl.deleteAdjustment);

module.exports = router;
