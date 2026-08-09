import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../audio-engine.js', import.meta.url), 'utf8');

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type) {
        this.listeners.get(type)?.forEach((listener) => listener());
    }
}

class FakeParam {
    constructor(value = 0) {
        this.value = value;
    }

    setValueAtTime(value) { this.value = value; }
    exponentialRampToValueAtTime(value) { this.value = value; }
    cancelScheduledValues() {}
    setTargetAtTime(value) { this.value = value; }
}

class FakeNode {
    connect(target) {
        this.target = target;
        return target;
    }

    disconnect() {
        this.disconnected = true;
    }
}

function createHarness(options = {}) {
    const probe = {
        bufferStarts: 0,
        contextCloses: 0,
        contextResumes: 0,
        gainNodes: [],
        oscillatorStarts: [],
        timers: new Map()
    };
    let timerId = 0;

    class FakeAudioContext extends FakeEventTarget {
        constructor() {
            super();
            this.currentTime = 1;
            this.destination = new FakeNode();
            this.sampleRate = 44100;
            this.state = 'suspended';
            probe.context = this;
        }

        createGain() {
            const node = new FakeNode();
            node.gain = new FakeParam(1);
            probe.gainNodes.push(node);
            return node;
        }

        createDynamicsCompressor() {
            const node = new FakeNode();
            for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new FakeParam();
            return node;
        }

        createOscillator() {
            const node = new FakeNode();
            node.frequency = new FakeParam();
            node.start = (when) => probe.oscillatorStarts.push({ frequency: node.frequency.value, when });
            node.stop = () => {};
            return node;
        }

        createBiquadFilter() {
            const node = new FakeNode();
            node.frequency = new FakeParam();
            node.Q = new FakeParam();
            return node;
        }

        createBufferSource() {
            const node = new FakeNode();
            node.start = () => { probe.bufferStarts += 1; };
            return node;
        }

        createBuffer() { return {}; }

        resume() {
            probe.contextResumes += 1;
            if (options.resume) return options.resume(this, probe.contextResumes);
            this.state = 'running';
            this.dispatch('statechange');
            return Promise.resolve();
        }

        async close() {
            probe.contextCloses += 1;
            this.state = 'closed';
            this.dispatch('statechange');
        }
    }

    const document = new FakeEventTarget();
    document.hidden = false;
    const window = new FakeEventTarget();
    window.AudioContext = FakeAudioContext;
    window.clearTimeout = (id) => probe.timers.delete(id);
    window.setTimeout = (callback, delay) => {
        timerId += 1;
        probe.timers.set(timerId, { callback, delay });
        return timerId;
    };

    probe.runTimer = async (delay) => {
        const timer = [...probe.timers].find(([, entry]) => entry.delay === delay);
        assert.ok(timer, `expected a ${delay}ms timer`);
        const [id, entry] = timer;
        probe.timers.delete(id);
        await entry.callback();
    };

    vm.runInNewContext(source, { document, window }, { filename: 'audio-engine.js' });
    return { document, engine: window.AudioEngine, probe, window };
}

test('unlocks Web Audio from a user action and primes iOS audio', async () => {
    const { engine, probe } = createHarness();
    assert.equal(engine.supported, true);
    assert.equal(engine.state.contextState, 'idle');

    assert.equal(await engine.unlock(), true);
    assert.equal(engine.unlocked, true);
    assert.equal(engine.state.contextState, 'running');
    assert.equal(probe.contextResumes, 1);
    assert.ok(probe.bufferStarts >= 2);
    engine.destroy();
});

test('schedules audible effects and background music after unlock', async () => {
    const { engine, probe } = createHarness();
    await engine.unlock();
    await engine.play('match');
    const effects = probe.oscillatorStarts.length;
    assert.ok(effects >= 3, 'match should schedule a multi-note effect');

    assert.equal(await engine.startMusic({ restart: true }), true);
    assert.equal(engine.state.musicPlaying, true);
    assert.ok(probe.oscillatorStarts.length > effects, 'music should schedule oscillator voices');

    engine.stopMusic();
    assert.equal(engine.state.musicWanted, false);
    assert.equal(engine.state.musicPlaying, false);
    engine.destroy();
});

test('builds audible master, music, and effects gain paths', async () => {
    const { engine, probe } = createHarness();
    await engine.unlock();
    const [master, music, effects] = probe.gainNodes;

    assert.equal(master.gain.value, 0.9);
    assert.equal(music.gain.value, 0.62);
    assert.equal(effects.gain.value, 1);
    assert.equal(music.target, master);
    assert.equal(effects.target, master);

    engine.setVolumes({ master: 0.5, music: 0.4, effects: 0.3 });
    assert.equal(master.gain.value, 0.5);
    assert.equal(music.gain.value, 0.4);
    assert.equal(effects.gain.value, 0.3);
    engine.destroy();
});

