import fs from 'fs';
fs.appendFileSync('style.css', `
@keyframes screen-shake {
    0% { transform: translate(0, 0); }
    20% { transform: translate(-3px, 4px) rotate(-1deg); }
    40% { transform: translate(4px, -3px) rotate(1deg); }
    60% { transform: translate(-4px, -3px) rotate(-1deg); }
    80% { transform: translate(3px, 4px) rotate(1deg); }
    100% { transform: translate(0, 0); }
}

.shake {
    animation: screen-shake 0.3s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

.slot-flash {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at center, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 80%);
    opacity: 0;
    pointer-events: none;
    z-index: 100;
}

@keyframes flash-anim {
    0% { opacity: 1; transform: scale(0.8); }
    100% { opacity: 0; transform: scale(1.5); }
}

.slot-flash.active {
    animation: flash-anim 0.4s ease-out;
}

.combo-text {
    position: absolute;
    left: 50%;
    top: 30%;
    transform: translate(-50%, -50%) scale(0.5);
    font-size: 2.5rem;
    font-weight: 900;
    font-style: italic;
    color: #fff;
    text-shadow: 0 4px 0 #d95f45, 0 6px 12px rgba(0,0,0,0.4);
    opacity: 0;
    pointer-events: none;
    z-index: 200;
    white-space: nowrap;
}

@keyframes combo-anim {
    0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
    20% { opacity: 1; transform: translate(-50%, -60%) scale(1.2); }
    100% { opacity: 0; transform: translate(-50%, -80%) scale(1); }
}

.combo-text.active {
    animation: combo-anim 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
`);
