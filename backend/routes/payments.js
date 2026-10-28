const router = require('express').Router();
const { protect, staffOnly } = require('../middleware/auth');
const c = require('../controllers/financeController');

router.use(protect);
router.get('/', c.listPayments);
router.get('/:id', c.getPayment);
router.post('/', staffOnly, c.createPayment);
router.patch('/:id/confirm', staffOnly, c.confirmPayment);

module.exports = router;
