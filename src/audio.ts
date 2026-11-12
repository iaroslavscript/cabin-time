const CHIME_URL = `${import.meta.env.BASE_URL}sounds/call-chime.mp3`;
const CLICK_URL = `${import.meta.env.BASE_URL}sounds/switch-click.wav`;

/** Max gain of the air hiss when every vent is fully open. */
const MAX_HISS = 0.08;

/**
 * Cabin sounds: the recorded crew call chime and mechanical switch click plus a
 * synthesized air vent hiss. The AudioContext is created on the first user gesture
 * because mobile browsers block audio before that.
 */
export class CabinAudio {
  private ctx: AudioContext | undefined;
  private chime: Promise<AudioBuffer | undefined> | undefined;
  private clickSample: Promise<AudioBuffer | undefined> | undefined;
  private clickBuffer: AudioBuffer | undefined;
  private hiss: GainNode | undefined;
  private flow = 0;
  private readonly chimeData = fetchSound(CHIME_URL);
  private readonly clickData = fetchSound(CLICK_URL);

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Must be called from a user gesture handler. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const ctx = this.ctx;
      this.chime = decode(ctx, this.chimeData);
      this.clickSample = decode(ctx, this.clickData).then((b) => (this.clickBuffer = b));
      this.hiss = this.createHiss(ctx);
      this.setFlow(this.flow);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  async playChime(): Promise<void> {
    const ctx = this.ctx;
    const buffer = await this.chime;
    if (!ctx || !buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
  }

  /** A mechanical push-button click, slightly varied so repeats sound natural. */
  click(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.clickBuffer) this.playClick(ctx, this.clickBuffer);
    // The first tap creates the context, so wait for the (tiny) sample to decode.
    else void this.clickSample?.then((b) => (b ? this.playClick(ctx, b) : this.synthClick(ctx)));
  }

  private playClick(ctx: AudioContext, buffer: AudioBuffer): void {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const gain = ctx.createGain();
    gain.gain.value = 0.6 + Math.random() * 0.15;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }

  /** Fallback when the recording can't be loaded. */
  private synthClick(ctx: AudioContext): void {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1800, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.03);
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  /** Total air flow of all vents, 0 (closed) to 1 (all fully open). */
  setFlow(flow: number): void {
    this.flow = flow;
    if (!this.ctx || !this.hiss) return;
    this.hiss.gain.setTargetAtTime(MAX_HISS * Math.sqrt(flow), this.ctx.currentTime, 0.15);
  }

  private createHiss(ctx: AudioContext): GainNode {
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    return gain;
  }
}

function fetchSound(url: string): Promise<ArrayBuffer | undefined> {
  return fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : undefined))
    .catch(() => undefined);
}

function decode(ctx: AudioContext, data: Promise<ArrayBuffer | undefined>): Promise<AudioBuffer | undefined> {
  return data.then((d) => (d ? ctx.decodeAudioData(d) : undefined)).catch(() => undefined);
}
