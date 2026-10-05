// Cattura audio dal microfono / interfaccia USB e produce PCM 16 bit mono a 16 kHz,
// il formato nativo richiesto dalla Live API. L'AudioContext viene creato a 16 kHz
// così il browser fa il resampling da solo.

const WORKLET_SRC = `
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(2048); // ~128 ms a 16 kHz
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.chunk[this.n++] = ch[i];
      if (this.n === this.chunk.length) this.flush();
    }
    return true;
  }
  flush() {
    const pcm = new Int16Array(this.n);
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      const s = Math.max(-1, Math.min(1, this.chunk[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / this.n);
    this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer]);
    this.n = 0;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
`;

export async function listAudioInputs() {
  // Serve un permesso già concesso per vedere le etichette dei dispositivi.
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

export class MicCapture {
  constructor({ onChunk, onLevel }) {
    this.onChunk = onChunk;
    this.onLevel = onLevel;
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.workletUrl = null;
  }

  async start(deviceId) {
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        // Entriamo da un mixer: niente post-processing "da videochiamata".
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.ctx = new AudioContext({ sampleRate: 16000 });
    this.workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(this.workletUrl);

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-worklet', { numberOfInputs: 1, numberOfOutputs: 0 });
    this.node.port.onmessage = (e) => {
      if (this.onLevel) this.onLevel(e.data.rms);
      if (this.onChunk) this.onChunk(new Int16Array(e.data.pcm));
    };
    source.connect(this.node);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx.sampleRate;
  }

  async stop() {
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.ctx) { await this.ctx.close(); this.ctx = null; }
    if (this.workletUrl) { URL.revokeObjectURL(this.workletUrl); this.workletUrl = null; }
  }
}

export function int16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let bin = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}
