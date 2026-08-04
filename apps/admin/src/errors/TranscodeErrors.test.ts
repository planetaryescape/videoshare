import { expect, test } from "vitest";
import { NoAssetTrackError } from "./TranscodeErrors";

test("describes missing supported audio and video tracks", () => {
  const error = new NoAssetTrackError({ filename: "recording.bin" });

  expect(error.message).toBe("Uploaded file has no supported audio or video track: recording.bin");
});
