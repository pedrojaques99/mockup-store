"use client";

/**
 * ArtFramePanel — shared fit-mode + crop UI for artwork placement.
 * Single source of truth used by both the Mockup Store and the Scene Maker.
 * All framing math lives in @/lib/art-frame; this is purely the control surface.
 *
 * `variant="source"` existe por um defeito de conceito, não por estética: no
 * painel da Store este componente desenhava uma SEGUNDA imagem grande, logo
 * abaixo da superfície que mostra a cena/o render. O resultado é que antes de
 * renderizar o topo mostrava a cena SEM a arte e o bloco de baixo mostrava a
 * arte SEM a cena — nenhuma das duas mostrava a coisa que o usuário está
 * decidindo, e ajustar enquadramento virava editar num lugar e conferir no
 * outro, rolando entre eles. Em `source` a arte é FONTE (miniatura + nome +
 * controles) e o recorte abre sob demanda, então sobra uma superfície grande só.
 */
import { useEffect, useState } from "react";
import { Crop, Shrink, Scaling, X, SlidersHorizontal } from "lucide-react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { IconSegmented } from "@/components/ui/IconSegmented";
import { dec } from "@/lib/utils";
import {
  type FrameConfig,
  effectiveSource,
  upscaleFactor,
  LOW_RES_FACTOR,
} from "@/lib/art-frame";

/**
 * ArtCropSurface — o recorte propriamente dito (Cropper + zoom).
 *
 * Existe separado para poder ser desenhado na superfície grande que a tela JÁ tem, em
 * vez de crescer uma segunda. Posição e zoom moram aqui dentro: a superfície só existe
 * em `cover`, então trocar de modo desmonta e o reset vem de graça, sem estado espelhado
 * no pai. Quem consome recebe só o que interessa — os pixels do recorte.
 *
 * `fill` faz a superfície ocupar o container em vez de ter altura própria — é como ela
 * entra numa caixa que já tem tamanho (a área de resultado do painel de render).
 */
