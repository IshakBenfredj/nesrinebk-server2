const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Order = require("../models/Order");
const StockHistory = require("../models/StockHistory");
const ProductHistory = require("../models/ProductHistory");

const { generateBarcode } = require("../utils/barcodeGenerator");
const { uploadMultipleImages, deleteFileByUrl } = require("../utils/r2Storage");

exports.createProduct = async (req, res) => {
  try {
    const {
      name,
      fabric,
      description,
      price,
      category,
      colors,
      originalPrice,
    } = req.body;

    const userId = req.user?._id;
    if (req.user.role === "worker") {
      return res.status(403).json({
        success: false,
        message: "غير مصرح للعاملات بإنشاء المنتجات",
      });
    }

    if (
      !name ||
      !price ||
      !originalPrice ||
      !category ||
      !colors ||
      colors.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "الحقول المطلوبة مفقودة: الاسم، السعر، التصنيف، الألوان",
        data: null,
      });
    }

    const invalidColors = colors.some(
      (color) => !color.sizes || color.sizes.length === 0,
    );
    if (invalidColors) {
      return res.status(400).json({
        success: false,
        message: "يجب أن يحتوي كل لون على مقاس واحد على الأقل",
        data: null,
      });
    }

    // ✅ معالجة الألوان وتعيين روابط الصور والباركود
    const processedColors = colors.map((color) => {
      const validImages = Array.isArray(color.images)
        ? color.images.filter(
            (img) => typeof img === "string" && img.startsWith("http"),
          )
        : [];
      return {
        ...color,
        images: validImages,
        sizes: (color.sizes || []).map((size) => ({
          ...size,
          barcode: size.barcode || generateBarcode(),
        })),
      };
    });

    const product = new Product({
      name,
      description,
      price,
      category,
      fabric,
      originalPrice,
      colors: processedColors,
    });

    await product.save();
    await product.populate("category", "name");

    // 📜 Log initial stock quantities
    const historyDocs = [];
    processedColors.forEach((color) => {
      color.sizes.forEach((size) => {
        historyDocs.push({
          productId: product._id,
          productName: product.name,
          color: color.color,
          size: size.size,
          changeAmount: size.quantity, // first time added
          newQuantity: size.quantity, // same as initial
          worker: userId,
        });
      });
    });
    await StockHistory.insertMany(historyDocs);

    res.status(201).json({
      success: true,
      message: "تم إنشاء المنتج بنجاح",
      data: product,
    });
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء إنشاء المنتج",
      data: null,
    });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const {
      category,
      color,
      search,
      barcode,
      minPrice,
      maxPrice,
      sortBy,
      page,
      limit,
    } = req.query;
    const query = {};

    if (category) {
      if (mongoose.Types.ObjectId.isValid(category)) {
        query.category = { $in: [category] };
      } else {
        const catDoc = await Category.findOne({ name: category });
        if (catDoc) {
          query.category = { $in: [catDoc._id] };
        }
      }
    }

    if (color) query["colors.color"] = color;

    if (barcode && barcode.trim()) {
      query["colors.sizes.barcode"] = barcode.trim();
    } else if (search && search.trim()) {
      const trimmed = search.trim();
      query.$or = [
        { name: { $regex: trimmed, $options: "i" } },
        { "colors.sizes.barcode": trimmed },
      ];
    }

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }

    const isWorker = req.user && req.user.role === "worker";

    // Sorting
    let sort = { createdAt: -1 };
    if (sortBy === "nameAsc") sort = { name: 1 };
    else if (sortBy === "nameDesc") sort = { name: -1 };
    else if (sortBy === "priceAsc") sort = { price: 1 };
    else if (sortBy === "priceDesc") sort = { price: -1 };
    else if (sortBy === "newest") sort = { createdAt: -1 };
    else if (sortBy === "oldest") sort = { createdAt: 1 };

    let productsQuery = Product.find(query)
      .populate("category", "name")
      .select(isWorker ? "-originalPrice" : "")
      .sort(sort)
      .lean();

    const total = await Product.countDocuments(query);
    let pagination = null;

    if (page && limit) {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const skip = (pageNum - 1) * limitNum;
      productsQuery = productsQuery.skip(skip).limit(limitNum);
      pagination = {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum) || 1,
      };
    }

    const products = await productsQuery;

    res.json({
      success: true,
      data: products,
      total,
      ...(pagination
        ? { pages: pagination.pages, currentPage: pagination.page }
        : { pages: 1, currentPage: 1 }),
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب المنتجات",
      data: null,
    });
  }
};

exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate(
        // Updated: Populate categories (plural)
        "category",
        "name",
      )
      .select(req.user.role === "worker" ? "-originalPrice" : "");
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "المنتج غير موجود",
        data: null,
      });
    }
    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء جلب المنتج",
      data: null,
    });
  }
};
function isCloudinaryUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "res.cloudinary.com" ||
      parsed.hostname.endsWith(".cloudinary.com")
    );
  } catch {
    return false;
  }
}
// exports.updateProduct = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { name, price, category, colors, fabric, originalPrice } = req.body;
//     const userId = req.user?._id;

//     if (
//       !name ||
//       !price ||
//       !originalPrice ||
//       !category ||
//       !Array.isArray(category) ||
//       category.length === 0 ||
//       !colors ||
//       colors.length === 0
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "الحقول المطلوبة مفقودة: الاسم، السعر، التصنيف، الألوان",
//         data: null,
//       });
//     }

//     const product = await Product.findById(id);
//     if (!product) {
//       return res
//         .status(404)
//         .json({ success: false, message: "المنتج غير موجود" });
//     }

//     const oldColors = JSON.parse(JSON.stringify(product.colors));

//     const processedColors = await Promise.all(
//       colors.map(async (color) => {
//         const existingColor = product.colors.find(
//           (c) => c.color === color.color,
//         );

//         const base64Images = (color.images || []).filter((img) =>
//           img.startsWith("data:"),
//         );
//         const retainedImages = (color.images || []).filter(
//           (img) => !img.startsWith("data:"),
//         );

//         const newUploadedImages =
//           base64Images.length > 0
//             ? await uploadMultipleImages(base64Images)
//             : [];

//         const previousImages = existingColor?.images || [];
//         const removedImages = previousImages.filter(
//           (img) => !retainedImages.includes(img) && !isCloudinaryUrl(img),
//         );
//         await Promise.all(removedImages.map((img) => deleteFileByUrl(img)));

//         return {
//           ...color,
//           images: [...retainedImages, ...newUploadedImages],
//           sizes: color.sizes.map((size) => {
//             const existingSize = existingColor?.sizes?.find(
//               (s) => s.size === size.size,
//             );
//             return {
//               ...size,
//               barcode: existingSize?.barcode || generateBarcode(),
//             };
//           }),
//         };
//       }),
//     );

//     product.name = name;
//     product.price = price;
//     product.category = category;
//     product.originalPrice = originalPrice;
//     product.colors = processedColors;

//     // ###########################################################
//     // 📜 Comprehensive History Logging
//     const historyDocs = [];

//     // 1. Detect top-level changes
//     const oldName = product.name;
//     const oldPrice = product.price;
//     const oldOriginalPrice = product.originalPrice;
//     const oldFabric = product.fabric;
//     const oldCategory = product.category;

//     if (name !== oldName) {
//       historyDocs.push({
//         productId: product._id,
//         productName: name,
//         action: "product_updated",
//         details: { field: "name", old: oldName, new: name },
//         worker: userId,
//       });
//     }
//     if (price !== oldPrice) {
//       historyDocs.push({
//         productId: product._id,
//         productName: name,
//         action: "product_updated",
//         details: { field: "price", old: oldPrice, new: price },
//         worker: userId,
//       });
//     }
//     if (originalPrice !== oldOriginalPrice) {
//       historyDocs.push({
//         productId: product._id,
//         productName: name,
//         action: "product_updated",
//         details: {
//           field: "originalPrice",
//           old: oldOriginalPrice,
//           new: originalPrice,
//         },
//         worker: userId,
//       });
//     }
//     if (fabric && fabric !== oldFabric) {
//       historyDocs.push({
//         productId: product._id,
//         productName: name,
//         action: "product_updated",
//         details: { field: "fabric", old: oldFabric, new: fabric },
//         worker: userId,
//       });
//     }
//     // Category changes can be compared if needed (arrays)

