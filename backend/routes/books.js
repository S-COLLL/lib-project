const router = require('express').Router();
const { protect, authorize, staffOnly } = require('../middleware/auth');
const c = require('../controllers/catalogController');

const editors = authorize('admin', 'librarian');

router.use(protect);
router.get('/', c.listBooks);
router.get('/meta', c.bookMeta);
router.get('/recommendations', c.recommendations);
router.post('/bulk', editors, c.bulkBooks);
router.get('/:id', c.getBook);
router.post('/', editors, c.createBook);
router.put('/:id', editors, c.updateBook);
router.patch('/:id/location', staffOnly, c.moveBook);
router.delete('/:id', editors, c.deleteBook);

module.exports = router;
