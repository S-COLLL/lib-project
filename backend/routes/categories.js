const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const c = require('../controllers/catalogController');

const editors = authorize('admin', 'librarian');

router.use(protect);
router.get('/', c.listCategories);
router.get('/:id', c.getCategory);
router.post('/', editors, c.createCategory);
router.put('/:id', editors, c.updateCategory);
router.delete('/:id', editors, c.deleteCategory);

module.exports = router;
