const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const c = require('../controllers/catalogController');

const editors = authorize('admin', 'librarian');

router.use(protect);
router.get('/', c.listShelves);
router.get('/:id', c.getShelf);
router.post('/', editors, c.createShelf);
router.put('/:id', editors, c.updateShelf);
router.delete('/:id', editors, c.deleteShelf);

module.exports = router;
