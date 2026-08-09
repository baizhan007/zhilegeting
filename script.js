const MOTIFS = [
    { key: 'seed1', image: 'assets/memes/seed1.svg', label: '开心婷', tone: 0 },
    { key: 'seed2', image: 'assets/memes/seed2.svg', label: '心动婷', tone: 1 },
    { key: 'seed3', image: 'assets/memes/seed3.svg', label: '淡定婷', tone: 2 },
    { key: 'seed4', image: 'assets/memes/seed4.svg', label: '委屈婷', tone: 3 },
    { key: 'seed5', image: 'assets/memes/seed5.svg', label: '可爱婷', tone: 4 },
    { key: 'seed6', image: 'assets/memes/seed6.svg', label: '心碎婷', tone: 5 },
    { key: 'seed7', image: 'assets/memes/seed7.svg', label: '星星婷', tone: 6 },
    { key: 'seed8', image: 'assets/memes/seed8.svg', label: '眯眼婷', tone: 7 },
    { key: 'seed9', image: 'assets/memes/seed9.svg', label: '皱眉婷', tone: 8 },
    { key: 'seed10', image: 'assets/memes/seed10.svg', label: '墨镜婷', tone: 9 }
];

const STAGES = [
    {
        key: 'warmup',
        name: '热身局',
        kicker: '第 1 关 · 今日挑战',
        layerCounts: [9, 9],
        motifCount: 6,
        gridSize: 7
    },
    {
        key: 'challenge',
        name: '挑战局',
        kicker: '第 2 关 · 今日挑战',
        layerCounts: [126],
        motifCount: 10,
        gridSize: 17
    }
];

const SLOT_CAPACITY = 7;
const STASH_CAPACITY = 3;
const MATCH_SIZE = 3;
const STORAGE = {
    stats: 'zlt-stats-v2',
    save: 'zlt-save-v3',
    sound: 'zlt-sound-v1'
};
const SAVE_VERSION = 4;

const dom = {};
let pile = [];
let slot = [];
let stash = [];
let history = [];
let allCards = [];
let stageIndex = 0;
let score = 0;
let stageStartScore = 0;
let combo = 0;
let lastMatchAt = 0;
let hasUsedUndo = false;
let hasUsedStash = false;
let hasUsedShuffle = false;
let isResolving = false;
let gameActive = false;
let elapsedSeconds = 0;
let startedAt = 0;
let timerInterval = null;
let resizeFrame = null;
let toastTimer = null;
let comboTimer = null;
let soundEnabled = true;
let lifecyclePaused = false;
let challengeBoard = null;
let deferredInstallPrompt = null;
let cheatMode = false;
let dailyRevivesUsed = 0;
let runRevives = 0;
const MAX_REVIVES = 2;
let stats = loadStats();

document.addEventListener('DOMContentLoaded', init);

function init() {
    cacheDom();
    bindEvents();
    soundEnabled = readStorage(STORAGE.sound) !== 'off';
    dailyRevivesUsed = getDailyRevivesUsed();
    // The engine defaults to enabled. Calling setEnabled(true) here would create
    // an AudioContext before a trusted gesture, which Android WebViews can reject.
    if (window.AudioEngine && !soundEnabled) window.AudioEngine.setEnabled(false);
    updateSoundButton();
    refreshHome();
    renderTray(dom.slotArea, [], SLOT_CAPACITY, 'slot');
    renderTray(dom.stashArea, [], STASH_CAPACITY, 'stash');

    const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(positionPileCards);
    });
    resizeObserver.observe(dom.gameArea);

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(() => {});
            
            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) return;
                refreshing = true;
                if (dom.updateButton) {
                    dom.updateButton.hidden = false;
                }
            });
        });
    }

    try {
        if (!localStorage.getItem('zlt-tutorial-v1')) {
            showTutorial();
        }
    } catch {}
}

function cacheDom() {
    dom.body = document.body;
    dom.startScreen = document.getElementById('start-screen');
    dom.gameContainer = document.getElementById('game-container');
    dom.gameArea = document.getElementById('game-area');
    dom.slotArea = document.getElementById('slot-area');
    dom.stashArea = document.getElementById('stash-area');
    dom.stashPanel = document.getElementById('stash-panel');
    dom.timer = document.getElementById('timer');
    dom.score = document.getElementById('score');
    dom.stageName = document.getElementById('stage-name');
    dom.stageKicker = document.getElementById('stage-kicker');
    dom.stageProgress = document.getElementById('stage-progress-bar');
    dom.remainingCount = document.getElementById('remaining-count');
    dom.slotState = document.getElementById('slot-state');
    dom.comboBadge = document.getElementById('combo-badge');
    dom.status = document.getElementById('game-status');
    dom.todayLabel = document.getElementById('today-label');
    dom.statStreak = document.getElementById('stat-streak');
    dom.statWins = document.getElementById('stat-wins');
    dom.statBest = document.getElementById('stat-best');
    dom.startButton = document.getElementById('btn-start-game');
    dom.startButtonLabel = document.getElementById('start-button-label');
    dom.newGameButton = document.getElementById('btn-new-game');
    dom.installButton = document.getElementById('btn-install');
    dom.updateButton = document.getElementById('btn-update');
    dom.helpButton = document.getElementById('btn-help');
    dom.startTitle = document.getElementById('start-title');
    dom.soundButton = document.getElementById('btn-sound');
    dom.homeGameButton = document.getElementById('btn-home-game');
    dom.undoButton = document.getElementById('btn-undo');
    dom.stashButton = document.getElementById('btn-stash');
    dom.shuffleButton = document.getElementById('btn-shuffle');
    dom.modal = document.getElementById('modal');
    dom.modalKicker = document.getElementById('modal-kicker');
    dom.modalTitle = document.getElementById('modal-title');
    dom.modalMessage = document.getElementById('modal-msg');
    dom.resultStats = document.getElementById('result-stats');
    dom.modalPrimary = document.getElementById('modal-primary');
    dom.modalSecondary = document.getElementById('modal-secondary');
    dom.celebration = document.getElementById('celebration');
}

