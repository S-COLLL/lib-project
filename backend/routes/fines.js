const router = require('express').Router();
const { protect, authorize, staffOnly } = require('../middleware/auth');
const c = require('../controllers/financeController');

router.use(protect);
router.get('/', c.listFines);
router.get('/summary', c.fineSummary);
router.post('/', staffOnly, c.createFine);
router.patch('/:id/discount', authorize('admin', 'librarian'), c.discountFine);
router.patch('/:id/waive', authorize('admin', 'librarian'), c.waiveFine);

module.exports = router;
