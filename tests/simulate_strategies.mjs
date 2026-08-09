import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../challenge-engine.js');

const MATCH_SIZE = engine.MATCH_SIZE;
const SLOT_CAPACITY = engine.SLOT_CAPACITY;

function createRng(seed) {
    let state = seed >>> 0;
    return function() {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function simulateGame(board, strategy, runSeed) {
    const rng = createRng(runSeed);
    const cardById = new Map(board.cards.map(c => [c.id, c]));
    const removed = new Set();
    const slotCounts = Array(board.motifCount).fill(0);
    let slotOccupancy = 0;
    let peakSlot = 0;
    
    // Tools
    let hasStash = strategy === 'with_tool';
    let stashedCount = 0;
    
    let step = 0;
    
    while (removed.size < board.cards.length) {
        const availableIds = engine.getAvailableCardIds(board, removed);
        if (availableIds.length === 0) {
            return { solved: false, reason: 'deadlock', peakSlot, step };
        }
        
        let chosenId;
        
        if (strategy === 'random') {
            chosenId = availableIds[Math.floor(rng() * availableIds.length)];
        } else if (strategy === 'conservative' || strategy === 'pair_first' || strategy === 'with_tool') {
            // Conservative: Priority 1: Motifs already in slot
            let candidates = availableIds.filter(id => slotCounts[cardById.get(id).motifIndex] > 0);
            
            if (candidates.length === 0 && (strategy === 'pair_first' || strategy === 'with_tool')) {
                // Pair First / With Tool: Priority 2: Motifs that have >= 2 cards in available pool
                const availableMotifCounts = new Map();
                availableIds.forEach(id => {
                    const m = cardById.get(id).motifIndex;
                    availableMotifCounts.set(m, (availableMotifCounts.get(m) || 0) + 1);
                });
                candidates = availableIds.filter(id => availableMotifCounts.get(cardById.get(id).motifIndex) >= 2);
            }
            
            if (candidates.length === 0) {
                // Fallback to random
                candidates = availableIds;
            }
            chosenId = candidates[Math.floor(rng() * candidates.length)];
        } else {
            chosenId = availableIds[Math.floor(rng() * availableIds.length)];
        }
        
        const card = cardById.get(chosenId);
        removed.add(chosenId);
        slotCounts[card.motifIndex] += 1;
        slotOccupancy += 1;
        peakSlot = Math.max(peakSlot, slotOccupancy);
        step += 1;
        
        if (slotCounts[card.motifIndex] === MATCH_SIZE) {
            slotCounts[card.motifIndex] = 0;
            slotOccupancy -= MATCH_SIZE;
        } else if (slotOccupancy >= SLOT_CAPACITY) {
            if (hasStash) {
                // Use stash: move up to 3 single cards out of slot
                hasStash = false;
                for (let motif = 0; motif < board.motifCount; motif++) {
                    if (slotCounts[motif] > 0 && slotCounts[motif] < MATCH_SIZE && stashedCount < 3) {
                        const toStash = Math.min(slotCounts[motif], 3 - stashedCount);
                        slotCounts[motif] -= toStash;
                        slotOccupancy -= toStash;
                        stashedCount += toStash;
                    }
                }
                if (slotOccupancy >= SLOT_CAPACITY) {
                    return { solved: false, reason: 'slot-overflow-after-stash', peakSlot, step };
                }
            } else {
                return { solved: false, reason: 'slot-overflow', peakSlot, step };
            }
        }
    }
    
    return { solved: true, peakSlot, step };
}

async function runSimulations() {
    console.log('Running branch strategy simulations...');
    const daysToTest = 100;
    const runsPerBoard = 10;
    
    const strategies = ['random', 'conservative', 'pair_first', 'with_tool'];
    const results = {};
    
    for (const strategy of strategies) {
        results[strategy] = {
            totalRuns: 0,
            solved: 0,
            peakSlotDistribution: {},
            stepsToFail: []
        };
    }
    
    for (let day = 1; day <= daysToTest; day++) {
        const date = new Date(2026, 0, day);
        const seed = engine.seedFromDate(date);
        const board = engine.generateChallenge(seed);
        
        for (const strategy of strategies) {
            for (let i = 0; i < runsPerBoard; i++) {
                const runSeed = seed + i * 1337;
                const sim = simulateGame(board, strategy, runSeed);
                
                const stats = results[strategy];
                stats.totalRuns++;
                if (sim.solved) {
                    stats.solved++;
                } else {
                    stats.stepsToFail.push(sim.step);
                }
                
                stats.peakSlotDistribution[sim.peakSlot] = (stats.peakSlotDistribution[sim.peakSlot] || 0) + 1;
            }
        }
    }
    
    console.log('Simulation Results:');
    for (const strategy of strategies) {
        const stats = results[strategy];
        const winRate = ((stats.solved / stats.totalRuns) * 100).toFixed(2);
        
        let avgStepsToFail = 0;
        if (stats.stepsToFail.length > 0) {
            avgStepsToFail = stats.stepsToFail.reduce((a, b) => a + b, 0) / stats.stepsToFail.length;
        }
        
        console.log(`\nStrategy: ${strategy}`);
        console.log(`Win Rate: ${winRate}% (${stats.solved} / ${stats.totalRuns})`);
        console.log(`Average Steps to Fail: ${avgStepsToFail.toFixed(1)}`);
        
        const peaks = Object.keys(stats.peakSlotDistribution).map(Number).sort((a, b) => a - b);
        console.log('Peak Slot Distribution:');
        for (const p of peaks) {
            const count = stats.peakSlotDistribution[p];
            const pct = ((count / stats.totalRuns) * 100).toFixed(1);
            console.log(`  Slot ${p}: ${count} runs (${pct}%)`);
        }
    }
}

runSimulations().catch(console.error);