function bindEvents() {
    dom.startButton.addEventListener('click', async () => {
        await primeAudio();
        const saved = loadSavedGame();
        if (saved) resumeGame(saved);
        else startNewRun();
    });
    dom.newGameButton.addEventListener('click', async () => {
        await primeAudio();
        startNewRun();
    });
    dom.soundButton.addEventListener('click', toggleSound);
    dom.homeGameButton.addEventListener('click', returnHome);
    dom.undoButton.addEventListener('click', useUndo);
    dom.stashButton.addEventListener('click', useStash);
    dom.shuffleButton.addEventListener('click', useShuffle);
    dom.installButton.addEventListener('click', installApp);
    dom.updateButton.addEventListener('click', () => window.location.reload());
    dom.helpButton.addEventListener('click', showTutorial);
    
    let titleClicks = 0;
    let titleClickTimer = null;
    dom.startTitle.addEventListener('click', () => {
        titleClicks++;
        clearTimeout(titleClickTimer);
        if (titleClicks >= 5) {
            titleClicks = 0;
            const code = prompt("请输入秘籍开启作弊模式：");
            if (code === "卢本伟广场") {
                cheatMode = true;
                showToast("已开启作弊模式：无限道具！");
                updateGameUi();
            } else if (code !== null) {
                showToast("秘籍错误");
            }
        } else {
            titleClickTimer = setTimeout(() => { titleClicks = 0; }, 1000);
        }
    });
    dom.modal.addEventListener('cancel', (event) => event.preventDefault());

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pauseGameForLifecycle();
        else resumeGameFromLifecycle();
    });
    window.addEventListener('pagehide', pauseGameForLifecycle);
    window.addEventListener('pageshow', resumeGameFromLifecycle);

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        dom.installButton.hidden = false;
    });
}

function pauseGameForLifecycle() {
    if (!gameActive || lifecyclePaused) return;
    lifecyclePaused = true;
    stopBackgroundMusic(false);
    pauseTimer();
    saveGame();
}

function resumeGameFromLifecycle() {
    if (!lifecyclePaused || document.hidden || !gameActive || dom.modal.open) return;
    lifecyclePaused = false;
    startTimer(elapsedSeconds);
    startBackgroundMusic();
}

function startNewRun() {
    clearSavedGame();
    stats.plays += 1;
    persistStats();
    score = 0;
    stageStartScore = 0;
    startStage(0);
}

function getDailyRevivesUsed() {
    const data = parseJson(localStorage.getItem('zlt-daily-revives-v1'));
    if (data && data.date === todayKey()) return data.used || 0;
    return 0;
}

function incrementDailyRevives() {
    const used = getDailyRevivesUsed() + 1;
    try { localStorage.setItem('zlt-daily-revives-v1', JSON.stringify({ date: todayKey(), used })); } catch {}
    return used;
}

function reviveGame() {
    dailyRevivesUsed = incrementDailyRevives();
    runRevives++;
    
    slot.forEach(card => {
        pile.push(card);
        card.el.style.left = card.x + 'px';
        card.el.style.top = card.y + 'px';
        card.el.style.zIndex = String(card.layer + 1);
        card.el.style.setProperty('--card-rotation', card.rotation.toFixed(2) + 'deg');
        card.el.disabled = false;
        if (card.el.parentElement !== dom.gameArea) dom.gameArea.appendChild(card.el);
    });
    slot = [];
    
    const rng = createRng(Date.now() >>> 0);
    if (currentStage().key === 'challenge') {
        shuffleChallengeSafely(rng);
    } else {
        const motifs = shuffleWithRng(pile.map((card) => card.motifIndex), rng);
        pile.forEach((card, index) => { card.motifIndex = motifs[index]; });
        ensureVisibleMatch(rng);
    }
    
    updateOcclusion();
    pile.forEach((card) => paintCard(card));
    renderTray(dom.slotArea, slot, SLOT_CAPACITY, 'slot');
    
    gameActive = true;
    startTimer(Date.now() - elapsedSeconds * 1000);
    updateGameUi();
    playSound('tool');
    vibrate([30, 50, 30]);
    closeDialog();
    saveGame();
}

function startStage(nextStageIndex) {
    pauseTimer();
    closeDialog();
    stageIndex = nextStageIndex;
    stageStartScore = score;
    pile = [];
    slot = [];
    stash = [];
    history = [];
    allCards = [];
    challengeBoard = null;
    combo = 0;
    lastMatchAt = 0;
    hasUsedUndo = false;
    hasUsedStash = false;
    hasUsedShuffle = false;
    isResolving = false;
    elapsedSeconds = 0;
    gameActive = true;
    lifecyclePaused = false;
    runRevives = 0;

    showGameView();
    dom.gameArea.querySelectorAll('.card').forEach((card) => card.remove());
    renderTray(dom.slotArea, slot, SLOT_CAPACITY, 'slot');
    renderTray(dom.stashArea, stash, STASH_CAPACITY, 'stash');
    dom.stashPanel.hidden = true;
    updateStageHeader();
    generateCards();
    updateGameUi();
    startTimer(0);
    saveGame();
    dom.gameArea.focus({ preventScroll: true });
    playSound('start');
    startBackgroundMusic();
}

function showGameView() {
    dom.body.dataset.view = 'game';
    dom.startScreen.hidden = true;
    dom.gameContainer.hidden = false;
}