export function ArtCropSurface({
  artPreview,
  aspect,
  heightClass,
  fill = false,
  onCropPixels,
}: {
  artPreview: string;
  aspect: number;
  heightClass?: string;
  fill?: boolean;
  onCropPixels: (px: Area) => void;
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  return (
    <div className={fill ? "absolute inset-0 flex flex-col" : "flex flex-col gap-2"}>
      <div
        className={
          fill
            ? "relative flex-1 min-h-0 w-full overflow-hidden bg-black"
            : `relative ${heightClass ?? "h-44"} w-full overflow-hidden rounded-xl bg-black`
        }
      >
        <Cropper
          image={artPreview}
          crop={pos}
          zoom={zoom}
          aspect={aspect}
          showGrid={false}
          minZoom={0.2}
          maxZoom={4}
          restrictPosition={false}
          onCropChange={setPos}
          onZoomChange={setZoom}
          onCropComplete={(_area: Area, px: Area) => onCropPixels(px)}
        />
      </div>
      <div className={fill ? "flex items-center gap-2 px-3 py-2 bg-neutral-950/90 backdrop-blur" : "flex items-center gap-2"}>
        <label className="text-[10px] text-neutral-500 shrink-0" htmlFor="art-crop-zoom">Zoom</label>
        <input
          id="art-crop-zoom"
          type="range"
          min={0.2}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1 flex-1 accent-white"
        />
        <span className="text-[10px] text-neutral-500 shrink-0 tabular-nums">{dec(zoom)}×</span>
      </div>
    </div>
  );
}

export interface ArtFramePanelProps {
  artPreview: string;
  artDims: { width: number; height: number } | null;
  frame: FrameConfig;
  onFrameChange: (updater: FrameConfig | ((f: FrameConfig) => FrameConfig)) => void;
  /** Target surface inner size — drives crop aspect + low-res warning. */
  soWidth?: number;
  soHeight?: number;
  fileName?: string;
  onClear?: () => void;
  /** Tailwind height class for the preview/cropper area. */
  previewHeightClass?: string;
  /** Compact mode shrinks the type scale for the floating panel. */
  compact?: boolean;
  /**
   * `"full"` desenha a imagem da arte em tamanho grande (Scene Maker, onde ela é
   * a única superfície). `"source"` trata a arte como fonte: miniatura + nome +
   * controles, e o recorte só aparece quando pedido. Use `"source"` sempre que a
   * tela JÁ tiver uma superfície grande mostrando o resultado.
   */
  variant?: "full" | "source";
  /**
   * Recorte CONTROLADO pelo consumidor. Passe os dois para que o painel deixe de
   * desenhar a superfície de recorte e apenas peça a abertura dela — quem desenha
   * passa a ser você, com `<ArtCropSurface>`, onde fizer sentido na sua tela.
   *
   * Existe porque `variant="source"` consertou o defeito pela metade: a arte parou de
   * ser uma segunda superfície grande PERMANENTE e virou uma segunda superfície grande
   * SOB DEMANDA. Aberto o recorte, a tela voltava a ter duas imagens competindo e o
   * usuário continuava ajustando num lugar e conferindo no outro. A cura não é encolher
   * a segunda superfície, é não ter duas.
   */
  cropOpen?: boolean;
  onCropOpenChange?: (open: boolean) => void;
}

export default function ArtFramePanel({
  artPreview,
  artDims,
  frame,
  onFrameChange,
  soWidth,
  soHeight,
  fileName,
  onClear,
  previewHeightClass = "h-44",
  compact = false,
  variant = "full",
  cropOpen: cropOpenProp,
  onCropOpenChange,
}: ArtFramePanelProps) {
  /* Em `source` o recorte começa fechado: ele é ajuste fino, não a primeira
   * coisa que alguém precisa ver. Aberto por padrão era o que criava a segunda
   * imagem grande competindo com o preview do render. */
  const [cropOpenSelf, setCropOpenSelf] = useState(false);

  /* Controlado quando o consumidor manda `cropOpen`; o Scene Maker não manda nada e
   * segue com o comportamento de sempre, byte por byte. */
  const controlled = cropOpenProp !== undefined;
  const cropOpen = controlled ? cropOpenProp : cropOpenSelf;
  const setCropOpen = (v: boolean) => (controlled ? onCropOpenChange?.(v) : setCropOpenSelf(v));

  // Reset cropper when a new image loads
  useEffect(() => {
    setCropOpenSelf(false);
  }, [artPreview]);

  const isSource = variant === "source";

  const aspect = soWidth && soHeight ? soWidth / soHeight : 16 / 9;

  /* A ampliação é a régua da entrega: é ela que decide se o PNG sai nítido ou borrado.
   * Sai da MESMA fonte que alimenta o render (o recorte, quando há recorte), então
   * apertar o crop faz o número subir em vez de escondê-lo. */
  const upscale =
    artDims && soWidth && soHeight
      ? (() => {
          const src = effectiveSource(artDims.width, artDims.height, soWidth, soHeight, frame);
          return upscaleFactor(src.width, src.height, soWidth, soHeight);
        })()
      : 0;
  const lowRes = upscale > LOW_RES_FACTOR;

  const setMode = (mode: FrameConfig["mode"]) => {
    if (mode === "cover") {
      /* A posição/zoom do recorte moram dentro de `ArtCropSurface`, que só existe em
       * `cover` — sair e voltar do modo desmonta e remonta a superfície, e o reset
       * acontece sozinho. Antes era estado duplicado aqui, zerado à mão. */
      onFrameChange((f) => ({ ...f, mode: "cover", cropPixels: undefined }));
    } else {
      onFrameChange((f) => ({ ...f, mode }));
    }
  };

  const nameSize = compact ? "text-[11px]" : "text-xs";
  const dimsSize = compact ? "text-[9px]" : "text-[10px]";

  return (
    <div className="flex flex-col gap-2">
      {/* Preview. No modo controlado o painel NÃO desenha superfície nenhuma: quem
          desenha o recorte é o consumidor, na superfície grande que a tela já tem. */}
      {controlled ? null : frame.mode === "cover" && (!isSource || cropOpen) ? (
        <ArtCropSurface
          artPreview={artPreview}
          aspect={aspect}
          heightClass={isSource ? "h-40" : previewHeightClass}
          onCropPixels={(px) => onFrameChange((f) => ({ ...f, cropPixels: px }))}
        />
      ) : isSource ? null : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artPreview}
          alt="Art"
          className={`w-full rounded-xl bg-black ${previewHeightClass}`}
          style={{ objectFit: frame.mode === "contain" ? "contain" : "fill" }}
        />
      )}

      {/* Info + mode controls */}
      <div className="flex items-center gap-2">
        {/* Em `source` a arte aparece como MINIATURA: identifica o arquivo sem
            virar uma segunda superfície grande. */}
        {isSource && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artPreview}
            alt=""
            className="w-10 h-10 rounded-lg bg-black object-contain shrink-0 border border-neutral-800"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className={`${nameSize} font-bold text-white truncate`}>{fileName || "Artwork"}</p>
          {artDims && (
            /* Uma linha, três termos, e o único marcado é o que decide.
             *
             * Isto substituiu uma caixa de 56px com fundo, borda, ícone de alerta e três
             * orações em negrito, encostada no botão que produz o entregável. Sete sinais
             * para UM fato — e um fato que não é erro nenhum: nada quebrou, não há o que
             * reconhecer, não há botão para clicar. É uma propriedade da combinação
             * arte↔superfície, e o lugar dela é ao lado dos números de que ela fala.
             *
             * A ampliação fica SEMPRE visível e só muda de cor. Aviso que aparece e some
             * ensina a não ler a linha; termo permanente que às vezes acende é régua. */
            <p className={`${dimsSize} text-neutral-500 truncate`}>
              {artDims.width}×{artDims.height}px
              {soWidth && soHeight ? ` → superfície ${Math.round(soWidth)}×${Math.round(soHeight)}` : ""}
              {upscale > 0 && (
                <>
                  {" · "}
                  {/* Âmbar, não verde. O termo marcado estava em `text-acc`, que é o
                      verde de PROGRESSO da BOXY — cor de "está indo bem" avisando que o
                      PNG vai sair borrado. Verde é ação e progresso nesta marca; ressalva
                      é âmbar, a mesma do selo de "Prévia", e essas são as duas únicas
                      exceções de cor do painel. */}
                  <span
                    className={lowRes ? "text-amber-400 font-bold" : "text-neutral-500"}
                    title={
                      lowRes
                        ? `A fonte é ampliada ${dec(upscale)}× para caber na superfície, então o PNG sai borrado. Mande uma arte de ${Math.round(soWidth ?? 0)}px de largura, ou troque para Encaixar.`
                        : "A arte tem resolução de sobra para esta superfície."
                    }
                  >
                    {upscale > 1
                      ? `amplia ${dec(upscale)}×`
                      : `${dec(1 / upscale)}× de folga`}
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        {/* Abre o recorte sob demanda, só onde ele faz sentido (cover recorta). */}
        {isSource && frame.mode === "cover" && (
          <button
            type="button"
            onClick={() => setCropOpen(!cropOpen)}
            title={cropOpen ? "Concluir recorte" : "Ajustar recorte"}
            aria-label={cropOpen ? "Concluir recorte" : "Ajustar recorte"}
            aria-expanded={cropOpen}
            className={`p-1.5 rounded-lg shrink-0 transition-colors ${cropOpen ? "bg-white text-black" : "text-neutral-500 hover:text-white"}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        )}

        {/* O triângulo de baixa resolução saiu daqui: o MESMO fato já era dito, a 120px
            de distância e ao mesmo tempo, pela caixa âmbar do rodapé. Agora quem diz é a
            linha de dimensões acima, uma vez só, ao lado dos números. */}

        {/* Era um segmented escrito à mão — três botões, estado ativo repetido em três
            classNames, significado só no `title` (invisível no teclado). `IconSegmented`
            já é isso, com `aria-label` e `aria-pressed` de fábrica.

            Os ícones também mudaram: `Maximize2` (setas para fora) para "esticar/
            distorcer" não é metáfora de distorção, é de ampliar. Cada ícone agora
            descreve a AÇÃO — `Crop` corta o que sobra, `Shrink` encolhe até caber,
            `Scaling` deforma a escala. */}
        <div className="shrink-0">
          <IconSegmented<FrameConfig["mode"]>
            value={frame.mode}
            onChange={setMode}
            iconSize={14}
            options={[
              { value: "cover", label: "Preencher: corta o que sobra", icon: Crop },
              { value: "contain", label: "Encaixar: arte inteira visível", icon: Shrink },
              { value: "stretch", label: "Esticar: distorce para preencher", icon: Scaling },
            ]}
          />
        </div>

        {onClear && (
          <button
            onClick={onClear}
            className="p-1.5 rounded-lg text-neutral-600 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
            title="Remover arte"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Fundo da arte — pra logo/PNG transparente: preenche atrás (tira o rosa). */}
      <div className="flex items-center gap-2 pt-1.5 mt-0.5 border-t border-neutral-800/60">
        <span className="text-[10px] text-neutral-500 shrink-0">Fundo</span>
        <div className="flex items-center gap-1.5">
          {([
            { v: null, title: "Transparente (mostra o placeholder)", style: { backgroundImage: "linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%),linear-gradient(45deg,#555 25%,#222 25%,#222 75%,#555 75%)", backgroundSize: "6px 6px", backgroundPosition: "0 0,3px 3px" } as React.CSSProperties },
            { v: "#ffffff", title: "Branco", style: { background: "#fff" } },
            { v: "#000000", title: "Preto", style: { background: "#000" } },
          ] as const).map((o) => {
            const on = (frame.bg ?? null) === o.v;
            return (
              <button key={String(o.v)} type="button" title={o.title}
                onClick={() => onFrameChange((f) => ({ ...f, bg: o.v }))}
                className={`w-5 h-5 rounded-full border transition-colors ${on ? "ring-2 ring-acc2 border-acc2" : "border-neutral-700 hover:border-neutral-500"}`}
                style={o.style} />
            );
          })}
          {/* Cor personalizada */}
          <label className={`w-5 h-5 rounded-full border grid place-items-center cursor-pointer overflow-hidden transition-colors ${frame.bg && !["#ffffff", "#000000"].includes(frame.bg.toLowerCase()) ? "ring-2 ring-acc2 border-acc2" : "border-neutral-700 hover:border-neutral-500"}`}
            title="Cor personalizada"
            style={{ background: frame.bg && !["#ffffff", "#000000"].includes(frame.bg.toLowerCase()) ? frame.bg : "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" }}>
            <input type="color" value={frame.bg ?? "#ffffff"} onChange={(e) => onFrameChange((f) => ({ ...f, bg: e.target.value }))}
              className="opacity-0 w-full h-full cursor-pointer" />
          </label>
        </div>
      </div>
    </div>
  );
}
