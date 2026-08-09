(function () {
    'use strict';

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const MUSIC_STEP_SECONDS = 0.31;
    const MUSIC_LOOK_AHEAD_SECONDS = 0.72;
    const MUSIC_SCHEDULER_MS = 140;
    const MUSIC_MELODY = [
        523.25, 659.25, 783.99, 659.25,
        587.33, 659.25, 523.25, null,
        440.00, 523.25, 659.25, 523.25,
        493.88, 587.33, 523.25, null
    ];

    const SOUND_PATTERNS = {
        tap: [
            [540, 0, 0.065, 0.17, 'triangle'],
            [810, 0.014, 0.045, 0.075, 'sine']
        ],
        tool: [
            [392, 0, 0.08, 0.18, 'triangle'],
            [587.33, 0.055, 0.09, 0.15, 'triangle']
        ],
        shuffle: [
            [294, 0, 0.06, 0.14, 'triangle'],
            [392, 0.065, 0.07, 0.16, 'triangle'],
            [587.33, 0.135, 0.1, 0.18, 'triangle']
        ],
        match: [
            [440, 0, 0.08, 0.18, 'triangle'],
            [554.37, 0.065, 0.1, 0.19, 'triangle'],
            [659.25, 0.135, 0.14, 0.21, 'triangle']
        ],
        start: [
            [329.63, 0, 0.09, 0.18, 'triangle'],
            [440, 0.08, 0.11, 0.2, 'triangle'],
            [659.25, 0.18, 0.13, 0.2, 'triangle']
        ],
        stage: [
            [392, 0, 0.1, 0.18, 'triangle'],
            [523.25, 0.09, 0.12, 0.2, 'triangle'],
            [659.25, 0.2, 0.15, 0.22, 'triangle'],
            [783.99, 0.32, 0.18, 0.22, 'triangle']
        ],
        win: [
            [392, 0, 0.1, 0.18, 'triangle'],
            [523.25, 0.09, 0.11, 0.19, 'triangle'],
            [659.25, 0.19, 0.13, 0.2, 'triangle'],
            [783.99, 0.31, 0.16, 0.22, 'triangle'],
            [1046.5, 0.44, 0.28, 0.18, 'sine']
        ],
        loss: [
            [293.66, 0, 0.14, 0.19, 'triangle'],
            [233.08, 0.13, 0.2, 0.18, 'sine']
        ]
    };

    function clamp(value, minimum, maximum) {
        return Math.min(maximum, Math.max(minimum, Number(value) || 0));
    }

    class SynthAudioEngine {
        constructor() {
            this._context = null;
            this._masterGain = null;
            this._musicGain = null;
            this._effectsGain = null;
            this._enabled = true;
            this._unlocked = false;
            this._gestureSeen = false;
            this._musicWanted = false;
            this._musicTimer = null;
            this._recoveryTimer = null;
            this._resumePromise = null;
            this._resumeStateWaiters = new Set();
            this._nextMusicTime = 0;
            this._musicStep = 0;
            this._musicVoices = new Set();
            this._effectVoices = new Set();
            this._masterVolume = 0.9;
            this._musicVolume = 0.62;
            this._effectsVolume = 1;

            this._onUserGesture = this._onUserGesture.bind(this);
            this._onVisibilityChange = this._onVisibilityChange.bind(this);
            this._onPageHide = this._onPageHide.bind(this);
            this._onPageShow = this._onPageShow.bind(this);
            this._onFocus = this._onFocus.bind(this);
            this._bindLifecycleEvents();
        }

        get enabled() {
            return this._enabled;
        }

        get unlocked() {
            return this._unlocked;
        }

        get supported() {
            return Boolean(AudioContextClass);
        }

        get state() {
            return {
                enabled: this._enabled,
                unlocked: this._unlocked,
                supported: Boolean(AudioContextClass),
                contextState: this._context ? this._context.state : 'idle',
                musicWanted: this._musicWanted,
                musicPlaying: this._musicTimer !== null,
                volumes: {
                    master: this._masterVolume,
                    music: this._musicVolume,
                    effects: this._effectsVolume
                }
            };
        }

        async unlock(options = {}) {
            if (!this._enabled || document.hidden) return false;
            this._gestureSeen = true;
            const forceResume = Boolean(options && options.forceResume);
            const context = this._ensureContext();
            if (!context) return false;

            // A silent buffer started from the tap/click keeps older iOS WebKit
            // versions from permanently muting an otherwise resumed AudioContext.
            this._primeIosAudio(context);

            if (context.state !== 'running') {
                const resumed = await this._resumeContext(forceResume);
                if (!resumed) return false;
            }

            // State may change while resume() is pending (mute, backgrounding,
            // or context replacement). Do not let the original caller emit audio.
            if (
                !this._enabled ||
                document.hidden ||
                context !== this._context ||
                context.state !== 'running'
            ) return false;

            this._primeIosAudio(context);
            this._unlocked = context.state === 'running';
            if (this._unlocked && this._musicWanted) this._startMusicScheduler();
            return this._unlocked;
        }

        async setEnabled(enabled) {
            this._enabled = Boolean(enabled);
            if (!this._enabled) {
                this._cancelRecoveryTimer();
                this._stopMusicScheduler();
                this._stopVoices(this._musicVoices);
                this._stopVoices(this._effectVoices);
                return false;
            }

            const ready = await this.unlock();
            if (ready && this._musicWanted) this._startMusicScheduler();
            return ready;
        }

        play(type = 'tap') {
            if (!this._enabled || document.hidden) return Promise.resolve(false);
            const context = this._context;
            if (context && context.state === 'running') {
                this._playPattern(type);
                return Promise.resolve(true);
            }

            return this.unlock().then((ready) => {
                if (!ready || !this._enabled || document.hidden) return false;
                this._playPattern(type);
                return true;
            });
        }

        wakeAndPlay(type = 'tap') {
            return this.play(type);
        }

        startMusic(options = {}) {
            if (options && options.restart) {
                this._musicStep = 0;
                this._nextMusicTime = 0;
            }
            this._musicWanted = true;
            if (!this._enabled || document.hidden) return Promise.resolve(false);

            const context = this._context;
            if (context && context.state === 'running') {
                this._startMusicScheduler();
                return Promise.resolve(true);
            }

            return this.unlock();
        }

        stopMusic(options = {}) {
            const reset = typeof options === 'boolean' ? options : !options || options.reset !== false;
            this._musicWanted = false;
            this._stopMusicScheduler();
            this._stopVoices(this._musicVoices);
            if (reset) {
                this._musicStep = 0;
                this._nextMusicTime = 0;
            }
        }

        pauseMusic(options = {}) {
            const reset = typeof options === 'boolean' ? options : Boolean(options && options.reset);
            this._stopMusicScheduler();
            this._stopVoices(this._musicVoices);
            // Voices are scheduled ahead of currentTime. Re-anchor on resume so
            // a quick foreground return does not inherit a stale silent gap.
            this._nextMusicTime = 0;
            if (reset) {
                this._musicStep = 0;
            }
        }

        setVolumes(volumes = {}) {
            const hasOwn = (key) => Object.prototype.hasOwnProperty.call(volumes, key);
            if (hasOwn('master')) this._masterVolume = clamp(volumes.master, 0, 1);
            if (hasOwn('music')) this._musicVolume = clamp(volumes.music, 0, 1);
            if (hasOwn('effects')) this._effectsVolume = clamp(volumes.effects, 0, 1);

            this._rampGain(this._masterGain, this._masterVolume);
            this._rampGain(this._musicGain, this._musicVolume);
            this._rampGain(this._effectsGain, this._effectsVolume);
            return this.state;
        }

        destroy() {
            this.stopMusic();
            this._stopVoices(this._effectVoices);
            this._cancelRecoveryTimer();
            document.removeEventListener('pointerdown', this._onUserGesture, true);
            document.removeEventListener('touchend', this._onUserGesture, true);
            document.removeEventListener('keydown', this._onUserGesture, true);
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
            window.removeEventListener('pagehide', this._onPageHide);
            window.removeEventListener('pageshow', this._onPageShow);
            window.removeEventListener('focus', this._onFocus);

            const context = this._context;
            this._disposeGraph();
            if (context && context.state !== 'closed') context.close().catch(() => {});
        }

        _bindLifecycleEvents() {
            document.addEventListener('pointerdown', this._onUserGesture, { capture: true, passive: true });
            document.addEventListener('touchend', this._onUserGesture, { capture: true, passive: true });
            document.addEventListener('keydown', this._onUserGesture, true);
            document.addEventListener('visibilitychange', this._onVisibilityChange);
            window.addEventListener('pagehide', this._onPageHide);
            window.addEventListener('pageshow', this._onPageShow);
            window.addEventListener('focus', this._onFocus);
        }

        _onUserGesture() {
            if (!this._enabled || document.hidden) return;
            this.unlock({ forceResume: true }).catch(() => {});
        }

        _onVisibilityChange() {
            if (document.hidden) {
                this._cancelRecoveryTimer();
                this.pauseMusic();
                this._stopVoices(this._effectVoices);
                return;
            }
            this._scheduleRecovery();
        }

        _onPageHide() {
            this._cancelRecoveryTimer();
            this.pauseMusic();
            this._stopVoices(this._effectVoices);
        }

        _onPageShow() {
            this._scheduleRecovery();
        }

        _onFocus() {
            this._scheduleRecovery();
        }

        _ensureContext() {
            if (this._context && this._context.state !== 'closed') return this._context;
            if (!AudioContextClass) return null;

            try {
                this._context = new AudioContextClass({ latencyHint: 'interactive' });
            } catch {
                try {
                    this._context = new AudioContextClass();
                } catch {
                    this._context = null;
                    return null;
                }
            }

            this._buildGraph();
            const onStateChange = () => this._handleContextStateChange();
            if (typeof this._context.addEventListener === 'function') {
                this._context.addEventListener('statechange', onStateChange);
            } else {
                this._context.onstatechange = onStateChange;
            }
            return this._context;
        }

        _buildGraph() {
            const context = this._context;
            if (!context) return;

            this._masterGain = context.createGain();
            this._musicGain = context.createGain();
            this._effectsGain = context.createGain();
            const compressor = context.createDynamicsCompressor();

            this._masterGain.gain.value = this._masterVolume;
            this._musicGain.gain.value = this._musicVolume;
            this._effectsGain.gain.value = this._effectsVolume;
            compressor.threshold.value = -20;
            compressor.knee.value = 16;
            compressor.ratio.value = 8;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.16;

            this._musicGain.connect(this._masterGain);
            this._effectsGain.connect(this._masterGain);
            this._masterGain.connect(compressor);
            compressor.connect(context.destination);
            this._compressor = compressor;
        }

        async _resumeContext(force = false) {
            const context = this._context;
            if (!context || context.state === 'closed') return false;
            if (context.state === 'running') return true;
            if (this._resumePromise && !force) return this._resumePromise;

            let resolveRunning;
            const running = new Promise((resolve) => {
                resolveRunning = resolve;
            });
            this._resumeStateWaiters.add(resolveRunning);

            let resumeAttempt;
            try {
                resumeAttempt = context.resume();
            } catch {
                this._resumeStateWaiters.delete(resolveRunning);
                return false;
            }

            let timeoutId = null;
            const timeout = new Promise((resolve) => {
                timeoutId = window.setTimeout(() => resolve(context.state === 'running'), 900);
            });
            const resumed = Promise.resolve(resumeAttempt)
                .then(() => context.state === 'running')
                .catch(() => false);

            // Some embedded WebViews leave resume() pending instead of rejecting.
            // Never let audio policy block the game-start interaction.
            const pending = Promise.race([resumed, timeout, running]);
            const tracked = pending
                .finally(() => {
                    window.clearTimeout(timeoutId);
                    this._resumeStateWaiters.delete(resolveRunning);
                    if (this._resumePromise === tracked) this._resumePromise = null;
                });
            this._resumePromise = tracked;
            return tracked;
        }

        _primeIosAudio(context) {
            if (!context || !this._effectsGain) return;
            try {
                const source = context.createBufferSource();
                source.buffer = context.createBuffer(1, 1, context.sampleRate);
                source.connect(this._effectsGain);
                source.onended = () => source.disconnect();
                source.start(0);
            } catch {
                // Audio unlock is best-effort; standard Web Audio still works elsewhere.
            }
        }

        _handleContextStateChange() {
            const context = this._context;
            if (!context) return;
            if (context.state === 'running') {
                this._cancelRecoveryTimer();
                this._resumeStateWaiters.forEach((resolve) => resolve(true));
                this._resumeStateWaiters.clear();
                this._unlocked = true;
                if (this._enabled && this._musicWanted && !document.hidden) this._startMusicScheduler();
                return;
            }

            this._stopMusicScheduler();
            this._stopVoices(this._musicVoices);
            this._stopVoices(this._effectVoices);
            if (context.state === 'closed') {
                this._resumeStateWaiters.forEach((resolve) => resolve(false));
                this._resumeStateWaiters.clear();
                this._disposeGraph();
                return;
            }
            if (!document.hidden) this._scheduleRecovery();
        }

        _scheduleRecovery() {
            if (
                this._recoveryTimer !== null ||
                !this._enabled ||
                !this._gestureSeen ||
                !this._context ||
                document.hidden
            ) return;

            this._recoveryTimer = window.setTimeout(async () => {
                this._recoveryTimer = null;
                if (!this._enabled || !this._gestureSeen || !this._context || document.hidden) return;
                const ready = await this._resumeContext();
                if (ready && this._musicWanted) this._startMusicScheduler();
            }, 120);
        }

        _startMusicScheduler() {
            const context = this._context;
            if (
                this._musicTimer !== null ||
                !this._enabled ||
                !this._musicWanted ||
                !context ||
                context.state !== 'running' ||
                document.hidden
            ) return;

            if (this._nextMusicTime < context.currentTime - 0.05) {
                this._nextMusicTime = context.currentTime + 0.045;
            }
            this._pumpMusic();
        }

        _pumpMusic() {
            const context = this._context;
            if (
                !this._enabled ||
                !this._musicWanted ||
                !context ||
                context.state !== 'running' ||
                document.hidden
            ) {
                this._stopMusicScheduler();
                return;
            }

            while (this._nextMusicTime < context.currentTime + MUSIC_LOOK_AHEAD_SECONDS) {
                this._scheduleMusicStep(this._nextMusicTime, this._musicStep);
                this._nextMusicTime += MUSIC_STEP_SECONDS;
                this._musicStep = (this._musicStep + 1) % MUSIC_MELODY.length;
            }

            this._musicTimer = window.setTimeout(() => {
                this._musicTimer = null;
                this._pumpMusic();
            }, MUSIC_SCHEDULER_MS);
        }

        _scheduleMusicStep(startTime, step) {
            const frequency = MUSIC_MELODY[step];
            if (!frequency || !this._musicGain) return;

            this._createVoice({
                frequency,
                startTime,
                duration: MUSIC_STEP_SECONDS * 0.84,
                volume: 0.15,
                type: 'triangle',
                bus: this._musicGain,
                group: this._musicVoices,
                filterFrequency: 3200
            });

            if (step % 4 === 0) {
                this._createVoice({
                    frequency: frequency / 2,
                    startTime,
                    duration: MUSIC_STEP_SECONDS * 0.96,
                    volume: 0.07,
                    type: 'sine',
                    bus: this._musicGain,
                    group: this._musicVoices,
                    filterFrequency: 1600
                });
            }
        }

        _playPattern(type) {
            const context = this._context;
            if (!context || context.state !== 'running' || !this._effectsGain) return;
            const pattern = SOUND_PATTERNS[type] || SOUND_PATTERNS.tap;
            const now = context.currentTime + 0.008;
            pattern.forEach(([frequency, delay, duration, volume, wave]) => {
                this._createVoice({
                    frequency,
                    startTime: now + delay,
                    duration,
                    volume,
                    type: wave,
                    bus: this._effectsGain,
                    group: this._effectVoices,
                    filterFrequency: 4200
                });
            });
        }

        _createVoice({ frequency, startTime, duration, volume, type, bus, group, filterFrequency }) {
            const context = this._context;
            if (!context || !bus || !group) return;
            const oscillator = context.createOscillator();
            const filter = context.createBiquadFilter();
            const gain = context.createGain();
            const attack = Math.min(0.018, duration * 0.24);
            const releaseStart = Math.max(startTime + attack, startTime + duration - 0.024);
            const stopTime = startTime + duration + 0.04;

            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, startTime);
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(filterFrequency, startTime);
            filter.Q.value = 0.7;
            gain.gain.setValueAtTime(0.0001, startTime);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startTime + attack);
            gain.gain.setValueAtTime(Math.max(0.0001, volume), releaseStart);
            gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

            oscillator.connect(filter);
            filter.connect(gain);
            gain.connect(bus);

            const voice = { oscillator, filter, gain };
            group.add(voice);
            oscillator.onended = () => {
                group.delete(voice);
                oscillator.disconnect();
                filter.disconnect();
                gain.disconnect();
            };
            oscillator.start(startTime);
            oscillator.stop(stopTime);
        }

        _stopMusicScheduler() {
            if (this._musicTimer !== null) window.clearTimeout(this._musicTimer);
            this._musicTimer = null;
        }

        _stopVoices(voices) {
            voices.forEach((voice) => {
                voice.oscillator.onended = null;
                try {
                    voice.oscillator.stop();
                } catch {
                    // A completed oscillator cannot be stopped again.
                }
                voice.oscillator.disconnect();
                voice.filter.disconnect();
                voice.gain.disconnect();
            });
            voices.clear();
        }

        _rampGain(node, value) {
            const context = this._context;
            if (!node || !context) return;
            const now = context.currentTime;
            node.gain.cancelScheduledValues(now);
            node.gain.setTargetAtTime(value, now, 0.02);
        }

        _disposeGraph() {
            this._resumeStateWaiters.forEach((resolve) => resolve(false));
            this._resumeStateWaiters.clear();
            this._stopMusicScheduler();
            this._stopVoices(this._musicVoices);
            this._stopVoices(this._effectVoices);
            [this._musicGain, this._effectsGain, this._masterGain, this._compressor].forEach((node) => {
                if (!node) return;
                try {
                    node.disconnect();
                } catch {
                    // Nodes may already be detached when a context is closed.
                }
            });
            this._context = null;
            this._masterGain = null;
            this._musicGain = null;
            this._effectsGain = null;
            this._compressor = null;
            this._unlocked = false;
        }

        _cancelRecoveryTimer() {
            if (this._recoveryTimer !== null) window.clearTimeout(this._recoveryTimer);
            this._recoveryTimer = null;
        }
    }

    window.AudioEngine = new SynthAudioEngine();
}());
