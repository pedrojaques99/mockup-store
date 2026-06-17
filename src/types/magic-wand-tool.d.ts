declare module "magic-wand-tool" {
  interface MWImage { data: Uint8ClampedArray; width: number; height: number; bytes: number; }
  interface MWBounds { minX: number; minY: number; maxX: number; maxY: number; }
  interface MWMask { data: Uint8Array; width: number; height: number; bounds: MWBounds; }
  const MagicWand: {
    floodFill(image: MWImage, px: number, py: number, colorThreshold: number, mask?: MWMask | null, includeBorders?: boolean): MWMask | null;
    gaussBlurOnlyBorder(mask: MWMask, radius: number, visited?: unknown): MWMask;
  };
  export default MagicWand;
}
