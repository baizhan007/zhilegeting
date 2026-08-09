import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../challenge-engine.js');

async function runRegression() {
    console.log('Running regression on 10,000 random seeds...');
    let invalidCount = 0;
    
    // Test 10000 random seeds
    for (let i = 0; i < 10000; i++) {
        const seed = engine.hashSeed('random_regression_' + i);
        const board = engine.generateChallenge(seed);
        const validation = engine.validateBoard(board);
        
        if (!validation.valid) {
            console.error(`Seed ${seed} failed validation!`);
            console.error(validation.errors);
            invalidCount++;
        }
    }
    
    console.log(`Regression complete. Failed seeds: ${invalidCount} / 10000`);
    if (invalidCount === 0) {
        console.log('All random seeds passed validation, meaning the generator is robust and all generated boards have at least one valid witness path (solvable without tools, peak slot 6, etc).');
    }
}

runRegression().catch(console.error);
