/**
 * 브라우저 기반 Web Audio 오프닝/엔딩(OP/ED) 스킵 분석 엔진
 * - 앞 4분(240초) OP 분석 -> 완료 후 뒤 2.5분(150초) ED 순차 분석
 * - CENS (Chroma Energy Normalized Statistics) 12-피치 클래스 기반
 * - 90초 크로마 지문 DB 저장 및 1:1 템플릿 매칭 캐시
 */

export const SAMPLE_RATE = 11025;
export const HOP_LENGTH = 2048;
export const OP_SEARCH_SEC = 240; // 앞 4분 고정
export const ED_SEARCH_SEC = 150; // 뒤 2.5분 고정
export const SIMILARITY_THRESHOLD = 0.70; // 일치 판정 임계값 (70% 이상)
export const CORE_SEC = 60.0; // 코어 탐색 윈도우 (60초)

export interface SkipIntervalResult {
  type: "op" | "ed";
  label: "오프닝" | "엔딩";
  start: number;
  end: number;
  score?: number;
}

export interface PipelineProgress {
  step: string;
  progress: number; // 0 to 100
  detail?: string;
}

// ==========================================
// 1. MPEG-TS -> AAC ADTS Demuxer (tsDemuxer 재내보내기)
// ==========================================
import { extractAacFromTs, isTsStream, isAacStream } from "./tsDemuxer";
export { extractAacFromTs, isTsStream, isAacStream };

// ==========================================
// 2. Web Audio 디코딩 (11025Hz 모노 PCM)
// ==========================================
export async function decodeAudioSegments(
  segmentUrls: string[],
  onProgress?: (ratio: number) => void,
  fallbackUrls?: string[]
): Promise<Float32Array | null> {
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) {
    throw new Error("Web Audio API not supported in this browser");
  }

  const audioCtx = new AudioCtxClass();
  const buffers: (ArrayBuffer | null)[] = new Array(segmentUrls.length).fill(null);

  const CONCURRENCY = 6;
  let currentIndex = 0;
  let completedCount = 0;

  async function worker() {
    while (currentIndex < segmentUrls.length) {
      const idx = currentIndex++;
      try {
        const resp = await fetch(segmentUrls[idx]);
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          buffers[idx] = ab;
        } else if (fallbackUrls && fallbackUrls[idx]) {
          const fResp = await fetch(fallbackUrls[idx]);
          if (fResp.ok) {
            buffers[idx] = await fResp.arrayBuffer();
          }
        }
      } catch (e) {
        if (fallbackUrls && fallbackUrls[idx]) {
          try {
            const fResp = await fetch(fallbackUrls[idx]);
            if (fResp.ok) {
              buffers[idx] = await fResp.arrayBuffer();
            }
          } catch (e2) {
            console.warn("[Segment fetch error]:", segmentUrls[idx], e, e2);
          }
        } else {
          console.warn("[Segment fetch error]:", segmentUrls[idx], e);
        }
      }
      completedCount++;
      if (onProgress) {
        onProgress((completedCount / segmentUrls.length) * 0.5);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, segmentUrls.length) },
    () => worker()
  );
  await Promise.all(workers);

  const rawBuffers = buffers.filter(
    (b): b is ArrayBuffer => b !== null && b.byteLength > 0
  );

  if (rawBuffers.length === 0) {
    audioCtx.close();
    return null;
  }

  let totalBytes = 0;
  for (const buf of rawBuffers) totalBytes += buf.byteLength;
  const joinedData = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of rawBuffers) {
    joinedData.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  let aacData: Uint8Array;
  if (isTsStream(joinedData)) {
    aacData = extractAacFromTs(joinedData);
  } else {
    aacData = joinedData;
  }

  const audioArrayBuffer = aacData.buffer.slice(
    aacData.byteOffset,
    aacData.byteOffset + aacData.byteLength
  );

  let audioBuffer: AudioBuffer | null = null;
  try {
    audioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer as ArrayBuffer);
  } catch (err) {
    try {
      const fallbackBuf = joinedData.buffer.slice(
        joinedData.byteOffset,
        joinedData.byteOffset + joinedData.byteLength
      );
      audioBuffer = await audioCtx.decodeAudioData(fallbackBuf as ArrayBuffer);
    } catch (e2) {
      console.error("[Audio decode failed]:", err, e2);
      audioCtx.close();
      return null;
    }
  }

  audioCtx.close();

  if (!audioBuffer) return null;

  const origSr = audioBuffer.sampleRate;
  const origLen = audioBuffer.length;
  const origData = audioBuffer.getChannelData(0);

  const targetLen = Math.floor(origLen * (SAMPLE_RATE / origSr));
  const pcm = new Float32Array(targetLen);

  const step = origSr / SAMPLE_RATE;
  for (let i = 0; i < targetLen; i++) {
    const srcIdx = Math.min(origLen - 1, Math.floor(i * step));
    pcm[i] = origData[srcIdx];
  }

  if (onProgress) {
    onProgress(1.0);
  }

  return pcm;
}