function returnHome() {
    stopBackgroundMusic();
    if (gameActive && !dom.modal.open) {
        pauseTimer();
        saveGame();
    }
    closeDialog();
    gameActive = false;
    lifecyclePaused = false;
    dom.body.dataset.view = 'start';
    dom.gameContainer.hidden = true;
    dom.startScreen.hidden = false;
    refreshHome();
    dom.startButton.focus({ preventScroll: true });
}

function refreshHome() {
    stats = loadStats();
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('zh-CN', {
        month: 'long',
        day: 'numeric',
        weekday: 'short'
    }).format(now);
    dom.todayLabel.textContent = formatted + ' · 今日挑战';
    dom.statStreak.textContent = stats.streak + ' 天';
    dom.statWins.textContent = stats.wins + ' 次';
    dom.statBest.textContent = stats.bestSeconds == null ? '--:--' : formatTime(stats.bestSeconds);

    const saved = loadSavedGame();
    dom.startButtonLabel.textContent = saved
        ? '继续第 ' + (saved.stageIndex + 1) + ' 关'
        : (stats.lastWinDate === todayKey() ? '再玩今日挑战' : '开始今日挑战');
    dom.newGameButton.hidden = !saved;

    const routeSteps = document.querySelectorAll('.route-step');
    routeSteps.forEach((step, index) => {
        const activeIndex = saved ? saved.stageIndex : (stats.lastWinDate === todayKey() ? 1 : 0);
        step.classList.toggle('is-active', index <= activeIndex);
    });
}

function updateStageHeader() {
    const stage = currentStage();
    dom.stageName.textContent = stage.name;
    dom.stageKicker.textContent = stage.kicker;
    dom.score.textContent = score + ' 分';
}

function generateCards() {
    const stage = currentStage();
    if (stage.key === 'challenge' && window.ChallengeEngine) {
        challengeBoard = window.ChallengeEngine.generateChallenge(
            window.ChallengeEngine.seedFromDate(todayKey())
        );
        allCards = challengeBoard.cards.map((card) => ({
            ...card,
            x: 0,
            y: 0,
            el: null
        }));
        allCards.forEach((card) => {
            card.el = createCardElement(card);
            pile.push(card);
            dom.gameArea.appendChild(card.el);
        });
        positionPileCards();
        return;
    }

    const rng = createRng(hashString(todayKey() + '-' + stage.key));
    const layouts = createLayerLayouts(stage, rng);
    let cardIndex = 0;

    stage.layerCounts.forEach((count, layer) => {
        layouts[layer].slice(0, count).forEach((gridPosition, cell) => {
            const card = {
                id: stage.key + '-card-' + cardIndex,
                motifIndex: 0,
                layer,
                cell,
                gridColumn: gridPosition.column,
                gridRow: gridPosition.row,
                status: 'pile',
                blocked: false,
                jitterX: (rng() - 0.5) * 4,
                jitterY: (rng() - 0.5) * 4,
                rotation: (rng() - 0.5) * 6,
                x: 0,
                y: 0,
                el: null
            };
            allCards.push(card);
            cardIndex += 1;
        });
    });

    assignGuaranteedMotifs(allCards, stage.motifCount, rng);
    allCards.forEach((card) => {
        card.el = createCardElement(card);
        pile.push(card);
        dom.gameArea.appendChild(card.el);
    });
    positionPileCards();
}

function assignGuaranteedMotifs(cards, motifCount, rng) {
    const remaining = [...cards];
    const solutionOrder = [];

    while (remaining.length > 0) {
        const available = remaining.filter((card) => !remaining.some((other) => (
            other.layer > card.layer && logicalOverlap(card, other)
        )));
        const chosen = available[Math.floor(rng() * available.length)];
        solutionOrder.push(chosen);
        remaining.splice(remaining.indexOf(chosen), 1);
    }

    const tripletMotifs = [];
    const tripletCount = cards.length / MATCH_SIZE;
    for (let index = 0; index < tripletCount; index += 1) {
        tripletMotifs.push(index % motifCount);
    }
    shuffleWithRng(tripletMotifs, rng);

    solutionOrder.forEach((card, index) => {
        card.solutionRank = index;
        card.motifIndex = tripletMotifs[Math.floor(index / MATCH_SIZE)];
    });
}

function createLayerLayouts(stage, rng) {
    const center = (stage.gridSize - 1) / 2;
    const parities = [
        { column: 0, row: 0 },
        { column: 1, row: 0 },
        { column: 0, row: 1 },
        { column: 1, row: 1 },
        { column: 0, row: 0 },
        { column: 1, row: 0 }
    ];

    return stage.layerCounts.map((count, layer) => {
        const parity = parities[layer % parities.length];
        const cells = [];
        for (let row = parity.row; row < stage.gridSize; row += 2) {
            for (let column = parity.column; column < stage.gridSize; column += 2) {
                cells.push({
                    column,
                    row,
                    distance: Math.abs(column - center) + Math.abs(row - center) + rng() * 1.8
                });
            }
        }
        cells.sort((first, second) => first.distance - second.distance);
        return shuffleWithRng(cells.slice(0, Math.max(count, Math.min(cells.length, count + 4))), rng)
            .slice(0, count)
            .map(({ column, row }) => ({ column, row }));
    });
}

function createCardElement(card) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    button.id = card.id;
    button.dataset.location = card.status;
    button.dataset.layer = String(card.layer);
    button.addEventListener('click', () => handleCardClick(card));
    paintCard(card, button);
    return button;
}

function paintCard(card, element = card.el) {
    const motif = MOTIFS[card.motifIndex];
    element.dataset.tone = String(motif.tone);
    element.setAttribute('aria-label', motif.label);
    element.replaceChildren();

    const face = document.createElement('img');
    face.className = 'card-face';
    face.src = motif.image;
    face.alt = '';
    face.draggable = false;
    face.setAttribute('aria-hidden', 'true');
    element.appendChild(face);
}

