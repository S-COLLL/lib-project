const { body, validationResult } = require('express-validator');

/** Runs express-validator chains and answers 400 with per-field details in the SmartLib error shape. */
const validate = (chains) => [
  ...chains,
  (req, res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    const details = {};
    result.array().forEach((e) => {
      if (!details[e.path]) details[e.path] = e.msg;
    });
    res.status(400).json({ success: false, message: Object.values(details)[0], details });
  },
];

const rules = {
  login: [
    body('password').isString().notEmpty().withMessage('Password is required'),
    body().custom((b) => {
      if (!String(b.email || b.identifier || '').trim()) throw new Error('Email (or user ID) is required');
      return true;
    }),
  ],
  register: [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name must be at least 2 characters'),
    body('email').trim().isEmail().withMessage('Email is invalid'),
    body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters'),
    body('phone').optional({ values: 'falsy' }).matches(/^[+\d][\d\s-]{7,15}$/).withMessage('Phone number is invalid'),
  ],
  createUser: [
    body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Name is required'),
    body('email').trim().isEmail().withMessage('Email is invalid'),
    body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn(['admin', 'librarian', 'staff', 'student']).withMessage('Role is required'),
  ],
  password: [
    body('currentPassword').isString().notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6, max: 128 }).withMessage('New password must be at least 6 characters'),
  ],
};

module.exports = { validate, rules };
