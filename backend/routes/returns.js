const router = require('express').Router();
const { protect, staffOnly } = require('../middleware/auth');
const c = require('../controllers/circulationController');

router.use(protect);
router.get('/lookup', staffOnly, c.lookupReturns);
router.get('/', c.listReturns);
router.post('/', staffOnly, c.createReturn);

module.exports = router;
