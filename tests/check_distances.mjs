import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../challenge-engine.js');

let maxDist = 0;

for (let i = 0; i < 100; i++) {
    const board = engine.generateChallenge(i);
    board.cards.forEach(card => {
        card.blockedBy.forEach(blockerId => {
            const blocker = board.cards.find(c => c.id === blockerId);
            const dx = card.gridColumn - blocker.gridColumn;
            const dy = card.gridRow - blocker.gridRow;
            const dist = dx*dx + dy*dy;
            
            if (dist > maxDist) maxDist = dist;
        });
    });
}
console.log('Max distance squared for any edge:', maxDist);
