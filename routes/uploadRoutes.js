const express = require("express");
const router = express.Router();
const uploadController = require("../controllers/uploadController");
const { protect } = require("../middleware/authMiddleware");

router.post("/presigned-url", protect, uploadController.getPresignedUrl);
router.post("/delete", protect, uploadController.deleteUploadedFiles);

module.exports = router;
