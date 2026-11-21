import * as lame from '@breezystack/lamejs';
import { DomainCategory } from '../types/telemetry';
import { GeolocationWeatherContext } from './telemetryEngine';
import { NormalizedDomainReading } from './weatherBeatsComposer';

export interface Id3TrackMetadata {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  comment: string;
}

export interface ProceduralCoverArtResult {
  dataUrl: string;
  jpegBytes: Uint8Array;
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i) & 0xff);
  }
}

function encodeUtf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function floatToInt16(channel: Float32Array): Int16Array {
  const out = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i++) {
    const s = Math.max(-1, Math.min(1, channel[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/**
 * Pure TypeScript 16-bit Stereo RIFF PCM WAV Encoder
 */
export function encodeWavPcm16(
  left: Float32Array,
  right: Float32Array,
  sampleRate = 48000
): Uint8Array {
  const numFrames = Math.min(left.length, right.length);
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, l < 0 ? Math.round(l * 0x8000) : Math.round(l * 0x7fff), true);
    view.setInt16(offset + 2, r < 0 ? Math.round(r * 0x8000) : Math.round(r * 0x7fff), true);
    offset += 4;
  }

  return new Uint8Array(buffer);
}

/**
 * Pure-JS 320kbps Stereo CBR MP3 Encoder using @breezystack/lamejs
 */
export function encodeMp3320(
  left: Float32Array,
  right: Float32Array,
  sampleRate = 48000
): Uint8Array {
  const numFrames = Math.min(left.length, right.length);
  const leftPcm = floatToInt16(left.subarray(0, numFrames));
  const rightPcm = floatToInt16(right.subarray(0, numFrames));

  const encoder = new (lame.Mp3Encoder as any)(2, sampleRate, 320);
  const chunks: Uint8Array[] = [];
  const blockSize = 1152;

  for (let i = 0; i < numFrames; i += blockSize) {
    const leftChunk = leftPcm.subarray(i, i + blockSize);
    const rightChunk = rightPcm.subarray(i, i + blockSize);
    const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf && mp3buf.length > 0) {
      chunks.push(new Uint8Array(mp3buf));
    }
  }

  const tail = encoder.flush();
  if (tail && tail.length > 0) {
    chunks.push(new Uint8Array(tail));
  }

  return concatUint8Arrays(chunks);
}

function buildTextFrame(frameId: string, text: string): Uint8Array {
  // ID3v2.3 Text Information Frame: encoding byte (0x03 = UTF-8 or 0x00 = ISO-8859-1; use 0x00 ASCII-safe or 0x01 UTF-16LE w/ BOM for wide player compatibility)
  const str = String(text || '');
  const payload = new Uint8Array(1 + 2 + str.length * 2);
  payload[0] = 0x01; // UTF-16 with BOM
  payload[1] = 0xff;
  payload[2] = 0xfe;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    payload[3 + i * 2] = code & 0xff;
    payload[3 + i * 2 + 1] = (code >> 8) & 0xff;
  }

  const header = new Uint8Array(10);
  const view = new DataView(header.buffer);
  writeAscii(view, 0, frameId);
  view.setUint32(4, payload.length, false); // ID3v2.3 frame sizes are big-endian uint32
  view.setUint16(8, 0, false);

  return concatUint8Arrays([header, payload]);
}

function buildCommentFrame(commentText: string): Uint8Array {
  const safe = String(commentText || '');
  const strBytes = encodeUtf8Bytes(safe);
  // Use ISO-8859-1 / UTF-8 compatible encoding 0x00 + 'eng' + 0x00 + text
  const payload = new Uint8Array(1 + 3 + 1 + strBytes.length);
  payload[0] = 0x00;
  payload[1] = 'e'.charCodeAt(0);
  payload[2] = 'n'.charCodeAt(0);
  payload[3] = 'g'.charCodeAt(0);
  payload[4] = 0x00;
  payload.set(strBytes, 5);

  const header = new Uint8Array(10);
  const view = new DataView(header.buffer);
  writeAscii(view, 0, 'COMM');
  view.setUint32(4, payload.length, false);
  view.setUint16(8, 0, false);

  return concatUint8Arrays([header, payload]);
}

