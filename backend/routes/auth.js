const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middleware/auth');
const { validate, rules } = require('../middleware/validate');
const c = require('../controllers/authController');

// Slows down password guessing on the open endpoints.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again in a few minutes.' },
});

router.post('/login', loginLimiter, validate(rules.login), c.login);
router.post('/register', loginLimiter, validate(rules.register), c.register);
router.get('/me', protect, c.me);
router.put('/profile', protect, c.updateProfile);
router.patch('/password', protect, validate(rules.password), c.changePassword);
router.post('/search-history', protect, c.addSearchHistory);
router.get('/users', protect, authorize('admin'), c.listUsers);
router.post('/users', protect, authorize('admin'), validate(rules.createUser), c.createUser);
router.patch('/users/:id', protect, authorize('admin'), c.updateUser);

module.exports = router;