function positionPileCards() {
    if (dom.gameContainer.hidden || pile.length === 0) return;
    const sample = pile.find((card) => card.status === 'pile')?.el;
    if (!sample) return;

    const cardRect = sample.getBoundingClientRect();
    const areaRect = dom.gameArea.getBoundingClientRect();
    const stage = currentStage();
    const cardWidth = cardRect.width;
    const cardHeight = cardRect.height;
    const isChallenge = stage.key === 'challenge' && challengeBoard;
    const horizontalPadding = isChallenge ? 6 : 12;
    const topPadding = areaRect.height < 300 ? 26 : (isChallenge ? 30 : 38);
    const bottomPadding = isChallenge ? 4 : 10;
    const steps = stage.gridSize - 1;
    const availableColumnStep = (areaRect.width - horizontalPadding * 2 - cardWidth) / steps;
    const availableRowStep = (areaRect.height - topPadding - bottomPadding - cardHeight) / steps;
    const columnStep = isChallenge
        ? Math.max(1, Math.min(cardWidth * 0.56, availableColumnStep))
        : clamp(availableColumnStep, cardWidth * 0.54, cardWidth * 0.82);
    const rowStep = isChallenge
        ? Math.max(1, Math.min(cardHeight * 0.72, availableRowStep))
        : clamp(availableRowStep, cardHeight * 0.53, cardHeight * 0.72);
    const clusterWidth = cardWidth + columnStep * steps;
    const clusterHeight = cardHeight + rowStep * steps;
    const baseX = (areaRect.width - clusterWidth) / 2;
    const baseY = topPadding + Math.max(0, (areaRect.height - topPadding - bottomPadding - clusterHeight) / 3);

    pile.forEach((card) => {
        card.x = baseX + card.gridColumn * columnStep + card.jitterX;
        card.y = baseY + card.gridRow * rowStep + card.jitterY;
        placeCardInPile(card);
    });
    updateOcclusion();
}

function placeCardInPile(card) {
    if (!card.el) card.el = createCardElement(card);
    card.el.dataset.location = 'pile';
    card.el.style.left = card.x + 'px';
    card.el.style.top = card.y + 'px';
    card.el.style.zIndex = String(card.layer + 1);
    card.el.style.setProperty('--card-rotation', card.rotation.toFixed(2) + 'deg');
    if (card.el.parentElement !== dom.gameArea) dom.gameArea.appendChild(card.el);
}

function updateOcclusion() {
    if (pile.length === 0) return;
    const sample = pile[0].el;
    const cardRect = sample.getBoundingClientRect();
    const width = cardRect.width;
    const height = cardRect.height;

    const pileIds = new Set(pile.map((card) => card.id));
    pile.forEach((card) => {
        card.blocked = Array.isArray(card.blockedBy)
            ? card.blockedBy.some((blockerId) => pileIds.has(blockerId))
            : pile.some((other) => (
                other.layer > card.layer && hasMeaningfulOverlap(card, other, width, height)
            ));
        card.el.classList.toggle('blocked', card.blocked);
        card.el.disabled = card.blocked || isResolving;
        card.el.setAttribute(
            'aria-label',
            MOTIFS[card.motifIndex].label + (card.blocked ? '，被遮住' : '，可选')
        );
    });
}

function logicalOverlap(first, second) {
    return Math.abs(first.gridColumn - second.gridColumn) <= 1 &&
        Math.abs(first.gridRow - second.gridRow) <= 1;
}

function hasMeaningfulOverlap(first, second, width, height) {
    const overlapWidth = Math.min(first.x + width, second.x + width) - Math.max(first.x, second.x);
    const overlapHeight = Math.min(first.y + height, second.y + height) - Math.max(first.y, second.y);
    return overlapWidth > width * 0.1 && overlapHeight > height * 0.1;
}

function handleCardClick(card) {
    if (isResolving || !['pile', 'stash'].includes(card.status)) return;
    if (card.status === 'pile' && card.blocked) return;
    if (slot.length >= SLOT_CAPACITY) return;

    wakeAudioAndPlay('tap');
    vibrate(8);
    const sourceRect = card.el.getBoundingClientRect();
    const source = card.status;
    history.push({ action: 'pick', cardId: card.id, source });

    if (source === 'pile') {
        pile = pile.filter((item) => item.id !== card.id);
    } else {
        stash = stash.filter((item) => item.id !== card.id);
        renderTray(dom.stashArea, stash, STASH_CAPACITY, 'stash');
        dom.stashPanel.hidden = stash.length === 0;
    }

    card.status = 'slot';
    slot.push(card);
    slot.sort((first, second) => first.motifIndex - second.motifIndex);
    renderTray(dom.slotArea, slot, SLOT_CAPACITY, 'slot');
    animateCardMove(card.el, sourceRect);
    updateOcclusion();
    updateGameUi();

    const match = findMatch();
    if (match.length === MATCH_SIZE) {
        resolveMatch(match);
    } else {
        checkGameState();
        updateToolsStatus();
        saveGame();
    }
}

function findMatch() {
    for (let index = 0; index <= slot.length - MATCH_SIZE; index += 1) {
        const candidate = slot.slice(index, index + MATCH_SIZE);
        if (candidate.every((card) => card.motifIndex === candidate[0].motifIndex)) {
            return candidate;
        }
    }
    return [];
}