function buildApicFrame(jpegBytes: Uint8Array): Uint8Array {
  const mime = encodeUtf8Bytes('image/jpeg');
  const payload = new Uint8Array(1 + mime.length + 1 + 1 + 1 + jpegBytes.length);
  let pos = 0;
  payload[pos++] = 0x00; // ISO-8859-1
  payload.set(mime, pos);
  pos += mime.length;
  payload[pos++] = 0x00; // null terminator for MIME
  payload[pos++] = 0x03; // Picture type: Cover (front)
  payload[pos++] = 0x00; // Empty description null terminator
  payload.set(jpegBytes, pos);

  const header = new Uint8Array(10);
  const view = new DataView(header.buffer);
  writeAscii(view, 0, 'APIC');
  view.setUint32(4, payload.length, false);
  view.setUint16(8, 0, false);

  return concatUint8Arrays([header, payload]);
}

function encodeSyncSafeInt(value: number): [number, number, number, number] {
  return [
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f
  ];
}

/**
 * Builds an authentic ID3v2.3 binary header containing TIT2, TPE1, TALB, TCON, TYER, COMM, and optional APIC cover artwork.
 */
export function buildId3v23Tag(
  meta: Id3TrackMetadata,
  coverJpegBytes?: Uint8Array
): Uint8Array {
  const frames: Uint8Array[] = [
    buildTextFrame('TIT2', meta.title),
    buildTextFrame('TPE1', meta.artist),
    buildTextFrame('TALB', meta.album),
    buildTextFrame('TCON', meta.genre),
    buildTextFrame('TYER', meta.year),
    buildCommentFrame(meta.comment)
  ];

  if (coverJpegBytes && coverJpegBytes.length > 0) {
    frames.push(buildApicFrame(coverJpegBytes));
  }

  const body = concatUint8Arrays(frames);
  const header = new Uint8Array(10);
  header[0] = 'I'.charCodeAt(0);
  header[1] = 'D'.charCodeAt(0);
  header[2] = '3'.charCodeAt(0);
  header[3] = 3; // ID3v2.3
  header[4] = 0;
  header[5] = 0; // flags
  const [b6, b7, b8, b9] = encodeSyncSafeInt(body.length);
  header[6] = b6;
  header[7] = b7;
  header[8] = b8;
  header[9] = b9;

  return concatUint8Arrays([header, body]);
}

export function prependId3ToMp3(
  mp3Bytes: Uint8Array,
  meta: Id3TrackMetadata,
  coverJpegBytes?: Uint8Array
): Uint8Array {
  const tag = buildId3v23Tag(meta, coverJpegBytes);
  return concatUint8Arrays([tag, mp3Bytes]);
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Converts an AI-generated PNG/JPEG data URL onto a crisp 1024x1024 JPEG
 * suitable for ID3v2.3 APIC cover embedding and direct download.
 */
export async function convertImageDataUrlToJpeg1024(
  imageDataUrl: string
): Promise<ProceduralCoverArtResult> {
  if (typeof document === 'undefined' || !imageDataUrl) {
    return { dataUrl: '', jpegBytes: new Uint8Array(0) };
  }

  return new Promise<ProceduralCoverArtResult>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ dataUrl: '', jpegBytes: new Uint8Array(0) });
          return;
        }
        ctx.fillStyle = '#0b0e14';
        ctx.fillRect(0, 0, size, size);
        // Center-crop square cover fill
        const scale = Math.max(size / Math.max(1, img.width), size / Math.max(1, img.height));
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (size - dw) * 0.5;
        const dy = (size - dh) * 0.5;
        ctx.drawImage(img, dx, dy, dw, dh);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.91);
        const jpegBytes = dataUrlToUint8Array(dataUrl);
        resolve({ dataUrl, jpegBytes });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to decode AI cover artwork image.'));
    img.src = imageDataUrl;
  });
}

/**
 * Generates deterministic 1024x1024 procedural cover artwork from the 24-domain telemetry fingerprint.
 */
