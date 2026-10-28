const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/aiController');

router.post('/query', protect, c.query);

module.exports = router;
