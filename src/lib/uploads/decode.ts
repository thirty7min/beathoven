import "server-only";
import { AACDecoder } from "@wasm-audio-decoders/aac";
import { FLACDecoder } from "@wasm-audio-decoders/flac";
import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
import CodecParser, { type OggPage, type OpusHeader } from "codec-parser";
import { createFile, MP4BoxBuffer, type Sample } from "mp4box";
import { MPEGDecoder } from "mpg123-decoder";
import { OpusDecoder } from "opus-decoder";
import { decodeWav } from "./wav";

export type PcmSink = (channelData: Float32Array[], sampleRate: number) => void;
export type DecodeOutcome = { gainDb: number };

type Decoded = { channelData: Float32Array[]; samplesDecoded: number; sampleRate: number };

const CHUNK_BYTES = 256 * 1024;
const MP4_SAMPLES_PER_BATCH = 500;

function* chunks(bytes: Uint8Array) {
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) yield bytes.subarray(offset, offset + CHUNK_BYTES);
}

function emit(sink: PcmSink, decoded: Decoded) {
  if (decoded.samplesDecoded > 0) sink(decoded.channelData, decoded.sampleRate);
}

async function decodeMp3(bytes: Uint8Array, sink: PcmSink) {
  const decoder = new MPEGDecoder();
  await decoder.ready;
  try {
    for (const chunk of chunks(bytes)) emit(sink, decoder.decode(chunk));
  } finally {
    decoder.free();
  }
}

async function decodeStream(
  decoder: { ready: Promise<void>; decode(data: Uint8Array): Promise<Decoded>; flush(): Promise<Decoded>; free(): void },
  bytes: Uint8Array,
  sink: PcmSink,
) {
  await decoder.ready;
  try {
    for (const chunk of chunks(bytes)) emit(sink, await decoder.decode(chunk));
    emit(sink, await decoder.flush());
  } finally {
    decoder.free();
  }
}

function isOpus(bytes: Uint8Array) {
  const head = new TextDecoder().decode(bytes.subarray(0, 64));
  return head.includes("OpusHead");
}

async function decodeOggOpus(bytes: Uint8Array, sink: PcmSink): Promise<DecodeOutcome> {
  const parser = new CodecParser<OggPage>("audio/ogg");
  let decoder: OpusDecoder | null = null;
  let gainDb = 0;
  try {
    const pages = function* () {
      for (const chunk of chunks(bytes)) yield* parser.parseChunk(chunk) as unknown as Iterable<OggPage>;
      yield* parser.flush() as unknown as Iterable<OggPage>;
    };
    for (const page of pages()) {
      if (!page.codecFrames?.length) continue;
      if (!decoder) {
        const header = page.codecFrames[0].header as OpusHeader;
        gainDb = header.outputGain / 256;
        decoder = new OpusDecoder({
          channels: header.channels,
          preSkip: header.preSkip,
          streamCount: header.streamCount,
          coupledStreamCount: header.coupledStreamCount,
          channelMappingTable: header.channelMappingTable,
        });
        await decoder.ready;
      }
      emit(sink, decoder.decodeFrames(page.codecFrames.map((f) => f.data)));
    }
  } finally {
    decoder?.free();
  }
  return { gainDb };
}

type DescriptorNode = { tag?: number; data?: Uint8Array; findDescriptor?: (tag: number) => DescriptorNode | undefined };

function audioSpecificConfig(entry: unknown): Uint8Array | null {
  const esd = (entry as { esds?: { esd?: DescriptorNode } })?.esds?.esd;
  const decoderConfig = esd?.findDescriptor?.(4);
  const specificInfo = decoderConfig?.findDescriptor?.(5);
  return specificInfo?.data ?? null;
}

async function decodeMp4(bytes: Uint8Array, sink: PcmSink) {
  const file = createFile();
  const batches: Uint8Array[][] = [];
  let config: Uint8Array | null = null;
  let failed = false;
  file.onError = () => {
    failed = true;
  };
  file.onReady = (info) => {
    const track = info.audioTracks.find((t) => t.codec.startsWith("mp4a.40"));
    if (!track) return;
    config = audioSpecificConfig(file.getTrackById(track.id)?.mdia?.minf?.stbl?.stsd?.entries?.[0]);
    if (!config) return;
    file.setExtractionOptions(track.id, null, { nbSamples: MP4_SAMPLES_PER_BATCH });
    file.start();
  };
  file.onSamples = (_id: number, _user: unknown, samples: Sample[]) => {
    batches.push(samples.flatMap((s) => (s.data ? [s.data] : [])));
  };
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes.slice().buffer, 0), true);
  file.flush();
  if (failed || !config || batches.length === 0) throw new Error("unsupported mp4 audio");

  const decoder = new AACDecoder({ audioSpecificConfig: config });
  await decoder.ready;
  try {
    for (const batch of batches.splice(0)) emit(sink, await decoder.decodeFrames(batch));
  } finally {
    decoder.free();
  }
}

export async function decodeAudio(bytes: Uint8Array, ext: string, sink: PcmSink): Promise<DecodeOutcome> {
  switch (ext) {
    case "wav":
      decodeWav(bytes, sink);
      return { gainDb: 0 };
    case "mp3":
      await decodeMp3(bytes, sink);
      return { gainDb: 0 };
    case "flac":
      await decodeStream(new FLACDecoder(), bytes, sink);
      return { gainDb: 0 };
    case "ogg":
      if (isOpus(bytes)) return decodeOggOpus(bytes, sink);
      await decodeStream(new OggVorbisDecoder(), bytes, sink);
      return { gainDb: 0 };
    case "aac":
      await decodeStream(new AACDecoder(), bytes, sink);
      return { gainDb: 0 };
    case "m4a":
      await decodeMp4(bytes, sink);
      return { gainDb: 0 };
    default:
      throw new Error(`unsupported audio format: ${ext}`);
  }
}
