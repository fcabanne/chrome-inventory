// Sonidos de papel sintetizados con Web Audio: un roce de ruido filtrado
// más varios crujidos cortos en momentos al azar. Sin archivos de audio.

let ctx = null;
let noise = null;

function audioContext() {
  if (!ctx) {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Si el navegador bloqueó el audio al abrir, se destraba con la primera interacción.
for (const type of ["pointerdown", "keydown"]) {
  window.addEventListener(type, () => audioContext(), { once: true, capture: true });
}

const rand = (min, max) => min + Math.random() * (max - min);

function burst(ac, out, t, length, freq, q, peak) {
  const src = ac.createBufferSource();
  src.buffer = noise;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = freq;
  band.Q.value = q;
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(band).connect(env).connect(out);
  src.start(t, rand(0, 0.9), length + 0.02);
}

function paper({ duration, crackles, gain, sweep = [2200, 4200] }) {
  const ac = audioContext();
  const t0 = ac.currentTime + 0.01;

  const out = ac.createGain();
  out.gain.value = gain;
  out.connect(ac.destination);

  const src = ac.createBufferSource();
  src.buffer = noise;
  const high = ac.createBiquadFilter();
  high.type = "highpass";
  high.frequency.value = 700;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.7;
  band.frequency.setValueAtTime(sweep[0], t0);
  band.frequency.linearRampToValueAtTime(sweep[1], t0 + duration);
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.3, t0 + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(high).connect(band).connect(env).connect(out);
  src.start(t0, 0, duration + 0.05);

  for (let i = 0; i < crackles; i++) {
    burst(ac, out, t0 + rand(0, duration * 0.85), rand(0.012, 0.045), rand(1500, 6500), rand(1.5, 4), rand(0.2, 0.9));
  }
}

export const sounds = {
  pickup: () => paper({ duration: 0.5, crackles: 12, gain: 0.55, sweep: [1800, 4200] }),
  turn: () => paper({ duration: 0.22, crackles: 6, gain: 0.4 }),
  read: () => paper({ duration: 0.18, crackles: 4, gain: 0.3, sweep: [3000, 4500] }),
  close: () => paper({ duration: 0.3, crackles: 5, gain: 0.35, sweep: [4000, 1800] }),
};
