const DailyProfit = require("../models/DailyProfit");

// Get daily profit by date
exports.getDailyProfit = async (req, res) => {
  try {
    const { date } = req.params;
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const dailyProfit = await DailyProfit.findOne({
      date: { $gte: startDate, $lte: endDate },
    });

    if (!dailyProfit) {
      return res.json({
        date: startDate,
        totalSales: 0,
        totalOriginal: 0,
        totalProfit: 0,
        exchangeAdjustments: 0,
        finalProfit: 0,
        salesCount: 0,
      });
    }

    res.json(dailyProfit);
  } catch (error) {
    console.error("Error getting daily profit:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get profit summary for a date range
exports.getProfitSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const dailyProfits = await DailyProfit.find({
      date: { $gte: start, $lte: end },
    }).sort({ date: 1 });

    // Calculate totals
    const summary = dailyProfits.reduce(
      (acc, curr) => {
        return {
          totalSales: acc.totalSales + curr.totalSales,
          totalOriginal: acc.totalOriginal + curr.totalOriginal,
          totalProfit: acc.totalProfit + curr.totalProfit,
          exchangeAdjustments:
            acc.exchangeAdjustments + curr.exchangeAdjustments,
          finalProfit: acc.finalProfit + curr.finalProfit,
          salesCount: acc.salesCount + curr.salesCount,
        };
      },
      {
        totalSales: 0,
        totalOriginal: 0,
        totalProfit: 0,
        exchangeAdjustments: 0,
        finalProfit: 0,
        salesCount: 0,
      }
    );

    res.json({
      dailyProfits,
      summary,
    });
  } catch (error) {
    console.error("Error getting profit summary:", error);
    res.status(500).json({ error: error.message });
  }
};