test('a real gesture retries a resume attempt that is already pending', async () => {
    const never = new Promise(() => {});
    const { document, engine, probe } = createHarness({
        resume(context, attempt) {
            if (attempt === 1) return never;
            context.state = 'running';
            context.dispatch('statechange');
            return Promise.resolve();
        }
    });

    let startSettled = false;
    const starting = engine.startMusic().then((ready) => {
        startSettled = true;
        return ready;
    });
    await Promise.resolve();
    assert.equal(probe.contextResumes, 1);

    document.dispatch('pointerdown');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(probe.contextResumes, 2, 'the gesture must make a fresh resume call');
    assert.equal(startSettled, true, 'statechange must release callers waiting on resume()');
    assert.equal(await starting, true);
    assert.equal(engine.state.musicPlaying, true);
    engine.destroy();
});

test('a permanently pending resume returns at the timeout budget', async () => {
    const { engine, probe } = createHarness({
        resume() {
            return new Promise(() => {});
        }
    });

    const unlocking = engine.unlock();
    await Promise.resolve();
    assert.ok([...probe.timers.values()].some(({ delay }) => delay === 900));
    await probe.runTimer(900);
    assert.equal(await unlocking, false);
    assert.equal(probe.contextResumes, 1);
    engine.destroy();
});

test('muting while resume is pending prevents the queued effect from playing', async () => {
    let finishResume;
    const { engine, probe } = createHarness({
        resume(context) {
            return new Promise((resolve) => {
                finishResume = () => {
                    context.state = 'running';
                    context.dispatch('statechange');
                    resolve();
                };
            });
        }
    });

    const playing = engine.play('tap');
    await engine.setEnabled(false);
    finishResume();
    assert.equal(await playing, false);
    assert.equal(probe.oscillatorStarts.length, 0);
    engine.destroy();
});

test('hiding the page cancels a queued automatic recovery', async () => {
    const { document, engine, probe } = createHarness();
    await engine.unlock();
    probe.context.state = 'interrupted';
    probe.context.dispatch('statechange');
    assert.ok([...probe.timers.values()].some(({ delay }) => delay === 120));

    document.hidden = true;
    document.dispatch('visibilitychange');
    assert.equal([...probe.timers.values()].some(({ delay }) => delay === 120), false);
    assert.equal(probe.contextResumes, 1);
    engine.destroy();
});

test('pagehide and pageshow resume wanted music without a look-ahead gap', async () => {
    const { engine, probe, window } = createHarness();
    await engine.unlock();
    await engine.startMusic({ restart: true });
    const beforeHide = probe.oscillatorStarts.length;

    window.dispatch('pagehide');
    assert.equal(engine.state.musicPlaying, false);
    assert.equal(engine.state.musicWanted, true);

    probe.context.currentTime += 0.1;
    window.dispatch('pageshow');
    await probe.runTimer(120);
    assert.equal(engine.state.musicPlaying, true);
    assert.ok(
        probe.oscillatorStarts.length > beforeHide,
        'returning before the look-ahead window expires must still schedule music immediately'
    );
    engine.destroy();
});

test('an interrupted context automatically resumes wanted music', async () => {
    const { engine, probe } = createHarness();
    await engine.unlock();
    await engine.startMusic();

    probe.context.state = 'interrupted';
    probe.context.dispatch('statechange');
    assert.equal(engine.state.musicPlaying, false);
    await probe.runTimer(120);

    assert.equal(probe.contextResumes, 2);
    assert.equal(engine.state.contextState, 'running');
    assert.equal(engine.state.musicPlaying, true);
    engine.destroy();
});

test('mute and page visibility stop audio activity without losing preferences', async () => {
    const { document, engine, probe } = createHarness();
    await engine.unlock();
    await engine.startMusic();
    await engine.setEnabled(false);
    assert.equal(engine.enabled, false);
    assert.equal(engine.state.musicPlaying, false);
    assert.equal(await engine.play('tap'), false);

    await engine.setEnabled(true);
    await engine.startMusic();
    document.hidden = true;
    document.dispatch('visibilitychange');
    assert.equal(engine.state.musicPlaying, false);
    assert.equal(engine.state.musicWanted, true);

    document.hidden = false;
    document.dispatch('visibilitychange');
    await probe.runTimer(120);
    assert.equal(engine.state.musicPlaying, true);

    engine.destroy();
    assert.equal(probe.contextCloses, 1);
});