//     // 2. Color & Size level changes
//     const oldColorsMap = new Map(oldColors.map((c) => [c.color, c]));

//     processedColors.forEach((newColor) => {
//       const oldColor = oldColorsMap.get(newColor.color);

//       if (!oldColor) {
//         // New color added
//         historyDocs.push({
//           productId: product._id,
//           productName: name,
//           action: "color_added",
//           details: {
//             color: newColor.color,
//             sizesCount: newColor.sizes.length,
//             imagesCount: newColor.images.length,
//           },
//           color: newColor.color,
//           worker: userId,
//         });
//       } else {
//         // Color exists → check sizes & images

//         const oldSizesMap = new Map(oldColor.sizes.map((s) => [s.size, s]));

//         newColor.sizes.forEach((newSize) => {
//           const oldSize = oldSizesMap.get(newSize.size);

//           if (!oldSize) {
//             // New size added
//             historyDocs.push({
//               productId: product._id,
//               productName: name,
//               action: "size_added",
//               details: {
//                 color: newColor.color,
//                 size: newSize.size,
//                 quantity: newSize.quantity,
//                 barcode: newSize.barcode,
//               },
//               color: newColor.color,
//               size: newSize.size,
//               worker: userId,
//             });
//           } else if (oldSize.quantity !== newSize.quantity) {
//             // Quantity changed (keep your existing stock logic too)
//             const changeAmount = newSize.quantity - oldSize.quantity;
//             historyDocs.push({
//               productId: product._id,
//               productName: name,
//               action: "stock_changed",
//               details: {
//                 color: newColor.color,
//                 size: newSize.size,
//                 oldQuantity: oldSize.quantity,
//                 newQuantity: newSize.quantity,
//                 changeAmount,
//               },
//               color: newColor.color,
//               size: newSize.size,
//               worker: userId,
//             });
//           }
//         });

//         // Detect removed sizes
//         oldColor.sizes.forEach((oldSize) => {
//           if (!newColor.sizes.some((ns) => ns.size === oldSize.size)) {
//             historyDocs.push({
//               productId: product._id,
//               productName: name,
//               action: "size_removed",
//               details: {
//                 color: newColor.color,
//                 size: oldSize.size,
//                 oldQuantity: oldSize.quantity,
//               },
//               color: newColor.color,
//               size: oldSize.size,
//               worker: userId,
//             });
//           }
//         });

//         // Image changes
//         const oldImages = oldColor.images || [];
//         const newImages = newColor.images || [];

//         const addedImages = newImages.filter((img) => !oldImages.includes(img));
//         const removedImages = oldImages.filter(
//           (img) => !newImages.includes(img),
//         );

//         addedImages.forEach((url) => {
//           historyDocs.push({
//             productId: product._id,
//             productName: name,
//             action: "image_added",
//             details: { color: newColor.color, imageUrl: url },
//             color: newColor.color,
//             worker: userId,
//           });
//         });

//         removedImages.forEach((url) => {
//           historyDocs.push({
//             productId: product._id,
//             productName: name,
//             action: "image_removed",
//             details: { color: newColor.color, imageUrl: url },
//             color: newColor.color,
//             worker: userId,
//           });
//         });
//       }
//     });

//     // Detect completely removed colors
//     oldColors.forEach((oldColor) => {
//       if (!processedColors.some((nc) => nc.color === oldColor.color)) {
//         historyDocs.push({
//           productId: product._id,
//           productName: name,
//           action: "color_removed",
//           details: {
//             color: oldColor.color,
//             sizesCount: oldColor.sizes.length,
//             imagesCount: oldColor.images.length,
//           },
//           color: oldColor.color,
//           worker: userId,
//         });
//       }
//     });

