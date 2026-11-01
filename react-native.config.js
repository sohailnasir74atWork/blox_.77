// Local native modules that live in this repo instead of node_modules.
// modules/trade-ocr: on-device text reader for the Trade Scanner (2026-11-01).
const path = require('path');

module.exports = {
  dependencies: {
    'trade-ocr': { root: path.join(__dirname, 'modules/trade-ocr') },
  },
};
