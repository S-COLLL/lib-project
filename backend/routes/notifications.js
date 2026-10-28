const router = require('express').Router();
const { protect, staffOnly } = require('../middleware/auth');
const c = require('../controllers/notificationController');

router.use(protect);
router.get('/', c.listNotifications);
router.get('/unread-count', c.unread);
router.patch('/read-all', c.readAll);
router.patch('/:id/read', c.readOne);
router.post('/', staffOnly, c.broadcast);
router.delete('/:id', staffOnly, c.deleteNotification);

module.exports = router;
