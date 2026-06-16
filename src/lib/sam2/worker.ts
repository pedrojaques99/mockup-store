/**
 * SAM2 web worker — keeps encode/decode off the main thread.
 * Protocol (postMessage):
 *   → { type:"init" }                              ← {type:"progress",stage} / {type:"ready",device} / {type:"error"}
 *   → { type:"encode", float32Array, shape }       ← {type:"encoded", ms}
 *   → { type:"decode", points }                    ← {type:"decoded", mask:Float32Array, width, height}
 */
import { Tensor } from "onnxruntime-web/all";
import { SAM2, type SamPoint } from "./SAM2";
import { sliceTensor } from "./imageutils";

const sam = new SAM2();

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;
  try {
    if (type === "init") {
      self.postMessage({ type: "progress", stage: "download" });
      await sam.downloadModels();
      self.postMessage({ type: "progress", stage: "session" });
      const { success, device } = await sam.createSessions();
      if (success) self.postMessage({ type: "ready", device });
      else self.postMessage({ type: "error", error: "session init failed" });
    } else if (type === "encode") {
      const { float32Array, shape } = e.data;
      const t0 = performance.now();
      await sam.encodeImage(new Tensor("float32", float32Array, shape));
      self.postMessage({ type: "encoded", ms: performance.now() - t0 });
    } else if (type === "decode") {
      const points = e.data.points as SamPoint[];
      const res = await sam.decode(points);
      const masks = res.masks;
      const [, , width, height] = masks.dims as number[];
      const scores = res.iou_predictions.data as Float32Array;
      let best = 0;
      for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
      const mask = sliceTensor(masks, best);
      self.postMessage({ type: "decoded", mask, width, height }, [mask.buffer]);
    }
  } catch (err: any) {
    self.postMessage({ type: "error", error: String(err?.message ?? err) });
  }
};
