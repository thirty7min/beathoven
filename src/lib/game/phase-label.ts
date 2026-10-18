import type { RoomMode, RoomStatus } from "./types";

export function isUploadOnly(mode: RoomMode): boolean {
  return mode === "premade";
}

export function phaseLabel(mode: RoomMode, status: RoomStatus): string | null {
  switch (status) {
    case "lobby":
      return "Lobby";
    case "producing":
      return isUploadOnly(mode) ? "Uploading" : "Producing";
    case "listening":
      return "Listening";
    case "results":
      return "Results";
    default:
      return null;
  }
}

export type SubmitPhaseCopy = {
  title: string;
  waiting: string;
  countdown: string;
  timeSetting: string;
};

export function submitPhaseCopy(mode: RoomMode): SubmitPhaseCopy {
  return isUploadOnly(mode)
    ? { title: "Upload", waiting: "Uploading…", countdown: "Time left to upload", timeSetting: "Upload window" }
    : { title: "Producing", waiting: "Producing", countdown: "Time left to produce", timeSetting: "Produce time" };
}