// ==========================================
// 3. Fast Fourier Transform (FFT) & CENS 크로마 추출
// ==========================================
function fftRadix2(re: Float32Array, im: Float32Array) {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = re[i];
      re[i] = re[j];
      re[j] = tempR;
      const tempI = im[i];
      im[i] = im[j];
      im[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let l = 2; l <= n; l <<= 1) {
    const halfL = l >> 1;
    const angle = (-2 * Math.PI) / l;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);
    for (let i = 0; i < n; i += l) {
      let curWR = 1.0;
      let curWI = 0.0;
      for (let m = 0; m < halfL; m++) {
        const uR = re[i + m];
        const uI = im[i + m];
        const vR = re[i + m + halfL] * curWR - im[i + m + halfL] * curWI;
        const vI = re[i + m + halfL] * curWI + im[i + m + halfL] * curWR;
        re[i + m] = uR + vR;
        im[i + m] = uI + vI;
        re[i + m + halfL] = uR - vR;
        im[i + m + halfL] = uI - vI;
        const nextWR = curWR * wStepR - curWI * wStepI;
        const nextWI = curWR * wStepI + curWI * wStepR;
        curWR = nextWR;
        curWI = nextWI;
      }
    }
  }
}

export function extractCENS(pcm: Float32Array): Float32Array {
  const nFft = 2048;
  const halfFft = nFft / 2;
  const numFrames = Math.max(1, Math.floor((pcm.length - nFft) / HOP_LENGTH) + 1);

  const chroma = new Float32Array(12 * numFrames);

  const hann = new Float32Array(nFft);
  for (let i = 0; i < nFft; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (nFft - 1)));
  }

  const binPitch = new Int8Array(halfFft);
  const freqStep = SAMPLE_RATE / nFft;
  for (let k = 1; k < halfFft; k++) {
    const f = k * freqStep;
    if (f >= 65 && f <= 2100) {
      const midi = Math.round(12 * Math.log2(f / 440) + 69);
      binPitch[k] = ((midi % 12) + 12) % 12;
    } else {
      binPitch[k] = -1;
    }
  }

  const re = new Float32Array(nFft);
  const im = new Float32Array(nFft);

  for (let t = 0; t < numFrames; t++) {
    const startIdx = t * HOP_LENGTH;
    for (let i = 0; i < nFft; i++) {
      re[i] = (pcm[startIdx + i] || 0) * hann[i];
      im[i] = 0;
    }

    fftRadix2(re, im);

    for (let k = 1; k < halfFft; k++) {
      const pitch = binPitch[k];
      if (pitch >= 0) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        chroma[pitch * numFrames + t] += mag;
      }
    }
  }

  const smoothed = new Float32Array(12 * numFrames);
  const winHalf = 5;
  for (let p = 0; p < 12; p++) {
    const pOffset = p * numFrames;
    for (let t = 0; t < numFrames; t++) {
      let sum = 0;
      let cnt = 0;
      const minI = Math.max(0, t - winHalf);
      const maxI = Math.min(numFrames - 1, t + winHalf);
      for (let i = minI; i <= maxI; i++) {
        sum += chroma[pOffset + i];
        cnt++;
      }
      smoothed[pOffset + t] = sum / cnt;
    }
  }

  for (let t = 0; t < numFrames; t++) {
    let mean = 0;
    for (let p = 0; p < 12; p++) {
      mean += smoothed[p * numFrames + t];
    }
    mean /= 12;

    let normSq = 0;
    for (let p = 0; p < 12; p++) {
      const centered = smoothed[p * numFrames + t] - mean;
      smoothed[p * numFrames + t] = centered;
      normSq += centered * centered;
    }

    const norm = Math.sqrt(normSq);
    if (norm > 1e-4) {
      for (let p = 0; p < 12; p++) {
        smoothed[p * numFrames + t] /= norm;
      }
    } else {
      for (let p = 0; p < 12; p++) {
        smoothed[p * numFrames + t] = 0;
      }
    }
  }

  return smoothed;
}

