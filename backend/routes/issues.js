const router = require('express').Router();
const { protect, staffOnly } = require('../middleware/auth');
const c = require('../controllers/circulationController');

router.use(protect);
router.get('/', c.listIssues);
router.get('/:id', c.getIssue);
router.post('/', staffOnly, c.createIssue);
router.patch('/:id/renew', c.renewIssue);

module.exports = router;