function resolveMatch(match) {
    isResolving = true;
    match.forEach((card) => card.el.classList.add('removing'));
    updateToolsStatus();
    updateOcclusion();
    playSound('match');
    vibrate([12, 35, 18]);

    const now = Date.now();
    combo = now - lastMatchAt <= 4200 ? combo + 1 : 1;
    lastMatchAt = now;
    score += 100 * combo + stageIndex * 25;
    updateCombo();

    window.setTimeout(() => {
        const label = MOTIFS[match[0].motifIndex].label;
        slot = slot.filter((card) => !match.includes(card));
        match.forEach((card) => {
            card.status = 'removed';
            card.el.remove();
        });
        history = [];
        isResolving = false;
        renderTray(dom.slotArea, slot, SLOT_CAPACITY, 'slot');
        updateOcclusion();
        updateGameUi();
        showToast('消除「' + label + '」 +' + (100 * combo + stageIndex * 25));
        checkGameState();
        updateToolsStatus();
        saveGame();
    }, 240);
}

function updateCombo() {
    window.clearTimeout(comboTimer);
    dom.comboBadge.hidden = combo < 2;
    if (combo >= 2) {
        dom.comboBadge.textContent = '连击 ×' + combo;
        comboTimer = window.setTimeout(() => {
            dom.comboBadge.hidden = true;
            combo = 0;
        }, 4200);
    }
}

function renderTray(container, cards, capacity, location) {
    container.replaceChildren();
    for (let index = 0; index < capacity; index += 1) {
        if (index < cards.length) {
            const card = cards[index];
            card.el.classList.remove('blocked', 'removing');
            card.el.dataset.location = location;
            card.el.style.left = '';
            card.el.style.top = '';
            card.el.style.zIndex = '';
            card.el.style.removeProperty('--card-rotation');
            card.el.disabled = location === 'slot' || isResolving;
            card.el.setAttribute(
                'aria-label',
                MOTIFS[card.motifIndex].label + (location === 'stash' ? '，可放回卡槽' : '，已在卡槽')
            );
            container.appendChild(card.el);
        } else {
            const placeholder = document.createElement('span');
            placeholder.className = 'slot-placeholder';
            if (location === 'slot' && cards.length >= 5) placeholder.classList.add('is-danger');
            placeholder.setAttribute('aria-hidden', 'true');
            container.appendChild(placeholder);
        }
    }
}

function useUndo() {
    if ((!cheatMode && hasUsedUndo) || history.length === 0 || isResolving) return;
    const lastAction = history.pop();
    const card = allCards.find((item) => item.id === lastAction.cardId);
    if (!card || card.status !== 'slot') return;

    const sourceRect = card.el.getBoundingClientRect();
    slot = slot.filter((item) => item.id !== card.id);
    card.status = lastAction.source;
    if (lastAction.source === 'pile') {
        pile.push(card);
        placeCardInPile(card);
        updateOcclusion();
    } else {
        stash.push(card);
        renderTray(dom.stashArea, stash, STASH_CAPACITY, 'stash');
        dom.stashPanel.hidden = false;
    }

    hasUsedUndo = true;
    renderTray(dom.slotArea, slot, SLOT_CAPACITY, 'slot');
    animateCardMove(card.el, sourceRect);
    updateGameUi();
    updateToolsStatus();
    showToast('已撤回上一张');
    wakeAudioAndPlay('tool');
    saveGame();
}

function useStash() {
    if ((!cheatMode && hasUsedStash) || slot.length === 0 || stash.length > 0 || isResolving) return;
    const count = Math.min(STASH_CAPACITY, slot.length);
    stash = slot.splice(0, count);
    stash.forEach((card) => { card.status = 'stash'; });
    hasUsedStash = true;
    history = [];
    dom.stashPanel.hidden = false;
    renderTray(dom.slotArea, slot, SLOT_CAPACITY, 'slot');
    renderTray(dom.stashArea, stash, STASH_CAPACITY, 'stash');
    updateGameUi();
    updateToolsStatus();
    showToast('已移出 ' + count + ' 张');
    wakeAudioAndPlay('tool');
    vibrate(12);
    saveGame();
}

function useShuffle() {
    if ((!cheatMode && hasUsedShuffle) || pile.length === 0 || isResolving) return;
    const rng = createRng(Date.now() >>> 0);
    if (currentStage().key === 'challenge') {
        if (!shuffleChallengeSafely(rng)) {
            showToast('当前牌路无需重排');
            return;
        }
    } else {
        const motifs = shuffleWithRng(pile.map((card) => card.motifIndex), rng);
        pile.forEach((card, index) => { card.motifIndex = motifs[index]; });
        ensureVisibleMatch(rng);
    }
    pile.forEach((card) => paintCard(card));
    if (currentStage().key === 'challenge' && stash.length > 0) {
        stash.forEach((card) => paintCard(card));
        renderTray(dom.stashArea, stash, STASH_CAPACITY, 'stash');
    }
    hasUsedShuffle = true;
    history = [];
    updateOcclusion();
    updateToolsStatus();
    showToast('牌面已重新排列');
    wakeAudioAndPlay('shuffle');
    vibrate([10, 25, 10]);
    saveGame();
}

