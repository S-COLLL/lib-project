const router = require('express').Router();
const { protect, staffOnly } = require('../middleware/auth');
const c = require('../controllers/reportController');

router.use(protect);
router.get('/dashboard', c.dashboard);
router.get('/', staffOnly, c.listReports);
router.get('/:type', staffOnly, c.getReport);

module.exports = router;
