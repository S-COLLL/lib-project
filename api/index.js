// Vercel serverless entry: every /api/* request is rewritten here (see vercel.json)
// and handled by the same Express app that `npm start` runs locally.
module.exports = require('../backend/server');