function shuffleChallengeSafely(rng) {
    const orderedCards = [
        ...stash.slice().sort((first, second) => first.solutionRank - second.solutionRank),
        ...pile.slice().sort((first, second) => first.solutionRank - second.solutionRank)
    ];
    const remainingCounts = new Map();
    orderedCards.forEach((card) => {
        remainingCounts.set(card.motifIndex, (remainingCounts.get(card.motifIndex) || 0) + 1);
    });

    const trayCounts = new Map();
    slot.forEach((card) => trayCounts.set(card.motifIndex, (trayCounts.get(card.motifIndex) || 0) + 1));
    const sequence = [];

    [...trayCounts.entries()]
        .sort((first, second) => second[1] - first[1] || first[0] - second[0])
        .forEach(([motif, count]) => {
            const needed = MATCH_SIZE - count;
            if ((remainingCounts.get(motif) || 0) < needed) return;
            for (let index = 0; index < needed; index += 1) sequence.push(motif);
            remainingCounts.set(motif, remainingCounts.get(motif) - needed);
        });

    const tripletGroups = [];
    remainingCounts.forEach((count, motif) => {
        if (count % MATCH_SIZE !== 0) return;
        for (let index = 0; index < count / MATCH_SIZE; index += 1) tripletGroups.push(motif);
    });
    shuffleWithRng(tripletGroups, rng);

    while (tripletGroups.length >= 3) {
        const first = tripletGroups.shift();
        const secondIndex = tripletGroups.findIndex((motif) => motif !== first);
        const second = tripletGroups.splice(secondIndex >= 0 ? secondIndex : 0, 1)[0];
        const thirdIndex = tripletGroups.findIndex((motif) => motif !== first && motif !== second);
        const third = tripletGroups.splice(thirdIndex >= 0 ? thirdIndex : 0, 1)[0];
        sequence.push(first, second, first, third, second, first, second, third, third);
    }
    if (tripletGroups.length === 2) {
        const [first, second] = tripletGroups;
        sequence.push(first, second, first, second, first, second);
    } else if (tripletGroups.length === 1) {
        sequence.push(tripletGroups[0], tripletGroups[0], tripletGroups[0]);
    }

    if (sequence.length !== orderedCards.length) return false;
    orderedCards.forEach((card, index) => { card.motifIndex = sequence[index]; });
    return true;
}

function ensureVisibleMatch(rng) {
    updateOcclusion();
    const visible = shuffleWithRng(pile.filter((card) => !card.blocked), rng);
    if (visible.length < MATCH_SIZE) return;
    const counts = new Map();
    pile.forEach((card) => counts.set(card.motifIndex, (counts.get(card.motifIndex) || 0) + 1));
    const motif = [...counts.entries()].find(([, count]) => count >= MATCH_SIZE)?.[0];
    if (motif == null) return;

    visible.slice(0, MATCH_SIZE).forEach((target) => {
        if (target.motifIndex === motif) return;
        const donor = pile.find((card) => (
            !visible.slice(0, MATCH_SIZE).includes(card) && card.motifIndex === motif
        ));
        if (!donor) return;
        const previous = target.motifIndex;
        target.motifIndex = motif;
        donor.motifIndex = previous;
    });
}

function updateGameUi() {
    const total = allCards.length || currentStage().layerCounts.reduce((sum, count) => sum + count, 0);
    const removed = allCards.filter((card) => card.status === 'removed').length;
    dom.remainingCount.textContent = pile.length + ' 张';
    dom.slotState.textContent = slot.length + ' / ' + SLOT_CAPACITY;
    dom.score.textContent = score + ' 分';
    dom.stageProgress.style.width = (removed / total * 100) + '%';
    updateToolsStatus();
}

function updateToolsStatus() {
    dom.undoButton.disabled = (!cheatMode && hasUsedUndo) || history.length === 0 || isResolving;
    dom.stashButton.disabled = (!cheatMode && hasUsedStash) || slot.length === 0 || stash.length > 0 || isResolving;
    dom.shuffleButton.disabled = (!cheatMode && hasUsedShuffle) || pile.length === 0 || isResolving;
    dom.undoButton.querySelector('small').textContent = (hasUsedUndo && !cheatMode) ? '已用' : (cheatMode ? '∞' : '1');
    dom.stashButton.querySelector('small').textContent = (hasUsedStash && !cheatMode) ? '已用' : (cheatMode ? '∞' : '1');
    dom.shuffleButton.querySelector('small').textContent = (hasUsedShuffle && !cheatMode) ? '已用' : (cheatMode ? '∞' : '1');
}

function checkGameState() {
    if (pile.length === 0 && slot.length === 0 && stash.length === 0) {
        if (stageIndex === 0) showStageComplete();
        else showWin();
        return;
    }
    if (slot.length >= SLOT_CAPACITY) showLoss();
}

function showStageComplete() {
    pauseTimer();
    gameActive = false;
    score += 500;
    updateGameUi();
    clearSavedGame();
    playSound('stage');
    vibrate([20, 50, 30]);
    configureModal({
        kicker: '第 1 关通过',
        title: '热身完成',
        message: '真正的今日挑战，开始了。',
        statsHtml: '<span>热身用时<strong>' + formatTime(elapsedSeconds) + '</strong></span><span>当前得分<strong>' + score + '</strong></span>',
        primaryText: '进入第 2 关',
        onPrimary: () => startStage(1)
    });
}

function showWin() {
    pauseTimer();
    gameActive = false;
    score += Math.max(0, 1200 - elapsedSeconds * 2);
    updateStatsAfterWin();
    clearSavedGame();
    updateGameUi();
    playSound('win');
    vibrate([25, 45, 25, 45, 60]);
    launchCelebration();
    configureModal({
        kicker: '今日挑战完成',
        title: '婷婷支棱住了',
        message: '两关清空，今天的漂亮战绩已记录。',
        statsHtml: '<span>挑战用时<strong>' + formatTime(elapsedSeconds) + '</strong></span><span>最终得分<strong>' + score + '</strong></span>' + (runRevives > 0 ? '<span>复活次数<strong>' + runRevives + ' 次</strong></span>' : ''),
        primaryText: '分享战绩',
        onPrimary: shareResult,
        secondaryText: '返回封面',
        onSecondary: returnHome
    });
}

