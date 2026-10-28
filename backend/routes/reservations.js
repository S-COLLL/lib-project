const router = require('express').Router();
const { protect, authorize, staffOnly } = require('../middleware/auth');
const c = require('../controllers/circulationController');

router.use(protect);
router.get('/', c.listReservations);
router.post('/', c.createReservation);
router.patch('/:id/cancel', c.cancelReservation);
router.patch('/:id/collect', staffOnly, c.collectReservation);
router.delete('/:id', authorize('admin', 'librarian'), c.deleteReservation);

module.exports = router;
