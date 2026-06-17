"use client";

/**
 * CropCanvas — overlay de corte sobre a foto da cena. Usa react-easy-crop (já
 * instalado) que tem pan/zoom próprio, então roda FORA do ZoomPanViewer, num
 * branch dedicado. Reporta a região cortada em pixels naturais da imagem.
 */
import { useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";

export function CropCanvas({
  imageUrl,
  aspect,
  zoom,
  onZoom,
  onArea,
}: {
  imageUrl: string;
  aspect?: number;
  zoom: number;
  onZoom: (z: number) => void;
  onArea: (a: Area) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  return (
    <Cropper
      image={imageUrl}
      crop={crop}
      zoom={zoom}
      aspect={aspect}
      minZoom={0.3}
      onCropChange={setCrop}
      onZoomChange={onZoom}
      onCropComplete={(_, areaPixels) => onArea(areaPixels)}
      objectFit="contain"
      showGrid
      restrictPosition={false}
    />
  );
}