function showLoss() {
    pauseTimer();
    gameActive = false;
    clearSavedGame();
    updateGameUi();
    playSound('loss');
    vibrate([70, 50, 70]);
    
    const canRevive = dailyRevivesUsed < MAX_REVIVES;
    const reviveMsg = canRevive 
        ? '剩 ' + pile.length + ' 张，挑战失败。\n今日还剩 ' + (MAX_REVIVES - dailyRevivesUsed) + ' 次免费洗牌复活机会。' 
        : '剩 ' + pile.length + ' 张，挑战失败。\n今日复活次数已用完。';

    configureModal({
        kicker: currentStage().kicker,
        title: '差一点支棱住',
        message: reviveMsg,
        statsHtml: '<span>本次用时<strong>' + formatTime(elapsedSeconds) + '</strong></span><span>当前得分<strong>' + score + '</strong></span>',
        primaryText: canRevive ? '洗牌复活' : '再来一次',
        onPrimary: () => {
            if (canRevive) {
                reviveGame();
            } else {
                score = stageStartScore;
                startStage(stageIndex);
            }
        },
        secondaryText: canRevive ? '重新开始' : '返回封面',
        onSecondary: () => {
            if (canRevive) {
                score = stageStartScore;
                startStage(stageIndex);
            } else {
                returnHome();
            }
        }
    });
}

function configureModal(options) {
    stopBackgroundMusic(false);
    dom.modalKicker.textContent = options.kicker;
    dom.modalTitle.textContent = options.title;
    dom.modalMessage.textContent = options.message;
    dom.resultStats.hidden = !options.statsHtml;
    dom.resultStats.innerHTML = options.statsHtml || '';
    dom.modalPrimary.textContent = options.primaryText;
    dom.modalPrimary.onclick = options.onPrimary;
    dom.modalSecondary.hidden = !options.secondaryText;
    dom.modalSecondary.textContent = options.secondaryText || '';
    dom.modalSecondary.onclick = options.onSecondary || null;
    if (!dom.modal.open) dom.modal.showModal();
    dom.modalPrimary.focus({ preventScroll: true });
}

function closeDialog() {
    if (dom.modal.open) {
        dom.modal.close();
    }
}

function updateStatsAfterWin() {
    const today = todayKey();
    if (stats.lastWinDate !== today) {
        const dayGap = stats.lastWinDate ? differenceInDays(stats.lastWinDate, today) : null;
        stats.streak = dayGap === 1 ? stats.streak + 1 : 1;
        stats.wins += 1;
        stats.lastWinDate = today;
    }
    stats.bestSeconds = stats.bestSeconds == null
        ? elapsedSeconds
        : Math.min(stats.bestSeconds, elapsedSeconds);
    persistStats();
}

function startTimer(initialSeconds) {
    pauseTimer(false);
    elapsedSeconds = initialSeconds;
    startedAt = Date.now() - initialSeconds * 1000;
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 250);
}

function pauseTimer(update = true) {
    if (update && timerInterval) updateTimer();
    window.clearInterval(timerInterval);
    timerInterval = null;
}

function updateTimer() {
    elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    dom.timer.textContent = formatTime(elapsedSeconds);
    dom.timer.dateTime = 'PT' + elapsedSeconds + 'S';
}

function showToast(message) {
    window.clearTimeout(toastTimer);
    dom.status.textContent = message;
    dom.status.classList.add('is-visible');
    toastTimer = window.setTimeout(() => dom.status.classList.remove('is-visible'), 1800);
}

