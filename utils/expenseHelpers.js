/**
 * Utility helpers for Fixed Expenses calculation
 */

/**
 * Calculates the first due date for a monthly fixed expense.
 * - If dueDay >= baseDate.getDate(): first due date is in the current month (today or later this month).
 * - If dueDay < baseDate.getDate(): the due date for this month has already passed,
 *   so the first due date starts from NEXT month.
 *
 * @param {Date|string} baseDate - Usually createdAt or current date
 * @param {number} dueDay - Target day of the month (1 - 31)
 * @returns {Date} First due date at 00:00:00
 */
function getMonthlyFirstDueDate(baseDate, dueDay) {
  const base = new Date(baseDate);
  const year = base.getFullYear();
  const month = base.getMonth();
  const currentDay = base.getDate();

  const targetDay = parseInt(dueDay, 10) || currentDay;

  if (targetDay >= currentDay) {
    const maxDays = new Date(year, month + 1, 0).getDate();
    const actualDay = Math.min(targetDay, maxDays);
    const d = new Date(year, month, actualDay);
    d.setHours(0, 0, 0, 0);
    return d;
  } else {
    const nextMonth = month + 1;
    const maxDays = new Date(year, nextMonth + 1, 0).getDate();
    const actualDay = Math.min(targetDay, maxDays);
    const d = new Date(year, nextMonth, actualDay);
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

/**
 * Returns the effective first due date for an expense.
 * For existing expenses without firstDueDate, computes it dynamically from createdAt and dueDay.
 *
 * @param {Object} exp - Expense document
 * @returns {Date}
 */
function getExpenseFirstDueDate(exp) {
  if (exp.firstDueDate) {
    const d = new Date(exp.firstDueDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const createdAt = exp.createdAt ? new Date(exp.createdAt) : new Date();
  const dueDay = exp.dueDay || createdAt.getDate();
  return getMonthlyFirstDueDate(createdAt, dueDay);
}

/**
 * Checks if a monthly fixed expense is due on a specific calendar day.
 *
 * @param {number} dueDay - Target day of month (1 - 31)
 * @param {Date} firstDue - First valid due date (cannot be due before this)
 * @param {Date} checkDate - The day to check
 * @returns {boolean}
 */
function isMonthlyExpenseDueOnSpecificDate(dueDay, firstDue, checkDate) {
  const check = new Date(checkDate);
  check.setHours(0, 0, 0, 0);

  const fd = new Date(firstDue);
  fd.setHours(0, 0, 0, 0);

  // If check date is before first due date, it cannot be due
  if (check < fd) return false;

  const year = check.getFullYear();
  const month = check.getMonth();
  const maxDays = new Date(year, month + 1, 0).getDate();
  const actualDueDay = Math.min(dueDay, maxDays);

  return check.getDate() === actualDueDay;
}

module.exports = {
  getMonthlyFirstDueDate,
  getExpenseFirstDueDate,
  isMonthlyExpenseDueOnSpecificDate,
};
