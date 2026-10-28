const router = require('express').Router();
const { protect, authorize, staffOnly } = require('../middleware/auth');
const c = require('../controllers/memberController');

router.use(protect);
router.get('/', staffOnly, c.listMembers);
router.get('/:id', c.getMember);
router.post('/', staffOnly, c.createMember);
router.put('/:id', staffOnly, c.updateMember);
router.patch('/:id/renew', staffOnly, c.renewMember);
router.delete('/:id', authorize('admin', 'librarian'), c.deleteMember);

module.exports = router;