function animateCardMove(element, fromRect) {
    if (!element.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    requestAnimationFrame(() => {
        const toRect = element.getBoundingClientRect();
        const deltaX = fromRect.left - toRect.left;
        const deltaY = fromRect.top - toRect.top;
        element.animate([
            { transform: 'translate(' + deltaX + 'px, ' + deltaY + 'px) scale(1.04)', zIndex: 220 },
            { transform: 'translate(0, 0) scale(1)', zIndex: 220 }
        ], { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    });
}

function launchCelebration() {
    dom.celebration.replaceChildren();
    const colors = ['#d95f45', '#247f78', '#f2bf4b', '#ffffff'];
    for (let index = 0; index < 36; index += 1) {
        const piece = document.createElement('span');
        piece.className = 'confetti';
        piece.style.left = (index * 29 % 100) + '%';
        piece.style.setProperty('--confetti-color', colors[index % colors.length]);
        piece.style.setProperty('--confetti-drift', ((index % 7) - 3) * 12 + 'vw');
        piece.style.animationDelay = (index % 9) * 45 + 'ms';
        dom.celebration.appendChild(piece);
    }
    window.setTimeout(() => dom.celebration.replaceChildren(), 2600);
}

async function toggleSound() {
    soundEnabled = !soundEnabled;
    writeStorage(STORAGE.sound, soundEnabled ? 'on' : 'off');
    updateSoundButton();
    if (!window.AudioEngine) return;
    const ready = await window.AudioEngine.setEnabled(soundEnabled);
    if (!soundEnabled) return;
    if (ready) playSound('tool');
    if (gameActive && !dom.modal.open) startBackgroundMusic();
}

function updateSoundButton() {
    dom.body.dataset.sound = soundEnabled ? 'on' : 'off';
    const label = soundEnabled ? '关闭音乐和音效' : '打开音乐和音效';
    dom.soundButton.setAttribute('aria-label', label);
    dom.soundButton.title = label;
}

async function primeAudio() {
    if (!soundEnabled || !window.AudioEngine) return false;
    return window.AudioEngine.unlock();
}

function wakeAudioAndPlay(type) {
    if (!soundEnabled || !window.AudioEngine) return;
    window.AudioEngine.wakeAndPlay(type).then((ready) => {
        if (ready && gameActive && !dom.modal.open) startBackgroundMusic();
    });
}

function playSound(type) {
    if (!soundEnabled || !window.AudioEngine) return;
    window.AudioEngine.play(type);
}

function startBackgroundMusic() {
    if (!soundEnabled || !gameActive || dom.modal.open || !window.AudioEngine) return;
    window.AudioEngine.startMusic();
}

function stopBackgroundMusic(reset = true) {
    if (!window.AudioEngine) return;
    window.AudioEngine.stopMusic({ reset });
}

function vibrate(pattern) {
    if ('vibrate' in navigator) navigator.vibrate(pattern);
}

async function installApp() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    dom.installButton.hidden = true;
}

function saveGame() {
    if (!gameActive || isResolving) return;
    const cards = allCards.map((card) => {
        const copy = { ...card };
        delete copy.el;
        return copy;
    });
    const saved = {
        version: SAVE_VERSION,
        date: todayKey(),
        stageIndex,
        score,
        stageStartScore,
        elapsedSeconds,
        cards,
        pileIds: pile.map((card) => card.id),
        slotIds: slot.map((card) => card.id),
        stashIds: stash.map((card) => card.id),
        history,
        hasUsedUndo,
        hasUsedStash,
        hasUsedShuffle
    };
    writeStorage(STORAGE.save, JSON.stringify(saved));
}

function loadSavedGame() {
    const saved = parseJson(readStorage(STORAGE.save));
    if (!saved || saved.version !== SAVE_VERSION || saved.date !== todayKey() || !STAGES[saved.stageIndex]) {
        if (saved) clearSavedGame();
        return null;
    }
    return saved;
}

function resumeGame(saved) {
    closeDialog();
    stageIndex = saved.stageIndex;
    score = saved.score;
    stageStartScore = saved.stageStartScore;
    elapsedSeconds = saved.elapsedSeconds;
    history = saved.history || [];
    hasUsedUndo = saved.hasUsedUndo;
    hasUsedStash = saved.hasUsedStash;
    hasUsedShuffle = saved.hasUsedShuffle;
    isResolving = false;
    gameActive = true;
    lifecyclePaused = false;
    combo = 0;
    lastMatchAt = 0;
    runRevives = saved.runRevives || 0;

    const cardsById = new Map();
    allCards = saved.cards.map((data) => {
        const card = { ...data, el: null };
        if (card.status !== 'removed') card.el = createCardElement(card);
        cardsById.set(card.id, card);
        return card;
    });
    challengeBoard = currentStage().key === 'challenge'
        ? { layout: { gridSize: currentStage().gridSize } }
        : null;
    pile = saved.pileIds.map((id) => cardsById.get(id)).filter(Boolean);
    slot = saved.slotIds.map((id) => cardsById.get(id)).filter(Boolean);
    stash = saved.stashIds.map((id) => cardsById.get(id)).filter(Boolean);

    showGameView();
    dom.gameArea.querySelectorAll('.card').forEach((card) => card.remove());
    pile.forEach((card) => dom.gameArea.appendChild(card.el));
    renderTray(dom.slotArea, slot, SLOT_CAPACITY, 'slot');
    renderTray(dom.stashArea, stash, STASH_CAPACITY, 'stash');
    dom.stashPanel.hidden = stash.length === 0;
    updateStageHeader();
    positionPileCards();
    updateGameUi();
    startTimer(elapsedSeconds);
    startBackgroundMusic();
    showToast('已继续今日牌局');
    dom.gameArea.focus({ preventScroll: true });
}

function clearSavedGame() {
    removeStorage(STORAGE.save);
}

function loadStats() {
    const saved = parseJson(readStorage(STORAGE.stats));
    return {
        plays: Number(saved?.plays) || 0,
        wins: Number(saved?.wins) || 0,
        streak: Number(saved?.streak) || 0,
        bestSeconds: Number.isFinite(saved?.bestSeconds) ? saved.bestSeconds : null,
        lastWinDate: saved?.lastWinDate || null
    };
}

function persistStats() {
    writeStorage(STORAGE.stats, JSON.stringify(stats));
}

function currentStage() {
    return STAGES[stageIndex];
}

function todayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
}

function differenceInDays(fromKey, toKey) {
    const from = new Date(fromKey + 'T00:00:00');
    const to = new Date(toKey + 'T00:00:00');
    return Math.round((to - from) / 86400000);
}

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return minutes + ':' + seconds;
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createRng(seed) {
    let state = seed || 1;
    return () => {
        state += 0x6D2B79F5;
        let result = state;
        result = Math.imul(result ^ result >>> 15, result | 1);
        result ^= result + Math.imul(result ^ result >>> 7, result | 61);
        return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
}

function shuffleWithRng(items, rng) {
    for (let index = items.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(rng() * (index + 1));
        [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
    }
    return items;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function readStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Storage can be unavailable in privacy mode; the game remains fully playable.
    }
}

function removeStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch {
        // Ignore unavailable storage.
    }
}

function shareResult() {
    let text = '支了个婷 ' + todayKey() + '\n';
    text += '挑战用时：' + formatTime(elapsedSeconds) + '\n';
    text += '最终得分：' + score + '\n';
    text += '连续通关：' + stats.streak + ' 天';
    if (runRevives > 0) text += '\n(复活 ' + runRevives + ' 次)';
    
    if (navigator.share) {
        navigator.share({ title: '支了个婷', text: text }).catch(() => {});
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('战绩已复制到剪贴板');
        }).catch(() => {
            showToast('复制失败');
        });
    } else {
        showToast('无法调用分享功能');
    }
}

function parseJson(value) {
    try {
        return value ? JSON.parse(value) : null;
    } catch {
        return null;
    }
}

function showTutorial() {
    configureModal({
        kicker: '支了个婷',
        title: '玩法说明',
        message: '1. 点击卡牌将其移入下方卡槽。\n2. 卡槽内凑齐 3 张相同卡牌即可消除。\n3. 卡槽最多容纳 7 张牌，装满即挑战失败。\n4. 暂存区可以将卡槽中的 3 张牌临时移出。\n5. 每天的挑战局均通过引擎校验，保证绝对有解！',
        primaryText: '我知道了',
        onPrimary: () => {
            try { localStorage.setItem('zlt-tutorial-v1', '1'); } catch {}
            closeDialog();
        }
    });
}
