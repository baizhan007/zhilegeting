import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../challenge-engine.js');

let maxD0 = 0;
for (let i = 0; i < 1000; i++) {
    const board = engine.generateChallenge(i);
    // actually we can't easily extract nearest[0] distance vs nearest[1] distance
    // unless we check max distance of ALL edges.
    board.cards.forEach(card => {
        card.blockedBy.forEach(blockerId => {
            const blocker = board.cards.find(c => c.id === blockerId);
            const dx = card.gridColumn - blocker.gridColumn;
            const dy = card.gridRow - blocker.gridRow;
            const dist = dx*dx + dy*dy;
            if (dist > maxD0) maxD0 = dist;
        });
    });
}
console.log('Max edge distance squared:', maxD0);
