const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/** Verifies the Bearer JWT and loads req.user (with memberId for linked members). */
const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) throw new ApiError(401, 'Not authenticated. Please log in.');
  let payload;
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch {
    throw new ApiError(401, 'Session expired. Please log in again.');
  }
  const [rows] = await pool.query(
    `SELECT u.*, m.member_id AS linked_member_id FROM users u LEFT JOIN members m ON m.user_id = u.user_id WHERE u.user_id = ?`,
    [payload.userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw new ApiError(401, 'Not authenticated. Please log in.');
  user.memberId = user.linked_member_id || null;
  req.user = user;
  next();
});

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new ApiError(403, `This action requires one of the roles: ${roles.join(', ')}`));
  }
  next();
};

const staffOnly = authorize('admin', 'librarian', 'staff');

module.exports = { protect, authorize, staffOnly };
