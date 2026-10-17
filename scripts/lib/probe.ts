import fs from "node:fs";
import { MediaError } from "../../src/spec/errors.ts";
import { mediaKindForPath } from "../../src/spec/validate.ts";
import type { MediaInfo } from "../../src/spec/types.ts";
import { runOk } from "./proc.ts";

type FfStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  nb_read_frames?: string;
  nb_frames?: string;
};
export type FfProbe = { streams: FfStream[]; format: { duration?: string; format_name?: string } };

export const ffprobe = async (file: string, countFrames = false): Promise<FfProbe> => {
  const args = ["-v", "error", "-print_format", "json", "-show_streams", "-show_format"];
  if (countFrames) args.push("-count_frames");
  return JSON.parse(await runOk("ffprobe", [...args, file])) as FfProbe;
};

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s === "N/A") return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const probeMedia = async (file: string): Promise<MediaInfo> => {
  if (!fs.existsSync(file)) throw new MediaError(`media missing: ${file}`);
  const st = fs.statSync(file);
  if (!st.isFile() || st.size === 0) throw new MediaError(`media is empty or not a file: ${file}`);
  const kind = mediaKindForPath(file);
  if (!kind) throw new MediaError(`unsupported media type: ${file}`);
  let data: FfProbe;
  try {
    data = await ffprobe(file);
  } catch (e) {
    throw new MediaError(`media unreadable: ${file}: ${(e as Error).message}`);
  }
  const v = data.streams.find((s) => s.codec_type === "video");
  if (!v || !v.width || !v.height) throw new MediaError(`no video/image stream with dimensions: ${file}`);
  if (kind === "image") return { kind, width: v.width, height: v.height };
  const duration = num(data.format.duration) ?? num(v.duration);
  if (duration === undefined) {
    throw new MediaError(
      `duration unknown for ${file} (raw browser WebM recordings carry no duration); ` +
        `transcode it first: node scripts/prepare.ts <in> <out.mp4>`,
    );
  }
  return { kind, width: v.width, height: v.height, duration };
};
