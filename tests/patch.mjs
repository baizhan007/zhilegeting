import fs from 'node:fs';

let c = fs.readFileSync('script.js', 'utf8');

c = c.replace('const SAVE_VERSION = 3;', 'const SAVE_VERSION = 4;');

c = c.replace('let cheatMode = false;', `let cheatMode = false;\nlet dailyRevivesUsed = 0;\nlet runRevives = 0;\nconst MAX_REVIVES = 2;`);

c = c.replace('function startStage(nextStageIndex) {', `function getDailyRevivesUsed() {
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

function startStage(nextStageIndex) {`);

c = c.replace('    lifecyclePaused = false;\n\n    showGameView();', `    lifecyclePaused = false;\n    runRevives = 0;\n\n    showGameView();`);

c = c.replace(`function showLoss() {
    pauseTimer();
    gameActive = false;
    clearSavedGame();
    updateGameUi();
    playSound('loss');
    vibrate([50, 100, 50]);
    configureModal({
        kicker: '挑战失败',
        title: '差一点点',
        message: '卡槽已满，再试一次吧。',
        statsHtml: '<span>本次用时<strong>' + formatTime(elapsedSeconds) + '</strong></span><span>累计得分<strong>' + score + '</strong></span>',
        primaryText: '重新开始',
        onPrimary: () => {
            score = stageStartScore;
            startStage(stageIndex);
        },
        secondaryText: '返回封面',
        onSecondary: returnHome
    });
}`, `function showLoss() {
    pauseTimer();
    gameActive = false;
    clearSavedGame();
    updateGameUi();
    playSound('loss');
    vibrate([50, 100, 50]);
    
    const canRevive = dailyRevivesUsed < MAX_REVIVES;
    const reviveMsg = canRevive 
        ? '卡槽已满！\\n今日还剩 ' + (MAX_REVIVES - dailyRevivesUsed) + ' 次免费复活机会。' 
        : '卡槽已满，再试一次吧。\\n今日复活次数已用完。';
        
    configureModal({
        kicker: '挑战失败',
        title: '差一点点',
        message: reviveMsg,
        statsHtml: '<span>本次用时<strong>' + formatTime(elapsedSeconds) + '</strong></span><span>累计得分<strong>' + score + '</strong></span>',
        primaryText: canRevive ? '洗牌复活' : '重新开始',
        onPrimary: () => {
            if (canRevive) reviveGame();
            else {
                score = stageStartScore;
                startStage(stageIndex);
            }
        },
        secondaryText: canRevive ? '重新开始' : '返回封面',
        onSecondary: () => {
            if (canRevive) {
                score = stageStartScore;
                startStage(stageIndex);
            } else returnHome();
        }
    });
}`);

c = c.replace(`        statsHtml: '<span>挑战用时<strong>' + formatTime(elapsedSeconds) + '</strong></span><span>最终得分<strong>' + score + '</strong></span>',`, `        statsHtml: '<span>挑战用时<strong>' + formatTime(elapsedSeconds) + '</strong></span><span>最终得分<strong>' + score + '</strong></span>' + (runRevives > 0 ? '<span>复活次数<strong>' + runRevives + ' 次</strong></span>' : ''),`);

c = c.replace(`        message: '恭喜今天通关，你获得了漂亮的三消连击和超高分数！',`, `        message: '恭喜今天通关，你获得了漂亮的三消连击和超高分数！' + (runRevives > 0 ? '\\n(复活了 ' + runRevives + ' 次)' : ''),`);

c = c.replace(`        elapsedSeconds,
        cards: allCards.map((card) => ({`, `        elapsedSeconds,
        runRevives,
        cards: allCards.map((card) => ({`);

c = c.replace(`    lifecyclePaused = false;
    combo = 0;
    lastMatchAt = 0;`, `    lifecyclePaused = false;
    combo = 0;
    lastMatchAt = 0;
    runRevives = saved.runRevives || 0;`);

c = c.replace(`    soundEnabled = readStorage(STORAGE.sound) !== 'off';`, `    soundEnabled = readStorage(STORAGE.sound) !== 'off';
    dailyRevivesUsed = getDailyRevivesUsed();`);

fs.writeFileSync('script.js', c);
