declare module "zzfx" {
  export const ZZFX: {
    volume: number;
    audioContext: AudioContext;
    buildSamples(...params: (number | undefined)[]): number[];
    playSamples(channels: number[][], volumeScale?: number, rate?: number, pan?: number, loop?: boolean): AudioBufferSourceNode;
  };
  export function zzfx(...params: (number | undefined)[]): AudioBufferSourceNode;
}