export function generateProceduralCoverArt(
  vector: Record<DomainCategory, NormalizedDomainReading>,
  weatherCtx: GeolocationWeatherContext,
  meta: Id3TrackMetadata,
  bpm: number
): ProceduralCoverArtResult {
  if (typeof document === 'undefined') {
    return { dataUrl: '', jpegBytes: new Uint8Array(0) };
  }

  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: '', jpegBytes: new Uint8Array(0) };
  }

  const tempNorm = vector.weather.normalized;
  const solarNorm = vector.solar.normalized;
  const envNorm = vector.environmental.normalized;

  // Deep cosmic/atmospheric gradient backdrop
  const bgGrad = ctx.createRadialGradient(512, 460, 60, 512, 512, 680);
  bgGrad.addColorStop(0, tempNorm > 0.55 ? '#1f2937' : '#0f172a');
  bgGrad.addColorStop(0.55, '#0b1120');
  bgGrad.addColorStop(1, '#050811');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // Subtle concentric acoustic horizon grid
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1.5;
  for (let r = 110; r <= 420; r += 62) {
    ctx.beginPath();
    ctx.arc(512, 470, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 24-Domain telemetry harmonic spokes & orbital nodes
  const domains = Object.values(vector);
  domains.forEach((reading, idx) => {
    const angle = (idx / domains.length) * Math.PI * 2 - Math.PI / 2;
    const innerR = 115;
    const outerR = 145 + reading.normalized * 255;

    ctx.strokeStyle = reading.colorHex;
    ctx.globalAlpha = 0.52;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(512 + Math.cos(angle) * innerR, 470 + Math.sin(angle) * innerR);
    ctx.lineTo(512 + Math.cos(angle) * outerR, 470 + Math.sin(angle) * outerR);
    ctx.stroke();

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = reading.colorHex;
    ctx.beginPath();
    ctx.arc(
      512 + Math.cos(angle) * outerR,
      470 + Math.sin(angle) * outerR,
      6 + reading.normalized * 6,
      0,
      Math.PI * 2
    );
    ctx.fill();
  });

  // Central crystalline atmospheric core orb
  ctx.globalAlpha = 1;
  const orbGrad = ctx.createRadialGradient(480, 430, 12, 512, 470, 130);
  orbGrad.addColorStop(0, '#e0f2fe');
  orbGrad.addColorStop(0.35, solarNorm > 0.5 ? '#38bdf8' : '#22d3ee');
  orbGrad.addColorStop(0.72, envNorm > 0.6 ? '#f59e0b' : '#6366f1');
  orbGrad.addColorStop(1, 'rgba(15, 23, 42, 0.05)');
  ctx.fillStyle = orbGrad;
  ctx.beginPath();
  ctx.arc(512, 470, 128, 0, Math.PI * 2);
  ctx.fill();

  // Atmospheric waveform ribbons
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.45)';
  ctx.lineWidth = 2.2;
  for (let w = 0; w < 3; w++) {
    ctx.beginPath();
    for (let x = 80; x <= 944; x += 8) {
      const t = (x - 80) / 864;
      const y =
        470 +
        Math.sin(t * Math.PI * (3 + w * 2) + tempNorm * 4) *
          (28 + w * 18) *
          Math.sin(t * Math.PI);
      if (x === 80) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Editorial typography footer
  ctx.fillStyle = 'rgba(7, 10, 18, 0.86)';
  ctx.fillRect(0, 810, size, 214);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, 810);
  ctx.lineTo(960, 810);
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 46px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(meta.title.slice(0, 32), 64, 876);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 24px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(`${meta.artist} · ${meta.album}`, 64, 922);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '600 21px "JetBrains Mono", monospace';
  ctx.fillText(
    `${weatherCtx.region} · ${weatherCtx.temperatureC.toFixed(1)}°C · AQI ${weatherCtx.aqi} · ${bpm} BPM · 24 DOMAINS`,
    64,
    970
  );

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const jpegBytes = dataUrlToUint8Array(dataUrl);
  return { dataUrl, jpegBytes };
}
