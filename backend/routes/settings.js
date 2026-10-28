const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const c = require('../controllers/notificationController');

router.use(protect);
router.get('/', c.getSettings);
router.put('/', authorize('admin'), c.updateSettings);
router.post('/backup', authorize('admin'), c.backup);

module.exports = router;