// ==========================================
// 4. 경계 정밀 검출
// ==========================================
export function findExactBoundaries(
  diagVals: Float32Array,
  coreStartIdx: number,
  coreFrames: number,
  fps: number,
  threshold = 0.55
): { startIdx: number; endIdx: number; durSec: number } {
  const L = diagVals.length;
  const coreEndIdx = coreStartIdx + coreFrames;

  let startIdx = coreStartIdx;
  let lowCount = 0;
  const maxBackFrames = Math.round(35.0 * fps);
  const minSearchIdx = Math.max(0, coreStartIdx - maxBackFrames);
  for (let idx = coreStartIdx - 1; idx >= minSearchIdx; idx--) {
    if (diagVals[idx] < threshold) {
      lowCount++;
      if (lowCount >= 2) {
        startIdx = idx + 2;
        break;
      }
    } else {
      lowCount = 0;
      startIdx = idx;
    }
  }

  let endIdx = coreEndIdx;
  lowCount = 0;
  const maxFwdFrames = Math.round(35.0 * fps);
  const maxSearchIdx = Math.min(L, coreEndIdx + maxFwdFrames);
  for (let idx = coreEndIdx; idx < maxSearchIdx; idx++) {
    if (diagVals[idx] < threshold) {
      lowCount++;
      if (lowCount >= 2) {
        endIdx = idx - 1;
        break;
      }
    } else {
      lowCount = 0;
      endIdx = idx + 1;
    }
  }

  const marginFrames = Math.round(1.0 * fps);
  let safeEndIdx = Math.max(coreEndIdx, endIdx - marginFrames);
  let durSec = (safeEndIdx - startIdx) / fps;

  if (durSec < 75.0 || durSec > 93.0) {
    safeEndIdx = Math.min(L - 1, startIdx + Math.round(88.0 * fps));
    durSec = (safeEndIdx - startIdx) / fps;
  }

  return { startIdx, endIdx: safeEndIdx, durSec };
}

// ==========================================
// 5. 1D 템플릿(지문) 고속 매칭
// ==========================================
export function matchTemplate(
  currChroma: Float32Array,
  currFrames: number,
  templateChroma: Float32Array,
  templateFrames: number,
  threshold = SIMILARITY_THRESHOLD
): { score: number; start: number; end: number; durationSec: number } | null {
  if (currFrames < templateFrames) return null;

  const fps = SAMPLE_RATE / HOP_LENGTH;
  const durSec = templateFrames / fps;
  const outLen = currFrames - templateFrames + 1;

  let bestScore = -1.0;
  let bestIdx = 0;

  for (let t = 0; t < outLen; t++) {
    let dotSum = 0;
    for (let p = 0; p < 12; p++) {
      const cOffset = p * currFrames + t;
      const tOffset = p * templateFrames;
      for (let k = 0; k < templateFrames; k++) {
        dotSum += currChroma[cOffset + k] * templateChroma[tOffset + k];
      }
    }
    const score = dotSum / templateFrames;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = t;
    }
  }

  if (bestScore < threshold) return null;

  const startSec = Math.round((bestIdx / fps) * 10) / 10;
  const endSec = Math.round((startSec + durSec) * 10) / 10;

  return {
    score: Math.round(bestScore * 1000) / 1000,
    start: startSec,
    end: endSec,
    durationSec: Math.round(durSec * 10) / 10,
  };
}

