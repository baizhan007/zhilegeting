import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../challenge-engine.js');

test('generates the requested board topology and card inventory', () => {
    const board = engine.generateChallenge('2026-08-08');
    const regionCounts = Object.create(null);
    board.cards.forEach((card) => {
        regionCounts[card.region] = (regionCounts[card.region] || 0) + 1;
    });

    assert.equal(board.cards.length, 126);
    assert.equal(board.motifCount, 10);
    assert.deepEqual({ ...regionCounts }, {
        center: 84,
        leftQueue: 15,
        rightQueue: 15,
        relief: 12
    });
    assert.equal(board.layout.regions.center.effectiveLayers, 12);
    assert.equal(board.layout.regions.leftQueue.effectiveLayers, 15);
    assert.equal(board.layout.regions.rightQueue.effectiveLayers, 15);
    assert.equal(board.layout.regions.relief.effectiveLayers, 4);
    assert.ok(board.metrics.motifCounts.every((count) => count > 0 && count % 3 === 0));
});

test('is deterministic while different seeds produce different boards', () => {
    const first = engine.generateChallenge('2026-08-08');
    const repeated = engine.generateChallenge('2026-08-08');
    const different = engine.generateChallenge('2026-08-09');

    assert.deepEqual(repeated, first);
    assert.notDeepEqual(
        different.cards.map((card) => [card.motifIndex, card.solutionRank, card.rotation]),
        first.cards.map((card) => [card.motifIndex, card.solutionRank, card.rotation])
    );
});

test('publishes a consistent explicit blocking DAG', () => {
    const board = engine.generateChallenge(42);
    const rankById = new Map(board.witness.map((id, rank) => [id, rank]));
    const cardById = new Map(board.cards.map((card) => [card.id, card]));

    board.cards.forEach((card) => {
        card.blockedBy.forEach((blockerId) => {
            assert.ok(cardById.has(blockerId));
            assert.ok(cardById.get(blockerId).blocks.includes(card.id));
            assert.ok(rankById.get(blockerId) < rankById.get(card.id));
        });
    });

    const openingIds = engine.getAvailableCardIds(board);
    assert.equal(openingIds.length, board.metrics.openingSelectable);
    assert.ok(openingIds.every((id) => cardById.get(id).blockedBy.length === 0));
});

test('witness is non-AAA, no-tool solvable, and reaches six occupied slots', () => {
    const board = engine.generateChallenge('slot-pressure');
    const simulation = engine.simulateWitness(board);

    assert.equal(simulation.solved, true);
    assert.equal(simulation.finalSlot, 0);
    assert.equal(simulation.peakSlot, 6);
    assert.ok(board.metrics.longestConsecutiveMotifRun < 3);
    assert.ok(board.metrics.openingSelectable >= 5 && board.metrics.openingSelectable <= 8);
    assert.ok(board.metrics.openingImmediateTriples <= 1);
});

test('validates 365 deterministic daily seeds', () => {
    for (let day = 1; day <= 365; day += 1) {
        const date = new Date(2026, 0, day);
        const seed = engine.seedFromDate(date);
        const board = engine.generateChallenge(seed);
        const validation = engine.validateBoard(board);
        assert.equal(validation.valid, true, `seed ${seed}: ${validation.errors.join(', ')}`);
        assert.equal(validation.metrics.openingSelectable, 7);
        assert.equal(validation.metrics.openingImmediateTriples, 0);
        assert.ok(validation.metrics.openingPairs >= 2);
        assert.equal(validation.metrics.witnessPeakSlot, 6);
        assert.equal(validation.metrics.witnessSolved, true);
        assert.ok(validation.metrics.frontierMedian >= 4 && validation.metrics.frontierMedian <= 9);
        assert.ok(validation.metrics.frontierP90 <= 12);
        assert.ok(validation.metrics.frontierMax <= 15);
        assert.ok(validation.metrics.routeMaxImmediateTriples <= 4);
        assert.ok(validation.metrics.medianThirdCopyGap >= 2);
        assert.ok(validation.metrics.medianThirdCopyGap <= 3);
    }
});