//     if (historyDocs.length > 0) {
//       await ProductHistory.insertMany(historyDocs);
//     }

//     // ###########################################################
//     if (fabric) product.fabric = fabric;

//     // 📜 Logging changes
//     const historyDocs = [];
//     processedColors.forEach((color) => {
//       color.sizes.forEach((size) => {
//         const oldQty =
//           oldColors
//             .find((c) => c.color === color.color)
//             ?.sizes.find((s) => s.size === size.size)?.quantity || 0;

//         const changeAmount = size.quantity - oldQty;
//         if (changeAmount !== 0) {
//           historyDocs.push({
//             productId: product._id,
//             productName: product.name,
//             color: color.color,
//             size: size.size,
//             changeAmount,
//             newQuantity: size.quantity,
//             worker: userId,
//           });
//         }
//       });
//     });
//     if (historyDocs.length) await StockHistory.insertMany(historyDocs);

//     await product.save();
//     await product.populate("category");

//     res.json({
//       success: true,
//       message: "تم تحديث المنتج بنجاح",
//       data: product,
//     });
//   } catch (error) {
//     console.error("Error updating product:", error);
//     res.status(500).json({
//       success: false,
//       message: "حدث خطأ أثناء تحديث المنتج",
//       data: null,
//     });
//   }
// };

// exports.deleteProduct = async (req, res) => {
//   try {
//     const product = await Product.findById(req.params.id);
//     if (!product) {
//       return res.status(404).json({
//         success: false,
//         message: "المنتج غير موجود",
//         data: null,
//       });
//     }

//     // Delete all images from R2
//     const imageUrls = product.colors.flatMap((color) => color.images || []);
//     await Promise.all(imageUrls.map((url) => deleteFileByUrl(url)));

//     await product.deleteOne();

//     res.json({
//       success: true,
//       message: "تم حذف المنتج بنجاح",
//       data: null,
//     });
//   } catch (error) {
//     console.error("Error deleting product:", error);
//     res.status(500).json({
//       success: false,
//       message: "حدث خطأ أثناء حذف المنتج",
//       data: null,
//     });
//   }
// };

// exports.updateSizeQuantity = async (req, res) => {
//   try {
//     const { productId, colorIndex, sizeIndex } = req.params;
//     const { quantity } = req.body;

//     if (typeof quantity !== "number" || quantity < 0) {
//       return res.status(400).json({
//         success: false,
//         message: "الكمية يجب أن تكون رقم موجب",
//         data: null,
//       });
//     }

//     const product = await Product.findById(productId);
//     if (!product) {
//       return res.status(404).json({
//         success: false,
//         message: "المنتج غير موجود",
//         data: null,
//       });
//     }

//     const colorIdx = parseInt(colorIndex);
//     if (colorIdx < 0 || colorIdx >= product.colors.length) {
//       return res.status(400).json({
//         success: false,
//         message: "اللون المحدد غير موجود",
//         data: null,
//       });
//     }

//     const szIdx = parseInt(sizeIndex);
//     if (szIdx < 0 || szIdx >= product.colors[colorIdx].sizes.length) {
//       return res.status(400).json({
//         success: false,
//         message: "المقاس المحدد غير موجود",
//         data: null,
//       });
//     }

//     product.colors[colorIdx].sizes[szIdx].quantity = quantity;

//     await product.save();

//     const changeAmount = quantity - oldQuantity;
//     if (changeAmount !== 0) {
//       await StockHistory.create({
//         productId: product._id,
//         productName: product.name,
//         color: product.colors[colorIdx].color,
//         size: sizeObj.size,
//         changeAmount,
//         newQuantity: quantity,
//         worker: userId,
//       });
//     }

//     res.json({
//       success: true,
//       message: "تم تحديث الكمية بنجاح",
//       data: {
//         productId,
//         colorIndex,
//         sizeIndex,
//         newQuantity: quantity,
//       },
//     });
//   } catch (error) {
//     console.error("Error updating size quantity:", error);
//     res.status(500).json({
//       success: false,
//       message: "حدث خطأ أثناء تحديث الكمية",
//       data: null,
//     });
//   }
// };

exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, category, colors, fabric, originalPrice } = req.body;
    const userId = req.user?._id;

    if (req.user.role === "worker") {
      return res.status(403).json({
        success: false,
        message: "غير مصرح للعاملات بتعديل المنتجات",
      });
    }

    // Basic validation
    if (
      !name ||
      !price ||
      !originalPrice ||
      !category ||
      !Array.isArray(category) ||
      category.length === 0 ||
      !colors ||
      !Array.isArray(colors) ||
      colors.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "الحقول المطلوبة مفقودة: الاسم، السعر، التصنيف، الألوان",
        data: null,
      });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "المنتج غير موجود" });
    }

    // ==================== TAKE OLD SNAPSHOT ====================
    const oldData = {
      name: product.name,
      price: Number(product.price),
      originalPrice: Number(product.originalPrice),
      fabric: product.fabric,
      colors: JSON.parse(JSON.stringify(product.colors)), // deep clone
    };

    console.log("Old Name:", oldData.name);
    console.log("New Name from body:", name);

    // ==================== PROCESS COLORS & IMAGES ====================
    const processedColors = colors.map((color) => {
      const existingColor = product.colors.find(
        (c) => c.color === color.color,
      );

      const validImages = Array.isArray(color.images)
        ? color.images.filter(
            (img) => typeof img === "string" && img.startsWith("http"),
          )
        : [];

      return {
        ...color,
        images: validImages,
        sizes: (color.sizes || []).map((size) => {
          const existingSize = existingColor?.sizes?.find(
            (s) => s.size === size.size,
          );
          return {
            ...size,
            barcode: existingSize?.barcode || generateBarcode(),
          };
        }),
      };
    });

    // Delete removed images from R2
    const oldAllImages = oldData.colors.flatMap((c) => c.images || []);
    const newAllImages = processedColors.flatMap((c) => c.images || []);
    const removedImages = oldAllImages.filter(
      (img) => !newAllImages.includes(img) && !isCloudinaryUrl(img),
    );
    if (removedImages.length > 0) {
      await Promise.all(removedImages.map((img) => deleteFileByUrl(img)));
    }

    // ==================== APPLY CHANGES ====================
    product.name = name;
    product.price = price;
    product.originalPrice = originalPrice;
    product.category = category;
    product.colors = processedColors;
    if (fabric !== undefined) product.fabric = fabric;

    // ==================== BUILD HISTORY DOCS ====================
    const historyDocs = [];

    // Top-level changes
    if (name !== oldData.name) {
      historyDocs.push({
        productId: product._id,
        productName: name,
        action: "product_updated",
        details: { field: "name", old: oldData.name, new: name },
        worker: userId,
      });
    }

    if (Number(price) !== oldData.price) {
      historyDocs.push({
        productId: product._id,
        productName: name,
        action: "product_updated",
        details: { field: "price", old: oldData.price, new: price },
        worker: userId,
      });
    }

    if (Number(originalPrice) !== oldData.originalPrice) {
      historyDocs.push({
        productId: product._id,
        productName: name,
        action: "product_updated",
        details: {
          field: "originalPrice",
          old: oldData.originalPrice,
          new: originalPrice,
        },
        worker: userId,
      });
    }

    if (fabric !== undefined && fabric !== oldData.fabric) {
      historyDocs.push({
        productId: product._id,
        productName: name,
        action: "product_updated",
        details: { field: "fabric", old: oldData.fabric, new: fabric },
        worker: userId,
      });
    }

    // Color / Size / Image changes
    const oldColorsMap = new Map(oldData.colors.map((c) => [c.color, c]));

    processedColors.forEach((newColor) => {
      const oldColor = oldColorsMap.get(newColor.color);

      if (!oldColor) {
        // New color added
        historyDocs.push({
          productId: product._id,
          productName: name,
          action: "color_added",
          details: {
            color: newColor.color,
            sizesCount: newColor.sizes.length,
            imagesCount: newColor.images.length,
          },
          color: newColor.color,
          worker: userId,
        });
      } else {
        const oldSizesMap = new Map(oldColor.sizes.map((s) => [s.size, s]));

        // New or changed sizes
        newColor.sizes.forEach((newSize) => {
          const oldSize = oldSizesMap.get(newSize.size);

          if (!oldSize) {
            historyDocs.push({
              productId: product._id,
              productName: name,
              action: "size_added",
              details: {
                color: newColor.color,
                size: newSize.size,
                quantity: newSize.quantity,
                barcode: newSize.barcode,
              },
              color: newColor.color,
              size: newSize.size,
              worker: userId,
            });
          } else if (oldSize.quantity !== newSize.quantity) {
            const changeAmount = newSize.quantity - oldSize.quantity;
            historyDocs.push({
              productId: product._id,
              productName: name,
              action: "stock_changed",
              details: {
                color: newColor.color,
                size: newSize.size,
                oldQuantity: oldSize.quantity,
                newQuantity: newSize.quantity,
                changeAmount,
              },
              color: newColor.color,
              size: newSize.size,
              worker: userId,
            });
          }
        });

        // Removed sizes
        oldColor.sizes.forEach((oldSize) => {
          if (!newColor.sizes.some((ns) => ns.size === oldSize.size)) {
            historyDocs.push({
              productId: product._id,
              productName: name,
              action: "size_removed",
              details: {
                color: newColor.color,
                size: oldSize.size,
                oldQuantity: oldSize.quantity,
              },
              color: newColor.color,
              size: oldSize.size,
              worker: userId,
            });
          }
        });

        // Images
        const oldImages = oldColor.images || [];
        const newImages = newColor.images || [];

        const addedImages = newImages.filter((img) => !oldImages.includes(img));
        const removedImages = oldImages.filter(
          (img) => !newImages.includes(img),
        );

        addedImages.forEach((url) => {
          historyDocs.push({
            productId: product._id,
            productName: name,
            action: "image_added",
            details: { color: newColor.color, imageUrl: url },
            color: newColor.color,
            worker: userId,
          });
        });

        removedImages.forEach((url) => {
          historyDocs.push({
            productId: product._id,
            productName: name,
            action: "image_removed",
            details: { color: newColor.color, imageUrl: url },
            color: newColor.color,
            worker: userId,
          });
        });
      }
    });

    // Removed colors
    oldData.colors.forEach((oldColor) => {
      if (!processedColors.some((nc) => nc.color === oldColor.color)) {
        historyDocs.push({
          productId: product._id,
          productName: name,
          action: "color_removed",
          details: {
            color: oldColor.color,
            sizesCount: oldColor.sizes.length,
            imagesCount: oldColor.images?.length || 0,
          },
          color: oldColor.color,
          worker: userId,
        });
      }
    });

    // ==================== SAVE HISTORY ====================
    if (historyDocs.length > 0) {
      console.log(
        `✅ Logging ${historyDocs.length} history entries for product ${product._id}`,
      );
      await ProductHistory.insertMany(historyDocs);
    } else {
      console.log("⚠️ No changes detected - nothing to log");
    }

    // ==================== SAVE PRODUCT ====================
    await product.save();
    await product.populate("category");

    res.json({
      success: true,
      message: "تم تحديث المنتج بنجاح",
      data: product,
    });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء تحديث المنتج",
      data: null,
    });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    if (req.user.role === "worker") {
      return res.status(403).json({
        success: false,
        message: "غير مصرح للعاملات بحذف المنتجات",
      });
    }
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "المنتج غير موجود" });
    }

    const userId = req.user?._id;

    // Log deletion before deleting images/product
    await ProductHistory.create({
      productId: product._id,
      productName: product.name,
      action: "product_deleted",
      details: {
        colorsCount: product.colors.length,
        totalStock: product.colors.reduce(
          (sum, c) => sum + c.sizes.reduce((s, size) => s + size.quantity, 0),
          0,
        ),
      },
      worker: userId,
    });

    // Delete images
    const imageUrls = product.colors.flatMap((color) => color.images || []);
    await Promise.all(imageUrls.map((url) => deleteFileByUrl(url)));

    await product.deleteOne();

    res.json({
      success: true,
      message: "تم حذف المنتج بنجاح",
      data: null,
    });
  } catch (error) {
    console.error("Error deleting product:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء حذف المنتج" });
  }
};