// ==========================================
// 6. 2D 회차 교차 매칭
// ==========================================
export function matrixMatch(
  c1: Float32Array,
  t1Frames: number,
  c2: Float32Array,
  t2Frames: number,
  maxSearchSec: number,
  threshold = SIMILARITY_THRESHOLD
): {
  score: number;
  t1: number;
  t1End: number;
  t2: number;
  t2End: number;
  durSec: number;
  fingerprintSlice: Float32Array;
  fingerprintFrames: number;
} | null {
  const fps = SAMPLE_RATE / HOP_LENGTH;
  const coreFrames = Math.round(CORE_SEC * fps);

  if (t1Frames < coreFrames || t2Frames < coreFrames) {
    return null;
  }

  const S = new Float32Array(t1Frames * t2Frames);
  for (let i = 0; i < t1Frames; i++) {
    const rowOffset = i * t2Frames;
    for (let j = 0; j < t2Frames; j++) {
      let dot = 0;
      for (let p = 0; p < 12; p++) {
        dot += c1[p * t1Frames + i] * c2[p * t2Frames + j];
      }
      S[rowOffset + j] = dot;
    }
  }

  const diagMin = -(t1Frames - coreFrames);
  const diagMax = t2Frames - coreFrames;

  let bestScore = -1.0;
  let bestD = 0;
  let bestCoreIdx = 0;

  for (let d = diagMin; d < diagMax; d++) {
    const diagLen = d >= 0 ? Math.min(t1Frames, t2Frames - d) : Math.min(t1Frames + d, t2Frames);
    if (diagLen < coreFrames) continue;

    const diagVals = new Float32Array(diagLen);
    for (let k = 0; k < diagLen; k++) {
      const i = d >= 0 ? k : k - d;
      const j = d >= 0 ? k + d : k;
      diagVals[k] = S[i * t2Frames + j];
    }

    let curSum = 0;
    for (let k = 0; k < coreFrames; k++) {
      curSum += diagVals[k];
    }

    const maLen = diagLen - coreFrames + 1;
    for (let k = 0; k < maLen; k++) {
      if (k > 0) {
        curSum += diagVals[k + coreFrames - 1] - diagVals[k - 1];
      }
      const score = curSum / coreFrames;
      if (score > bestScore) {
        const curT1 = (d >= 0 ? k : k - d) / fps;
        const curT2 = (d >= 0 ? k + d : k) / fps;
        if (curT1 <= maxSearchSec && curT2 <= maxSearchSec) {
          bestScore = score;
          bestD = d;
          bestCoreIdx = k;
        }
      }
    }
  }

  if (bestScore < threshold) return null;

  const diagLen = bestD >= 0 ? Math.min(t1Frames, t2Frames - bestD) : Math.min(t1Frames + bestD, t2Frames);
  const bestDiag = new Float32Array(diagLen);
  for (let k = 0; k < diagLen; k++) {
    const i = bestD >= 0 ? k : k - bestD;
    const j = bestD >= 0 ? k + bestD : k;
    bestDiag[k] = S[i * t2Frames + j];
  }

  const { startIdx, endIdx, durSec } = findExactBoundaries(
    bestDiag,
    bestCoreIdx,
    coreFrames,
    fps,
    0.55
  );

  const realT1Idx = bestD >= 0 ? startIdx : startIdx - bestD;
  const realT1EndIdx = bestD >= 0 ? endIdx : endIdx - bestD;
  const realT2Idx = bestD >= 0 ? startIdx + bestD : startIdx;
  const realT2EndIdx = bestD >= 0 ? endIdx + bestD : endIdx;

  const realT1 = Math.round((realT1Idx / fps) * 10) / 10;
  const realT1End = Math.round((realT1EndIdx / fps) * 10) / 10;
  const realT2 = Math.round((realT2Idx / fps) * 10) / 10;
  const realT2End = Math.round((realT2EndIdx / fps) * 10) / 10;

  const fpFrames = Math.max(1, realT1EndIdx - realT1Idx);
  const fpSlice = new Float32Array(12 * fpFrames);
  for (let p = 0; p < 12; p++) {
    const srcOffset = p * t1Frames + realT1Idx;
    const dstOffset = p * fpFrames;
    for (let k = 0; k < fpFrames; k++) {
      fpSlice[dstOffset + k] = c1[srcOffset + k] || 0;
    }
  }

  return {
    score: Math.round(bestScore * 1000) / 1000,
    t1: realT1,
    t1End: realT1End,
    t2: realT2,
    t2End: realT2End,
    durSec: Math.round(durSec * 10) / 10,
    fingerprintSlice: fpSlice,
    fingerprintFrames: fpFrames,
  };
}

// ==========================================
// 7. Base64 변환 헬퍼
// ==========================================
export function chromaToBase64(chroma: Float32Array): string {
  const bytes = new Uint8Array(chroma.buffer, chroma.byteOffset, chroma.byteLength);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToChroma(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

export async function runAudioSkipPipeline(_params?: {
  animeId: string;
  episodeNumber: number;
  currentM3u8Url: string;
  compareEpisodeNumber?: number;
  onProgress?: (p: PipelineProgress) => void;
}): Promise<SkipIntervalResult[]> {
  return [];
}
