import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../challenge-engine.js');

let d0Count = 0;
let d1Count = 0;

// Need to hack into createTopology or just re-implement connectAdjacentLayers locally to test.
// Actually, I can just check the distance of cards with ONLY ONE blocker vs TWO blockers.
// But we want to know what happens if we drop edges > 7.
