(function attachChallengeEngine(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ChallengeEngine = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createChallengeEngine() {
    'use strict';

    const VERSION = 1;
    const CARD_COUNT = 126;
    const MOTIF_COUNT = 10;
    const MATCH_SIZE = 3;
    const SLOT_CAPACITY = 7;
    const GRID_SIZE = 17;
    const CENTER_LAYER_COUNTS = [9, 9, 9, 9, 8, 8, 7, 7, 6, 5, 4, 3];
    const RELIEF_LAYER_COUNTS = [4, 3, 3, 2];
    const SIDE_QUEUE_LENGTH = 15;
    const MAX_ASSIGNMENT_ATTEMPTS = 64;

    function hashSeed(value) {
        const text = String(value);
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function normalizeSeed(seed) {
        return typeof seed === 'number' && Number.isFinite(seed)
            ? seed >>> 0
            : hashSeed(seed == null ? 'challenge' : seed);
    }

    function seedFromDate(value) {
        let dateKey;
        if (typeof value === 'string') {
            dateKey = value.slice(0, 10);
        } else {
            const date = value instanceof Date ? value : new Date();
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            dateKey = year + '-' + month + '-' + day;
        }
        return hashSeed(dateKey + '-challenge-v' + VERSION);
    }

    function createRng(seed) {
        let state = normalizeSeed(seed);
        return function random() {
            state = (state + 0x6D2B79F5) >>> 0;
            let value = state;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    function shuffle(values, rng) {
        const result = [...values];
        for (let index = result.length - 1; index > 0; index -= 1) {
            const target = Math.floor(rng() * (index + 1));
            [result[index], result[target]] = [result[target], result[index]];
        }
        return result;
    }

    function generateChallenge(seed) {
        const normalizedSeed = normalizeSeed(seed);
        const layoutRng = createRng(normalizedSeed ^ 0x7F4A7C15);
        const cards = createTopology(layoutRng);
        const assignment = chooseAssignment(cards, normalizedSeed);
        const cardById = new Map(cards.map((card) => [card.id, card]));

        assignment.witness.forEach((id, solutionRank) => {
            const card = cardById.get(id);
            card.solutionRank = solutionRank;
            card.motifIndex = assignment.motifs[solutionRank];
        });

        cards.forEach((card) => {
            card.blocked = card.blockedBy.length > 0;
        });

        const board = {
            version: VERSION,
            seed: normalizedSeed,
            cardCount: CARD_COUNT,
            motifCount: MOTIF_COUNT,
            slotCapacity: SLOT_CAPACITY,
            matchSize: MATCH_SIZE,
            layout: {
                gridSize: GRID_SIZE,
                regions: {
                    center: { cardCount: 84, effectiveLayers: CENTER_LAYER_COUNTS.length },
                    leftQueue: { cardCount: SIDE_QUEUE_LENGTH, effectiveLayers: SIDE_QUEUE_LENGTH },
                    rightQueue: { cardCount: SIDE_QUEUE_LENGTH, effectiveLayers: SIDE_QUEUE_LENGTH },
                    relief: { cardCount: 12, effectiveLayers: RELIEF_LAYER_COUNTS.length }
                }
            },
            cards,
            witness: assignment.witness,
            metrics: null
        };
        board.metrics = measureBoard(board);
        return board;
    }

    function createTopology(rng) {
        const cards = [];
        const centerLayers = [];
        const reliefLayers = [];

        function addCard(region, regionLayer, cell, gridColumn, gridRow) {
            const card = {
                id: 'challenge-card-' + cards.length,
                motifIndex: 0,
                region,
                regionLayer,
                layer: regionLayer,
                cell,
                gridColumn,
                gridRow,
                status: 'pile',
                blocked: true,
                blockedBy: [],
                blocks: [],
                jitterX: (rng() - 0.5) * 3,
                jitterY: (rng() - 0.5) * 3,
                rotation: (rng() - 0.5) * 5,
                solutionRank: -1
            };
            cards.push(card);
            return card;
        }

        CENTER_LAYER_COUNTS.forEach((count, layer) => {
            const positions = makeCenteredPositions(count, layer, 8, 7, rng);
            centerLayers.push(positions.map((position, cell) => addCard(
                'center', layer, cell, position.column, position.row
            )));
        });
        connectAdjacentLayers(centerLayers, rng);

        createSideQueue('leftQueue', 1.25, false);
        createSideQueue('rightQueue', 14.75, true);

        RELIEF_LAYER_COUNTS.forEach((count, layer) => {
            const positions = makeReliefPositions(count, layer, rng);
            reliefLayers.push(positions.map((position, cell) => addCard(
                'relief', layer, cell, position.column, position.row
            )));
        });
        connectAdjacentLayers(reliefLayers, rng);

        return cards;

        function createSideQueue(region, column, mirrored) {
            const queue = [];
            for (let layer = 0; layer < SIDE_QUEUE_LENGTH; layer += 1) {
                const depth = SIDE_QUEUE_LENGTH - 1 - layer;
                const horizontalDrift = (depth % 3) * 0.08 * (mirrored ? -1 : 1);
                queue.push(addCard(
                    region,
                    layer,
                    layer,
                    column + horizontalDrift,
                    3.25 + depth * 0.28
                ));
            }
            for (let layer = 0; layer < queue.length - 1; layer += 1) {
                addBlockingEdge(queue[layer + 1], queue[layer]);
            }
        }
    }

    function makeCenteredPositions(count, layer, centerColumn, centerRow, rng) {
        const shift = layer % 2 === 0 ? 0 : 0.8;
        const offsets = [];
        [-1.6, 0, 1.6].forEach((row) => {
            [-1.6, 0, 1.6].forEach((column) => offsets.push({ column, row, tie: rng() }));
        });
        offsets.sort((first, second) => (
            first.column * first.column + first.row * first.row -
            second.column * second.column - second.row * second.row ||
            first.tie - second.tie
        ));
        return offsets.slice(0, count).map((offset) => ({
            column: centerColumn + offset.column + shift,
            row: centerRow + offset.row + shift
        }));
    }

    function makeReliefPositions(count, layer, rng) {
        const shift = layer % 2 === 0 ? 0 : 0.8;
        const candidates = [
            { column: 7.2, row: 12.8 },
            { column: 8.8, row: 12.8 },
            { column: 7.2, row: 14.4 },
            { column: 8.8, row: 14.4 }
        ].map((position) => ({ ...position, tie: rng() }));
        candidates.sort((first, second) => (
            Math.abs(first.column - 8) + Math.abs(first.row - 13.6) -
            Math.abs(second.column - 8) - Math.abs(second.row - 13.6) ||
            first.tie - second.tie
        ));
        return candidates.slice(0, count).map((pos) => ({
            column: pos.column + shift,
            row: pos.row + shift
        }));
    }

    function connectAdjacentLayers(layers, rng) {
        for (let layer = 0; layer < layers.length - 1; layer += 1) {
            const lower = layers[layer];
            const upper = layers[layer + 1];
            lower.forEach((card) => {
                let blocked = false;
                upper.forEach((upperCard) => {
                    const dx = Math.abs(card.gridColumn - upperCard.gridColumn);
                    const dy = Math.abs(card.gridRow - upperCard.gridRow);
                    if (dx < 1.5 && dy < 1.5) {
                        addBlockingEdge(upperCard, card);
                        blocked = true;
                    }
                });
                
                if (!blocked) {
                    const nearest = [...upper].sort((first, second) => (
                        distanceSquared(card, first) - distanceSquared(card, second) ||
                        first.id.localeCompare(second.id)
                    ));
                    addBlockingEdge(nearest[0], card);
                }
            });
        }
    }

    function distanceSquared(first, second) {
        const column = first.gridColumn - second.gridColumn;
        const row = first.gridRow - second.gridRow;
        return column * column + row * row;
    }

    function addBlockingEdge(blocker, blocked) {
        if (blocked.blockedBy.includes(blocker.id)) return;
        blocked.blockedBy.push(blocker.id);
        blocker.blocks.push(blocked.id);
    }

    function chooseAssignment(cards, seed) {
        const roots = cards.filter((card) => card.blockedBy.length === 0);
        let best = null;

        for (let attempt = 0; attempt < MAX_ASSIGNMENT_ATTEMPTS; attempt += 1) {
            const rng = createRng(seed ^ Math.imul(attempt + 1, 0x9E3779B1));
            const witness = createRandomTopologicalOrder(cards, rng);
            const motifs = createWitnessMotifs(rng);
            const rankById = new Map(witness.map((id, rank) => [id, rank]));
            const openingMotifs = roots.map((card) => motifs[rankById.get(card.id)]);
            const opening = measureMotifs(openingMotifs);
            const score = opening.triples * 100 +
                Math.max(0, 2 - opening.pairs) * 10 +
                Math.abs(5 - opening.distinct);
            const candidate = { witness, motifs, opening, score };
            if (!best || candidate.score < best.score) best = candidate;
            if (opening.triples === 0 && opening.pairs >= 2 && opening.distinct >= 4) return candidate;
        }
        return best;
    }

    function createRandomTopologicalOrder(cards, rng) {
        const indegree = new Map(cards.map((card) => [card.id, card.blockedBy.length]));
        const cardById = new Map(cards.map((card) => [card.id, card]));
        const available = cards.filter((card) => card.blockedBy.length === 0).map((card) => card.id);
        const witness = [];

        while (available.length > 0) {
            const chosenIndex = Math.floor(rng() * available.length);
            const [chosenId] = available.splice(chosenIndex, 1);
            witness.push(chosenId);
            cardById.get(chosenId).blocks.forEach((blockedId) => {
                const nextIndegree = indegree.get(blockedId) - 1;
                indegree.set(blockedId, nextIndegree);
                if (nextIndegree === 0) available.push(blockedId);
            });
        }

        if (witness.length !== cards.length) throw new Error('Challenge topology contains a cycle');
        return witness;
    }

    function createWitnessMotifs(rng) {
        const motifOrder = shuffle(Array.from({ length: MOTIF_COUNT }, (_, index) => index), rng);
        const remainingTriplets = Array(MOTIF_COUNT).fill(4);
        remainingTriplets[motifOrder[0]] = 5;
        remainingTriplets[motifOrder[1]] = 5;
        const sequence = [];

        for (let batch = 0; batch < CARD_COUNT / 9; batch += 1) {
            const tieBreakers = Array.from({ length: MOTIF_COUNT }, () => rng());
            const chosen = Array.from({ length: MOTIF_COUNT }, (_, index) => index)
                .filter((index) => remainingTriplets[index] > 0)
                .sort((first, second) => (
                    remainingTriplets[second] - remainingTriplets[first] ||
                    tieBreakers[first] - tieBreakers[second]
                ))
                .slice(0, 3);
            if (chosen.length !== 3) throw new Error('Unable to distribute motif triplets');
            const [a, b, c] = shuffle(chosen, rng);
            sequence.push(a, b, c, a, b, a, c, b, c);
            chosen.forEach((motif) => { remainingTriplets[motif] -= 1; });
        }

        if (remainingTriplets.some((count) => count !== 0)) {
            throw new Error('Motif distribution is incomplete');
        }
        return sequence;
    }

    function getAvailableCardIds(board, removedIds) {
        const removed = removedIds instanceof Set ? removedIds : new Set(removedIds || []);
        return board.cards
            .filter((card) => !removed.has(card.id) && card.blockedBy.every((id) => removed.has(id)))
            .map((card) => card.id);
    }

    function simulateWitness(board) {
        const cardById = new Map(board.cards.map((card) => [card.id, card]));
        const removed = new Set();
        const slotCounts = Array(board.motifCount).fill(0);
        let slotOccupancy = 0;
        let peakSlot = 0;

        for (let step = 0; step < board.witness.length; step += 1) {
            const id = board.witness[step];
            const card = cardById.get(id);
            if (!card || removed.has(id)) {
                return { solved: false, reason: 'invalid-card', step, peakSlot, finalSlot: slotOccupancy };
            }
            if (!card.blockedBy.every((blockerId) => removed.has(blockerId))) {
                return { solved: false, reason: 'blocked-card', step, peakSlot, finalSlot: slotOccupancy };
            }

            removed.add(id);
            slotCounts[card.motifIndex] += 1;
            slotOccupancy += 1;
            peakSlot = Math.max(peakSlot, slotOccupancy);
            if (slotCounts[card.motifIndex] === MATCH_SIZE) {
                slotCounts[card.motifIndex] = 0;
                slotOccupancy -= MATCH_SIZE;
            } else if (slotOccupancy >= SLOT_CAPACITY) {
                return { solved: false, reason: 'slot-overflow', step, peakSlot, finalSlot: slotOccupancy };
            }
        }

        return {
            solved: removed.size === board.cards.length && slotOccupancy === 0,
            reason: null,
            step: board.witness.length,
            peakSlot,
            finalSlot: slotOccupancy
        };
    }

    function measureBoard(board) {
        const roots = board.cards.filter((card) => card.blockedBy.length === 0);
        const opening = measureMotifs(roots.map((card) => card.motifIndex));
        const motifCounts = Array(board.motifCount).fill(0);
        const cardById = new Map(board.cards.map((card) => [card.id, card]));
        board.cards.forEach((card) => { motifCounts[card.motifIndex] += 1; });
        const simulation = simulateWitness(board);
        const rankMotifs = board.witness.map((id) => cardById.get(id).motifIndex);
        const removed = new Set();
        const frontierSizes = [];
        const visibleTriples = [];
        board.witness.forEach((id) => {
            const available = getAvailableCardIds(board, removed);
            frontierSizes.push(available.length);
            visibleTriples.push(measureMotifs(
                available.map((cardId) => cardById.get(cardId).motifIndex)
            ).triples);
            removed.add(id);
        });
        const thirdCopyGaps = [];
        Array.from({ length: board.motifCount }, (_, motif) => motif).forEach((motif) => {
            const ranks = [];
            rankMotifs.forEach((rankMotif, rank) => {
                if (rankMotif === motif) ranks.push(rank);
            });
            for (let index = 0; index < ranks.length; index += MATCH_SIZE) {
                thirdCopyGaps.push(ranks[index + 2] - ranks[index + 1]);
            }
        });
        let longestRun = 1;
        let currentRun = 1;
        for (let index = 1; index < rankMotifs.length; index += 1) {
            currentRun = rankMotifs[index] === rankMotifs[index - 1] ? currentRun + 1 : 1;
            longestRun = Math.max(longestRun, currentRun);
        }

        return {
            openingSelectable: roots.length,
            openingImmediateTriples: opening.triples,
            openingPairs: opening.pairs,
            openingDistinctMotifs: opening.distinct,
            witnessPeakSlot: simulation.peakSlot,
            witnessSolved: simulation.solved,
            longestConsecutiveMotifRun: longestRun,
            frontierMedian: percentile(frontierSizes, 0.5),
            frontierP90: percentile(frontierSizes, 0.9),
            frontierMax: Math.max(...frontierSizes),
            routeMaxImmediateTriples: Math.max(...visibleTriples),
            medianThirdCopyGap: percentile(thirdCopyGaps, 0.5),
            motifCounts
        };
    }

    function percentile(values, fraction) {
        const sorted = [...values].sort((first, second) => first - second);
        return sorted[Math.floor((sorted.length - 1) * fraction)];
    }

    function measureMotifs(motifs) {
        const counts = new Map();
        motifs.forEach((motif) => counts.set(motif, (counts.get(motif) || 0) + 1));
        return {
            triples: [...counts.values()].reduce((sum, count) => sum + Math.floor(count / MATCH_SIZE), 0),
            pairs: [...counts.values()].filter((count) => count === 2).length,
            distinct: counts.size
        };
    }

    function validateBoard(board) {
        const errors = [];
        const ids = new Set(board.cards.map((card) => card.id));
        const cardById = new Map(board.cards.map((card) => [card.id, card]));
        if (board.cards.length !== CARD_COUNT) errors.push('card-count');
        if (ids.size !== board.cards.length) errors.push('duplicate-card-id');
        if (board.witness.length !== board.cards.length || new Set(board.witness).size !== board.cards.length) {
            errors.push('invalid-witness-coverage');
        }

        board.cards.forEach((card) => {
            card.blockedBy.forEach((blockerId) => {
                const blocker = cardById.get(blockerId);
                if (!blocker) errors.push('missing-blocker:' + blockerId);
                else if (!blocker.blocks.includes(card.id)) errors.push('asymmetric-edge:' + blockerId + ':' + card.id);
            });
            card.blocks.forEach((blockedId) => {
                const blocked = cardById.get(blockedId);
                if (!blocked) errors.push('missing-blocked-card:' + blockedId);
                else if (!blocked.blockedBy.includes(card.id)) errors.push('asymmetric-edge:' + card.id + ':' + blockedId);
            });
        });

        const motifCounts = Array(MOTIF_COUNT).fill(0);
        board.cards.forEach((card) => {
            if (!Number.isInteger(card.motifIndex) || card.motifIndex < 0 || card.motifIndex >= MOTIF_COUNT) {
                errors.push('invalid-motif:' + card.id);
            } else {
                motifCounts[card.motifIndex] += 1;
            }
        });
        if (motifCounts.some((count) => count === 0 || count % MATCH_SIZE !== 0)) {
            errors.push('invalid-motif-counts');
        }

        const simulation = simulateWitness(board);
        if (!simulation.solved) errors.push('unsolved-witness:' + simulation.reason);
        if (simulation.peakSlot !== 6) errors.push('unexpected-witness-peak:' + simulation.peakSlot);
        const metrics = measureBoard(board);
        if (metrics.openingSelectable < 5 || metrics.openingSelectable > 8) errors.push('opening-selectable');
        if (metrics.openingImmediateTriples > 1) errors.push('opening-triples');
        if (metrics.longestConsecutiveMotifRun >= 3) errors.push('consecutive-triplet-assignment');
        return { valid: errors.length === 0, errors, metrics };
    }

    return Object.freeze({
        VERSION,
        CARD_COUNT,
        MOTIF_COUNT,
        MATCH_SIZE,
        SLOT_CAPACITY,
        hashSeed,
        seedFromDate,
        generateChallenge,
        getAvailableCardIds,
        simulateWitness,
        validateBoard
    });
}));