exports.updateSizeQuantity = async (req, res) => {
  try {
    const { productId, colorIndex, sizeIndex } = req.params;
    const { quantity } = req.body;
    const userId = req.user?._id; // worker ID from auth middleware

    if (typeof quantity !== "number" || quantity < 0) {
      return res
        .status(400)
        .json({ success: false, message: "الكمية يجب أن تكون رقم موجب" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "المنتج غير موجود" });
    }

    const colorIdx = parseInt(colorIndex);
    const szIdx = parseInt(sizeIndex);

    const sizeObj = product.colors[colorIdx].sizes[szIdx];
    const oldQuantity = sizeObj.quantity;
    console.log(
      `Updating stock for product ${productId}, color ${colorIdx}, size ${sizeIndex}: ${oldQuantity} -> ${quantity}`,
    );
    sizeObj.quantity = quantity;

    await product.save();

    const changeAmount = quantity - oldQuantity;
    if (changeAmount !== 0) {
      await StockHistory.create({
        productId: product._id,
        productName: product.name,
        color: product.colors[colorIdx].color,
        size: sizeObj.size,
        changeAmount,
        newQuantity: quantity,
        worker: userId,
      });
    }

    res.json({
      success: true,
      message: "تم تحديث الكمية بنجاح",
      data: { productId, colorIndex, sizeIndex, newQuantity: quantity },
    });
  } catch (error) {
    console.error("Error updating size quantity:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء تحديث الكمية" });
  }
};

