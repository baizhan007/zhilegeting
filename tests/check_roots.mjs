import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../challenge-engine.js');
const board = engine.generateChallenge(624325031);
const roots = board.cards.filter(c => c.blockedBy.length === 0);
console.log(roots.map(c => c.region + " L" + c.layer + " col:" + c.gridColumn + " row:" + c.gridRow).join('\n'));
