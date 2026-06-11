"use client";

import { useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import type { FrameConfig, FitMode } from "@/lib/art-frame";

const MODES: Array<{ value: FitMode; label: string; hint: string }> = [
  { value: "cover", label: "Preencher", hint: "A arte cobre todo o espaço — arraste e dê zoom para enquadrar" },
  { value: "contain", label: "Caber", hint: "A arte inteira aparece, com fundo nas sobras" },
  { value: "stretch", label: "Esticar", hint: "A arte é deformada para o tamanho exato do smart object" },
];

const CHECKER: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#262626 25%,transparent 25%),linear-gradient(-45deg,#262626 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#262626 75%),linear-gradient(-45deg,transparent 75%,#262626 75%)",
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0,0 6px,6px -6px,-6px 0",
};

export default function ArtFramer({
  artUrl,
  soWidth,
  soHeight,
  value,
  onChange,
}: {
  artUrl: string;
  soWidth: number;
  soHeight: number;
  value: FrameConfig;
  onChange: (config: FrameConfig) => void;
}) {
  const aspect = soWidth / soHeight;
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // Reset pan/zoom quando a arte ou o aspect do SO mudam (state-during-render)
  const [prevKey, setPrevKey] = useState({ artUrl, aspect });
  if (prevKey.artUrl !== artUrl || prevKey.aspect !== aspect) {
    setPrevKey({ artUrl, aspect });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  const mode = MODES.find((m) => m.value === value.mode) ?? MODES[0];

  return (
    <div className="bg-neutral-900 rounded-lg p-2.5">
      <p className="text-neutral-500 uppercase tracking-wider text-[9px] mb-1.5">
        Enquadramento · {soWidth}×{soHeight}px
      </p>

      {/* Mode segmented control */}
      <div className="grid grid-cols-3 gap-1 mb-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => onChange({ ...value, mode: m.value, cropPixels: undefined })}
            className={`text-[11px] py-1.5 rounded-md transition-colors ${
              value.mode === m.value
                ? "bg-white text-black font-medium"
                : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Preview / crop area */}
      {value.mode === "cover" ? (
        <>
          <div className="relative w-full h-56 rounded-md overflow-hidden bg-neutral-950">
            <Cropper
              image={artUrl}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_area: Area, px: Area) =>
                onChange({ ...value, cropPixels: px })
              }
            />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] text-neutral-500">Zoom</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-white h-1"
            />
          </div>
        </>
      ) : (
        <div
          className="relative w-full rounded-md overflow-hidden max-h-56"
          style={{ aspectRatio: `${soWidth} / ${soHeight}`, ...(!value.bg && value.mode === "contain" ? CHECKER : {}), backgroundColor: value.mode === "contain" ? value.bg ?? undefined : undefined }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artUrl}
            alt="Preview do enquadramento"
            className={`absolute inset-0 w-full h-full ${
              value.mode === "contain" ? "object-contain" : "object-fill"
            }`}
          />
        </div>
      )}

      {/* Background picker for contain */}
      {value.mode === "contain" && (
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[10px] text-neutral-500 mr-1">Fundo</span>
          <button
            onClick={() => onChange({ ...value, bg: null })}
            title="Transparente"
            className={`w-6 h-6 rounded-md border ${
              value.bg === null ? "border-white" : "border-neutral-700"
            }`}
            style={CHECKER}
          />
          {["#ffffff", "#000000"].map((c) => (
            <button
              key={c}
              onClick={() => onChange({ ...value, bg: c })}
              title={c}
              className={`w-6 h-6 rounded-md border ${
                value.bg === c ? "border-white" : "border-neutral-700"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <input
            type="color"
            value={value.bg?.startsWith("#") && value.bg.length === 7 ? value.bg : "#888888"}
            onChange={(e) => onChange({ ...value, bg: e.target.value })}
            title="Cor personalizada"
            className="w-6 h-6 rounded-md border border-neutral-700 bg-transparent cursor-pointer p-0"
          />
        </div>
      )}

      <p className="text-[10px] text-neutral-600 mt-2">{mode.hint}</p>
    </div>
  );
}