// GET /api/products/by-barcode/:barcode
exports.getProductByBarcode = async (req, res) => {
  try {
    const { barcode } = req.params;
    if (!barcode) {
      return res
        .status(400)
        .json({ success: false, message: "الباركود مطلوب" });
    }

    const trimmedBarcode = String(barcode).trim();

    // Find product containing this size barcode
    const product = await Product.findOne(
      { "colors.sizes.barcode": trimmedBarcode },
      { name: 1, price: 1, originalPrice: 1, fabric: 1, colors: 1 }
    ).lean();

    if (!product) {
      return res
        .status(404)
        .json({ success: false, message: "المنتج غير موجود" });
    }

    // Locate matching color and size
    let foundColor = null;
    let foundSize = null;

    for (const color of product.colors) {
      for (const size of color.sizes) {
        if (String(size.barcode).trim() === trimmedBarcode) {
          foundColor = color;
          foundSize = size;
          break;
        }
      }
      if (foundSize) break;
    }

    if (!foundSize || !foundColor) {
      return res
        .status(404)
        .json({ success: false, message: "لم يتم العثور على المقاس المطلوب" });
    }

    // Check reserved quantity in unconfirmed orders only
    const reservedOrders = await Order.aggregate([
      {
        $match: {
          status: "غير مؤكدة",
          "items.barcode": trimmedBarcode,
        },
      },
      { $unwind: "$items" },
      { $match: { "items.barcode": trimmedBarcode } },
      {
        $group: {
          _id: "$items.barcode",
          reservedQty: { $sum: "$items.quantity" },
        },
      },
    ]);

    const reservedQty =
      reservedOrders.length > 0 ? reservedOrders[0].reservedQty : 0;
    const availableQty = foundSize.quantity - reservedQty;

    const isWorker = req.user && req.user.role === "worker";

    res.json({
      success: true,
      data: {
        product: product._id,
        barcode: foundSize.barcode,
        name: product.name,
        price: product.price,
        originalPrice: isWorker ? undefined : product.originalPrice,
        size: foundSize.size,
        color: foundColor.color,
        physicalQuantity: foundSize.quantity,
        reservedQty,
        availableQty,
      },
    });
  } catch (error) {
    console.error("Error fetching product by barcode:", error);
    res
      .status(500)
      .json({ success: false, message: "حدث خطأ أثناء فحص الباركود" });
  }
};

