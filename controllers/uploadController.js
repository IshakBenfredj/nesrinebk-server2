const {
  generatePresignedUploadUrl,
  deleteMultipleFilesByUrls,
} = require("../utils/r2Storage");

exports.getPresignedUrl = async (req, res) => {
  try {
    const { filename, contentType, folder } = req.body;

    if (!contentType) {
      return res.status(400).json({
        success: false,
        message: "نوع الملف (contentType) مطلوب",
      });
    }

    const data = await generatePresignedUploadUrl(
      filename,
      contentType,
      folder || "images"
    );

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إنشاء رابط الرفع",
      error: error.message,
    });
  }
};

exports.deleteUploadedFiles = async (req, res) => {
  try {
    const { urls, url } = req.body;
    const fileUrls = Array.isArray(urls) ? urls : url ? [url] : [];

    if (fileUrls.length === 0) {
      return res.status(400).json({
        success: false,
        message: "روابط الصور المراد حذفها مطلوبة",
      });
    }

    await deleteMultipleFilesByUrls(fileUrls);

    res.json({
      success: true,
      message: "تم حذف الصور بنجاح من التخزين السحابي",
    });
  } catch (error) {
    console.error("Error deleting uploaded files:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء حذف الصور",
      error: error.message,
    });
  }
};
