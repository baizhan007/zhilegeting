import io
import os

with io.open('script.js', 'r', encoding='utf-8') as f:
    c = f.read()

import re

loss_pattern = re.compile(r"function showLoss\(\) \{[\s\S]*?\}\n\}")
match = loss_pattern.search(c)
if match:
    old_loss = match.group(0)
    new_loss = """function showLoss() {
    pauseTimer();
    gameActive = false;
    clearSavedGame();
    updateGameUi();
    playSound('loss');
    vibrate([70, 50, 70]);
    
    const canRevive = dailyRevivesUsed < MAX_REVIVES;
    const reviveMsg = canRevive 
        ? '剩 ' + pile.length + ' 张，挑战失败。\\n今日还剩 ' + (MAX_REVIVES - dailyRevivesUsed) + ' 次免费洗牌复活机会。' 
        : '剩 ' + pile.length + ' 张，挑战失败。\\n今日复活次数已用完。';

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
}"""
    c = c.replace(old_loss, new_loss)

win_pattern = re.compile(r"statsHtml: '<span>挑战用时<strong>'\s*\+\s*formatTime\(elapsedSeconds\)\s*\+\s*'</strong></span><span>最终得分<strong>'\s*\+\s*score\s*\+\s*'</strong></span>',")
c = re.sub(win_pattern, "statsHtml: '<span>挑战用时<strong>' + formatTime(elapsedSeconds) + '</strong></span><span>最终得分<strong>' + score + '</strong></span>' + (runRevives > 0 ? '<span>复活次数<strong>' + runRevives + ' 次</strong></span>' : ''),", c)

win_msg_pattern = re.compile(r"message: '恭喜今天通关，你获得了漂亮的三消连击和超高分数！',")
c = re.sub(win_msg_pattern, "message: '恭喜今天通关，你获得了漂亮的三消连击和超高分数！' + (runRevives > 0 ? '\\n(本局复活了 ' + runRevives + ' 次)' : ''),", c)

with io.open('script.js', 'w', encoding='utf-8') as f:
    f.write(c)
