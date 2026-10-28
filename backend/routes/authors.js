const router = require('express').Router();
const { protect, authorize } = require('../middleware/auth');
const c = require('../controllers/catalogController');

const editors = authorize('admin', 'librarian');

router.use(protect);
router.get('/', c.listAuthors);
router.get('/:id', c.getAuthor);
router.post('/', editors, c.createAuthor);
router.put('/:id', editors, c.updateAuthor);
router.delete('/:id', editors, c.deleteAuthor);

module.exports = router;
