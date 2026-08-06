"use client";

import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import Image from "next/image";
import Link from "next/link";
import ArtFramePanel, { ArtCropSurface } from "@/components/ArtFramePanel";
import { dec } from "@/lib/utils";
import { readError } from "@/lib/http-error";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  usePanelRef,
} from "react-resizable-panels";
import {
  Search,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
  RotateCcw,
  X,
  Maximize2,
  Folder,
  Image as ImageIcon,
  Layers,
  Settings2,
  Download,
  Loader2,
  AlertTriangle,
  Library,
  Infinity as InfinityIcon,
  Zap,
  ExternalLink,
  LayoutGrid,
  Columns,
  PanelLeft,
  PanelRight,
  Menu,
  Copy,
  Trash2,
  CheckCircle2,
  RefreshCw,
  HardDrive,
  Terminal,
  Upload,
  Camera,
  Bookmark,
  BookmarkCheck,
  ScanSearch,
  ListPlus,
  Pencil,
} from "lucide-react";
import {
  DEFAULT_FRAME,
  type FrameConfig,
  renderFramedArt,
} from "@/lib/art-frame";
import { decideFraming, sampleArtStats, type FramingDecision } from "@/lib/art-classify";
import { dedupeRefs } from "@/lib/dedup";
import Lottie from "lottie-react";
import boxLoaderData from "../../public/lottie/box-loader.json";
import IngestDialog from "@/components/ingest/IngestDialog";
import { DropOverlay } from "@/components/ui/DropOverlay";
import { MasonryGallery } from "@/components/ui/masonry-gallery";
import { Select } from "@/components/ui/Select";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/Dialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { SmartObjectList } from "@/components/mockup/SmartObjectList";
import { PsdDetails } from "@/components/mockup/PsdDetails";
import { ComoUsar } from "@/components/ComoUsar";
import { ConfigPanel } from "@/components/ConfigPanel";
import type { Face, PsdInfo, ArtSlot } from "@/components/mockup/types";
import { Switch } from "@/components/ui/Switch";
import { useContainerColumns } from "@/hooks/use-container-columns";
import { Toaster, toast } from "sonner";
import { pathOrigin } from "@/lib/path-origin";
import { BoxyMark } from "@/components/BoxyMark";

// Reveal-on-hover clássico (opacity-0 + group-hover) esconde a ação primária
// pra sempre em tablet/touch (sem :hover) e não reage a foco de teclado — a
// única rota até o editor ("Abrir") e a ação principal ("Aplicar") ficavam
// inalcançáveis fora do mouse. `hover:hover` restringe o "começa escondido"
// só a quem tem hover de verdade; touch/teclado sempre vê o botão.
const REVEAL_OVERLAY =
  "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:opacity-100";

// Mesma regra para os controles pequenos do canto do card (Photoshop, pasta,
// similares, esconder). Eles nasceram com o reveal cru e repetiram o defeito que
// a constante acima já tinha consertado logo ali: em tablet ficavam invisíveis e
// inalcançáveis, porque largura de tela não é sinal de que existe mouse.
const REVEAL_CONTROL =
  "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:opacity-100";

/** Sentinela de "sem filtro" nos selects: o Radix reserva a string vazia para o
 *  placeholder e recusa um `<Item value="">`. O estado da página continua usando
 *  `""` — a tradução vive só na borda do componente. */
const ALL = "__all";

/** Espaço entre cards do grid, em px. Precisa ser um número porque o masonry usa o
 *  mesmo valor para o gap das colunas e para a conta de quantas colunas cabem —
 *  apertar o gap também faz caber mais uma coluna na mesma largura. */
const GRID_GAP = 16;

/** Aspecto medido da imagem de preview, por id. Vive no módulo (e não em estado)
 *  porque o card é memoizado e desmonta ao rolar/refiltrar: sem este cache o
 *  masonry reajustaria a altura toda vez que o mesmo item voltasse à tela. */
const PREVIEW_ASPECT = new Map<string, number>();

function MockupCardImpl({
  mockup,
  selected,
  hasArt,
  isRendering,
  onSelect,
  onApply,
  onHide,
  onToggleCollection,
  onSimilar,
  inCollection,
  collectionLabel,
  thumbSize,
  renderedUrl,
  enterDelay,
}: {
  mockup: Reference;
  selected: boolean;
  hasArt: boolean;
  isRendering: boolean;
  onSelect: (mockup: Reference) => void;
  onApply: (mockup: Reference) => void;
  onHide: (mockup: Reference) => void;
  /** Ausente quando não há marca selecionada — sem marca não existe coleção para curar. */
  onToggleCollection?: (mockup: Reference) => void;
  onSimilar?: (mockup: Reference) => void;
  inCollection?: boolean;
  collectionLabel?: string;
  thumbSize: number;
  renderedUrl?: string;
  enterDelay: number;
}) {
  const hasImage = !!mockup.referenceImageUrl;

  // O card enquadrava TODA thumbnail em 4/3 com `object-cover`: um outdoor 16:9 e
  // um pôster 2:3 chegavam ao olho recortados, e a escolha do mockup — a decisão
  // inteira desta tela — era feita sobre um pedaço da cena. O aspecto verdadeiro
  // só é conhecido quando a imagem carrega, então ele é medido no `onLoad` e
  // guardado num Map de módulo: rolar de volta (ou refiltrar) não repete o pulo.
  //
  // Cuidado registrado: NÃO usar o `aspect` do catálogo aqui. Aquele é o aspecto
  // do quad/face do smart object, não o da imagem de preview — usá-lo recortaria
  // exatamente o que este trecho existe para deixar de recortar.
  const [aspect, setAspect] = useState(() => PREVIEW_ASPECT.get(mockup.id) ?? 4 / 3);

  // Antes o card inteiro era um <button> envolvendo um <a> ("Abrir") e dois
  // <button> (Aplicar/Pasta/Esconder) — HTML inválido (botão não pode conter
  // conteúdo interativo), o que quebrava justamente o link "Abrir", única rota
  // até o editor de foto. <div role="button"> não é "conteúdo interativo" pro
  // parser HTML, então pode conter os controles reais como irmãos — mesma UX de
  // clique (com stopPropagation nos controles internos), agora com teclado.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(mockup)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(mockup);
        }
      }}
      // Cascata de entrada CURTA e capada (ver `enterDelay` no grid). Em CSS e
      // não num `motion.div`: envolver 60 cards memoizados num componente de
      // animação desfaz exatamente a memoização que segurou o INP desta página.
      // `fill-mode-backwards` para o card não piscar visível antes do delay.
      style={{ animationDelay: `${enterDelay}ms` }}
      className={`group relative rounded-2xl overflow-hidden border transition-colors [transition-duration:var(--dur-slow)] text-left bg-neutral-900/40 hover:bg-neutral-900 cursor-pointer animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards ${
        selected ? "border-white ring-4 ring-white/10 shadow-2xl" : "border-neutral-800 hover:border-neutral-700"
      }`}
    >
      <div className="relative bg-neutral-900 overflow-hidden" style={{ aspectRatio: aspect }}>
        {hasImage ? (
          <Image
            src={mockup.referenceImageUrl}
            alt={mockup.name}
            fill
            className="object-cover transition-transform [transition-duration:var(--dur-slow)] group-hover:scale-[1.04]"
            sizes={`${thumbSize * 1.5}px`}
            loading="lazy"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (!img.naturalWidth || !img.naturalHeight) return;
              const a = img.naturalWidth / img.naturalHeight;
              if (PREVIEW_ASPECT.get(mockup.id) === a) return;
              PREVIEW_ASPECT.set(mockup.id, a);
              setAspect(a);
            }}
          />
        ) : (
          // Ausência é um argumento: um mockup sem prévia é justamente o registro
          // que precisa de ação (regerar o thumbnail). Um ícone cinza sozinho era
          // indistinguível de "ainda carregando" — um buraco no layout, não um
          // estado. Agora ele se nomeia.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-500">
            <Layers className="w-8 h-8" />
            <span className="text-[10px]">Sem prévia</span>
          </div>
        )}
        {renderedUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={renderedUrl}
            alt="Render aplicado"
            className="absolute inset-0 w-full h-full object-cover transition-opacity [transition-duration:var(--dur-slow)]"
          />
        )}

        {/* O tipo continua sendo informação real (decide se a ação é "Aplicar"
            ou "Abrir"), mas era uma pílula SATURADA repetida em todos os cards —
            51 manchas de cor competindo com as próprias thumbnails que o olho
            veio comparar. E o emerald/blue nem é do tema (o design system tem
            acc/acc2/ink). Marca neutra: a informação fica, o ruído sai. */}
        {(mockup.psdPath || mockup.type === "photo") && !isRendering && (
          <span className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-[9px] font-bold px-1.5 py-0.5 rounded text-white/70">
            {mockup.type === "photo" ? "Photo" : "PSD"}
          </span>
        )}

        {isRendering && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          </div>
        )}

        {mockup.type === "photo" && mockup.photoSceneId && !isRendering && (
          <a
            href={`/photo-mockup?scene=${mockup.photoSceneId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`absolute inset-0 bg-black/40 transition-colors [transition-duration:var(--dur-slow)] flex items-center justify-center backdrop-blur-[2px] ${REVEAL_OVERLAY}`}
          >
            <span className="bg-white text-black text-[11px] font-semibold px-4 py-2 rounded-xl hover:bg-neutral-200 transition-ui press shadow-2xl">
              Abrir
            </span>
          </a>
        )}

        {hasArt && mockup.psdPath && !isRendering && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onApply(mockup); }}
            title="Aplicar arte neste mockup"
            className={`absolute inset-0 bg-black/40 transition-colors [transition-duration:var(--dur-slow)] flex items-center justify-center backdrop-blur-[2px] ${REVEAL_OVERLAY}`}
          >
            <span className="bg-white text-black text-[11px] font-semibold px-4 py-2 rounded-xl hover:bg-neutral-200 transition-ui press shadow-2xl">
              Aplicar
            </span>
          </button>
        )}

        {!isRendering && (
          // A opacidade saiu do contêiner e foi para cada botão: o marcador da coleção
          // precisa ficar aceso sem hover, e os outros três continuam surgindo só no hover.
          <div className="absolute top-2 left-2 z-20 flex gap-1.5 transition-[color,background-color,border-color,opacity]">
            {mockup.psdPath && (
              <>
                {/* Abrir no Photoshop. Sem rótulo, como as vizinhas — o `title` é o
                    rótulo. A marca é o wordmark "Ps" no azul do app e não o logo
                    da Adobe: o `simple-icons`, que é a fonte da casa para ícones de
                    marca, **removeu os ícones da Adobe** por questão de marca
                    registrada, e não existe hoje um logo do Photoshop licenciado
                    para empacotar. O "Ps" é reconhecível e não distribui o ativo. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fetch("/api/open-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: mockup.psdPath, mode: "open" }) })
                      .then((r) => { if (!r.ok) toast.error("Não foi possível abrir o PSD."); })
                      .catch(() => toast.error("Não foi possível abrir o PSD."));
                  }}
                  title="Abrir no Photoshop"
                  aria-label="Abrir no Photoshop"
                  className={`${REVEAL_CONTROL} w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm flex items-center justify-center hover:bg-[#001E36] transition-ui press shadow-xl`}
                >
                  <span className="text-[10px] font-semibold leading-none tracking-tighter text-[#31A8FF]">Ps</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fetch("/api/open-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: mockup.psdPath }) });
                  }}
                  title="Mostrar na pasta"
                  aria-label="Mostrar na pasta"
                  className={`${REVEAL_CONTROL} w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm text-white/90 flex items-center justify-center hover:bg-white hover:text-black transition-ui press shadow-xl`}
                >
                  <Folder className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {/* Marcador da coleção da marca. Ele é o ÚNICO controle do card que
                permanece visível sem hover quando está ligado: o estado "este mockup
                já é da marca" é informação que o olho precisa varrendo o grid, não
                algo a descobrir passando o mouse card a card. */}
            {onToggleCollection && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleCollection(mockup); }}
                title={inCollection ? `Tirar de ${collectionLabel}  (B)` : `Guardar em ${collectionLabel}  (B)`}
                aria-pressed={!!inCollection}
                className={`w-7 h-7 rounded-lg backdrop-blur-sm flex items-center justify-center transition-ui press ${
                  inCollection
                    // Ligado, ele é ESTADO, não ação: um bloco branco chapado em cada
                    // card curado gritava mais que a própria thumbnail. Marca discreta
                    // (fundo escuro, ícone na cor da ação) que fica nítida no hover.
                    ? "opacity-100 bg-black/55 text-acc2 hover:bg-black/75"
                    : `${REVEAL_CONTROL} bg-black/70 text-white/90 hover:bg-white hover:text-black shadow-xl`
                }`}
              >
                {inCollection ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
              </button>
            )}
            {/* "Ver similares" — a pergunta que se faz olhando um card específico, e que
                nem a busca por imagem (precisa de arquivo) nem a sugestão de marca (fala
                da marca, não do mockup) respondiam. */}
            {onSimilar && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onSimilar(mockup); }}
                title="Ver mockups parecidos com este  (S)"
                aria-label="Ver mockups parecidos com este"
                className={`${REVEAL_CONTROL} w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm text-white/90 flex items-center justify-center hover:bg-white hover:text-black transition-ui press shadow-xl`}
              >
                <ScanSearch className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onHide(mockup); }}
              title="Esconder este mockup"
              className={`${REVEAL_CONTROL} w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm text-white/90 flex items-center justify-center hover:bg-white hover:text-black transition-ui press shadow-xl`}
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      {/* O nome do mockup é O DADO QUE DECIDE O CLIQUE — esta tela inteira existe
          para escolher um. Ele estava mais fraco que os chips de tag da sidebar.
          O estúdio era `uppercase tracking-widest` em 100% dos cards (textura, não
          informação) e, sem estúdio, ESCREVIA "General" — um valor que o banco não
          tem. Ausência agora é ausência. */}
      <div className="p-3">
        <p className="text-xs font-semibold truncate text-neutral-200 group-hover:text-white transition-colors">{mockup.name}</p>
        {mockup.studio && (
          <p className="text-[10px] text-neutral-500 truncate mt-0.5">{mockup.studio}</p>
        )}
      </div>
    </div>
  );
}

// Memoizado: sem isso, cada tecla digitada na busca (debounce de 300ms) e cada
// mudança de estado não relacionada (thumbSize, seleção…) re-renderizava os
// 60+ cards do grid — cada um com <Image>+backdrop-blur — o maior custo de INP
// da home. Só funciona porque onSelect/onApply/onHide agora são funções
// ESTÁVEIS do pai (useCallback) que recebem o mockup como argumento, em vez de
// closures novas por item a cada render.
const MockupCard = memo(MockupCardImpl);

interface Reference {
  id: string;
  name: string;
  studio?: string;
  description: string;
  referenceImageUrl: string;
  dimensions: Record<string, string[]>;
  psdFileName?: string;
  psdPath?: string;
  psdSizeBytes?: number;
  smartObjectName?: string;
  soInnerWidth?: number;
  soInnerHeight?: number;
  type?: "photo";
  photoSceneId?: string;
}

interface Brand {
  id: string;
  name: string;
  logoUrl?: string;
  colors: Array<{ hex: string; name: string; role?: string }>;
}

interface Suggestion {
  ref: Reference;
  score: number;
  reasons: string[];
}

function SuggestionCard({
  suggestion,
  selected,
  isRendering,
  onSelect,
  onApply,
}: {
  suggestion: Suggestion;
  selected: boolean;
  isRendering: boolean;
  onSelect: () => void;
  onApply: () => void;
}) {
  const { ref, reasons } = suggestion;
  // Mesmo problema do MockupCard: container não pode ser <button> se "Aplicar"
  // vira um <button> real (botão-em-botão é HTML inválido). <div role="button">
  // preserva clique/seleção + teclado sem aninhar interativo em interativo.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group relative w-48 shrink-0 rounded-2xl overflow-hidden border text-left transition-colors [transition-duration:var(--dur-slow)] bg-neutral-900/40 hover:bg-neutral-900 cursor-pointer ${
        selected ? "border-white ring-4 ring-white/10 shadow-2xl scale-105 z-10" : "border-neutral-800 hover:border-neutral-700"
      }`}
    >
      <div className="aspect-[4/3] relative bg-neutral-900 overflow-hidden">
        {ref.referenceImageUrl ? (
          <Image 
            src={ref.referenceImageUrl} 
            alt={ref.name} 
            fill 
            className="object-cover transition-transform [transition-duration:var(--dur-slow)] group-hover:scale-[1.04]"
            sizes="192px"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-600">
            <Layers className="w-10 h-10" />
          </div>
        )}
        
        {ref.psdPath && !isRendering && (
          <span className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-[8px] font-semibold px-1.5 py-0.5 rounded text-neutral-300">PSD</span>
        )}

        {isRendering && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
        )}

        {ref.psdPath && !isRendering && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onApply(); }}
            title="Aplicar arte neste mockup"
            className={`absolute inset-0 bg-black/40 transition-colors [transition-duration:var(--dur-slow)] flex items-center justify-center backdrop-blur-[2px] ${REVEAL_OVERLAY}`}
          >
            <span className="bg-white text-black text-[10px] font-semibold px-3 py-1.5 rounded-xl hover:bg-neutral-200 transition-ui press shadow-2xl">
              Aplicar
            </span>
          </button>
        )}
      </div>
      <div className="p-3">
        <p className="text-[11px] font-bold truncate text-neutral-300 group-hover:text-white transition-colors">{ref.name}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {reasons.slice(0, 2).map((r, i) => (
            <span key={i} className="text-[8px] font-bold text-neutral-500 uppercase tracking-tighter bg-neutral-800/50 px-1 rounded-sm">{r}</span>
          ))}
        </div>
      </div>
    </div>
  );
}



interface Studio {
  name: string;
  count: number;
}

interface TagEntry {
  value: string;
  count: number;
}

const STEP_LABELS: Record<string, string> = {
  queued: "Na fila",
  reading_psd: "Lendo PSD",
  psd_loaded: "PSD carregado",
  parsing_psd: "Processando PSD",
  psd_parsed: "PSD processado",
  reading_art: "Lendo arte",
  upscaling_art: "Melhorando resolução",
  art_ok: "Arte verificada",
  art_ready: "Arte pronta",
  finding_smart_objects: "Localizando smart object",
  smart_objects_found: "Smart object encontrado",
  replacing: "Aplicando arte",
  warped: "Aplicando perspectiva",
  replaced: "Arte aplicada",
  hidden_layer: "Ocultando camada",
  rendering: "Compondo camadas",
  composited: "Composição pronta",
  exporting_png: "Exportando imagem",
  done: "Concluído",
};

const DIM_LABELS: Record<string, string> = {
  mockup_type: "Tipo",
  niche: "Nicho",
  style: "Estilo",
  vibe: "Vibe",
  material: "Material",
  setting: "Ambiente",
  color_palette: "Cor",
};

/**
 * Rótulo de uma dimensão que o mapa acima não cobre — o acervo tem `aesthetic`,
 * `angle`, `texture`, `lighting`… que chegam como a chave crua.
 *
 * Existe porque tirar o `uppercase` do cabeçalho EXPÔS um defeito que ele
 * escondia: com CAIXA ALTA, "Material" (mapeado) e "aesthetic" (cru) pareciam
 * iguais; sem ela, a mesma coluna mostrava "aesthetic", "angle", "Material",
 * "texture". Não foi a regressão, foi a revelação — mas o resultado na tela é
 * ruim do mesmo jeito, e o conserto é normalizar a fonte, não repor a maquiagem.
 */
function dimLabel(dim: string): string {
  const mapped = DIM_LABELS[dim];
  if (mapped) return mapped;
  const limpo = dim.replace(/_/g, " ");
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

interface Asset {
  id: string;
  url: string;
  directUrl: string;
  variant: string;
  label: string;
  thumbnail: string;
}

function ResizeHandle({ className = "", id }: { className?: string, id?: string }) {
  return (
    <PanelResizeHandle
      id={id}
      className={`relative flex w-2 items-center justify-center bg-neutral-950 transition-colors hover:bg-white/5 outline-none group ${className}`}
    >
      <div className="z-10 h-12 w-[2px] rounded-full bg-neutral-800 transition-colors group-hover:bg-white/20" />
    </PanelResizeHandle>
  );
}

export default function Home() {
  const [refs, setRefs] = useState<Reference[]>([]);
  const [thumbSize, setThumbSize] = useState(250);
  // O masonry precisa saber quantas colunas existem; a largura útil é a do
  // contêiner (entre painéis colapsáveis), nunca a da janela.
  const [gridRef, gridCols] = useContainerColumns(thumbSize, GRID_GAP);
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();

  /**
   * Sidebar recolhida em viewport estreito.
   *
   * O painel é `defaultSize="20%"` com `minSize="15%"`: a 390px isso são ~60-78px
   * de coluna, onde "Logo construction" vira "Logo construc" e os dois selects
   * viram "S." e "T.". E NADA disso reprovava o portão — a raiz é
   * `overflow-hidden`, então o conteúdo cortado dentro do painel não faz o
   * documento rolar. É a mesma armadilha do portão do ingest: medir o documento
   * passa sempre; quem acusa é medir o elemento contra a caixa dele, e olhar a
   * captura. Abaixo de `lg` a sidebar não cabe, então não ocupa espaço — o botão
   * do header continua abrindo.
   */
  useEffect(() => {
    const aplicar = () => {
      const p = leftPanelRef.current;
      if (!p) return;
      if (window.innerWidth < 1024) { if (!p.isCollapsed()) p.collapse(); }
      else if (p.isCollapsed()) p.expand();
    };
    aplicar();
    window.addEventListener("resize", aplicar);
    return () => window.removeEventListener("resize", aplicar);
  }, [leftPanelRef]);
  const [studios, setStudios] = useState<Studio[]>([]);
  const [aspects, setAspects] = useState<{ name: string; count: number }[]>([]);
  const [allTags, setAllTags] = useState<Record<string, TagEntry[]>>({});
  const [total, setTotal] = useState(0);
  /**
   * Mockups DISTINTOS no recorte, e não linhas do catálogo. Duas refs podem apontar para
   * o mesmo `.psd`: medido, 4.480 registros eram 3.520 arquivos. O badge dizia 4.480 e
   * inflava o acervo em 18% — número que a tela afirmava e o disco não sustentava.
   */
  const [totalDistinct, setTotalDistinct] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  // Erro do fetchPage (Mongo offline, 500 etc.) — distinto do empty-state real:
  // "nenhum resultado pros filtros" não é a mesma coisa que "a API caiu".
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Cauda algorítmica: quando o RECORTE acaba, o acervo continua. Ver `/api/references/tail`.
  const [tail, setTail] = useState<Reference[]>([]);
  const [tailLoading, setTailLoading] = useState(false);
  const [tailDone, setTailDone] = useState(false);
  // Falha da cauda é ESTADO PRÓPRIO. Colapsá-la em `tailDone` fazia a tela dizer "você viu
  // o acervo inteiro" quando o que aconteceu foi a rota cair: o zero silencioso, na versão
  // mais cara — mentira sobre o tamanho do acervo, contada com cara de conclusão.
  const [tailError, setTailError] = useState<string | null>(null);
  const [tailMode, setTailMode] = useState<"semantic" | "lexical" | "catalog" | null>(null);
  const [search, setSearch] = useState("");
  const [studio, setStudio] = useState("");
  // Formato da superfície — o critério que o pipeline usa o tempo todo pra casar arte↔cena.
  const [aspect, setAspect] = useState<"" | "square" | "portrait" | "landscape">("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  // OR é o PADRÃO, não uma opção escondida. Marcar mais uma tag na taxonomia é
  // um gesto de "quero ver também isto" — quem clica em `billboard` e depois em
  // `outdoor` está ampliando a busca, não pedindo o mockup que é as duas coisas
  // ao mesmo tempo. Com AND o segundo clique quase sempre esvaziava o grid, e o
  // acervo parecia menor a cada tag ligada. O AND continua alcançável no
  // seletor E/OU (e por `?tagMode=AND` na URL) para o caso raro de interseção.
  const [tagMode, setTagMode] = useState<"AND" | "OR">("OR");
  /** Ordem da LISTAGEM. Com busca ativa quem ordena é a relevância (o motor ignora). */
  const [sort, setSort] = useState<"popular" | "name" | "shuffle">("shuffle");
  /**
   * Semente da home embaralhada: UMA por carga da página.
   * Fica em `useState(() => …)` e não em módulo porque é isso que faz "abrir o app"
   * significar "galeria nova" — e, ao mesmo tempo, rolar até a página 3 continuar
   * pedindo a MESMA ordem ao servidor. Sortear por request devolveria card repetido.
   * O valor sorteado no servidor difere do sorteado no cliente — o que seria mismatch de
   * hidratação se ele fosse parar no HTML. Não vai: a semente só viaja como parâmetro de
   * fetch, nunca é renderizada. Se um dia virar texto na tela, tem que sair daqui.
   */
  const [shuffleSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [hideDuplicates, setHideDuplicates] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [lastHidden, setLastHidden] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [expandedDims, setExpandedDims] = useState<Set<string>>(new Set());
  /**
   * O ingest inteiro (origem, varredura, aprovação, gravação) vive no
   * IngestDialog. Aqui sobra só "está aberto?".
   *
   * Antes eram três estados espalhados nesta página (`wizardStep`,
   * `folderInput`, `reviewPath`) e o fluxo trocava de container no meio: a
   * origem num bloco da sidebar, o resto num diálogo por cima. O retorno da
   * escrita aparecia na sidebar, que podia estar colapsada — confirmação de
   * escrita irreversível invisível.
   */
  const [ingestOpen, setIngestOpen] = useState(false);

  const [visantConnected, setVisantConnected] = useState<boolean | null>(null);
  const [visantLoginUrl, setVisantLoginUrl] = useState<string | null>(null);
  const [visantConnecting, setVisantConnecting] = useState(false);
  const [visantAuthError, setVisantAuthError] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<string>("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  /** O X do painel fecha o PAINEL. Desconectar a marca é outra ação (a do seletor). */
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  /**
   * Coleção da marca ativa — a curadoria manual.
   *
   * O Set é o que o grid inteiro consulta para acender o marcador, então ele mora aqui e
   * não dentro do card: 60 cards perguntando "eu estou na coleção?" a uma lista seria
   * O(n²) a cada render, e o card é memoizado justamente para não repetir trabalho.
   * `collectionRefs` é a lista ORDENADA (a ordem é curadoria) usada pela aba Coleção.
   */
  const [collectionIds, setCollectionIds] = useState<Set<string>>(new Set());
  const [collectionRefs, setCollectionRefs] = useState<Reference[]>([]);
  const [collectionName, setCollectionName] = useState("");
  const [collectionLoading, setCollectionLoading] = useState(false);
  /**
   * Coleção ativa. Vazio = "a da marca conectada" (chave = brandId, como sempre foi).
   * Uma coleção avulsa (`col_…`) não depende de marca nenhuma — curadoria também é
   * feita fora de cliente ("referências de tipografia").
   */
  const [collectionId, setCollectionId] = useState("");
  const [collections, setCollections] = useState<
    { id: string; name: string; count: number; brandId?: string }[]
  >([]);
  /** Dialog de nome: `create` nasce vazio, `rename` nasce com o nome atual. */
  const [nameDialog, setNameDialog] = useState<{ mode: "create" | "rename"; value: string } | null>(null);
  /** Aba do grid: o acervo inteiro ou só o que foi curado para a marca. */
  const [view, setView] = useState<"all" | "collection">("all");
  const [completions, setCompletions] = useState<Reference[]>([]);
  const [completionsLoading, setCompletionsLoading] = useState(false);
  const [completionsError, setCompletionsError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestLimit, setSuggestLimit] = useState(18);

  const [brandAssets, setBrandAssets] = useState<Asset[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);

  const [showSession, setShowSession] = useState(false);
  const [sessionSelected, setSessionSelected] = useState<Set<string>>(new Set());

  const [selected, setSelected] = useState<Reference | null>(null);
  // Arte por slot — um slot por face do mockup (faces = SOs editáveis distintos)
  const [artSlots, setArtSlots] = useState<Record<number, ArtSlot>>({});
  const [activeSlot, _setActiveSlot] = useState(0);
  const activeSlotRef = useRef(0);
  const setActiveSlot = (i: number) => { activeSlotRef.current = i; _setActiveSlot(i); };
  const [fullscreen, setFullscreen] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [previewRendering, setPreviewRendering] = useState(false);
  const [renderingRefId, setRenderingRefId] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<string | null>(null);
  const [renderCache, setRenderCache] = useState<Record<string, { url: string; name: string }>>({});
  const [renderTime, setRenderTime] = useState<number | null>(null);
  const [renderElapsed, setRenderElapsed] = useState(0);
  const [renderLogs, setRenderLogs] = useState<Array<{ step: string; detail?: string }>>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [psdInfo, setPsdInfo] = useState<PsdInfo | null>(null);
  const [selectedSo, setSelectedSo] = useState<string>("");
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [isPreviewResult, setIsPreviewResult] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [copiedPng, setCopiedPng] = useState(false);
  
  // Advanced settings modal
  const [showSettings, setShowSettings] = useState(false);

  // Painel "Ocultos" — o que foi escondido do catálogo (nada disso saiu do disco).
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenList, setHiddenList] = useState<Reference[] | null>(null);
  const [hiddenLoading, setHiddenLoading] = useState(false);

  // Duplicates modal
  type DupeGroup ={ hash: string; sizeBytes: number; keepPath: string; removePaths: string[]; wastedBytes: number };
  const [showDupes, setShowDupes] = useState(false);
  const [dupesScanning, setDupesScanning] = useState(false);
  const [dupesGroups, setDupesGroups] = useState<DupeGroup[]>([]);
  const [dupesProgress, setDupesProgress] = useState<{ hashed: number; total: number; pct: number } | null>(null);
  const [dupesSummary, setDupesSummary] = useState<{ filesScanned: number; totalWastedBytes: number } | null>(null);
  const [dupesError, setDupesError] = useState<string | null>(null);
  const [dupesFilter, setDupesFilter] = useState("");
  const [dupesSort, setDupesSort] = useState<"wasted" | "size" | "copies">("wasted");
  const [dupesExpanded, setDupesExpanded] = useState<Set<string>>(new Set());
  const [dupesLogs, setDupesLogs] = useState<string[]>([]);
  const [dupesElapsed, setDupesElapsed] = useState(0);
  const dupesTimerRef = useRef<ReturnType<typeof setInterval>>(null);
  const dupesLogsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { dupesLogsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [dupesLogs]);

  const scanDuplicates = useCallback(async (refresh = false) => {
    setDupesScanning(true);
    setDupesGroups([]);
    setDupesProgress(null);
    setDupesSummary(null);
    setDupesError(null);
    setDupesExpanded(new Set());
    setDupesLogs(["Iniciando scan..."]);
    setDupesElapsed(0);
    if (dupesTimerRef.current) clearInterval(dupesTimerRef.current);
    dupesTimerRef.current = setInterval(() => setDupesElapsed((s) => s + 1), 1000);
    const addLog = (msg: string) => setDupesLogs((p) => [...p.slice(-60), msg]);
    try {
      const params = new URLSearchParams({ stream: "1" });
      if (refresh) params.set("refresh", "1");
      const res = await fetch(`/api/duplicates?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "scan") {
              addLog(`Listados ${ev.filesFound.toLocaleString()} arquivos. ${ev.candidates} candidatos com tamanho duplicado`);
            } else if (ev.type === "progress") {
              setDupesProgress({ hashed: ev.hashed, total: ev.total, pct: ev.pct });
              if (ev.currentFile) addLog(`Hashing ${ev.hashed}/${ev.total}: ${ev.currentFile}`);
            } else if (ev.type === "group") {
              setDupesGroups((p) => [...p, ev.group]);
              const name = ev.group.keepPath.split(/[/\\]/).pop() || "";
              addLog(`Duplicata: ${name} × ${ev.group.removePaths.length + 1} cópias, ${dec(ev.group.wastedBytes / 1e6)} MB desperdiçados`);
            } else if (ev.type === "complete") {
              setDupesSummary({ filesScanned: ev.filesScanned, totalWastedBytes: ev.totalWastedBytes });
              addLog(`✓ Concluído: ${ev.groups} grupos encontrados em ${ev.filesScanned.toLocaleString()} arquivos`);
            } else if (ev.type === "error") {
              throw new Error(ev.message);
            }
          } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
        }
      }
    } catch (err) {
      setDupesError(String((err as Error).message || err));
      addLog(`✗ Erro: ${(err as Error).message}`);
    } finally {
      if (dupesTimerRef.current) clearInterval(dupesTimerRef.current);
      setDupesScanning(false);
    }
  }, []);

  const filteredSortedGroups = useMemo(() => {
    let result = [...dupesGroups];
    if (dupesFilter) {
      const q = dupesFilter.toLowerCase();
      result = result.filter(
        (g) => g.keepPath.toLowerCase().includes(q) || g.removePaths.some((p) => p.toLowerCase().includes(q))
      );
    }
    if (dupesSort === "wasted") result.sort((a, b) => b.wastedBytes - a.wastedBytes);
    else if (dupesSort === "size") result.sort((a, b) => b.sizeBytes - a.sizeBytes);
    else if (dupesSort === "copies") result.sort((a, b) => b.removePaths.length - a.removePaths.length);
    return result;
  }, [dupesGroups, dupesFilter, dupesSort]);

  // UI Section States
  const [artSectionCollapsed, setArtSectionCollapsed] = useState(false);
  /* O recorte é um MODO da superfície de resultado, não um painel à parte — por isso o
   * estado mora aqui, com quem é dono da superfície, e não dentro do `ArtFramePanel`. */
  const [cropOpen, setCropOpen] = useState(false);
  /* `showAdjustments` saiu com o `PsdDetails` (estado que só uma caixa lia),
   * `expandSoList` já estava morto, e o `useEffect` que sincronizava a seção de
   * arte virou parte do `onAbertoChange` do `SmartObjectList`: reagir ao próprio
   * estado num efeito é como a sincronia fica longe de quem a causa. */
  const [showSmartObjects, setShowSmartObjects] = useState(true);

  const renderTimerRef = useRef<ReturnType<typeof setInterval>>(null);
  const autoPreviewTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Faces do PSD selecionado + slot ativo derivado
  const faces = psdInfo?.faces ?? [];
  const activeArt = artSlots[activeSlot] ?? null;
  const artPreview = activeArt?.preview ?? null;

  const artFile = activeArt?.file ?? null;
  const artDims = activeArt?.dims ?? null;
  const frame = activeArt?.frame ?? DEFAULT_FRAME;
  const anyArt = Object.values(artSlots).some((s) => !!s?.preview);
  const filledCount = faces.length
    ? faces.filter((_, i) => artSlots[i]?.preview).length
    : anyArt ? 1 : 0;

  const setFrame = (up: FrameConfig | ((f: FrameConfig) => FrameConfig)) =>
    setArtSlots((s) => {
      const cur = s[activeSlotRef.current];
      if (!cur) return s;
      const next = typeof up === "function" ? up(cur.frame) : up;
      return { ...s, [activeSlotRef.current]: { ...cur, frame: next } };
    });

  const clearSlot = (i: number) =>
    setArtSlots((s) => {
      const next = { ...s };
      delete next[i];
      return next;
    });

  const pendingRenderRef = useRef<Reference | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Contexto do enquadramento automático em REFS: `handleArtSelect` é chamada de
  // dentro de listeners registrados uma vez (colar, soltar na página), que
  // congelariam a closure na primeira renderização e decidiriam o enquadramento
  // com o mockup e a marca de quando a página abriu.
  const psdInfoRef = useRef<PsdInfo | null>(null);
  const soDimsRef = useRef<{ w?: number; h?: number }>({});
  const brandColorRef = useRef<string | null>(null);
  /** Última decisão automática — mostrada ao usuário, nunca silenciosa. */
  const [framingHint, setFramingHint] = useState<(FramingDecision & { slot: number }) | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  /** Container que ROLA de verdade (o `<main>`) — é ele o root do sentinel. */
  const gridScrollRef = useRef<HTMLElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerReqId = useRef(0);
  const previewBlobUrl = useRef<string | null>(null);

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (loading) return;
      setLoading(true);
      setFetchError(null);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const params = new URLSearchParams({
        page: String(pageNum),
        limit: "60",
      });
      if (search) params.set("search", search);
      if (studio) params.set("studio", studio);
      if (aspect) params.set("aspect", aspect);
      if (activeTags.length) {
        params.set("tags", activeTags.join(","));
        params.set("tagMode", tagMode);
      }
      if (sort !== "popular") params.set("sort", sort);
      if (sort === "shuffle") {
        params.set("seed", String(shuffleSeed));
        // Marca ativa enviesa o sorteio (não filtra): as sugestões dela ocupam a primeira
        // dobra, o acervo inteiro continua atrás.
        if (brandId) params.set("brandId", brandId);
      }
      params.set("has_psd", "true");

      try {
        const res = await fetch(`/api/references?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (append) {
          setRefs((prev) => [...prev, ...data.references]);
        } else {
          setRefs(data.references);
          // Recorte novo ⇒ cauda velha morre. Sugestão herdada do filtro anterior é a
          // pior forma de "mais como isto": parece resultado da busca que acabou de mudar.
          setTail([]);
          setTailDone(false);
          setTailError(null);
          setTailMode(null);
        }
        setTotal(data.total);
        setTotalDistinct(data.totalDistinct ?? data.total);
        setHasMore(pageNum < data.pages);
        setPage(pageNum);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Mongo offline é caminho documentado deste projeto (AGENTS.md), não
        // exceção — antes só AbortError era tratado, então qualquer outro erro
        // (Mongo caído, 500) deixava refs=[] com hasMore=true intocado: o
        // IntersectionObserver via sentinelRef refazia fetchPage em loop contra
        // uma API que já caiu, e o badge do header continuava com o total antigo
        // enquanto o grid renderizava vazio. setHasMore(false) mata o loop; zerar
        // o total (só em fetch não-incremental) evita o badge contradizer o grid.
        setFetchError(String((err as Error).message || err));
        setHasMore(false);
        if (!append) { setTotal(0); setTotalDistinct(0); }
      } finally {
        setLoading(false);
        setInitialLoad(false);
      }
    },
    [search, studio, aspect, activeTags, tagMode, sort, shuffleSeed, brandId, loading]
  );

  // Busca/facetas na URL: sem isto o F5 jogava tudo fora e um filtro montado com
  // cuidado não era compartilhável — o detalhe que separa "página" de "app".
  // Lido no mount (não no useState, que rodaria na SSR e daria mismatch de hidratação)
  // e o primeiro fetch espera esse parse pra não disparar duas vezes.
  const [urlReady, setUrlReady] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = p.get("q") ?? "";
    if (q) setSearch(q);
    if (p.get("studio")) setStudio(p.get("studio")!);
    const a = p.get("aspect");
    if (a === "square" || a === "portrait" || a === "landscape") setAspect(a);
    const t = p.get("tags");
    if (t) setActiveTags(t.split(",").filter(Boolean).slice(0, 5));
    // Só o AND vem na URL: ele é que é o desvio do padrão agora.
    if (p.get("tagMode") === "AND") setTagMode("AND");
    const s = p.get("sort");
    if (s === "name" || s === "popular" || s === "shuffle") setSort(s);
    setUrlReady(true);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (studio) p.set("studio", studio);
    if (aspect) p.set("aspect", aspect);
    if (activeTags.length) {
      p.set("tags", activeTags.join(","));
      if (tagMode === "AND") p.set("tagMode", "AND");
    }
    if (sort !== "popular") p.set("sort", sort);
    const qs = p.toString();
    // replaceState (não push): digitar na busca não pode encher o histórico de
    // entradas — o "voltar" tem que sair da página, não desfazer letra por letra.
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [urlReady, search, studio, aspect, activeTags, tagMode, sort]);

  useEffect(() => {
    if (!urlReady) return;
    setRefs([]);
    setPage(1);
    setHasMore(true);
    setInitialLoad(true);
    // Mexer num filtro textual sai da busca por imagem — os dois disputam o
    // mesmo grid, e manter o chip aceso enquanto a lista já é outra seria a UI
    // dizendo que está filtrando por algo que não está mais valendo.
    setImageSearch(null);
    fetchPage(1, false);
    // Trocar de marca refaz o grid SÓ no modo Descobrir — é lá que a marca enviesa a
    // ordem. Nos outros modos a resposta seria idêntica, e refazer seria fetch à toa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlReady, search, studio, aspect, activeTags, tagMode, sort, sort === "shuffle" ? brandId : ""]);

  useEffect(() => {
    // Estúdios e aspectos saem do MESMO catálogo do grid — o dropdown não pode prometer
    // um estúdio que a listagem não entrega.
    fetch("/api/references/facets?has_psd=true")
      .then((r) => r.json())
      .then((f) => { setStudios(f.studios ?? []); setAspects(f.aspects ?? []); })
      .catch(() => {});
    fetch("/api/references/tags")
      .then((r) => r.json())
      .then(setAllTags);
    // Checa conexão com a Visant; se conectado, carrega as marcas
    fetch("/api/auth/visant")
      .then((r) => r.json())
      .then((d) => {
        setVisantConnected(!!d.connected);
        if (d.connected) fetchBrands();
      })
      .catch(() => setVisantConnected(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBrands = useCallback(() => {
    fetch("/api/brands")
      .then((r) => (r.ok ? r.json() : { brands: [] }))
      .then((d) => {
        setBrands(d.brands || []);
        const saved = localStorage.getItem("mockup-store:brandId");
        if (saved && (d.brands || []).some((b: Brand) => b.id === saved)) {
          setBrandId(saved);
        }
      })
      .catch(() => {});
  }, []);

  // "Login as Visant" — device flow: abre o link de aprovação e fica de olho
  const connectVisant = useCallback(async () => {
    setVisantConnecting(true);
    setVisantAuthError(null);
    setVisantLoginUrl(null);
    try {
      const res = await fetch("/api/auth/visant", { method: "POST" });
      if (!res.ok) throw new Error(await readError(res));
      const d = await res.json();
      setVisantLoginUrl(d.verificationUriComplete);
      window.open(d.verificationUriComplete, "_blank", "noopener");

      const deadline = Date.now() + (d.expiresInSec || 600) * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const poll = await fetch("/api/auth/visant/poll").then((r) => r.json());
        if (poll.status === "authorized") {
          setVisantConnected(true);
          setVisantLoginUrl(null);
          fetchBrands();
          return;
        }
        if (poll.status === "error") throw new Error(poll.message);
      }
      throw new Error("Login expirou. Tente de novo");
    } catch (err) {
      setVisantAuthError(String((err as Error).message || err));
      setVisantLoginUrl(null);
    } finally {
      setVisantConnecting(false);
    }
  }, [fetchBrands]);

  // Sugestões brand-aware. `force` re-roda o perfil LLM (regenerar); `limit`
  // permite "ver mais".
  const loadSuggestions = useCallback(
    (opts?: { force?: boolean; limit?: number }) => {
      if (!brandId) {
        setSuggestions([]);
        return;
      }
      localStorage.setItem("mockup-store:brandId", brandId);
      const params = new URLSearchParams({
        brandId,
        limit: String(opts?.limit ?? suggestLimit),
      });
      if (opts?.force) params.set("refresh", "true");
      setLoadingSuggestions(true);
      setSuggestError(null);
      fetch(`/api/suggest?${params}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(await readError(r));
          const d = await r.json();
          setSuggestions(d.suggestions || []);
        })
        .catch((err) => {
          setSuggestions([]);
          setSuggestError(String(err.message || err));
        })
        .finally(() => setLoadingSuggestions(false));
    },
    [brandId, suggestLimit]
  );

  // Recarrega quando a marca muda (volta ao limite base).
  useEffect(() => {
    setSuggestLimit(18);
    setSuggestionsOpen(true); // marca nova ⇒ recomendações de novo à vista
    loadSuggestions({ limit: 18 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  // ------------------------------------------------------------ coleção (marca ou avulsa)

  /** A chave que vai no servidor: a coleção escolhida à mão, ou a da marca conectada. */
  const collectionKey = collectionId || brandId;

  /** Lista do seletor. Recarregada depois de toda escrita que muda nome/contagem. */
  const loadCollections = useCallback(async () => {
    try {
      const r = await fetch("/api/collections");
      if (!r.ok) return;
      const d = await r.json();
      setCollections(d.collections || []);
    } catch {
      // Lista é conveniência: falhar em carregá-la não pode atrapalhar a curadoria.
    }
  }, []);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  const loadCollection = useCallback(async () => {
    if (!collectionKey) {
      setCollectionIds(new Set());
      setCollectionRefs([]);
      setCollectionName("");
      return;
    }
    setCollectionLoading(true);
    try {
      const r = await fetch(`/api/collections?collectionId=${encodeURIComponent(collectionKey)}`);
      if (!r.ok) throw new Error(await readError(r));
      const d = await r.json();
      setCollectionRefs(d.references || []);
      setCollectionName(d.name || "");
      setCollectionIds(new Set<string>((d.items || []).map((i: { id: string }) => i.id)));
    } catch (err) {
      // A coleção é trabalho manual do usuário: falhar em LER não pode fazer o grid
      // parecer que ela esvaziou. Mantém o que já estava em memória e diz o que houve.
      toast.error(`Não foi possível carregar a coleção: ${String((err as Error).message || err)}`);
    } finally {
      setCollectionLoading(false);
    }
  }, [collectionKey]);

  // Trocar de marca solta a coleção avulsa: a marca nova traz a coleção dela.
  useEffect(() => {
    setCollectionId("");
  }, [brandId]);

  useEffect(() => {
    void loadCollection();
    // Sem coleção ativa (nem marca, nem avulsa) a aba Coleção não tem o que mostrar.
    if (!collectionKey) setView("all");
  }, [collectionKey, loadCollection]);

  /**
   * Guardar/tirar da coleção. Otimista: o marcador acende na hora e volta atrás se o
   * servidor recusar — curar é uma sequência rápida de cliques, e esperar o round-trip
   * a cada card transformaria a curadoria numa fila.
   */
  const toggleCollection = useCallback(
    async (mockup: Reference) => {
      if (!collectionKey) return;
      const member = !collectionIds.has(mockup.id);
      setCollectionIds((prev) => {
        const next = new Set(prev);
        if (member) next.add(mockup.id);
        else next.delete(mockup.id);
        return next;
      });
      setCollectionRefs((prev) =>
        member ? [...prev.filter((r) => r.id !== mockup.id), mockup] : prev.filter((r) => r.id !== mockup.id),
      );
      try {
        const r = await fetch("/api/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectionId: collectionKey, ids: [mockup.id], member }),
        });
        if (!r.ok) throw new Error(await readError(r));
        // Desfazer em vez de confirmar. Tirar da coleção é reversível, então pedir
        // confirmação antes cobraria um clique de todo mundo para proteger o engano de
        // poucos; o caminho barato é agir na hora e deixar a volta à mão. Só o REMOVER
        // ganha o aviso: guardar por engano não custa nada, perder curadoria custa.
        if (!member) {
          toast(`Fora da coleção: ${mockup.name}`, {
            action: {
              label: "Desfazer",
              onClick: () => void toggleCollectionRef.current?.(mockup),
            },
          });
        }
      } catch (err) {
        toast.error(`Não salvou na coleção: ${String((err as Error).message || err)}`);
        void loadCollection();
      }
    },
    [collectionKey, collectionIds, loadCollection],
  );
  // O desfazer chama a própria callback, que ainda não existe quando ela é criada.
  // O ref quebra o ciclo sem custar a identidade estável de que o card memoizado depende.
  const toggleCollectionRef = useRef<typeof toggleCollection | null>(null);
  toggleCollectionRef.current = toggleCollection;

  /** Curar em lote o que já está selecionado no grid. */
  const addSelectionToCollection = useCallback(
    async (ids: string[]) => {
      if (!collectionKey || !ids.length) return;
      try {
        const r = await fetch("/api/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectionId: collectionKey, ids, member: true }),
        });
        if (!r.ok) throw new Error(await readError(r));
        await loadCollection();
        toast.success(`${ids.length} ${ids.length === 1 ? "mockup guardado" : "mockups guardados"} na coleção`);
      } catch (err) {
        toast.error(`Não salvou na coleção: ${String((err as Error).message || err)}`);
      }
    },
    [collectionKey, loadCollection],
  );

  /**
   * "Completar a coleção": o que a marca sugere ⊕ os vizinhos semânticos do que já
   * foi curado. É a coleção ensinando o que procurar — quanto mais curada, melhor a
   * sugestão. Sem embeddings configurados, sobra só a sugestão da marca, que já existia.
   */
  const loadCompletions = useCallback(async () => {
    if (!brandId) return;
    setCompletionsLoading(true);
    try {
      const r = await fetch(`/api/collections/similar?brandId=${encodeURIComponent(brandId)}&limit=18`);
      if (!r.ok) throw new Error(await readError(r));
      const d = await r.json();
      setCompletions(d.references || []);
      setCompletionsError(null);
    } catch (err) {
      // Erro e vazio são estados DIFERENTES. Engolir a falha e pintar lista vazia
      // faz "a Visant caiu" parecer "não temos sugestão para esta marca" — o
      // usuário conclui que a feature não serve e nunca mais volta nela.
      setCompletions([]);
      setCompletionsError(String((err as Error).message || err));
    } finally {
      setCompletionsLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    if (view === "collection" && brandId) void loadCompletions();
  }, [view, brandId, collectionIds.size, loadCompletions]);

  /**
   * Persiste uma ordem nova da coleção. A ordem é curadoria, então ela vale tanto quanto
   * o conteúdo. Mora separada do arrasto porque o teclado (alt+seta) reordena pelo mesmo
   * caminho — duas UIs para o mesmo gesto não podem virar duas implementações que
   * divergem no primeiro conserto.
   */
  const applyOrder = useCallback(
    async (ids: string[]) => {
      if (!collectionKey) return;
      setCollectionRefs((prev) => ids.map((id) => prev.find((r) => r.id === id)!).filter(Boolean));
      try {
        const r = await fetch("/api/collections", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectionId: collectionKey, order: ids }),
        });
        if (!r.ok) throw new Error(await readError(r));
      } catch (err) {
        toast.error(`Não salvou a ordem: ${String((err as Error).message || err)}`);
        void loadCollection();
      }
    },
    [collectionKey, loadCollection],
  );

  /** Reordenar arrastando. */
  const dropOn = useCallback(
    async (targetId: string) => {
      if (!dragId || dragId === targetId || !collectionKey) return;
      const ids = collectionRefs.map((r) => r.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ...ids.splice(from, 1));
      setDragId(null);
      await applyOrder(ids);
    },
    [dragId, collectionKey, collectionRefs, applyOrder],
  );

  /**
   * Nome que aparece na aba. O default do servidor é neutro ("Coleção") porque ele
   * não conhece marca nenhuma — quem sabe o nome da marca é aqui. Antes o servidor
   * mandava "Coleção 69e8e78b51a13978c9bc90d8" e o id de banco ia parar na tela.
   */
  const collectionLabel = useMemo(() => {
    if (collectionName && collectionName !== "Coleção") return collectionName;
    const owner = collections.find((c) => c.id === collectionKey)?.brandId || (collectionId ? "" : brandId);
    const brand = owner ? brands.find((b) => b.id === owner) : undefined;
    return brand ? `Coleção ${brand.name}` : "Coleção";
  }, [collectionName, collections, collectionKey, collectionId, brandId, brands]);

  /** Carregando e ainda sem nada para mostrar — não vale reservar altura de card. */
  const suggestionsPending = loadingSuggestions && suggestions.length === 0;

  /** Opções do seletor: as coleções do disco ⊕ a da marca conectada (que pode ainda não existir). */
  const collectionOptions = useMemo(() => {
    const nameOf = (c: { id: string; name: string; brandId?: string }) => {
      if (c.name && c.name !== "Coleção") return c.name;
      const brand = c.brandId ? brands.find((b) => b.id === c.brandId) : undefined;
      return brand ? `Coleção ${brand.name}` : "Coleção";
    };
    const opts = collections.map((c) => ({ value: c.id, label: nameOf(c), hint: c.count }));
    if (brandId && !collections.some((c) => c.id === brandId)) {
      const brand = brands.find((b) => b.id === brandId);
      opts.unshift({ value: brandId, label: brand ? `Coleção ${brand.name}` : "Coleção", hint: 0 });
    }
    return opts;
  }, [collections, brands, brandId]);

  /** Cria (avulsa, sem exigir marca) ou renomeia — o mesmo diálogo, um caminho de escrita. */
  const submitCollectionName = useCallback(async () => {
    if (!nameDialog) return;
    const name = nameDialog.value.trim();
    try {
      if (nameDialog.mode === "create") {
        const r = await fetch("/api/collections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ create: true, name }),
        });
        if (!r.ok) throw new Error(await readError(r));
        const d = await r.json();
        setCollectionId(d.collection.id);
        setView("collection");
      } else {
        if (!collectionKey) return;
        const r = await fetch("/api/collections", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectionId: collectionKey, name }),
        });
        if (!r.ok) throw new Error(await readError(r));
        const d = await r.json();
        setCollectionName(d.name || "");
      }
      setNameDialog(null);
      await loadCollections();
    } catch (err) {
      toast.error(`Não deu para salvar o nome: ${String((err as Error).message || err)}`);
    }
  }, [nameDialog, collectionKey, loadCollections]);

  /** Apagar existe porque criar avulsa existe — senão o seletor só acumula lixo. */
  const removeCollection = useCallback(async () => {
    if (!collectionKey) return;
    try {
      const r = await fetch(`/api/collections?collectionId=${encodeURIComponent(collectionKey)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(await readError(r));
      setCollectionId("");
      setView("all");
      await loadCollections();
      toast.success("Coleção apagada");
    } catch (err) {
      toast.error(`Não deu para apagar: ${String((err as Error).message || err)}`);
    }
  }, [collectionKey, loadCollections]);

  const [assetError, setAssetError] = useState<string | null>(null);

  const openLibrary = useCallback(async () => {
    if (!brandId) return;
    setShowLibrary(true);
    setLoadingAssets(true);
    setAssetError(null);
    try {
      const res = await fetch(`/api/brands/${encodeURIComponent(brandId)}/assets`);
      if (!res.ok) throw new Error(await readError(res));
      const d = await res.json();
      setBrandAssets(d.assets || []);
    } catch (err) {
      setAssetError(String((err as Error).message || err));
      setBrandAssets([]);
    } finally {
      setLoadingAssets(false);
    }
  }, [brandId]);

  const loadAssetAsArt = useCallback(async (asset: Asset) => {
    try {
      const res = await fetch(asset.url);
      if (!res.ok) return;
      const blob = await res.blob();
      const ext = blob.type.includes("svg") ? "svg" : blob.type.split("/")[1] || "png";
      handleArtSelect(new File([blob], `${asset.label}.${ext}`, { type: blob.type }));
      setShowLibrary(false);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Baixa o logo da marca (via proxy server-side) e carrega como arte
  const loadBrandLogoAsArt = useCallback(async () => {
    if (!brandId) return false;
    try {
      const res = await fetch(`/api/brands/${encodeURIComponent(brandId)}/logo`);
      if (!res.ok) return false;
      const blob = await res.blob();
      const ext = blob.type.includes("svg") ? "svg" : blob.type.split("/")[1] || "png";
      const brandName = brands.find((b) => b.id === brandId)?.name || "logo";
      handleArtSelect(new File([blob], `${brandName}.${ext}`, { type: blob.type }));
      return true;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, brands]);

  // Scroll infinito que NUNCA deixa o usuário bater no fim.
  //
  // Duas armadilhas pagas aqui:
  //  1. Quem rola é o `<main>`, não a janela. Com `root: null` o rootMargin infla o
  //     retângulo da VIEWPORT, mas o sentinel continua recortado pelo overflow do
  //     `<main>` — ou seja, a margem de 600px não antecipava nada e a página só
  //     carregava quando o fim já estava na tela. Root = o container que rola.
  //  2. Margem fixa mente em telas altas: 600px é meia dobra num monitor 4K e duas
  //     dobras num laptop. A distância de pré-carga é medida em ALTURAS do container.
  /**
   * A cauda: quando o RECORTE acaba, o acervo não acabou. Em vez de "Fim da Biblioteca"
   * (que era mentira em toda busca filtrada — 40 resultados de um catálogo de milhares),
   * o rodapé vira sugestão algorítmica e o scroll continua. Só quando a cauda também
   * seca — aí sim o usuário viu tudo — é que aparece o fim.
   */
  const loadTail = useCallback(async () => {
    if (tailLoading || tailDone || tailError) return;
    setTailLoading(true);
    try {
      const shown = [...refs, ...tail];
      const res = await fetch("/api/references/tail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seeds: shown.slice(-24).map((r) => r.id),
          // Escondido entra no exclude: senão a rota gasta vaga da página com card que o
          // filtro do cliente vai jogar fora, e a cauda chega curta sem motivo aparente.
          exclude: [...shown.map((r) => r.id), ...hiddenIds],
          limit: 30,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const more = (data.references ?? []) as Reference[];
      if (!more.length) {
        setTailDone(true);
      } else {
        setTail((prev) => [...prev, ...more]);
        setTailMode(data.mode ?? null);
      }
    } catch (err) {
      // Falhar não é acabar. Quem some daqui é a sugestão, e o usuário fica sabendo disso
      // com um botão para tentar de novo, no lugar de um "acabou" que ele acreditaria.
      setTailError(String((err as Error).message || err));
    } finally {
      setTailLoading(false);
    }
  }, [refs, tail, hiddenIds, tailLoading, tailDone, tailError]);

  const maybeLoadMore = useCallback(() => {
    if (view !== "all") return;
    if (hasMore) {
      if (!loading) fetchPage(page + 1, true);
      return;
    }
    if (!loading && !fetchError) void loadTail();
  }, [hasMore, loading, page, fetchPage, view, fetchError, loadTail]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = gridScrollRef.current;
    if (!sentinel || !root) return;

    // 1.5 dobras de antecedência: no scroll normal a próxima página chega antes de o
    // usuário ver o rodapé; num flick violento ele encosta no spinner, não no vazio.
    const prefetch = Math.max(800, Math.round(root.clientHeight * 1.5));

    const observer = new IntersectionObserver(
      (entries) => {
        // A Coleção não pagina: ela é uma lista curada, inteira, que já veio de uma vez.
        // Sem esta guarda o sentinel continuaria puxando páginas do ACERVO por baixo dela.
        if (entries[0].isIntersecting) maybeLoadMore();
      },
      { root, rootMargin: `0px 0px ${prefetch}px 0px` }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [maybeLoadMore]);

  // Uma página curta (ou uma que cabe inteira dentro da janela de pré-carga) deixa o
  // sentinel intersectando SEM mudar de estado — e o IntersectionObserver só avisa em
  // mudança. Sem este empurrão a lista trava com meia tela de conteúdo.
  useEffect(() => {
    if (loading || tailLoading || view !== "all") return;
    if (!hasMore && (tailDone || tailError)) return;
    const sentinel = sentinelRef.current;
    const root = gridScrollRef.current;
    if (!sentinel || !root) return;

    const gap = sentinel.getBoundingClientRect().top - root.getBoundingClientRect().bottom;
    if (gap < Math.max(800, root.clientHeight * 1.5)) maybeLoadMore();
  }, [refs.length, tail.length, loading, tailLoading, hasMore, tailDone, tailError, view, maybeLoadMore]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

      // `/` e ⌘K/Ctrl+K levam ao campo de busca — o gesto que todo app de
      // catálogo já colocou no dedo do usuário. Nunca sequestra o `/` de quem
      // está digitando.
      if (!typing && (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"))) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      /* Cascata do Escape: fecha UMA camada por vez, da mais interna para a mais
         externa. O recorte entra aqui, e não num listener próprio — dois listeners de
         Escape em `window` disparam os dois, e o Esc fechava o recorte E o painel
         inteiro na mesma tecla. Visto acontecendo antes de virar linha. */
      if (e.key === "Escape") {
        if (fullscreen) { setFullscreen(false); return; }
        if (typing && el === searchInputRef.current) { el.blur(); return; }
        if (cropOpen) { setCropOpen(false); return; }
        if (selected) { setSelected(null); return; }
      }

      // Reordenar a coleção pelo teclado. Arrastar era a ÚNICA forma de mudar a
      // ordem, e ordem é curadoria: quem não usa mouse simplesmente não curava.
      // Alt+seta move o card selecionado uma posição, que é o gesto que todo
      // gerenciador de lista já colocou no dedo do usuário.
      if (!typing && e.altKey && view === "collection" && selected &&
          (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        const ids = collectionRefs.map((r) => r.id);
        const from = ids.indexOf(selected.id);
        const to = from + (e.key === "ArrowRight" ? 1 : -1);
        if (from >= 0 && to >= 0 && to < ids.length) {
          const next = [...ids];
          next.splice(to, 0, ...next.splice(from, 1));
          void applyOrder(next);
        }
        return;
      }

      // As duas ações novas do card, no dedo: guardar na coleção e ver parecidos.
      // Elas agem sobre o card SELECIONADO, que é o mesmo alvo das setas — assim o
      // teclado tem um alvo só, e não um para navegar e outro para agir.
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && selected) {
        if (e.key === "b" || e.key === "B") {
          if (!brandId) {
            toast("Selecione uma marca para usar a coleção");
          } else {
            e.preventDefault();
            void toggleCollectionRef.current?.(selected);
          }
          return;
        }
        if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          void showSimilarRef.current?.(selected);
          return;
        }
      }

      // Setas navegam o grid — mas não enquanto se digita (senão a seta que
      // deveria mover o cursor no campo troca o mockup selecionado) e não com
      // modificador (⌥→ é "pular palavra" do sistema, não "próximo card").
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!selected || !refs.length) return;
      const idx = refs.findIndex((r) => r.id === selected.id);
      if (idx === -1) return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = refs[idx + 1];
        if (next) selectRef(next);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = refs[idx - 1];
        if (prev) selectRef(prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    /* `cropOpen` PRECISA estar aqui. O handler fecha sobre o valor do render em que
       foi registrado, e sem esta dependência ele enxergava `cropOpen` sempre falso:
       a cascata do Escape pulava o recorte e fechava o painel inteiro, com o recorte
       aberto na tela. O `eslint-disable` abaixo é o que deixa esse tipo de erro
       entrar calado — toda variável nova usada aqui dentro entra nesta lista à mão. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, refs, fullscreen, view, collectionRefs, brandId, applyOrder, cropOpen]);

  // useCallback (não função solta): precisa de identidade ESTÁVEL — é passada
  // direto como prop `onSelect` pro MockupCard memoizado (React.memo só evita
  // re-render se a prop-função não mudar a cada render do pai).
  const selectRef = useCallback((ref: Reference) => {
    // Sinal de relevância: o resultado aberto A PARTIR de uma busca reordena o ranking
    // da próxima vez (`search-telemetry`, mesmo princípio do `engine-feedback` que já
    // aprende com cada publish). Lido de um ref pra não quebrar a identidade estável
    // desta callback — ela é prop do MockupCard memoizado. keepalive: o beacon precisa
    // sobreviver à navegação. Best-effort: nunca bloqueia nem atrasa a seleção.
    // O `if (q)` que morava aqui quebrava o laço inteiro: só o clique vindo DE UMA
    // BUSCA era contado, e navegar o grid — que é como a maior parte das sessões
    // acontece — não ensinava nada. Resultado real: `signals.json` com dois docs no
    // acervo inteiro, um deles do smoke test. Sem isto a ordenação "Mais usados"
    // seria idêntica ao alfabético para sempre.
    // A query continua importando: `logClick("")` só incrementa a popularidade
    // global; com termo, também grava a afinidade query↔doc.
    void fetch("/api/references/click", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: searchRef.current.trim(), id: ref.id }),
      keepalive: true,
    }).catch(() => {});
    setSelected(ref);
    setRenderResult(null);
    setRenderTime(null);
    setPsdInfo(null);
    setSelectedSo("");
    setHiddenLayers(new Set());
    // Faces mudam por mockup: mantém a arte do slot 0 (recorte resetado,
    // o aspect do SO muda), descarta os slots extras
    setActiveSlot(0);
    setArtSlots((s): Record<number, ArtSlot> =>
      s[0] ? { 0: { ...s[0], frame: { ...s[0].frame, cropPixels: undefined } } } : {}
    );
    if (ref.psdPath) {
      // Regex para pegar o nome do arquivo independente de ser / ou \
      const psdName = ref.psdPath.split(/[/\\]/).pop()?.replace(/\.psd$/i, "") || "";
      fetch(`/api/psd-info?name=${encodeURIComponent(psdName)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (!d) return;
          setPsdInfo(d);
          const sos = d.smartObjects ?? [];
          if (sos.length === 1) {
            setSelectedSo(sos[0].path || sos[0].name);
          } else if (sos.length > 1) {
            const TARGET = /double\.click|your\.design|your\.image|place\.here|smart\.object|artwork|design\.here|edite|edit.*aqui|\(edite\)|\(editar\)|\[edit|here|aqui|arte\b|art\b|\(!?\)/i;
            const match = sos.find((s: { name: string; path: string }) => TARGET.test(s.name) || TARGET.test(s.path));
            if (match) setSelectedSo(match.path || match.name);
          }
        })
        .catch(() => {});
    }
  }, []);

  // Idem selectRef: identidade estável pra virar prop `onApply` do MockupCard
  // memoizado sem criar uma closure nova por card a cada render do grid.
  const handleCardApply = useCallback(
    (ref: Reference) => {
      selectRef(ref);
      pendingRenderRef.current = ref;
    },
    [selectRef]
  );

  // Espelho de `search` pra telemetria de clique — ver selectRef.
  const searchRef = useRef("");
  useEffect(() => { searchRef.current = search; }, [search]);

  const handleSearchInput = (value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setSearch(value), 300);
  };

  // ── Busca por imagem ──────────────────────────────────────────────────────
  // `/api/search-by-image` (índice vetorial da Visant) existia desde o commit da
  // busca unificada e NUNCA teve interface: capacidade construída, paga e nunca
  // entregue. Aqui ela vira um botão ao lado da busca textual.
  const [imageSearch, setImageSearch] = useState<{ thumb: string; count: number } | null>(null);
  const [imageSearching, setImageSearching] = useState(false);
  /**
   * "Parecidos com este card". `mode` diz de onde veio a semelhança — semântica (vetor)
   * ou léxica (tags do próprio mockup) — porque a qualidade das duas é bem diferente e o
   * usuário merece saber qual está vendo antes de concluir que a busca é ruim.
   */
  const [similarTo, setSimilarTo] = useState<{ id: string; name: string; mode: string; count: number } | null>(null);
  const [similarLoading, setSimilarLoading] = useState(false);
  /** Onde o usuário estava quando pediu "parecidos" — para devolvê-lo ali ao voltar. */
  const similarFrom = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  /**
   * Reduz a imagem antes de mandar. O embedding olha estrutura, não pixel a
   * pixel — subir 20 MB de PNG só compra latência. 512px no maior lado é o
   * suficiente e cabe folgado no corpo da requisição.
   */
  const toSearchPayload = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Não deu para ler o arquivo"));
      reader.onload = () => {
        const img = new window.Image();
        img.onerror = () => reject(new Error("Arquivo de imagem inválido"));
        img.onload = () => {
          const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
          const cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(img.naturalWidth * scale));
          cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
          cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL("image/jpeg", 0.82));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });

  const runImageSearch = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Busca por imagem precisa de uma imagem", { description: file.name });
      return;
    }
    setImageSearching(true);
    try {
      const dataUrl = await toSearchPayload(file);
      const res = await fetch("/api/search-by-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl, limit: 60 }),
      });
      if (!res.ok) {
        // 401 é "faça login", 502 é "o serviço caiu" — a rota já separa os dois
        // e a mensagem tem de separar também, senão manda tentar de novo quem
        // só precisa conectar.
        if (res.status === 401) {
          toast.error("Conecte a Visant para buscar por imagem", {
            description: "A busca visual usa o índice vetorial da conta.",
          });
        } else {
          toast.error("A busca por imagem falhou", { description: await readError(res) });
        }
        return;
      }
      const d = await res.json();
      const ids: string[] = (d.matches ?? []).map((m: { id: string }) => m.id).filter(Boolean);
      if (!ids.length) {
        toast("Nenhum mockup parecido", { description: "Nada no índice se aproximou dessa imagem." });
        return;
      }
      const hydrate = await fetch(`/api/references?ids=${encodeURIComponent(ids.join(","))}`);
      const page = await hydrate.json();
      const found: Reference[] = page.references ?? [];

      setRefs(found);
      setTotal(found.length);
      setTotalDistinct(found.length);
      setHasMore(false);
      setFetchError(null);
      setInitialLoad(false);
      setImageSearch({ thumb: dataUrl, count: found.length });
    } catch (err) {
      toast.error("A busca por imagem falhou", {
        description: String((err as Error)?.message ?? err),
      });
    } finally {
      setImageSearching(false);
    }
  }, []);

  /** Volta pro catálogo normal — o filtro por imagem é sempre reversível. */
  const clearImageSearch = useCallback(() => {
    setImageSearch(null);
    setHasMore(true);
    fetchPage(1, false);
  }, [fetchPage]);

  /**
   * "Ver similares" a partir de um card — mesmo mecanismo da busca por imagem (a lista
   * vira o resultado, com um chip que desfaz), porque para o usuário são a mesma coisa:
   * o grid parou de ser o catálogo e virou uma resposta. Duas maneiras de sair da lista
   * normal com duas UIs diferentes seria a tela se contradizendo.
   */
  const showSimilar = useCallback(async (mockup: Reference) => {
    similarFrom.current = gridScrollRef.current?.scrollTop ?? 0;
    setSimilarLoading(true);
    try {
      const r = await fetch(`/api/references/similar?id=${encodeURIComponent(mockup.id)}&limit=60`);
      if (!r.ok) throw new Error(await readError(r));
      const d = await r.json();
      const found: Reference[] = d.references ?? [];
      if (!found.length) {
        toast("Nada parecido encontrado", {
          description: "Este mockup não tem tags suficientes, e o índice semântico não o alcança.",
        });
        return;
      }
      setRefs(found);
      setTotal(found.length);
      setTotalDistinct(found.length);
      setHasMore(false);
      setFetchError(null);
      setInitialLoad(false);
      setImageSearch(null);
      setView("all");
      setSimilarTo({ id: mockup.id, name: mockup.name, mode: d.mode, count: found.length });
    } catch (err) {
      toast.error("Não foi possível buscar parecidos", { description: String((err as Error).message || err) });
    } finally {
      setSimilarLoading(false);
    }
  }, []);

  // Mesma razão do `toggleCollectionRef`: o atalho de teclado é montado antes desta
  // callback existir, e o ref evita reordenar 300 linhas de arquivo por causa disso.
  const showSimilarRef = useRef<typeof showSimilar | null>(null);
  showSimilarRef.current = showSimilar;

  const clearSimilar = useCallback(() => {
    setSimilarTo(null);
    setHasMore(true);
    // Voltar tem de devolver o usuário ao lugar de onde ele saiu. Sem isto, olhar
    // parecidos e desistir custava rolar o catálogo inteiro de novo — a ação punia
    // quem a experimentou, que é a forma mais rápida de ninguém mais experimentar.
    const back = similarFrom.current;
    void fetchPage(1, false).then(() => {
      if (back != null) requestAnimationFrame(() => gridScrollRef.current?.scrollTo({ top: back }));
    });
  }, [fetchPage]);

  // Copia o render pro clipboard como PNG (preview vem em JPEG → converte)
  const copyRenderAsPng = async () => {
    if (!renderResult) return;
    try {
      const blob = await fetch(renderResult).then((r) => r.blob());
      let png = blob;
      if (blob.type !== "image/png") {
        const bmp = await createImageBitmap(blob);
        const cv = document.createElement("canvas");
        cv.width = bmp.width;
        cv.height = bmp.height;
        cv.getContext("2d")!.drawImage(bmp, 0, 0);
        png = await new Promise<Blob>((resolve, reject) =>
          cv.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob falhou"))), "image/png")
        );
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setCopiedPng(true);
      setTimeout(() => setCopiedPng(false), 1500);
    } catch (err) {
      // Só o console não serve: o botão voltava ao normal e nada ia pro
      // clipboard — indistinguível de sucesso pra quem está olhando a tela.
      console.error("Copiar PNG falhou:", err);
      toast.error("Não deu para copiar o PNG", {
        description: String((err as Error)?.message ?? err),
      });
    }
  };

  const handleArtSelect = (file: File, slotIdx?: number) => {
    // Antes esta guarda era um `return` mudo: arrastar um PDF (ou um .ai, ou uma
    // pasta) na ação PRIMÁRIA do produto não dava retorno nenhum — o usuário
    // ficava olhando para uma tela que não mudou, sem saber se o arquivo não
    // serve ou se o app travou. Falha silenciosa é a pior das mentiras de estado.
    if (!file.type.startsWith("image/")) {
      toast.error("Esse arquivo não é uma imagem", {
        description: `${file.name}: use PNG, JPG, WEBP ou SVG.`,
      });
      return;
    }
    const idx = slotIdx ?? activeSlotRef.current;
    setRenderResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const img = new window.Image();
      img.onload = () => {
        // Enquadramento decidido na entrada, não deixado no default.
        //
        // A regra do projeto (AGENTS.md: *layout = cover; logo = contain + fundo
        // da marca*) existia só em documento — toda arte caía em `DEFAULT_FRAME`
        // (cover, sem fundo) e o logo do cliente saía CORTADO nas bordas do
        // billboard. É o erro mais caro e mais silencioso deste produto: o PNG
        // fica bonito e a marca, decepada.
        //
        // A superfície ativa entra na conta: arte na proporção da face não
        // precisa de tarja, e é isso que separa "logo" de "layout full-bleed
        // com fundo sólido" — que as duas heurísticas de pixel confundiriam.
        const faceNow = psdInfoRef.current?.faces?.[idx];
        const soW = faceNow?.innerWidth || soDimsRef.current.w;
        const soH = faceNow?.innerHeight || soDimsRef.current.h;
        let frame = DEFAULT_FRAME;
        let decision: FramingDecision | null = null;
        try {
          const isVector = file.type.includes("svg") || /\.svgz?$/i.test(file.name);
          decision = decideFraming(sampleArtStats(img, isVector), {
            soAspect: soW && soH ? soW / soH : undefined,
            brandColor: brandColorRef.current,
          });
          frame = { ...DEFAULT_FRAME, mode: decision.mode, bg: decision.bg };
        } catch {
          // Heurística é conveniência: se ela falhar, o comportamento antigo
          // continua valendo. Nunca impede a arte de entrar.
        }

        setArtSlots((s) => ({
          ...s,
          [idx]: {
            file,
            preview: url,
            dims: { width: img.naturalWidth, height: img.naturalHeight },
            frame,
            img,
          },
        }));
        // A decisão é automática, então tem de ser VISÍVEL e reversível — o
        // painel de enquadramento continua mandando mais que a heurística.
        if (decision) setFramingHint({ ...decision, slot: idx });
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  };

  // Colar imagem com Ctrl+V em qualquer lugar da página
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) =>
        i.type.startsWith("image/")
      );
      const file = item?.getAsFile();
      if (file) handleArtSelect(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Soltar arte em QUALQUER lugar da página.
  //
  // O contador de profundidade não é capricho: `dragleave` dispara toda vez que
  // o ponteiro cruza a borda de um filho, então um `setDragging(false)` direto
  // faz o overlay piscar sem parar por cima de um grid com 60 cards. Contar
  // enter/leave é o único jeito estável de saber que o arrasto saiu da janela.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    const hasFile = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types || []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFile(e)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      // Sem isto o navegador ABRE o arquivo solto e o trabalho da sessão some.
      if (hasFile(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFile(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      dragDepth.current = 0;
      setDragging(false);
      if (!hasFile(e)) return;
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) handleArtSelect(file);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Builds the arts array (framed art per slot) — shared between preview and export.
  const buildArts = (sel: typeof selected) => {
    if (!sel) return [];
    const arts: Array<{ smartObject?: string; artBase64: string }> = [];
    if (faces.length > 0) {
      faces.forEach((f, i) => {
        const slot = artSlots[i];
        if (!slot?.preview) return;
        let payload = slot.preview;
        if (slot.img && f.innerWidth && f.innerHeight) {
          try { payload = renderFramedArt(slot.img, slot.frame, f.innerWidth, f.innerHeight); } catch {}
        }
        arts.push({ smartObject: f.smartObject, artBase64: payload });
      });
    } else {
      /* O slot ATIVO, não o slot 0.
       *
       * Sem faces detectadas, `filledCount` habilita o botão com QUALQUER slot
       * preenchido (`anyArt`), e esta linha lia só o `[0]`. As duas contas precisam
       * concordar: enquanto discordarem, existe um estado em que o botão fica verde e
       * a lista sai vazia. O caminho antigo continua valendo quando o slot ativo está
       * vazio, então nada que funcionava passa a não funcionar. */
      const slot = artSlots[activeSlotRef.current]?.preview
        ? artSlots[activeSlotRef.current]
        : Object.values(artSlots).find((s) => s?.preview) ?? artSlots[0];
      if (slot?.preview) {
        let payload = slot.preview;
        if (slot.img && soWidth && soHeight) {
          try { payload = renderFramedArt(slot.img, slot.frame, soWidth, soHeight); } catch {}
        }
        arts.push({ smartObject: selectedSo || sel.smartObjectName || "Your design", artBase64: payload });
      }
    }
    return arts;
  };

  // Preview: client-side Web Worker (OffscreenCanvas + psd-engine, no TCP round-trip).
  const handlePreviewWorker = async (sel: typeof selected, arts: Array<{ smartObject?: string; artBase64: string }>) => {
    if (!sel?.psdPath) return;

    // Lazy-init worker
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("../workers/render.worker.ts", import.meta.url), { type: "module" });
    }
    const worker = workerRef.current;

    const reqId = ++workerReqId.current;
    setRendering(true);
    setPreviewRendering(true);
    setRenderingRefId(sel.id);
    setCurrentStep("Compondo…");

    return new Promise<void>((resolve) => {
      const cleanup = (err?: string) => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        // A prévia dispara SOZINHA no hover-apply: sem toast, o worker morria e a tela
        // simplesmente não mudava — o único sinal era o botão de logs aparecendo no
        // rodapé. O caminho do render final já avisava; este não avisava.
        if (err) {
          setRenderLogs([{ step: "error", detail: err }]);
          toast.error("A prévia falhou", { description: err });
        }
        setRendering(false);
        setPreviewRendering(false);
        setRenderingRefId(null);
        setCurrentStep(null);
        resolve();
      };

      const onMessage = (e: MessageEvent) => {
        if (e.data.id !== reqId) return;
        if (e.data.error) {
          cleanup(e.data.error);
        } else if (e.data.blob) {
          if (previewBlobUrl.current) URL.revokeObjectURL(previewBlobUrl.current);
          const url = URL.createObjectURL(e.data.blob);
          previewBlobUrl.current = url;
          setRenderResult(url);
          setIsPreviewResult(true);
          cleanup();
        }
      };

      const onError = (e: ErrorEvent) => {
        // Worker failed to load or threw an uncaught error — fall back to TCP preview
        workerRef.current?.terminate();
        workerRef.current = null;
        cleanup(`Worker error: ${e.message}`);
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);

      // Worker handles its own PSD fetch + caching by path — no buffer transfer needed.
      worker.postMessage({
        id: reqId,
        psdPath: sel.psdPath,
        arts,
        hideLayers: Array.from(hiddenLayers),
      });
    });
  };

  const handleRender = async (preview = false) => {
    /* Os dois `return` silenciosos da ação primária.
     *
     * Nenhum dos dois foi visto disparando: são defesa, não conserto de bug observado.
     * Existem porque um `return` sem aviso na ação que produz o entregável é
     * indistinguível de ter clicado errado — a mesma mentira do stream sem `complete`,
     * uma camada antes. Se um dia dispararem, o usuário fica sabendo.
     *
     * O que É real e está no código é a assimetria que o segundo cobre: `filledCount`
     * (quem habilita o botão) aceita QUALQUER slot preenchido quando não há faces
     * detectadas, e `buildArts` lia só o slot 0. Habilitar por uma conta e executar por
     * outra é como um botão passa a mentir, tenha ou não acontecido ainda. */
    if (!selected?.psdPath) {
      toast.error("Este mockup não tem PSD", {
        description: "Sem arquivo no disco não há o que renderizar. Reindexe o acervo ou escolha outro mockup.",
      });
      return;
    }

    const arts = buildArts(selected);
    if (arts.length === 0) {
      toast.error("Nenhuma arte chegou ao render", {
        description: "A arte não está no destino que este mockup usa. Clique na face desejada em Smart Objects e mande a arte de novo.",
      });
      return;
    }

    // Preview → client-side Worker (fast, no TCP)
    if (preview) {
      return handlePreviewWorker(selected, arts);
    }

    // Render final é o sinal MAIS FORTE de "este mockup serve" — muito acima de
    // abrir o card. Como o contador é incremental, renderizar simplesmente conta
    // de novo: quem foi aberto E renderizado acumula o dobro de quem só foi olhado,
    // sem precisar de peso especial nenhum.
    void fetch("/api/references/click", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: searchRef.current.trim(), id: selected.id }),
      keepalive: true,
    }).catch(() => {});

    // Full export → render-server TCP (full-res, node-canvas)
    setRendering(true);
    setRenderingRefId(selected.id);
    setRenderResult(null);
    setRenderElapsed(0);
    setRenderLogs([]);
    setCurrentStep(null);
    renderTimerRef.current = setInterval(
      () => setRenderElapsed((s) => s + 1),
      1000
    );

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          psdPath: selected.psdPath,
          arts,
          hideLayers: Array.from(hiddenLayers),
          preview: false,
          stream: true,
        }),
      });

      if (!res.ok) {
        /* NUNCA `res.json()` seco aqui. Resposta de erro sem corpo (o 500 que o
         * Next devolve quando o handler morre antes de responder) fazia o parse
         * estourar DENTRO do try, e o `catch` lá embaixo mostrava
         * "SyntaxError: Unexpected end of JSON input" — o erro do parser em cima
         * do erro real, que ficava invisível. O status é o que sempre existe. */
        const raw = await res.text().catch(() => "");
        let detail = "";
        try { detail = (JSON.parse(raw) as { error?: string }).error || ""; } catch {}
        if (!detail) detail = raw.trim().slice(0, 200) || `O servidor respondeu HTTP ${res.status} sem explicação.`;
        setRenderLogs([{ step: "error", detail }]);
        // O log só aparece se o usuário abrir o painel de logs — o entregável
        // final falhando precisa avisar sozinho.
        toast.error("O render falhou", { description: detail });
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) return;

      let buffer = "";
      let completedJobId = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.step === "complete") {
              setRenderTime(event.durationMs);
              completedJobId = event.jobId;
              setRenderLogs((prev) => [...prev, { step: "complete", detail: `done in ${event.durationMs}ms` }]);
            } else if (event.step) {
              setRenderLogs((prev) => [...prev, { step: event.step, detail: event.detail }]);
              if (event.step !== "error") setCurrentStep(STEP_LABELS[event.step] || event.step);
            }
          } catch {}
        }
      }

      if (completedJobId) {
        const url = `/api/render?jobId=${completedJobId}`;
        setRenderResult(url);
        setIsPreviewResult(false);
        // Só o render FINAL entra na sessão. Antes o cache guardava preview e
        // final com a mesma cara, então "Baixar todos" misturava JPEG de prévia
        // com PNG de entrega e ninguém via a diferença até abrir os arquivos.
        setRenderCache((c) => ({ ...c, [selected.id]: { url, name: selected.name } }));
      } else {
        // O stream terminou sem evento `complete`: servidor fechou a conexão, worker
        // morreu depois do 200, rede caiu no meio. O `finally` desliga o `rendering` e a
        // tela volta EXATAMENTE ao estado anterior — sem resultado, sem erro, sem toast.
        // Quem esperou 40s não conseguia distinguir isso de ter clicado errado.
        const detail = "O render terminou sem produzir arquivo. O render-server pode ter caído no meio.";
        setRenderLogs((prev) => [...prev, { step: "error", detail }]);
        toast.error("O render falhou", { description: detail });
      }
    } catch (err) {
      setRenderLogs((prev) => [...prev, { step: "error", detail: String(err) }]);
      toast.error("O render falhou", { description: String((err as Error)?.message ?? err) });
    } finally {
      if (renderTimerRef.current) clearInterval(renderTimerRef.current);
      setRendering(false);
      setRenderingRefId(null);
      setCurrentStep(null);
    }
  };

  useEffect(() => {
    if (pendingRenderRef.current && selected?.id === pendingRenderRef.current.id && anyArt && !rendering) {
      pendingRenderRef.current = null;
      handleRender(true); // hover-apply gera preview rápido; o render final é manual
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, anyArt, rendering]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) handleArtSelect(file);
  };

  const toggleDim = (dim: string) => {
    setExpandedDims((prev) => {
      const next = new Set(prev);
      if (next.has(dim)) next.delete(dim);
      else next.add(dim);
      return next;
    });
  };

  // Lista de mockups ocultados manualmente. Mora no servidor
  // (`data/hidden-refs.json`, via /api/references/hide) — em localStorage ela era
  // por navegador, e esconder no desktop não valia no notebook. O estado local
  // segue existindo só para o grid reagir na hora, antes do refetch.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/references/hide");
        if (!r.ok) return;
        const { ids } = (await r.json()) as { ids: string[] };
        const server = new Set(ids);

        // Migração única do que ficou preso no navegador.
        try {
          const saved = localStorage.getItem("mockup-store:hiddenIds");
          if (saved) {
            const local: string[] = JSON.parse(saved);
            const novos = local.filter((id) => typeof id === "string" && !server.has(id));
            if (novos.length) {
              await fetch("/api/references/hide", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: novos, hidden: true }),
              });
              novos.forEach((id) => server.add(id));
            }
            localStorage.removeItem("mockup-store:hiddenIds");
          }
        } catch {}

        if (alive) setHiddenIds(server);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  const persistHidden = useCallback(async (ids: string[], hidden: boolean) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (hidden) next.add(id); else next.delete(id); }
      return next;
    });
    try {
      const r = await fetch("/api/references/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, hidden }),
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      // Falhou no servidor: desfaz o otimismo em vez de mentir que salvou.
      setHiddenIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) { if (hidden) next.delete(id); else next.add(id); }
        return next;
      });
      toast.error(hidden ? "Não consegui esconder" : "Não consegui reexibir", {
        description: "O item continua como estava.",
      });
    }
  }, []);

  /** "Restaurar ocultos" — devolve tudo ao grid de uma vez. */
  const restoreAllHidden = useCallback(() => {
    void persistHidden([...hiddenIds], false);
    setHiddenList([]);
  }, [hiddenIds, persistHidden]);

  /**
   * Abre o painel de ocultos. A lista vem do servidor porque o card escondido
   * não está mais em `refs` — o catálogo já o filtrou, que é justamente o ponto.
   */
  const openHiddenPanel = useCallback(async () => {
    setShowHidden(true);
    setHiddenLoading(true);
    try {
      const r = await fetch("/api/references/hide");
      if (!r.ok) throw new Error(String(r.status));
      const { ids, references } = (await r.json()) as { ids: string[]; references: Reference[] };
      setHiddenIds(new Set(ids));
      setHiddenList(references);
    } catch {
      setHiddenList([]);
      toast.error("Não consegui carregar os ocultos");
    } finally {
      setHiddenLoading(false);
    }
  }, []);

  /** Reexibe um item e tira ele da lista do painel na hora. */
  const restoreHidden = useCallback(
    (ref: Reference) => {
      void persistHidden([ref.id], false);
      setHiddenList((cur) => cur?.filter((r) => r.id !== ref.id) ?? cur);
    },
    [persistHidden]
  );

  /**
   * Esconder pelo CAMINHO — é o que o painel de duplicatas tem em mãos. O
   * arquivo não é tocado; quem some é o card. Um mesmo `.psd` pode estar em mais
   * de uma ref do catálogo, então o servidor resolve e devolve quantos casaram.
   */
  const hidePathFromCatalog = useCallback(async (filePath: string, name: string) => {
    try {
      const r = await fetch("/api/references/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: [filePath], hidden: true }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const { ids, matched } = (await r.json()) as { ids: string[]; matched: number };
      setHiddenIds(new Set(ids));
      if (matched === 0) {
        toast("Esse arquivo não está no catálogo", { description: "Nada a esconder — o grid nunca mostrou ele." });
      } else {
        toast.success(`Escondido do catálogo${matched > 1 ? ` (${matched} cards)` : ""}`, {
          description: `${name}. O arquivo continua no disco.`,
        });
      }
    } catch {
      toast.error("Não consegui esconder", { description: name });
    }
  }, []);

  const hideMockup = useCallback(
    (ref: Reference) => {
      void persistHidden([ref.id], true);
      setLastHidden({ id: ref.id, name: ref.name });
    },
    [persistHidden]
  );
  const unhideMockup = useCallback(
    (id: string) => {
      void persistHidden([id], false);
      setLastHidden((cur) => (cur?.id === id ? null : cur));
    },
    [persistHidden]
  );

  /** Há algum recorte aplicado? Separa "acervo vazio" de "filtro sem resultado". */
  const hasActiveFilters = !!(search || studio || aspect || activeTags.length || imageSearch || similarTo);

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setStudio("");
    setAspect("");
    setActiveTags([]);
    setImageSearch(null);
    if (searchInputRef.current) searchInputRef.current.value = "";
  }, []);

  // Grid: tira ocultados manualmente, depois colapsa duplicados.
  //
  // Na aba Coleção nada disso se aplica: a lista é curadoria explícita, e colapsar
  // "duplicado" ali seria o app apagando uma escolha que a pessoa fez à mão.
  const { kept: displayRefs, hiddenDupes } = useMemo(() => {
    if (view === "collection") return { kept: collectionRefs, hiddenDupes: 0 };
    const visible = hiddenIds.size ? refs.filter((r) => !hiddenIds.has(r.id)) : refs;
    if (!hideDuplicates) return { kept: visible, hiddenDupes: 0 };
    const { kept, hidden } = dedupeRefs(visible);
    return { kept, hiddenDupes: hidden };
  }, [refs, hideDuplicates, hiddenIds, view, collectionRefs]);

  // A cauda passa pelo MESMO filtro do grid. Sem isto, "Esconder" e "Esconder Duplicados"
  // valiam só acima da costura: o mockup que o usuário mandou sumir voltava trinta cards
  // depois, na seção de sugestão — desfazer uma ação explícita dele é pior que repetir.
  const displayTail = useMemo(() => {
    const visible = hiddenIds.size ? tail.filter((r) => !hiddenIds.has(r.id)) : tail;
    return hideDuplicates ? dedupeRefs(visible).kept : visible;
  }, [tail, hiddenIds, hideDuplicates]);

  // Toast de desfazer some sozinho depois de alguns segundos.
  useEffect(() => {
    if (!lastHidden) return;
    const t = setTimeout(() => setLastHidden(null), 6000);
    return () => clearTimeout(t);
  }, [lastHidden]);

  const MAX_TAGS = 5;
  const toggleTag = (tag: string) => {
    setActiveTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      // No teto, a versão anterior devolvia `prev` — o clique não fazia NADA e
      // o usuário não tinha como saber por quê. Agora a tag mais antiga sai e a
      // nova entra: o teto continua valendo e o clique sempre tem consequência.
      if (prev.length >= MAX_TAGS) return [...prev.slice(1), tag];
      return [...prev, tag];
    });
  };

  /**
   * Abre o ingest. Não mexe mais no painel da esquerda: reconfigurar o layout
   * do usuário era efeito colateral de uma ação que não tem nada a ver com o
   * painel, e o layout nunca voltava ao que era.
   */
  const openIngest = useCallback(() => setIngestOpen(true), []);

  const handleIngested = useCallback(
    (report: { referencesCreated: number; psdOnlyCreated: number; psdMetadataScanned: number }) => {
      // Toast em vez de linha na sidebar: a confirmação de uma escrita
      // irreversível não pode depender de um painel que o usuário pode ter
      // colapsado. O sonner já está montado nesta página.
      toast.success(
        `+${report.referencesCreated} refs, ${report.psdOnlyCreated} PSDs, ${report.psdMetadataScanned} analisados`,
      );
      // Facetas saem do MESMO catálogo do grid — recarrega as duas ou o dropdown
      // passa a prometer estúdio que a listagem ainda não conhece.
      fetch("/api/references/facets?has_psd=true")
        .then((r) => r.json())
        .then((f) => { setStudios(f.studios ?? []); setAspects(f.aspects ?? []); })
        .catch(() => {});
      fetchPage(1, false);
    },
    [fetchPage],
  );

  const activeSoName = selectedSo || selected?.smartObjectName || "";
  const selectedSoInfo =
    psdInfo?.smartObjects.find((s) => s.path === activeSoName || s.name === activeSoName) ||
    (psdInfo?.smartObjects.length === 1 ? psdInfo.smartObjects[0] : null);

  // SO dims: face ativa → psdInfo live → metadata do DB (disponível na hora)
  const activeFace = faces[activeSlot] ?? null;
  const soWidth = activeFace?.innerWidth || selectedSoInfo?.innerWidth || selected?.soInnerWidth;
  const soHeight = activeFace?.innerHeight || selectedSoInfo?.innerHeight || selected?.soInnerHeight;

  // Espelhos para o enquadramento automático (ver os refs lá em cima).
  useEffect(() => { psdInfoRef.current = psdInfo; }, [psdInfo]);
  useEffect(() => { soDimsRef.current = { w: soWidth, h: soHeight }; }, [soWidth, soHeight]);
  useEffect(() => {
    // A cor de fundo do logo é a da marca — prefere a que estiver marcada como
    // primária; sem papel declarado, a primeira da paleta.
    const cols = brands.find((b) => b.id === brandId)?.colors ?? [];
    const primary = cols.find((c) => /primary|primária|principal/i.test(c.role ?? ""));
    brandColorRef.current = (primary ?? cols[0])?.hex ?? null;
  }, [brandId, brands]);

  // A dica de enquadramento acompanha a arte: trocar de slot ou limpar a arte
  // não pode deixar na tela uma explicação sobre algo que não está mais lá.
  useEffect(() => {
    if (!framingHint) return;
    if (framingHint.slot !== activeSlot || !artSlots[framingHint.slot]?.preview) {
      setFramingHint(null);
    }
  }, [framingHint, activeSlot, artSlots]);

  const renderDisabled =
    filledCount === 0 ||
    rendering ||
    (faces.length === 0 && psdInfo != null && psdInfo.smartObjects.length > 1 && !selectedSo);

  /**
   * Existe um PNG final pronto para baixar? É o que decide O QUE a ação primária É.
   *
   * Só UM primário por vez, e ele é sempre o próximo passo: sem arquivo final, o
   * próximo passo é gerar; com arquivo final, é baixar. Prévia não conta — ela é JPEG
   * de conferência, não entregável, então enquanto o resultado na tela for prévia o
   * primário continua sendo "gerar".
   *
   * Esta constante já existiu como `hasResult` e servia só para DEMOVER um dos dois
   * botões que chamavam `handleRender(false)`. Os dois continuavam na tela.
   */
  const finalReady = Boolean(renderResult) && !rendering && !isPreviewResult;

  /* A ampliação da arte era calculada AQUI, a partir de `artDims` — a arte inteira —
   * enquanto o que alimenta o render em `cover` é o RECORTE. Recorte apertado fazia o
   * aviso subestimar a própria ampliação, e o `ArtFramePanel` calculava certo ao lado,
   * com o mesmo nome. Sobrou uma conta só, em `art-frame.ts` (`upscaleFactor` sobre
   * `effectiveSource`), consumida por quem desenha a linha. */

  /* Auto-preview: dispara handleRender(true) logo depois que o crop/zoom para.
   *
   * NÃO enquanto o recorte está aberto. Agora que o recorte ocupa a superfície de
   * resultado, cada arrastada disparava uma prévia cujo overlay de carregando cobria
   * a própria imagem que estava sendo recortada — a tela piscando por cima do gesto.
   * O recorte é um ajuste modal: a prévia é o que acontece quando ele termina, e o
   * efeito de fechamento abaixo cuida disso. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (renderDisabled || !artPreview || cropOpen) return;
    if (autoPreviewTimer.current) clearTimeout(autoPreviewTimer.current);
    autoPreviewTimer.current = setTimeout(() => { handleRender(true); }, 250);
    return () => { if (autoPreviewTimer.current) clearTimeout(autoPreviewTimer.current); };
  }, [frame.cropPixels, frame.mode, cropOpen]);

  /**
   * O recorte é um modo, e todo modo precisa de saída garantida.
   *
   * Só existe em `cover` (é o único que recorta) e só com arte na mão. Trocar a arte,
   * trocar de face ou sair do `cover` fecha sozinho — senão a superfície ficaria
   * recortando um arquivo que não está mais lá.
   */
  const cropping = cropOpen && Boolean(artPreview) && frame.mode === "cover";

  useEffect(() => {
    if (!cropping && cropOpen) setCropOpen(false);
  }, [cropping, cropOpen]);

  useEffect(() => {
    setCropOpen(false);
  }, [artPreview, activeSlot]);

  const toggleLayer = (name: string) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-white selection:bg-white/10 selection:text-white overflow-hidden">
      {/* Top Header */}
      <header className="h-14 border-b border-neutral-900 bg-neutral-950/50 backdrop-blur-md flex items-center justify-between gap-2 px-4 shrink-0 z-20">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0 shrink">
          <button 
            onClick={() => {
              const panel = leftPanelRef.current;
              if (panel) panel.isCollapsed() ? panel.expand() : panel.collapse();
            }}
            className="p-2 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition-ui press"
            title="Toggle Sidebar"
          >
            <PanelLeft className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-2 pr-2 sm:pr-4 border-r border-neutral-900 shrink-0">
            <h1 className="flex items-center">
              <BoxyMark label="Store" />
            </h1>
          </div>

          <Link
            href="/photo-mockup"
            title="Scene Maker"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white hover:bg-white/5 transition-colors border border-neutral-800 hover:border-neutral-600 shrink-0"
          >
            <Camera className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden lg:inline">Scene Maker</span>
          </Link>

          <ComoUsar />

          {/* O header não cabia numa janela estreita: a raiz é `overflow-hidden`,
              então nada rolava — o campo de busca simplesmente saía da tela e
              ficava INALCANÇÁVEL (medido a 390px: 24 elementos cortados, busca
              começando em x≈676). O que é secundário desaparece primeiro; o que
              é a ação de todo dia fica. */}
          <div className="hidden xl:flex items-center gap-6 pl-2 shrink-0">
            <div className="flex items-center gap-3">
              <LayoutGrid className="w-4 h-4 text-neutral-500" />
              <input 
                type="range" 
                min="150" 
                max="450" 
                step="10"
                value={thumbSize}
                onChange={(e) => setThumbSize(parseInt(e.target.value))}
                title={`Tamanho do card: ${thumbSize}px`}
                className="w-32 accent-white h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
              />
              {/* O readout "230px" saiu: o feedback deste controle é o grid inteiro
                  mudando de tamanho na hora. O número era ruído de engenheiro. */}
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 max-w-xl px-2 lg:px-8">
          {imageSearch ? (
            // O chip SUBSTITUI o campo: com um ranking por imagem no grid, um
            // campo de texto vazio ao lado convidaria a digitar e derrubar o
            // resultado sem avisar. A saída é explícita e sempre reversível.
            <div className="flex items-center gap-3 h-9 rounded-full bg-acc/10 border border-acc/25 pl-1.5 pr-1.5 animate-in fade-in zoom-in-95 duration-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageSearch.thumb} alt="" className="w-6 h-6 rounded-full object-cover border border-acc/30 shrink-0" />
              <span className="text-[10px] font-semibold text-acc truncate">
                Parecidos com a imagem ({imageSearch.count})
              </span>
              <button
                onClick={clearImageSearch}
                title="Voltar ao catálogo"
                className="ml-auto w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-acc/70 hover:text-white hover:bg-acc/20 transition-colors transition-ui press"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="relative group flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 group-focus-within:text-white transition-colors" />
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Buscar mockups…    /"
                  defaultValue={search}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  className="w-full h-9 rounded-full bg-neutral-900/50 border border-neutral-800 pl-10 pr-9 text-xs placeholder:text-neutral-500 focus:border-neutral-600 focus:bg-neutral-900 transition-colors"
                />
                {/* A busca é debounced: sem isto, digitar dá 300ms de tela parada
                    sem nenhum sinal de que algo está sendo procurado. */}
                {loading && !initialLoad && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500 animate-spin" />
                )}
              </div>
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={imageSearching}
                title="Buscar mockups parecidos com uma imagem"
                className="shrink-0 w-9 h-9 rounded-full bg-neutral-900/50 border border-neutral-800 flex items-center justify-center text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors transition-ui press disabled:opacity-40"
              >
                {imageSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) runImageSearch(f);
                  e.target.value = "";
                }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Dois números mediam coisas diferentes sem rótulo: este vinha do
              servidor (total do recorte) e o "N ocultos" da sidebar era
              client-side sobre a página carregada. Agora o badge diz de qual
              universo está falando, e mostra o que está à vista quando os dois
              divergem. */}
          {total > 0 && (
            <div
              // `hidden lg:block`: a 390px este badge disputava a mesma linha do
              // campo de busca e ficava POR CIMA dele. Contagem é contexto;
              // buscar é a ação de todo dia — some primeiro o contexto.
              className="hidden lg:block px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[10px] font-bold text-neutral-400"
              title={
                total !== totalDistinct
                  ? `${totalDistinct.toLocaleString()} mockups em ${total.toLocaleString()} registros: o mesmo arquivo aparece mais de uma vez no catálogo`
                  : `${totalDistinct.toLocaleString()} no recorte atual`
              }
            >
              {totalDistinct.toLocaleString()} {hasActiveFilters ? "no filtro" : "no acervo"}
            </div>
          )}

          {Object.keys(renderCache).length > 0 && (
            <button
              onClick={() => { setShowSession(true); setSessionSelected(new Set()); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-acc2/10 border border-acc2/20 text-[10px] font-bold text-acc2 hover:bg-acc2/20 hover:text-acc2 transition-ui press"
              title="Renders desta sessão"
            >
              <Download className="w-3.5 h-3.5" />
              Session ({Object.keys(renderCache).length})
            </button>
          )}

          {/* Ingerir pasta é ação GLOBAL do acervo, não um filtro — vivia como uma
              laje tracejada de 44px no meio dos filtros da sidebar, disputando peso
              com controles do dia a dia por algo que se faz uma vez por sessão. */}
          <button
            onClick={openIngest}
            className={`p-2 rounded-lg hover:bg-white/5 transition-ui press ${
              ingestOpen ? "text-white bg-white/5" : "text-neutral-500 hover:text-white"
            }`}
            title="Adicionar pasta ao acervo"
            aria-label="Adicionar pasta ao acervo"
            aria-expanded={ingestOpen}
          >
            <FolderPlus className="w-4.5 h-4.5" />
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-white/5 text-neutral-500 hover:text-white transition-ui press"
            title="Configurações"
            aria-label="Configurações"
          >
            <Settings2 className="w-4.5 h-4.5" />
          </button>
          
          {/* Controle morto não renderiza. Sem seleção não existe painel de
              detalhes para alternar, e um botão inerte a 20% de opacidade só
              ocupa espaço dizendo que não serve. */}
          {selected && (
            <button
              onClick={() => {
                const panel = rightPanelRef.current;
                if (panel) panel.isCollapsed() ? panel.expand() : panel.collapse();
              }}
              className="p-2 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition-colors transition-ui press"
              title="Alternar painel de detalhes"
            >
              <PanelRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {/* O RECORTE ATIVO MORA NO HEADER.
          Ele já esteve em dois lugares ao mesmo tempo — um bloco "Filtros ativos"
          na sidebar esquerda e uma barra de chips dentro do `<main>` — e nenhum
          dos dois funcionava: a sidebar é colapsável (some o estado justo quando
          se ganha espaço) e o `<main>` ROLA, então a barra saía de vista no
          primeiro scroll e o grid passava a mostrar um recorte sem dizer que era
          um recorte — o acervo parecia ter encolhido. Aqui é uma faixa irmã do
          header, fora de todo container de rolagem: enquanto houver filtro, ele
          está na tela, na mesma zona onde se busca e se limpa. Sem filtro, a
          faixa não existe (altura zero, não uma barra vazia). */}
      {hasActiveFilters && !initialLoad && (
        <div className="shrink-0 z-10 border-b border-neutral-900 bg-neutral-950/50 backdrop-blur-md px-4 py-2 flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <span className="text-[10px] text-neutral-500 shrink-0">Filtrando por</span>
          {[
            search && { k: "q", label: `“${search}”`, clear: () => { setSearch(""); if (searchInputRef.current) searchInputRef.current.value = ""; } },
            studio && { k: "studio", label: studio, clear: () => setStudio("") },
            aspect && {
              k: "aspect",
              label: aspect === "square" ? "1:1" : aspect === "portrait" ? "Retrato" : "Paisagem",
              clear: () => setAspect(""),
            },
            imageSearch && { k: "img", label: "Imagem parecida", clear: clearImageSearch },
            similarTo && {
              k: "similar",
              label: `Parecidos com ${similarTo.name}${similarTo.mode === "lexical" ? " (por tags)" : ""}`,
              clear: clearSimilar,
            },
            ...activeTags.map((t) => ({ k: `tag-${t}`, label: t, clear: () => toggleTag(t) })),
          ]
            .filter(Boolean)
            .map((f) => {
              const chip = f as { k: string; label: string; clear: () => void };
              return (
                <button
                  key={chip.k}
                  onClick={chip.clear}
                  title="Remover este filtro"
                  className="group inline-flex items-center gap-1.5 h-7 pl-3 pr-2 rounded-full bg-neutral-900 border border-neutral-800 text-[10px] font-bold text-neutral-300 hover:border-neutral-600 hover:text-white transition-colors transition-ui press"
                >
                  <span className="max-w-[14rem] truncate">{chip.label}</span>
                  <X className="w-3 h-3 text-neutral-500 group-hover:text-white transition-colors" />
                </button>
              );
            })}

          {/* O seletor só aparece quando há duas tags — antes disso não existe
              diferença entre unir e cruzar, e um controle que não muda nada é
              ruído. Rótulo diz o EFEITO, não a operação booleana: quem filtra
              quer "qualquer uma" ou "todas", não AND e OR. */}
          {activeTags.length > 1 && (
            <div
              role="group"
              aria-label="Como combinar as tags"
              className="flex shrink-0 rounded-full bg-neutral-900 border border-neutral-800 p-0.5"
            >
              {([
                { m: "OR", label: "Qualquer uma", dica: "Mostra o que tem QUALQUER UMA das tags — cada tag a mais amplia o recorte" },
                { m: "AND", label: "Todas", dica: "Mostra só o que tem TODAS as tags — cada tag a mais afunila o recorte" },
              ] as const).map(({ m, label, dica }) => (
                <button
                  key={m}
                  onClick={() => setTagMode(m)}
                  aria-pressed={tagMode === m}
                  title={dica}
                  className={`text-[9px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                    tagMode === m ? "bg-white text-black" : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={clearAllFilters}
            /* Sem `ml-auto`: encostado na borda direita de uma tela de 1920 ele
               fica a um metro do último chip e o olho não liga os dois. A ação
               de limpar pertence ao FIM DA LISTA que ela limpa. */
            className="h-7 px-3 rounded-full text-[9px] font-semibold text-neutral-500 hover:text-white transition-colors shrink-0"
          >
            Limpar tudo
          </button>
        </div>
      )}

      <PanelGroup orientation="horizontal" className="flex-1 min-h-0 w-full">
        {/* Left Sidebar: Catalog & Filters */}
        <Panel
          panelRef={leftPanelRef}
          defaultSize="20%"
          minSize="15%"
          maxSize="28%"
          collapsible={true}
          collapsedSize="0%"
          className="flex flex-col bg-neutral-950 border-r border-neutral-900/50 overflow-hidden"
        >
          <div className="p-4 pb-2 shrink-0">
            {visantConnected === false && (
              <div className="mb-4 bg-neutral-900/50 p-3 rounded-2xl border border-neutral-800 shadow-xl">
                <button
                  onClick={connectVisant}
                  disabled={visantConnecting}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-white text-black text-[11px] font-semibold px-3 py-2.5 hover:bg-neutral-200 transition-ui disabled:opacity-50 press"
                >
                  {visantConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 fill-current" />}
                  {visantConnecting ? "Aguardando..." : "Conectar Visant"}
                </button>
                {visantLoginUrl && (
                  <p className="text-[10px] text-neutral-500 mt-2.5 leading-tight text-center px-1">
                    Aprove o acesso na aba que abriu. Não abriu?{" "}
                    <a href={visantLoginUrl} target="_blank" rel="noopener noreferrer" className="text-neutral-300 underline font-bold">Clique aqui</a>
                  </p>
                )}
                {visantAuthError && (
                  <p className="text-[10px] text-red-400 mt-2.5 flex items-center gap-1.5 px-1"><AlertTriangle className="w-3.5 h-3.5" /> {visantAuthError}</p>
                )}
              </div>
            )}

            {/* Contexto (marca · estúdio) — linhas, não caixas.
                Antes eram cinco blocos empilhados com o mesmo peso e três estilos de
                borda diferentes: `h-10 rounded-xl bg-neutral-900 border` para os
                selects, `h-9 border` para os chips, `h-11 border-2 dashed` para a
                pasta. Cinco caixas de peso igual não têm hierarquia — o olho lê uma
                pilha e não uma estrutura. O agrupamento agora é o ESPAÇO (`gap`
                pequeno dentro da zona, grande entre zonas) e o valor é o próprio
                controle, como numa lista de ajustes. */}
            {brands.length > 0 && (
              <div className="mb-1">
                {/* Radix, não `<select>`: a lista do nativo é desenhada pelo SO
                    (fundo branco, realce azul do Windows) e nenhum CSS alcança. */}
                <Select
                  ariaLabel="Marca"
                  value={brandId || ALL}
                  onChange={(v) => setBrandId(v === ALL ? "" : v)}
                  options={[
                    { value: ALL, label: "Sem marca" },
                    ...brands.map((b) => ({ value: b.id, label: b.name })),
                  ]}
                />
                {brandId && (
                  <div className="flex items-center gap-1.5 px-1 pb-1">
                    {(brands.find((b) => b.id === brandId)?.colors || [])
                      .slice(0, 8)
                      .map((c, i) => (
                        <span
                          key={`${c.hex}-${i}`}
                          title={c.name}
                          className="w-3 h-3 rounded-full border border-white/10"
                          style={{ backgroundColor: c.hex }}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* A régua só existe para separar marca de estúdio. Sem marca conectada
                ela vira um traço solto logo abaixo da borda do header. */}
            <div className={`mb-5 ${brands.length > 0 ? "border-t border-neutral-900 pt-1" : ""}`}>
              <Select
                ariaLabel="Estúdio"
                value={studio || ALL}
                onChange={(v) => setStudio(v === ALL ? "" : v)}
                options={[
                  { value: ALL, label: "Todos os estúdios" },
                  // A contagem vai na coluna da direita, não colada no nome entre
                  // parênteses — assim os números alinham e o nome pode truncar.
                  ...studios.map((s) => ({ value: s.name, label: s.name, hint: s.count })),
                ]}
              />
            </div>

            <div className="flex flex-col gap-2.5 mb-5">
              {/* Formato da superfície — filtro que o pipeline usa o tempo todo ("casar
                  arte↔cena por aspecto") e que só existia no CLI. Clicar de novo limpa.
                  UMA caixa em volta dos três, não três caixas: sem ela (a versão
                  anterior) as opções desligadas ficavam sem borda nenhuma e liam
                  como três palavras soltas na sidebar — só na captura dá pra ver
                  que ninguém adivinharia que são clicáveis. O trilho comum diz
                  "isto é um controle" sem dar peso a nenhuma opção. */}
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-neutral-900/60">
                {([
                  { key: "square", label: "1:1" },
                  { key: "portrait", label: "Retrato" },
                  { key: "landscape", label: "Paisagem" },
                ] as const).map(({ key, label }) => {
                  const on = aspect === key;
                  const count = aspects.find((a) => a.name === key)?.count;
                  return (
                    <button
                      key={key}
                      onClick={() => setAspect(on ? "" : key)}
                      aria-pressed={on}
                      title={count ? `${count} mockups` : undefined}
                      className={`flex-1 h-7 rounded-lg text-[11px] font-bold transition-colors ${
                        on
                          ? "bg-white text-black"
                          : "text-neutral-500 hover:text-neutral-200 hover:bg-white/5"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Linha, não botão-caixa: o rótulo quebrava em duas linhas assim que a
                  contagem entrava ao lado, dentro de um bloco de 36px em caixa alta. */}
              {/* `<label htmlFor>`, não `<button>` em volta.
                  Este bloco era um `<button>` envolvendo o `<Switch>` do Radix,
                  que renderiza `<button role="switch">`: botão dentro de botão.
                  HTML inválido, e o custo não era teórico — o console acusava
                  "Hydration failed because the server rendered HTML didn't match
                  the client", ou seja, o React DESCARTAVA o HTML do servidor e
                  regenerava a árvore inteira no cliente a cada carregamento.
                  Um `<label>` deixa a linha toda clicável de graça, pelo próprio
                  navegador, e o controle continua sendo um só. */}
              <label
                htmlFor="hide-duplicates"
                className="flex items-center gap-2 px-1 cursor-pointer group/dup"
              >
                <span className={`text-[11px] font-bold truncate transition-colors ${hideDuplicates ? "text-neutral-300" : "text-neutral-500 group-hover/dup:text-neutral-300"}`}>
                  Esconder duplicados
                </span>
                {hideDuplicates && hiddenDupes > 0 && (
                  <span className="text-[10px] text-neutral-500 shrink-0">{hiddenDupes}</span>
                )}
                <span className="ml-auto shrink-0">
                  <Switch id="hide-duplicates" checked={hideDuplicates} onCheckedChange={setHideDuplicates} label="Esconder duplicados" />
                </span>
              </label>

              {hiddenIds.size > 0 && (
                <button
                  onClick={() => void openHiddenPanel()}
                  className="flex items-center gap-2 px-1 text-[11px] font-bold text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  <EyeOff className="w-3 h-3 shrink-0" />
                  {hiddenIds.size} {hiddenIds.size === 1 ? "oculto" : "ocultos"}
                </button>
              )}
            </div>

          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0 space-y-8 no-scrollbar">
            {/* O bloco "Filtros ativos" saiu daqui: as tags ligadas agora vivem
                na faixa do header (uma cópia só, sempre visível, mesmo com esta
                sidebar colapsada). O que sobra aqui é a ESCOLHA — a taxonomia —,
                e cada dimensão continua marcando na própria linha quantas tags
                dela estão ligadas. */}
            <div className="pb-10">
              {/* Eyebrows saíram do `font-black uppercase tracking-[0.2em]`: o
                  rótulo de uma seção da sidebar tinha o MESMO peso tipográfico do
                  botão de ação primária e do nome do mockup. Quando tudo grita,
                  nada grita — e o que precisa gritar aqui é o card.
                  Placar no arquivo inteiro: 70 `uppercase` → 3, 69 `font-black`
                  → 1 (só o wordmark, que é logo e pode gritar). */}
              <p className="text-[11px] font-medium text-neutral-400 mb-4 px-1">Taxonomia</p>
              {/* RECOLHIDO MOSTRA SÓ O QUE ESTÁ LIGADO.
                  Antes o chevron dizia "recolhido" e a dimensão renderizava 10
                  chips assim mesmo — a affordance mentia, e as ~6 dimensões
                  somavam 60+ controles permanentes ocupando a rolagem inteira da
                  sidebar. Numa superfície de trabalho o painel de filtro reporta
                  ESTADO, não anuncia capacidade: `minimalist 1493` de um acervo
                  de 4.483 não é um filtro, é decoração com número. Recolhido
                  mostra as tags ativas daquela dimensão (quase sempre nenhuma);
                  expandido mostra tudo. O chevron passou a dizer a verdade. */}
              {Object.entries(allTags).map(([dim, tags]) => {
                const label = dimLabel(dim);
                const expanded = expandedDims.has(dim);
                const ativosNaDim = tags.filter((t) => activeTags.includes(t.value));
                const visible = expanded ? tags : ativosNaDim;

                return (
                  <div key={dim} className={expanded || ativosNaDim.length ? "mb-6" : "mb-1"}>
                    <button
                      onClick={() => toggleDim(dim)}
                      aria-expanded={expanded}
                      className={`group/tag flex items-center gap-3 text-[11px] font-semibold hover:text-white transition-colors w-full py-1 ${
                        ativosNaDim.length ? "text-white" : "text-neutral-400"
                      } ${expanded || ativosNaDim.length ? "mb-3" : ""}`}
                    >
                      <ChevronRight
                        className={`w-4 h-4 transition-transform [transition-duration:var(--dur-slow)] ${expanded ? "rotate-90 text-white" : "text-neutral-500"}`}
                      />
                      <span className="flex-1 text-left">{label}</span>
                      {/* O número que importa é quantas estão LIGADAS. O total só
                          aparece quando a dimensão está aberta, que é quando ele
                          ajuda a decidir se vale rolar. */}
                      {ativosNaDim.length > 0 ? (
                        <span className="text-[9px] font-bold text-black bg-white rounded-full px-1.5 py-0.5">{ativosNaDim.length}</span>
                      ) : expanded ? (
                        <span className="text-[9px] text-neutral-500 font-bold">{tags.length}</span>
                      ) : null}
                    </button>
                    <div className="flex flex-wrap gap-2 pl-7">
                      {visible.map((t) => {
                        const isActive = activeTags.includes(t.value);
                        // No teto de 5 tags a versão anterior renderizava DEZENAS
                        // de chips `disabled` — um campo de controles mortos que
                        // o olho precisa varrer para achar os vivos. Agora o chip
                        // continua clicável e troca a tag mais antiga: entrega a
                        // ação que o usuário quis, em vez de uma parede.
                        // (`scale-110` também saiu: escala dentro de flex-wrap
                        // reflui a linha inteira a cada toggle.)
                        const willSwap = !isActive && activeTags.length >= MAX_TAGS;
                        return (
                          <button
                            key={`${dim}-${t.value}`}
                            onClick={() => toggleTag(t.value)}
                            aria-pressed={isActive}
                            title={willSwap ? `Substitui «${activeTags[0]}» (teto de ${MAX_TAGS} tags)` : undefined}
                            className={`text-[10px] px-3 py-1.5 rounded-lg font-bold transition-[color,background-color,border-color,box-shadow] ${
                              isActive
                                ? "bg-white text-black shadow-2xl z-10"
                                : willSwap
                                ? "bg-neutral-900 text-neutral-500 border border-dashed border-neutral-700 hover:text-neutral-300 hover:border-neutral-500"
                                : "bg-neutral-900 text-neutral-500 border border-neutral-800 hover:border-neutral-600 hover:text-neutral-300"
                            }`}
                          >
                            {t.value}
                            {/* Era text-neutral-600 (#262626) sobre bg-neutral-900
                                (#171717): ~1.3:1. Não é discreto, é invisível —
                                o número existia no DOM e não na tela. */}
                            <span className={`ml-2 ${isActive ? "opacity-40" : "text-neutral-500"}`}>{t.count}</span>
                          </button>
                        );
                      })}
                      {expanded && (
                        <button onClick={() => toggleDim(dim)} className="text-[10px] font-bold px-3 py-1.5 text-neutral-500 hover:text-white">Recolher</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>

        <ResizeHandle />

        {/* Main Area: Grid */}
        <Panel className="relative flex flex-col bg-neutral-950 min-w-0 overflow-hidden">
          <main ref={gridScrollRef} className="flex-1 overflow-y-auto p-8 no-scrollbar">
            {brandId && !suggestionsOpen && (
              <button
                onClick={() => setSuggestionsOpen(true)}
                className="mb-6 flex items-center gap-2 h-8 px-3 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-bold text-neutral-400 hover:text-white hover:border-neutral-600 transition-ui press"
              >
                <Zap className="w-3.5 h-3.5" />
                Ver sugeridos para {brands.find((b) => b.id === brandId)?.name}
              </button>
            )}

            {brandId && suggestionsOpen && (
              // Enquanto carrega ainda não há o que espaçar: o painel reservava a
              // altura da fila de cards (mb-4 + pb-6 + mb-8) e o usuário olhava para
              // um buraco entre o título e o grid. Espaço se abre com o conteúdo.
              <div className={`${suggestionsPending ? "mb-4" : "mb-8"} animate-in fade-in slide-in-from-left-4 duration-300`}>
                <div className={`flex items-center justify-between ${suggestionsPending ? "" : "mb-4"}`}>
                  {/* O peso vai no NOME DA MARCA, que é o dado que o usuário
                      precisa confirmar. Antes ia no adjetivo: "MATCHES
                      INTELIGENTES" em font-medium, com
                      uma bolinha esmeralda pulsando para sempre ao lado. Nenhum
                      dos dois reportava estado — a bolinha não parava nunca e
                      "inteligentes" é detalhe de implementação, não benefício.
                      Quem usa quer saber PARA QUEM são as sugestões. */}
                  <h2 className="text-sm min-w-0 truncate">
                    <span className="text-neutral-500">Sugeridos para </span>
                    <span className="font-bold text-white">{brands.find((b) => b.id === brandId)?.name}</span>
                  </h2>
                  <div className="flex items-center gap-3">
                    {/* Havia DOIS giradores para a mesma operação: um `Loader2` solto
                        ao lado e o ícone do próprio botão girando. Feedback duplicado
                        do mesmo estado. O botão já é o lugar certo — quem disparou a
                        ação olha para onde clicou. */}
                    <button
                      onClick={() => loadSuggestions({ force: true })}
                      disabled={loadingSuggestions}
                      title="Recalcular as sugestões desta marca"
                      className="flex items-center gap-2 h-8 px-3 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-bold text-neutral-400 hover:text-white hover:border-neutral-600 transition-ui press disabled:opacity-40"
                    >
                      {/* Rótulo FIXO. Trocar para "Analisando" era a terceira
                          cópia do mesmo estado (ícone girando + botão desabilitado
                          + texto), e nomeava a máquina em vez da ação. */}
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingSuggestions ? "animate-spin" : ""}`} />
                      Regenerar
                    </button>
                    {/* Fecha o PAINEL — a marca continua conectada (coleção, aba
                        Coleção e logo dependem dela). Desconectar é no seletor. */}
                    <button onClick={() => setSuggestionsOpen(false)} title="Fechar as recomendações (a marca continua conectada)" className="w-8 h-8 rounded-full flex items-center justify-center bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-white hover:border-neutral-600 transition-ui press"><X className="w-4 h-4" /></button>
                  </div>
                </div>
                {suggestError ? (
                  <div className="p-5 bg-red-500/5 border border-red-500/10 rounded-2xl text-[11px] text-red-400 font-bold flex items-center gap-3"><AlertTriangle className="w-5 h-5" /> {suggestError}</div>
                ) : suggestionsPending ? null : !loadingSuggestions && suggestions.length === 0 ? (
                  <div className="p-8 rounded-2xl border border-dashed border-neutral-900 flex flex-col items-center gap-3 opacity-40">
                    <Zap className="w-8 h-8" />
                    <p className="text-xs font-semibold text-center">Nenhuma recomendação disponível para os ativos atuais desta marca.</p>
                  </div>
                ) : (
                  <div className="flex gap-5 overflow-x-auto pb-6 -mx-2 px-2 no-scrollbar scroll-smooth">
                    {suggestions.map((s) => (
                      <SuggestionCard
                        key={`sug-${s.ref.id}`}
                        suggestion={s}
                        selected={selected?.id === s.ref.id}
                        isRendering={renderingRefId === s.ref.id}
                        onSelect={() => selectRef(s.ref)}
                        onApply={async () => {
                          selectRef(s.ref);
                          const ok = anyArt || (await loadBrandLogoAsArt());
                          if (ok) pendingRenderRef.current = s.ref;
                        }}
                      />
                    ))}
                    {suggestions.length >= suggestLimit && (
                      <button
                        onClick={() => {
                          const next = suggestLimit + 12;
                          setSuggestLimit(next);
                          loadSuggestions({ limit: next });
                        }}
                        disabled={loadingSuggestions}
                        className="shrink-0 w-32 rounded-2xl border border-dashed border-neutral-800 flex flex-col items-center justify-center gap-2 text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-ui press disabled:opacity-40"
                      >
                        {loadingSuggestions ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                        <span className="text-[10px] font-semibold">Ver mais</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* A barra de filtros ativos que ficava AQUI subiu para o header:
                dentro do `<main>` ela rolava junto com o grid e sumia no
                primeiro scroll, que é exatamente quando o usuário mais precisa
                lembrar que está vendo um recorte. */}

            {/* Acervo ⟷ Coleção. Aparece com marca conectada OU com qualquer coleção
                existente: curadoria avulsa ("referências de tipografia") não depende de
                cliente nenhum, e antes ela era impossível — coleção só nascia de marca. */}
            {(collectionKey || collections.length > 0) && (
              <div className="flex items-center gap-2 mb-4">
                {([
                  { k: "all", label: "Acervo", count: totalDistinct },
                  { k: "collection", label: collectionLabel, count: collectionIds.size },
                ] as const).map(({ k, label, count }) => (
                  <button
                    key={k}
                    onClick={() => {
                      // Sem marca conectada, "Coleção" precisa apontar para alguma:
                      // uma aba que abre vazia porque nada foi escolhido é um beco.
                      if (k === "collection" && !collectionKey && collections[0]) setCollectionId(collections[0].id);
                      setView(k);
                    }}
                    aria-pressed={view === k}
                    className={`h-8 px-3.5 rounded-full text-[10px] font-bold transition-colors inline-flex items-center gap-2 ${
                      view === k ? "bg-white text-black" : "text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800"
                    }`}
                  >
                    {k === "collection" && <Bookmark className="w-3 h-3" />}
                    <span className="max-w-[14rem] truncate">{label}</span>
                    {/* text-neutral-600 sobre neutral-900 dá 2.29:1 — o portão visual
                        pegou. Contagem é dado, não decoração: precisa ser legível. */}
                    <span className={view === k ? "text-black/50" : "text-neutral-500"}>{count.toLocaleString()}</span>
                  </button>
                ))}

                {/* Trocar de coleção. Só dentro da aba Coleção (no Acervo ele repetiria
                    o rótulo da aba sem fazer nada) e só com mais de uma — seletor de um
                    item só é enfeite. A coleção da marca conectada entra na lista mesmo
                    sem existir ainda no disco: é para onde o marcador do card escreve. */}
                {view === "collection" && collectionOptions.length > 1 && (
                  <Select
                    value={collectionKey}
                    onChange={(v) => { setCollectionId(v === brandId ? "" : v); setView("collection"); }}
                    options={collectionOptions}
                    ariaLabel="Trocar de coleção"
                    placeholder="Trocar de coleção"
                    boxed
                    // O gatilho é `w-full` por padrão (nasceu para sidebar/painel).
                    // Numa fila de pílulas isso o faz engolir a linha inteira.
                    className="h-8 w-auto max-w-[16rem] rounded-full text-[10px]"
                  />
                )}

                <button
                  onClick={() => setNameDialog({ mode: "create", value: "" })}
                  title="Nova coleção (não precisa de marca)"
                  aria-label="Nova coleção"
                  className="w-8 h-8 rounded-full flex items-center justify-center bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-white hover:border-neutral-600 transition-ui press"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>

                {view === "collection" && collectionKey && (
                  <>
                    <button
                      onClick={() => setNameDialog({ mode: "rename", value: collectionName === "Coleção" ? "" : collectionName })}
                      title="Renomear esta coleção"
                      aria-label="Renomear coleção"
                      className="w-8 h-8 rounded-full flex items-center justify-center bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-white hover:border-neutral-600 transition-ui press"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {/* Só coleção avulsa some daqui: a da marca é o destino padrão do
                        marcador do card — apagá-la por engano tiraria o chão do grid. */}
                    {collectionKey.startsWith("col_") && (
                      <button
                        onClick={() => void removeCollection()}
                        title="Apagar esta coleção"
                        aria-label="Apagar coleção"
                        className="w-8 h-8 rounded-full flex items-center justify-center bg-neutral-900 border border-neutral-800 text-neutral-500 hover:text-red-400 hover:border-red-500/40 transition-ui press"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}

                {view === "collection" && collectionIds.size > 0 && (
                  <span className="text-[10px] text-neutral-500">
                    arraste ou use alt+seta para reordenar, a ordem é sua
                  </span>
                )}
              </div>
            )}

            {/* Ordem da listagem — a regra dita em voz alta, onde se escolhe.
                Até aqui a listagem era SEMPRE A→Z por nome e não havia como trocar:
                um default acidental, e o pior possível para um acervo cujos nomes
                são de arquivo (as cinco primeiras posições eram cinco variações do
                mesmo bundle). Não renderiza durante a busca por texto: lá quem ordena
                é a relevância, e um seletor que não faz nada é um controle morto.
                Na Coleção também não: lá a ordem é a curadoria, arrastada à mão. */}
            {view === "all" && !search && !imageSearch && !similarTo && !initialLoad && refs.length > 0 && (
              <div className="flex items-center gap-2 mb-6">
                <span className="text-[10px] text-neutral-500">Ordem</span>
                {([
                  {
                    k: "shuffle",
                    label: "Descobrir",
                    rule: brandId
                      ? "galeria nova a cada abertura, puxando o que combina com a marca selecionada"
                      : "galeria nova a cada abertura, com o acervo inteiro em outra ordem",
                  },
                  { k: "popular", label: "Mais usados", rule: "os que você mais abre e renderiza primeiro, com empate resolvido no alfabético" },
                  { k: "name", label: "A–Z", rule: "ordem alfabética pelo nome do arquivo" },
                ] as const).map(({ k, label, rule }) => (
                  <button
                    key={k}
                    onClick={() => setSort(k)}
                    aria-pressed={sort === k}
                    title={rule}
                    className={`h-7 px-3 rounded-full text-[10px] font-bold transition-colors ${
                      sort === k ? "bg-white/10 text-white" : "text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {/* Saiu "aprende com o que você abre": nomeava a máquina, ficava
                    em text-neutral-500 sobre near-black (≈2:1, ilegível) e
                    repetia o `title` do próprio botão, que é onde a regra
                    pertence — junto de onde se escolhe. */}
              </div>
            )}

            {view === "collection" && collectionLoading && collectionRefs.length === 0 ? (
              // Mesma forma do skeleton do acervo. A aba Coleção não mostrava NADA
              // enquanto carregava, então trocar de aba dava um branco e depois um
              // salto — e branco é indistinguível de "esta coleção está vazia".
              <div className="grid" style={{ gap: GRID_GAP, gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="rounded-2xl overflow-hidden border border-neutral-800/50 bg-neutral-900/30 animate-pulse">
                    <div className="bg-neutral-800/40" style={{ aspectRatio: "4/3" }} />
                    <div className="p-3 space-y-2">
                      <div className="h-2.5 bg-neutral-800/60 rounded w-3/4" />
                      <div className="h-2 bg-neutral-800/40 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : view === "collection" && !collectionLoading && collectionRefs.length === 0 ? (
              // Coleção vazia é o estado NORMAL de uma marca nova, não uma falha. Então ele
              // ensina o gesto (o marcador no card) em vez de só constatar o vazio — e já
              // oferece o atalho de encher com o que a marca sugere.
              <div className="flex flex-col items-center justify-center h-full gap-5 animate-in fade-in zoom-in-95 duration-200">
                <div className="w-20 h-20 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                  <Bookmark className="w-9 h-9 text-neutral-600" />
                </div>
                <div className="text-center max-w-sm">
                  <p className="text-base font-semibold text-neutral-200">
                    Nada guardado para {brands.find((b) => b.id === brandId)?.name || "esta marca"}
                  </p>
                  <p className="text-xs font-bold text-neutral-500 mt-2 leading-relaxed">
                    No acervo, o marcador no canto do card guarda o mockup aqui. A ordem desta
                    lista é sua. Arraste depois para montar a sequência da apresentação.
                  </p>
                </div>
                <button
                  onClick={() => setView("all")}
                  className="flex items-center gap-2 h-11 px-5 rounded-xl bg-white text-black text-[11px] font-semibold hover:bg-neutral-200 transition-colors transition-ui press"
                >
                  <Search className="w-4 h-4" />
                  Ir escolher no acervo
                </button>
              </div>
            ) : initialLoad && view === "all" ? (
              // Mesmo gap e mesma contagem de colunas do masonry — senão o grid
              // "pula" de largura no instante em que os dados chegam.
              <div className="grid" style={{ gap: GRID_GAP, gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
                {Array.from({ length: 18 }).map((_, i) => (
                  <div key={i} className="rounded-2xl overflow-hidden border border-neutral-800/50 bg-neutral-900/30 animate-pulse">
                    <div className="bg-neutral-800/40" style={{ aspectRatio: "4/3" }} />
                    <div className="p-3 space-y-2">
                      <div className="h-2.5 bg-neutral-800/60 rounded w-3/4" />
                      <div className="h-2 bg-neutral-800/40 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : view === "all" && fetchError && refs.length === 0 ? (
              // Distinto do empty-state: aqui a API falhou (Mongo offline, 500…),
              // não é "sem resultados pros filtros". Badge do header já foi
              // zerado no fetchPage pra não contradizer este grid vazio.
              <div className="flex flex-col items-center justify-center h-full gap-4 text-neutral-500 animate-in fade-in zoom-in-95 duration-200">
                <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-red-400" />
                </div>
                <div className="text-center max-w-sm">
                  <p className="text-base font-semibold text-red-400">Não foi possível carregar o catálogo</p>
                  <p className="text-xs font-bold text-neutral-500 mt-2 break-words">{fetchError}</p>
                </div>
                <button
                  onClick={() => fetchPage(1, false)}
                  className="flex items-center gap-2 h-10 px-4 rounded-xl bg-white text-black text-[11px] font-semibold hover:bg-neutral-200 transition-ui press"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Tentar de novo
                </button>
              </div>
            ) : view === "all" && refs.length === 0 && !hasActiveFilters ? (
              // PRIMEIRO USO — sem nenhum filtro aplicado, "redefina seus
              // filtros" é conselho para um problema que o usuário não tem: ele
              // não filtrou nada, o acervo é que está vazio. O estado vazio é o
              // argumento, e o argumento aqui é a ação que resolve.
              <div className="flex flex-col items-center justify-center h-full gap-5 animate-in fade-in zoom-in-95 duration-200">
                <div className="w-20 h-20 rounded-2xl bg-acc/10 border border-acc/20 flex items-center justify-center">
                  <FolderPlus className="w-9 h-9 text-acc" />
                </div>
                <div className="text-center max-w-sm">
                  <p className="text-base font-semibold text-neutral-200">Seu acervo está vazio</p>
                  <p className="text-xs font-bold text-neutral-500 mt-2 leading-relaxed">
                    Aponte uma pasta com PSDs ou imagens de mockup. Nada é gravado antes de você
                    revisar o que entra. Duplicata e lixo já vêm desmarcados.
                  </p>
                </div>
                <button
                  onClick={openIngest}
                  className="flex items-center gap-2 h-11 px-5 rounded-xl bg-white text-black text-[11px] font-semibold hover:bg-neutral-200 transition-colors transition-ui press shadow-xl shadow-white/5"
                >
                  <FolderPlus className="w-4 h-4" />
                  Adicionar pasta
                </button>
              </div>
            ) : view === "all" && refs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-neutral-500 animate-in fade-in zoom-in-95 duration-200">
                <div className="w-20 h-20 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                  <Search className="w-8 h-8 opacity-20" />
                </div>
                <div className="text-center">
                  <p className="text-base font-semibold text-neutral-400">Nenhum mockup encontrado</p>
                  <p className="text-xs font-bold text-neutral-500 mt-2">Tente redefinir seus filtros ou buscar outro termo</p>
                </div>
                <button
                  onClick={clearAllFilters}
                  className="flex items-center gap-2 h-9 px-4 rounded-xl border border-neutral-800 text-[10px] font-semibold text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors transition-ui press"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Limpar filtros
                </button>
              </div>
            ) : displayRefs.length === 0 ? (
              // O grid renderiza `displayRefs`, mas o estado vazio testava
              // `refs`: esconder tudo o que estava carregado dava TELA BRANCA,
              // sem mensagem e sem caminho de volta.
              <div className="flex flex-col items-center justify-center h-full gap-4 text-neutral-500 animate-in fade-in zoom-in-95 duration-200">
                <div className="w-20 h-20 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                  <EyeOff className="w-8 h-8 opacity-20" />
                </div>
                <div className="text-center">
                  <p className="text-base font-semibold text-neutral-400">Tudo oculto nesta página</p>
                  <p className="text-xs font-bold text-neutral-500 mt-2">
                    {refs.length} carregados, {hiddenDupes > 0 && `${hiddenDupes} duplicados, `}
                    {hiddenIds.size > 0 && `${hiddenIds.size} escondidos`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {hideDuplicates && hiddenDupes > 0 && (
                    <button
                      onClick={() => setHideDuplicates(false)}
                      className="h-9 px-4 rounded-xl border border-neutral-800 text-[10px] font-semibold text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors transition-ui press"
                    >
                      Mostrar duplicados
                    </button>
                  )}
                  {hiddenIds.size > 0 && (
                    <button
                      onClick={restoreAllHidden}
                      className="h-9 px-4 rounded-xl border border-neutral-800 text-[10px] font-semibold text-neutral-500 hover:text-white hover:border-neutral-600 transition-colors transition-ui press"
                    >
                      Restaurar ocultos
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Masonry (`@visant/masonry-gallery`) no lugar do grid de linhas
                    fixas. Não é estética: o grid antigo enquadrava tudo em 4/3 com
                    `object-cover`, então billboard, pôster e mockup 1:1 chegavam
                    recortados ao olho que está justamente ESCOLHENDO entre eles.
                    O round-robin do componente é o que permite isso num feed
                    infinito — anexar página nunca reordena o que já está na tela.
                    Colunas vêm da largura do contêiner, não da janela: o grid vive
                    entre dois painéis colapsáveis.

                    Enquanto o refetch está em voo o grid mostra a lista ANTIGA
                    como se fosse o resultado do filtro novo. Meio-tom + cursor
                    de espera dizem "isto ainda é o anterior" sem tirar a lista
                    da tela (piscar para skeleton a cada tecla seria pior). */}
                <div
                  ref={gridRef}
                  className={`transition-opacity [transition-duration:var(--dur-base)] ${
                    (loading || similarLoading) && !initialLoad ? "opacity-50 cursor-wait" : "opacity-100"
                  }`}
                  aria-busy={loading || similarLoading}
                >
                  <MasonryGallery
                    items={displayRefs}
                    cols={gridCols}
                    gap={GRID_GAP}
                    // key = ref.id sozinho (Mongo _id / scene id, já único por
                    // item) — `${id}-${i}` quebrava a reconciliação no infinite
                    // scroll porque o índice de posição muda a cada `load more`
                    // e a cada resposta de busca, fazendo o React trocar o card
                    // errado de lugar. dedupeRefs (hideDuplicates) já colapsa
                    // nome+tamanho repetido ANTES disso chegar aqui, então não
                    // há id repetido dentro da mesma lista renderizada.
                    getKey={(ref) => ref.id}
                    renderItem={(ref, i) => (
                      <div
                        // Arrastar só faz sentido na Coleção: lá a ordem é curadoria e é
                        // persistida. No acervo a ordem é do motor, e um card arrastável
                        // prometeria um controle que não existe.
                        draggable={view === "collection"}
                        onDragStart={view === "collection" ? () => setDragId(ref.id) : undefined}
                        onDragOver={view === "collection" ? (e) => e.preventDefault() : undefined}
                        onDrop={view === "collection" ? () => void dropOn(ref.id) : undefined}
                        className={view === "collection" && dragId === ref.id ? "opacity-40" : undefined}
                      >
                        <MockupCard
                          mockup={ref}
                          selected={selected?.id === ref.id}
                          hasArt={anyArt}
                          isRendering={renderingRefId === ref.id}
                          thumbSize={thumbSize}
                          renderedUrl={renderCache[ref.id]?.url}
                          // Teto de 240ms no atraso acumulado: `i * step` sem teto
                          // faria o 60º card entrar quase 2s depois do primeiro —
                          // isso não lê como cascata, lê como app travando.
                          enterDelay={Math.min((i % 24) * 20, 240)}
                          onSelect={selectRef}
                          onApply={handleCardApply}
                          onHide={hideMockup}
                          onToggleCollection={collectionKey ? toggleCollection : undefined}
                          onSimilar={showSimilar}
                          inCollection={collectionIds.has(ref.id)}
                          collectionLabel={collectionLabel}
                        />
                      </div>
                    )}
                  />
                </div>

                {/* Completar a coleção: vizinhos semânticos do que já foi curado ⊕ a
                    sugestão da marca. Fica DEPOIS da coleção, não antes — quem abriu a aba
                    veio ver o que escolheu; a sugestão é o próximo passo, não a manchete. */}
                {view === "collection" && (completions.length > 0 || completionsLoading || completionsError) && (
                  <section className="mt-10 border-t border-neutral-900 pt-8">
                    <div className="flex items-center gap-2 mb-4">
                      <ListPlus className="w-3.5 h-3.5 text-neutral-500" />
                      <h2 className="text-[11px] font-bold text-neutral-300">Para completar a coleção</h2>
                      <span className="text-[10px] text-neutral-500">
                        {collectionIds.size > 0
                          ? "parecidos com o que você já guardou, e o que combina com a marca"
                          : "o que combina com a marca"}
                      </span>
                    </div>
                    {completionsError ? (
                      <div className="flex items-center gap-3 text-[10px] text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Não deu para buscar sugestões: {completionsError}</span>
                        <button
                          onClick={() => void loadCompletions()}
                          className="h-7 px-3 rounded-full border border-neutral-800 text-[10px] font-bold text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors"
                        >
                          Tentar de novo
                        </button>
                      </div>
                    ) : completionsLoading ? (
                      <div className="flex items-center gap-3 text-neutral-500 text-[10px]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> procurando
                      </div>
                    ) : (
                      <MasonryGallery
                        items={completions}
                        cols={Math.max(2, gridCols)}
                        gap={GRID_GAP}
                        getKey={(ref) => ref.id}
                        renderItem={(ref, i) => (
                          <MockupCard
                            mockup={ref}
                            selected={selected?.id === ref.id}
                            hasArt={anyArt}
                            isRendering={renderingRefId === ref.id}
                            thumbSize={thumbSize}
                            renderedUrl={renderCache[ref.id]?.url}
                            enterDelay={Math.min((i % 24) * 20, 240)}
                            onSelect={selectRef}
                            onApply={handleCardApply}
                            onHide={hideMockup}
                            onToggleCollection={toggleCollection}
                            onSimilar={showSimilar}
                            inCollection={collectionIds.has(ref.id)}
                            collectionLabel={collectionLabel}
                          />
                        )}
                      />
                    )}
                  </section>
                )}

                {/* A continuação: o acervo acabou DENTRO do recorte, não no catálogo.
                    A faixa marca a fronteira — daqui pra baixo não é mais resultado do
                    filtro, é sugestão. Esconder essa costura seria a UI fingindo que o
                    filtro achou mais do que achou. */}
                {view === "all" && displayTail.length > 0 && (
                  <section className="mt-10 border-t border-neutral-900 pt-8">
                    <div className="flex items-center gap-2 mb-4">
                      <InfinityIcon className="w-3.5 h-3.5 text-neutral-500" />
                      <h2 className="text-[11px] font-bold text-neutral-300">Continuando a partir daqui</h2>
                      <span className="text-[10px] text-neutral-500">
                        {hasActiveFilters ? "o filtro acabou aqui. " : ""}
                        {tailMode === "semantic"
                          ? "parecidos com o que você acabou de ver"
                          : tailMode === "lexical"
                            ? "pelas tags do que você acabou de ver"
                            : "o resto do acervo, pelos mais usados"}
                      </span>
                    </div>
                    <MasonryGallery
                      items={displayTail}
                      cols={gridCols}
                      gap={GRID_GAP}
                      getKey={(ref) => ref.id}
                      renderItem={(ref, i) => (
                        <MockupCard
                          mockup={ref}
                          selected={selected?.id === ref.id}
                          hasArt={anyArt}
                          isRendering={renderingRefId === ref.id}
                          thumbSize={thumbSize}
                          renderedUrl={renderCache[ref.id]?.url}
                          enterDelay={Math.min((i % 24) * 20, 240)}
                          onSelect={selectRef}
                          onApply={handleCardApply}
                          onHide={hideMockup}
                          onToggleCollection={collectionKey ? toggleCollection : undefined}
                          onSimilar={showSimilar}
                          inCollection={collectionIds.has(ref.id)}
                          collectionLabel={collectionLabel}
                        />
                      )}
                    />
                  </section>
                )}

                <div ref={sentinelRef} className="flex flex-col items-center justify-center py-20 gap-6">
                  {(loading || tailLoading) && (
                    <div className="flex items-center gap-4 text-neutral-400 text-[10px] font-medium bg-neutral-900/50 backdrop-blur-xl px-6 py-3 rounded-full border border-neutral-800 shadow-2xl">
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      {tailLoading ? "Procurando mais parecidos" : "Carregando Catálogo"}
                    </div>
                  )}
                  {fetchError && refs.length > 0 && (
                    // Já tinha página carregada quando o scroll infinito bateu erro —
                    // não mostra "Fim da Biblioteca" (mentira: não foi fim, foi falha)
                    // nem refaz fetch sozinho (hasMore já foi pra false no fetchPage).
                    <div className="flex flex-col items-center gap-3 text-red-400 text-[10px] font-medium">
                      <span>Falha ao carregar mais mockups: {fetchError}</span>
                      <button
                        onClick={() => fetchPage(page + 1, true)}
                        className="flex items-center gap-2 h-8 px-3 rounded-full bg-white text-black text-[10px] font-semibold hover:bg-neutral-200 transition-ui press"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Tentar de novo
                      </button>
                    </div>
                  )}
                  {tailError && !tailLoading && (
                    <div className="flex flex-col items-center gap-3 text-red-400 text-[10px] font-medium">
                      <span>Falha ao buscar mais parecidos: {tailError}</span>
                      <button
                        onClick={() => {
                          setTailError(null);
                          void loadTail();
                        }}
                        className="flex items-center gap-2 h-8 px-3 rounded-full bg-white text-black text-[10px] font-semibold hover:bg-neutral-200 transition-ui press"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Tentar de novo
                      </button>
                    </div>
                  )}
                  {/* "Fim" só depois de a cauda algorítmica secar também: enquanto houver
                      QUALQUER coisa no acervo que o usuário não viu, o rodapé não pode
                      dizer que acabou. Dizia, e acabava só o filtro. Cauda que FALHOU
                      também não vira fim: ali o rodapé é o erro acima, com saída. */}
                  {!hasMore && tailDone && !tailLoading && !tailError && !fetchError && refs.length > 0 && (
                    <div className="flex items-center gap-4 text-neutral-500 text-[10px] font-medium">
                      <div className="h-[1px] w-12 bg-neutral-900" />
                      Você viu o acervo inteiro
                      <div className="h-[1px] w-12 bg-neutral-900" />
                    </div>
                  )}
                </div>
              </>
            )}
          </main>

          {lastHidden && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-neutral-900/95 backdrop-blur-xl border border-neutral-700 rounded-2xl pl-5 pr-3 py-3 shadow-2xl animate-in slide-in-from-bottom-4 fade-in duration-300">
              <span className="flex items-center gap-2.5 text-[11px] font-bold text-neutral-300">
                <EyeOff className="w-4 h-4 text-neutral-500" />
                <span className="max-w-[220px] truncate">Mockup oculto: <span className="text-white">{lastHidden.name}</span></span>
              </span>
              <button
                onClick={() => unhideMockup(lastHidden.id)}
                className="flex items-center gap-2 bg-white text-black text-[10px] font-semibold px-3.5 py-2 rounded-xl hover:bg-neutral-200 transition-ui press"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Desfazer
              </button>
              <button onClick={() => setLastHidden(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-500 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
            </div>
          )}
        </Panel>

        {selected && <ResizeHandle />}

        {/* Right Sidebar: Controls & Render */}
        {selected && (
          <Panel
            panelRef={rightPanelRef}
            defaultSize="28%"
            minSize="22%"
            maxSize="40%"
            collapsible={true}
            collapsedSize="0%"
            className="flex flex-col bg-neutral-950 border-l border-neutral-900 shadow-2xl z-10 animate-in slide-in-from-right-4 duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] overflow-hidden"
          >
            <div className="p-4 border-b border-neutral-900 flex justify-between items-center shrink-0">
              <div className="min-w-0">
                <h2 className="font-bold text-sm truncate pr-2">{selected.name}</h2>
                <p className="text-[10px] font-bold text-neutral-500">{selected.studio}</p>
              </div>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-neutral-900 text-neutral-500 hover:text-white transition-ui press">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* O seletor de arquivo vivia DENTRO do bloco `faces.length > 0`.
                Num PSD com smart object mas sem face editável — que renderiza
                normalmente, via `selectedSo` — o input não existia, e o
                "Adicionar arte" do preview chamava `fileInputRef.current?.click()`
                num ref nulo: a ação primária do produto não fazia nada, em
                silêncio. Fora do bloco, ele existe sempre que há mockup aberto. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleArtSelect(f); e.target.value = ""; }}
            />

            <div className="flex-1 overflow-y-auto no-scrollbar">
              <div
                className="relative aspect-[4/3] bg-neutral-900 group/preview overflow-hidden ring-1 ring-white/5 mx-4 mt-4 rounded-2xl"
                onClick={!renderResult && !cropping ? () => fileInputRef.current?.click() : undefined}
                style={!renderResult && !cropping ? { cursor: "pointer" } : undefined}
              >
                {/* O recorte ASSUME esta superfície. Ele já morou num painel próprio
                    logo abaixo, e o resultado era o defeito que o `ArtFramePanel`
                    documenta: a arte sem a cena aqui, a cena sem a arte ali, e o
                    enquadramento sendo ajustado num lugar e conferido no outro. Uma
                    superfície grande por vez — o que está sendo decidido AGORA é o que
                    ocupa ela. */}
                {cropping ? (
                  <>
                    <ArtCropSurface
                      fill
                      artPreview={artPreview!}
                      aspect={soWidth && soHeight ? soWidth / soHeight : 4 / 3}
                      onCropPixels={(px) => setFrame((f) => ({ ...f, cropPixels: px }))}
                    />
                    {/* A saída do modo fica NA superfície, junto do trabalho. O botão que
                        entrou no recorte está 300px abaixo, e sair por onde se entrou
                        obriga a procurar. Esc faz o mesmo. */}
                    <button
                      onClick={() => setCropOpen(false)}
                      className="absolute top-3 right-3 z-10 h-8 px-3 rounded-xl bg-white text-black text-[11px] font-semibold shadow-lg hover:bg-neutral-200 transition-ui press"
                    >
                      Concluir recorte
                    </button>
                  </>
                ) : renderResult ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={renderResult} alt="Render" className="absolute inset-0 w-full h-full object-contain cursor-pointer transition-transform [transition-duration:var(--dur-slow)] group-hover/preview:scale-[1.03]" onClick={() => setFullscreen(true)} />
                ) : selected.referenceImageUrl ? (
                  <>
                    {/* `priority` saiu: esta imagem só existe com o drawer aberto, ou
                        seja nunca é o LCP — e `priority` fora do LCP tira banda de quem
                        é. */}
                    <Image src={selected.referenceImageUrl} alt={selected.name} fill className="object-contain" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 opacity-0 group-hover/preview:opacity-100 transition-opacity [transition-duration:var(--dur-base)] bg-black/50">
                      <Upload className="w-6 h-6 text-white" />
                      <span className="text-[11px] font-bold text-white">Adicionar arte</span>
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-500 group-hover/preview:text-neutral-400 transition-colors">
                    <Upload className="w-7 h-7" />
                    <span className="text-[11px] font-bold">Adicionar arte</span>
                  </div>
                )}
                {/* Render loading overlay — shown over the thumb for both preview (Worker) and final render.
                    Nunca durante o recorte: ali esta caixa É a área de trabalho, e um
                    overlay escurecendo o que a pessoa está arrastando é a tela brigando
                    com o gesto. */}
                {rendering && !cropping && (
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center px-6">
                    {/* Três sinais de movimento para UMA espera: o Lottie, o texto
                        pulsando e a barra varrendo, simultâneos, numa caixa de 220px.
                        Ficou o Lottie (identidade) e a barra (indeterminação honesta);
                        o `animate-pulse` do texto saiu, porque o passo já muda de
                        palavra sozinho — piscar um texto que muda é ruído em cima de
                        sinal. E "compositing…" era a única palavra em inglês da tela. */}
                    <div className="flex flex-col items-center gap-2 w-full max-w-[220px]" aria-live="polite">
                      <Lottie animationData={boxLoaderData} loop className={previewRendering ? "w-10 h-10" : "w-16 h-16"} />
                      <div className="flex items-center gap-2 text-[10px] font-bold text-white/70">
                        <span>{currentStep || (previewRendering ? "Compondo…" : "Processando…")}</span>
                        {!previewRendering && <span className="text-white/40 tabular-nums">{renderElapsed}s</span>}
                      </div>
                      {!previewRendering && (
                        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-white animate-progress-indefinite rounded-full" style={{ width: "40%" }} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Ações da superfície. Revelam no hover E no foco: eram o ÚNICO caminho
                    para tela cheia, copiar PNG e abrir a pasta, e quem navega no teclado
                    não tem hover — a ação existia e era inalcançável. `translate-y` fica
                    porque flutua sobre a imagem: revelar nunca muda layout.
                    Somem no recorte, que é outro modo e tem a saída dele. */}
                {!cropping && (
                <div className="absolute top-3 left-3 flex gap-2 opacity-0 group-hover/preview:opacity-100 group-focus-within/preview:opacity-100 translate-y-2 group-hover/preview:translate-y-0 group-focus-within/preview:translate-y-0 transition-ui [transition-duration:var(--dur-slow)]">
                  {renderResult && (
                    <>
                      <button onClick={() => setFullscreen(true)} title="Ver em tela cheia" aria-label="Ver em tela cheia" className="bg-black/80 backdrop-blur shadow-xl hover:bg-white hover:text-black text-white w-9 h-9 rounded-xl flex items-center justify-center transition-ui press">
                        <Maximize2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={copyRenderAsPng}
                        title="Copiar como PNG"
                        aria-label="Copiar como PNG"
                        className={`backdrop-blur shadow-xl w-9 h-9 rounded-xl flex items-center justify-center transition-ui press ${copiedPng ? "bg-acc2 text-neutral-950" : "bg-black/80 hover:bg-white hover:text-black text-white"}`}
                      >
                        {copiedPng ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </>
                  )}
                  {selected.psdPath && (
                    <button
                      onClick={() => fetch("/api/open-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: selected.psdPath }) })}
                      title="Abrir a pasta do PSD"
                      aria-label="Abrir a pasta do PSD"
                      className="bg-black/80 backdrop-blur shadow-xl hover:bg-white hover:text-black text-white w-9 h-9 rounded-xl flex items-center justify-center transition-ui press"
                    >
                      <Folder className="w-4 h-4" />
                    </button>
                  )}
                </div>
                )}

                {/* Marca que o que está na tela NÃO é o entregável. Com o aviso de
                    resolução fora daqui, âmbar voltou a ter um sentido só nesta tela, e
                    o selo pôde parar de gritar: era sólido, em caps, com brilho. */}
                {renderResult && isPreviewResult && !cropping && (
                  <div className="absolute top-3 right-3 bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-semibold px-2 py-0.5 rounded-lg backdrop-blur">Prévia</div>
                )}
                {renderTime != null && renderTime > 0 && !cropping && (
                  <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur text-[10px] font-bold text-neutral-400 px-2 py-1 rounded-lg tabular-nums">{dec(renderTime / 1000)}s</div>
                )}
              </div>

              <div className="flex flex-col p-4 gap-5">
                {/* Controls Accordion */}
                <div className="space-y-3">
                  <SmartObjectList
                    psdInfo={psdInfo}
                    faces={faces}
                    artSlots={artSlots}
                    activeSlot={activeSlot}
                    aberto={showSmartObjects}
                    onAbertoChange={(v) => {
                      setShowSmartObjects(v);
                      // Fechar Smart Objects fecha a seção de arte junto. Era um
                      // `useEffect` observando o próprio estado; agora é o handler.
                      if (!v) setArtSectionCollapsed(true);
                    }}
                    onSelectFace={(faceIdx, smartObject) => {
                      setActiveSlot(faceIdx);
                      setSelectedSo(smartObject);
                      setFrame((fr) => ({ ...fr, cropPixels: undefined }));
                      setArtSectionCollapsed(false);
                    }}
                    onPickArt={(faceIdx, temArte) => {
                      setActiveSlot(faceIdx);
                      setArtSectionCollapsed(false);
                      if (!temArte) fileInputRef.current?.click();
                    }}
                  />

                </div>

                {selected.description && (
                  <div className="bg-neutral-900/20 p-4 rounded-2xl border border-neutral-900">
                    <p className="text-[11px] text-neutral-500 leading-relaxed italic line-clamp-4">&ldquo;{selected.description}&rdquo;</p>
                  </div>
                )}

                <PsdDetails
                  psdInfo={psdInfo}
                  psdPath={selected.psdPath}
                  psdSizeBytes={selected.psdSizeBytes}
                  hiddenLayers={hiddenLayers}
                  onToggleLayer={toggleLayer}
                />
              </div>
            </div>

            {/* Art Input — colapsável. Hidden quando não há faces editáveis. */}
            {faces.length > 0 && (
              <div className="shrink-0 flex flex-col border-t border-neutral-900 bg-neutral-950">
              {/* Header — clica para colapsar.
                  Era `h-8` com texto de 9px: o único caminho de volta para a seção da
                  arte depois de colapsada, e quase invisível. Alvo de 36px e texto de
                  10px — continua discreto, mas agora é um alvo. */}
              <button
                onClick={() => setArtSectionCollapsed((v) => !v)}
                aria-expanded={!artSectionCollapsed}
                className="h-9 flex items-center justify-between px-4 w-full group select-none hover:bg-white/5 transition-colors"
              >
                <p className="text-[10px] font-medium text-neutral-400 group-hover:text-neutral-200 transition-colors truncate">
                  {faces.length > 1 && activeFace ? `Arte: ${activeFace.name}` : "Sua arte"}
                </p>
                {/* A MEDIDA DA SUPERFÍCIE, sempre visível.
                    Ela existia em dois lugares e nenhum dos dois serve para quem
                    ainda vai CRIAR a arte: a lista de Smart Objects só aparece com
                    duas faces ou mais, e a linha do `ArtFramePanel` exige a arte já
                    anexada e a seção aberta. PSD de uma face, seção fechada — que é
                    o estado padrão — não dizia em lugar nenhum para quantos pixels
                    desenhar. Aqui é um termo no cabeçalho que já existe: zero caixa
                    nova, zero altura nova, e é o número que decide o arquivo que a
                    pessoa vai abrir no Figma antes de voltar. */}
                <span className="ml-auto mr-2 shrink-0 text-[10px] font-mono tabular-nums text-neutral-600 group-hover:text-neutral-400 transition-ui">
                  {soWidth && soHeight ? `${soWidth}×${soHeight}` : ""}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-neutral-500 group-hover:text-neutral-300 transition-colors [transition-duration:var(--dur-base)] ${artSectionCollapsed ? "" : "rotate-180"}`} />
              </button>

              {/* Conteúdo colapsável */}
              {!artSectionCollapsed && (
                <div className="px-4 pb-4 flex flex-col gap-2">
                  <div className={brandId && !artPreview ? "flex gap-2 items-stretch" : undefined}>
                    <div
                      onDrop={handleDrop}
                      onDragOver={(e) => e.preventDefault()}
                      onClick={() => !artPreview && fileInputRef.current?.click()}
                      className={`rounded-2xl flex flex-col gap-2 transition-colors relative ${
                        artPreview
                          ? "border border-neutral-800 bg-neutral-900/40 p-2"
                          : `border-2 border-dashed cursor-pointer flex items-center justify-center px-3 py-3 group ${brandId ? "flex-1" : ""} border-neutral-800 hover:border-neutral-600 bg-neutral-900/30 hover:bg-neutral-900/50`
                      }`}
                    >
                      {artPreview ? (
                        <div onClick={(e) => e.stopPropagation()}>
                          {/* `source`, não `full`: esta tela JÁ tem uma superfície
                              grande logo acima (cena/render). Duas imagens grandes
                              empilhadas obrigavam a montar o resultado de cabeça. */}
                          <ArtFramePanel
                            variant="source"
                            artPreview={artPreview}
                            artDims={artDims}
                            frame={frame}
                            onFrameChange={setFrame}
                            soWidth={soWidth}
                            soHeight={soHeight}
                            fileName={artFile?.name || "Área de transferência"}
                            cropOpen={cropOpen}
                            onCropOpenChange={setCropOpen}
                            onClear={() => { clearSlot(activeSlot); setRenderResult(null); setCropOpen(false); }}
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 py-1">
                          <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center group-hover:bg-neutral-700 transition-colors shrink-0">
                            <ImageIcon className="w-4 h-4 text-neutral-500" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-neutral-400">
                              {faces.length > 1 && activeFace ? <>Arte para <span className="text-white">«{activeFace.name}»</span></> : "Clique ou arraste sua arte"}
                            </p>
                            <p className="text-[10px] text-neutral-500">JPG, PNG ou Ctrl+V</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Brand shortcuts — só quando sem arte */}
                    {brandId && !artPreview && (
                      <div className="flex flex-col gap-2 shrink-0 w-[4.5rem]">
                        <button onClick={(e) => { e.stopPropagation(); loadBrandLogoAsArt(); }} className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-neutral-800 text-[10px] font-bold text-neutral-400 hover:bg-white hover:text-black transition-ui press py-1"><Zap className="w-4 h-4" /><span>Logo</span></button>
                        <button onClick={(e) => { e.stopPropagation(); openLibrary(); }} className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-neutral-800 text-[10px] font-bold text-neutral-400 hover:bg-white hover:text-black transition-ui press py-1"><Library className="w-4 h-4" /><span>Library</span></button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Actions Footer */}
            <div className="p-4 border-t border-neutral-900 bg-neutral-950/80 backdrop-blur shrink-0 space-y-4 shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
              {/* A decisão automática de enquadramento é dita em voz alta e tem
                  desfazer ao lado. Automatismo silencioso numa etapa que produz
                  o entregável final vira surpresa no PNG. */}
              {framingHint && artPreview && (
                /* O default é uma decisão tomada no lugar do usuário, e a REGRA dele
                   tem que ser legível onde ele escolhe. O porquê (`reason`) estava só
                   no `title`: invisível no teclado, invisível no toque, e visível no
                   mouse apenas para quem já desconfiava. Agora é a frase, e o desfazer
                   virou um alvo com cara de alvo em vez de texto solto. */
                <div className="flex items-center gap-3 text-[10px] text-neutral-500">
                  <span className="min-w-0 flex-1 leading-relaxed">{framingHint.reason}</span>
                  <button
                    onClick={() => {
                      setFrame((f) => ({
                        ...f,
                        mode: framingHint.mode === "cover" ? "contain" : "cover",
                        bg: framingHint.mode === "cover" ? brandColorRef.current : null,
                      }));
                      setFramingHint(null);
                    }}
                    className="shrink-0 h-7 px-2.5 rounded-lg border border-neutral-800 font-bold text-neutral-300 hover:bg-neutral-900 hover:text-white transition-ui press"
                  >
                    {framingHint.mode === "cover" ? "Encaixar" : "Preencher"}
                  </button>
                </div>
              )}

              {/* A ampliação da arte era uma caixa âmbar de 56px aqui, com fundo, borda,
                  ícone de alerta e três orações em negrito, encostada no botão que
                  produz o entregável. Sete sinais para um fato que não é erro — nada
                  quebrou, não há o que reconhecer, não há botão para clicar. O fato
                  virou um termo na linha de dimensões da arte (`ArtFramePanel`), ao lado
                  dos números de que ele fala, e o conselho foi junto. */}

              {/* UMA ação primária, e ela é sempre o próximo passo.
                  Antes esta região desenhava DOIS botões que chamavam
                  `handleRender(false)` — `RENDER FINAL` em contorno e
                  `GERAR PNG FINAL PARA BAIXAR` em verde, a 12px um do outro. A
                  duplicação já tinha sido vista (o comentário de `hasResult` a
                  descreve) e o conserto na época foi demover um dos dois em vez de
                  apagá-lo: sobraram duas ações na tela para uma no código. Pior, o
                  verde levava ícone de download e NÃO baixava nada — disparava 40s de
                  render.

                  Agora o primário percorre os estados: sem arquivo final ele gera,
                  com arquivo final ele baixa. Mexer na arte ou no enquadramento
                  redispara a prévia, o `isPreviewResult` volta a ser true e o primário
                  volta sozinho para "Gerar PNG" — não existe estado onde renderizar de
                  novo seja preciso e não esteja à mão. */}
              {filledCount > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleRender(true)}
                  disabled={renderDisabled}
                  className="flex-1 py-3 rounded-xl border border-neutral-800 text-xs font-bold text-neutral-300 disabled:opacity-30 hover:bg-neutral-900 hover:text-white transition-ui press"
                >
                  Prévia
                </button>
                {finalReady ? (
                  <a
                    href={renderResult!}
                    download={`${selected.name.replace(/\s+/g, "_")}_mockup.png`}
                    className="flex-[1.4] flex items-center justify-center gap-2 py-3 rounded-xl bg-acc2 text-neutral-950 text-xs font-semibold hover:bg-acc2/90 transition-ui press shadow-lg shadow-acc2/10"
                  >
                    <Download className="w-4 h-4" /> Baixar PNG
                  </a>
                ) : (
                  <button
                    onClick={() => handleRender(false)}
                    disabled={renderDisabled}
                    className="flex-[1.4] py-3 rounded-xl text-xs font-semibold bg-acc2 text-neutral-950 disabled:opacity-30 hover:bg-acc2/90 shadow-lg shadow-acc2/10 transition-ui press"
                  >
                    Gerar PNG{faces.length > 1 ? ` · ${filledCount}/${faces.length}` : ""}
                  </button>
                )}
                {renderLogs.length > 0 && (
                  <button
                    onClick={() => setShowLogs(true)}
                    title="Ver logs do render"
                    aria-label="Ver logs do render"
                    className={`px-3 py-3 rounded-xl border text-xs font-bold transition-ui press ${renderLogs.some(l => l.step === "error") ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-neutral-800 text-neutral-500 hover:bg-neutral-900 hover:text-white"}`}
                  >
                    <Terminal className="w-4 h-4" />
                  </button>
                )}
              </div>
              )}

              {/* Contrato de tempo, ANTES do clique.
                  O render final leva de 20 a 60 segundos e nada dizia isso: o
                  contador só nascia depois que a espera já tinha começado, quando
                  a informação não serve mais para decidir. Quem não sabe que vai
                  esperar interpreta a espera como travamento e clica de novo.
                  Depois do primeiro render da sessão a linha para de estimar e
                  passa a relatar: a medida real deste mockup, nesta máquina, vale
                  mais que qualquer faixa que eu escrevesse aqui.

                  ⚠️ A linha ocupa o slot SEMPRE (altura fixa), e por isso o texto
                  cobre os três estados. A primeira versão dela sumia quando o
                  render começava, e isso empurrava o botão primário ~14px no
                  instante do clique — quem pegou foi o `check:render-failure`, que
                  passou a errar o alvo e a reportar "o botão nunca ficou clicável".
                  Salto de layout embaixo da ação que entrega o arquivo. */}
              {filledCount > 0 && (
                <p className="h-3.5 text-[10px] text-neutral-600 text-center tabular-nums">
                  {finalReady
                    ? renderTime != null && renderTime > 0
                      ? `PNG pronto em ${dec(renderTime / 1000)}s`
                      : "PNG pronto"
                    : renderTime != null && renderTime > 0
                      ? `o último PNG levou ${dec(renderTime / 1000)}s`
                      : "o PNG final leva de 20 a 60 segundos"}
                </p>
              )}

              {/* O texto que diz POR QUE o entregável falhou era o menor do rodapé
                  (10px, contra os 12 do botão logo acima) — a hierarquia dizia que
                  a explicação importava menos que o botão que acabou de falhar.
                  E o `.join(", ")` colava os erros de um render multi-face numa
                  frase corrida, sem quebra e sem dizer qual face morreu. */}
              {renderLogs.some((l) => l.step === "error") && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <div className="space-y-1 min-w-0">
                    {renderLogs
                      .filter((l) => l.step === "error")
                      .map((l, i) => (
                        <p key={i} className="leading-snug break-words">{l.detail}</p>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </Panel>
        )}
      </PanelGroup>

      {/* Render Logs modal */}
      <Dialog open={showLogs} onOpenChange={setShowLogs}>
        <DialogContent title="Logs do render" skin="neutral" showClose={false} bare
          className="flex items-end justify-end p-4 pointer-events-none">
          <div className="pointer-events-auto w-[min(500px,92vw)] max-h-[70vh] flex flex-col rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-900">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-neutral-500" />
                <span className="text-[11px] font-semibold text-neutral-300">Render Logs</span>
                <span className="text-[10px] font-bold text-neutral-500 bg-neutral-900 px-1.5 py-0.5 rounded-lg border border-neutral-800">{renderLogs.length}</span>
              </div>
              <button onClick={() => setShowLogs(false)} className="text-neutral-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-0.5 font-mono">
              {renderLogs.map((log, i) => (
                <div key={i} className={`flex gap-2 py-0.5 text-[10px] leading-relaxed ${log.step === "error" ? "text-red-400" : log.step === "complete" ? "text-acc2" : log.step === "warning" ? "text-amber-400" : "text-neutral-500"}`}>
                  <span className="shrink-0 text-neutral-500 w-5 text-right">{i + 1}</span>
                  <span className={`shrink-0 font-bold ${log.step === "error" ? "text-red-500" : log.step === "complete" ? "text-acc2" : log.step === "warning" ? "text-amber-500" : "text-neutral-500"}`}>{log.step}</span>
                  {log.detail && <span className="break-all">{log.detail}</span>}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Session modal */}
      {showSession && (() => {
        const entries = Object.entries(renderCache);
        const allSelected = entries.length > 0 && entries.every(([id]) => sessionSelected.has(id));
        const downloadTargets = sessionSelected.size > 0
          ? entries.filter(([id]) => sessionSelected.has(id))
          : entries;

        const triggerDownloads = (targets: typeof entries) => {
          targets.forEach(([id, { url, name }], i) => {
            setTimeout(() => {
              const a = document.createElement("a");
              a.href = url;
              a.download = `${name.replace(/\s+/g, "_")}_mockup.png`;
              a.click();
            }, i * 200);
          });
        };

        return (
          <Dialog open={showSession} onOpenChange={setShowSession}>
            <DialogContent title="Renders desta sessão" skin="neutral" showClose={false} bare className="flex flex-col">
            <div className="flex flex-col h-full max-w-5xl w-full mx-auto">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-950">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-white">Session</h2>
                  <span className="text-[10px] font-bold text-neutral-500 bg-neutral-900 px-2 py-0.5 rounded-full border border-neutral-800">{entries.length} renders</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSessionSelected(allSelected ? new Set() : new Set(entries.map(([id]) => id)))}
                    className="px-3 py-1.5 rounded-lg border border-neutral-800 text-[10px] font-bold text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors"
                  >
                    {allSelected ? "Desmarcar tudo" : "Selecionar tudo"}
                  </button>
                  {/* O render é o momento em que se descobre que o mockup serve para a
                      marca — guardar na coleção aqui evita ter que voltar ao grid e
                      reencontrar o card no meio de milhares. */}
                  {brandId && (
                    <button
                      onClick={() => void addSelectionToCollection(downloadTargets.map(([id]) => id))}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neutral-800 text-[10px] font-bold text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      {sessionSelected.size > 0 ? `Guardar na coleção (${sessionSelected.size})` : "Guardar tudo na coleção"}
                    </button>
                  )}
                  <button
                    onClick={() => triggerDownloads(downloadTargets)}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-white text-black text-[10px] font-semibold hover:bg-neutral-200 transition-ui press"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {sessionSelected.size > 0 ? `Baixar selecionados (${sessionSelected.size})` : "Baixar todos"}
                  </button>
                  <button
                    onClick={() => { setRenderCache({}); setShowSession(false); }}
                    className="px-3 py-1.5 rounded-lg border border-red-500/20 text-[10px] font-bold text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    Limpar sessão
                  </button>
                  <button onClick={() => setShowSession(false)} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-colors ml-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Grid */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {entries.map(([id, { url, name }]) => {
                    const isChecked = sessionSelected.has(id);
                    return (
                      <div
                        key={id}
                        onClick={() => setSessionSelected((s) => { const n = new Set(s); isChecked ? n.delete(id) : n.add(id); return n; })}
                        className={`relative rounded-2xl overflow-hidden border cursor-pointer transition-colors [transition-duration:var(--dur-base)] group ${isChecked ? "border-white ring-2 ring-white/20" : "border-neutral-800 hover:border-neutral-600"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={name} className="w-full aspect-[4/3] object-cover" />
                        {/* Checkbox */}
                        <div className={`absolute top-2 left-2 w-5 h-5 rounded-lg border flex items-center justify-center transition-[color,background-color,border-color,opacity] ${isChecked ? "bg-white border-white" : "bg-black/50 border-neutral-600 opacity-0 group-hover:opacity-100"}`}>
                          {isChecked && <CheckCircle2 className="w-3.5 h-3.5 text-black" />}
                        </div>
                        {/* Download button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); triggerDownloads([[id, { url, name }]]); }}
                          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-white hover:text-black transition-[color,background-color,border-color,opacity]"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <div className="p-2.5 bg-neutral-900 border-t border-neutral-800">
                          <p className="text-[11px] font-bold text-neutral-300 truncate">{name}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Fullscreen overlay. O `renderResult &&` externo continua sendo o que
          estreita o tipo para o `<img src>` e o `download` — `open` sozinho é só
          um booleano e o JSX é avaliado de qualquer jeito. */}
      {renderResult && (
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent title="Render em tela cheia" skin="neutral" showClose={false} bare
          className="bg-black/98 flex flex-col">
          <div className="p-4 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <ImageIcon className="w-5 h-5 text-neutral-500" />
              <span className="text-sm font-bold text-neutral-300">{selected?.name}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); copyRenderAsPng(); }}
                className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl transition-ui press ${copiedPng ? "bg-acc2 text-neutral-950" : "bg-neutral-800 hover:bg-neutral-700 text-white"}`}
              >
                {copiedPng ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copiedPng ? "Copiado!" : "Copiar PNG"}
              </button>
              <a
                href={renderResult}
                download={`${selected?.name || "render"}-render.${isPreviewResult ? "jpg" : "png"}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 bg-white text-black text-xs font-bold px-4 py-2 rounded-xl hover:bg-neutral-200 transition-ui press"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
              <button
                onClick={() => setFullscreen(false)}
                className="bg-neutral-800 hover:bg-neutral-700 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-ui press"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          <div className="flex-1 flex items-center justify-center p-8 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={renderResult}
              alt="Fullscreen"
              className="max-w-full max-h-full object-contain shadow-2xl shadow-black ring-1 ring-white/10"
            />
          </div>

          <div className="p-4 text-center text-[10px] font-bold text-neutral-500 bg-neutral-950/50">
            {renderTime != null && renderTime > 0 && `Processado em ${dec(renderTime / 1000)}s`}
            {renderResult && ` · ${isPreviewResult ? "JPEG Preview" : "PNG Lossless"}`}
          </div>
        </DialogContent>
      </Dialog>
      )}

      {/* Advanced Settings Modal — Radix: foco preso, ESC, rolagem do fundo travada
          e `aria-modal`. A versão à mão não tinha nada disso: Tab saía para o grid
          atrás e o leitor de tela nunca soube que havia um diálogo. */}
      {/* Nome da coleção — criar avulsa e renomear são a MESMA tela: o único dado
          é o nome, e duas telas para um campo divergiriam no primeiro conserto. */}
      <Dialog open={!!nameDialog} onOpenChange={(o) => !o && setNameDialog(null)}>
        <DialogContent
          title={nameDialog?.mode === "rename" ? "Renomear coleção" : "Nova coleção"}
          skin="neutral"
          showClose={false}
          className="w-[min(24rem,92vw)] rounded-2xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center">
                <Bookmark className="w-4 h-4 text-neutral-300" />
              </div>
              <p className="text-sm font-semibold text-white">
                {nameDialog?.mode === "rename" ? "Renomear coleção" : "Nova coleção"}
              </p>
            </div>
            <DialogClose aria-label="Fechar" className="p-2 rounded-xl hover:bg-neutral-800 text-neutral-500 hover:text-white transition-ui press">
              <X className="w-4 h-4" />
            </DialogClose>
          </div>
          <div className="p-5 flex flex-col gap-3">
            <input
              autoFocus
              value={nameDialog?.value ?? ""}
              onChange={(e) => setNameDialog((d) => (d ? { ...d, value: e.target.value } : d))}
              onKeyDown={(e) => { if (e.key === "Enter") void submitCollectionName(); }}
              placeholder="Referências de tipografia"
              className="w-full h-10 px-3 rounded-xl bg-neutral-900 border border-neutral-800 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-600"
            />
            <p className="text-[10px] text-neutral-500">
              Coleção avulsa não precisa de marca. Enquanto estiver ativa, ela é o destino do marcador.
            </p>
            <button
              onClick={() => void submitCollectionName()}
              className="h-10 rounded-xl bg-white text-black text-[11px] font-bold hover:bg-neutral-200 transition-ui press"
            >
              {nameDialog?.mode === "rename" ? "Salvar nome" : "Criar coleção"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent title="Configurações" skin="neutral" showClose={false}
          className="w-[min(34rem,92vw)] max-h-[85vh] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/30 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center">
                <Settings2 className="w-4 h-4 text-neutral-300" />
              </div>
              <p className="text-sm font-semibold text-white">Configurações</p>
            </div>
            <DialogClose aria-label="Fechar" className="p-2 rounded-xl hover:bg-neutral-800 text-neutral-500 hover:text-white transition-ui press">
              <X className="w-4 h-4" />
            </DialogClose>
          </div>

          {/* Acervo, chaves e render-server. Só é montado com o diálogo aberto,
              para o GET de configuração não custar nada em quem nunca abre.
              `min-h-0` é o que faz o filho rolar: sem ele o flex item adota a
              altura do conteúdo e o rodapé sai por cima do painel. */}
          {showSettings && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ConfigPanel />
            </div>
          )}

          <div className="p-5 border-t border-neutral-800 shrink-0 flex flex-col gap-3">
            <button
              onClick={() => { setShowSettings(false); setShowDupes(true); if (!dupesGroups.length && !dupesScanning) scanDuplicates(); }}
              className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl bg-amber-500/8 border border-amber-500/15 hover:bg-amber-500/15 hover:border-amber-500/30 transition-ui press group text-left"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0 group-hover:bg-amber-500/25 transition-colors">
                <Copy className="w-4.5 h-4.5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-300">Duplicatas</p>
                <p className="text-[10px] text-neutral-500 font-medium">Encontrar e remover PSDs duplicados</p>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ocultos — o que foi tirado do grid. Nada aqui saiu do disco. */}
      <Dialog open={showHidden} onOpenChange={setShowHidden}>
        <DialogContent title="Ocultos" skin="neutral" showClose={false}
          className="w-[min(48rem,92vw)] max-h-[85vh] rounded-2xl overflow-hidden">

          <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/30 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center shrink-0">
                <EyeOff className="w-4 h-4 text-neutral-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold tracking-tight">Ocultos</h3>
                <p className="text-[10px] text-neutral-500 font-semibold mt-0.5">
                  {hiddenIds.size} fora do grid · os arquivos continuam no disco
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hiddenIds.size > 0 && (
                <button
                  onClick={restoreAllHidden}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-800 text-[10px] font-bold text-neutral-400 hover:bg-neutral-700 hover:text-white transition-ui press"
                >
                  <RotateCcw className="w-3 h-3" />
                  Restaurar todos
                </button>
              )}
              {/* Botão à mão, como nos outros modais desta página: o IconButton
                  exige um TooltipProvider, que só existe no rail do editor. */}
              <button
                onClick={() => setShowHidden(false)}
                title="Fechar"
                className="p-1.5 rounded-xl hover:bg-neutral-800 text-neutral-500 hover:text-white transition-ui press"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 scroll-smooth">
            {/* Esqueleto com a forma da linha que vai chegar (miniatura de 40px,
                nome, caminho), não um disco girando no meio do vazio: a lista não
                colapsa e depois salta, e quem espera já lê o que vem. */}
            {hiddenLoading && (
              <div aria-busy aria-label="Carregando o que está oculto">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 mb-0.5">
                    <Skeleton className="w-10 h-10 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className="h-2.5 w-1/3" />
                      <Skeleton className="h-2 w-2/3" />
                    </div>
                    <Skeleton className="h-7 w-20 shrink-0 rounded-xl" />
                  </div>
                ))}
              </div>
            )}

            {!hiddenLoading && hiddenList?.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Eye className="w-10 h-10 text-neutral-600" />
                <p className="text-[10px] font-semibold text-neutral-500">
                  Nada oculto — o grid está inteiro
                </p>
              </div>
            )}

            {!hiddenLoading && hiddenList?.map((ref) => (
              <div
                key={ref.id}
                className="flex items-center gap-3 px-3 py-2 rounded-xl mb-0.5 hover:bg-white/[0.02] transition-colors"
              >
                {ref.referenceImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ref.referenceImageUrl} alt={ref.name} className="w-10 h-10 shrink-0 rounded-lg object-cover border border-neutral-800 opacity-60" />
                ) : (
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                    <Layers className="w-4 h-4 text-neutral-500" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-neutral-300 truncate">{ref.name}</p>
                  <p className="text-[8px] text-neutral-500 font-mono truncate mt-0.5">
                    {ref.studio ? <span className="mr-1.5 px-1 py-px rounded bg-neutral-800 text-neutral-500">{ref.studio}</span> : null}
                    {ref.psdPath || "—"}
                  </p>
                </div>
                <button
                  onClick={() => restoreHidden(ref)}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-800 text-[10px] font-bold text-neutral-400 hover:bg-neutral-700 hover:text-white transition-ui press"
                >
                  <Eye className="w-3 h-3" />
                  Reexibir
                </button>
              </div>
            ))}

            {/* Id sem card: a ref sumiu do Mongo/disco depois de escondida. */}
            {!hiddenLoading && hiddenList && hiddenIds.size > hiddenList.length && (
              <p className="px-3 py-3 text-[9px] font-bold text-neutral-500">
                + {hiddenIds.size - hiddenList.length} id(s) sem card no catálogo — some com &ldquo;Restaurar todos&rdquo;
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Duplicates Modal */}
      <Dialog open={showDupes} onOpenChange={setShowDupes}>
        <DialogContent title="Duplicatas" skin="neutral" showClose={false}
          className="w-[min(64rem,92vw)] max-h-[92vh] rounded-2xl overflow-hidden">

            {/* ── Header ── */}
            <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/30 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                  <Copy className="w-4 h-4 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold tracking-tight">Arquivos Duplicados</h3>
                  <p className="text-[10px] text-neutral-500 font-semibold mt-0.5 flex items-center gap-2">
                    <span>
                      {dupesScanning && !dupesSummary
                        ? dupesGroups.length > 0
                          ? `${dupesGroups.length} grupo${dupesGroups.length > 1 ? "s" : ""} encontrado${dupesGroups.length > 1 ? "s" : ""}...`
                          : "Iniciando scan..."
                        : dupesSummary
                        ? `${dupesGroups.length} grupos, ${dupesSummary.filesScanned.toLocaleString()} arquivos, `
                        : "Pronto para escanear"}
                      {dupesSummary && (
                        <span className="text-amber-400">{(dupesSummary.totalWastedBytes / 1e6).toFixed(0)} MB desperdiçados</span>
                      )}
                    </span>
                    {dupesScanning && (
                      <span className="font-mono text-neutral-500 tabular-nums">
                        {String(Math.floor(dupesElapsed / 60)).padStart(2, "0")}:{String(dupesElapsed % 60).padStart(2, "0")}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => scanDuplicates(true)}
                  disabled={dupesScanning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-800 text-[10px] font-bold text-neutral-400 hover:bg-neutral-700 hover:text-white transition-ui press disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${dupesScanning ? "animate-spin" : ""}`} />
                  {dupesScanning ? "Escaneando..." : "Re-escanear"}
                </button>
                <button onClick={() => setShowDupes(false)} className="p-1.5 rounded-xl hover:bg-neutral-800 text-neutral-500 hover:text-white transition-ui press">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* ── Progress bar (durante scan) ── */}
            {dupesScanning && dupesProgress && (
              <div className="px-6 py-2.5 bg-neutral-900/20 border-b border-neutral-800/50 shrink-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-neutral-500">
                    Hashing {dupesProgress.hashed.toLocaleString()} / {dupesProgress.total.toLocaleString()} arquivos candidatos
                  </span>
                  <span className="text-[10px] font-semibold text-amber-500">{dupesProgress.pct}%</span>
                </div>
                <div className="w-full h-[3px] bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-colors [transition-duration:var(--dur-slow)]"
                    style={{ width: `${dupesProgress.pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* ── Toolbar (filter + sort) ── */}
            {(dupesGroups.length > 0 || dupesSummary) && (
              <div className="px-6 py-3 bg-neutral-900/20 border-b border-neutral-800/50 flex items-center gap-3 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
                  <input
                    type="text"
                    value={dupesFilter}
                    onChange={(e) => setDupesFilter(e.target.value)}
                    placeholder="Filtrar por nome ou caminho..."
                    className="w-full h-8 rounded-xl bg-neutral-900 border border-neutral-800 pl-9 pr-4 text-xs focus:border-neutral-600 transition-colors placeholder:text-neutral-500"
                  />
                  {dupesFilter && (
                    <button onClick={() => setDupesFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[9px] font-semibold text-neutral-500 mr-1">Sort</span>
                  {(["wasted", "size", "copies"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setDupesSort(s)}
                      className={`px-2.5 py-1 rounded-lg text-[9px] font-semibold transition-colors ${
                        dupesSort === s ? "bg-white text-black" : "bg-neutral-900 text-neutral-500 hover:text-white border border-neutral-800"
                      }`}
                    >
                      {s === "wasted" ? "Desperdício" : s === "size" ? "Tamanho" : "Cópias"}
                    </button>
                  ))}
                </div>
                {dupesFilter && (
                  <span className="text-[10px] font-bold text-neutral-500 shrink-0">
                    {filteredSortedGroups.length}/{dupesGroups.length}
                  </span>
                )}
              </div>
            )}

            {/* ── Table header ── */}
            {filteredSortedGroups.length > 0 && (
              <div className="grid grid-cols-[2.5rem_1fr_7rem_4.5rem_7rem_2.5rem] px-4 py-2 bg-neutral-900/30 border-b border-neutral-800/50 shrink-0">
                {["#", "Arquivo", "Tamanho", "Cópias", "Desperdiçado", ""].map((h, i) => (
                  <span key={i} className={`text-[9px] font-medium text-neutral-500 ${i >= 2 && i < 5 ? "text-right" : ""}`}>{h}</span>
                ))}
              </div>
            )}

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto no-scrollbar">

              {/* Error state */}
              {dupesError && (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <div className="p-4 rounded-full bg-red-500/10 text-red-500"><AlertTriangle className="w-7 h-7" /></div>
                  <p className="text-red-400 text-xs font-bold text-center px-8">{dupesError}</p>
                  <button onClick={() => scanDuplicates()} className="text-[10px] font-semibold px-4 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 transition-ui press">
                    Tentar novamente
                  </button>
                </div>
              )}

              {/* Initial idle state */}
              {!dupesScanning && !dupesError && dupesGroups.length === 0 && !dupesSummary && (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-neutral-500">
                  <HardDrive className="w-10 h-10 opacity-20" />
                  <p className="text-xs font-semibold">Clique em Re-escanear para iniciar</p>
                </div>
              )}

              {/* Spinning boot + live logs — mesmo componente do render panel */}
              {dupesScanning && dupesGroups.length === 0 && (
                <div className="p-6 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex flex-col gap-2 items-center">
                    <div className="flex items-center gap-3 text-[11px] font-bold text-neutral-400 w-full">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                      <span className="animate-pulse flex-1 truncate">
                        {dupesLogs[dupesLogs.length - 1] || "Processando..."}
                      </span>
                      <span className="text-neutral-500 font-mono tabular-nums shrink-0">
                        {String(Math.floor(dupesElapsed / 60)).padStart(2, "0")}:{String(dupesElapsed % 60).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-neutral-900 rounded-full overflow-hidden">
                      {dupesProgress ? (
                        <div className="h-full bg-amber-500 rounded-full transition-colors [transition-duration:var(--dur-slow)]" style={{ width: `${dupesProgress.pct}%` }} />
                      ) : (
                        <div className="h-full bg-amber-500/60 animate-progress-indefinite rounded-full" style={{ width: "40%" }} />
                      )}
                    </div>
                  </div>
                  <div className="bg-black/40 rounded-xl border border-neutral-800/50 p-3 h-36 overflow-y-auto no-scrollbar font-mono text-[10px] leading-relaxed space-y-0.5">
                    {dupesLogs.map((line, i) => (
                      <p key={i} className={line.startsWith("✓") ? "text-acc2" : line.startsWith("✗") ? "text-red-400" : line.startsWith("Duplicata") ? "text-amber-400/80" : "text-neutral-500"}>
                        <span className="text-neutral-600 mr-2 select-none">{String(i + 1).padStart(2, " ")} ›</span>{line}
                      </p>
                    ))}
                    <div ref={dupesLogsEndRef} />
                  </div>
                </div>
              )}

              {/* Clean state — scan done, zero dupes */}
              {!dupesScanning && dupesSummary && dupesGroups.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-acc2/10 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7 text-acc2" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-white">Nenhuma duplicata</p>
                    <p className="text-[10px] font-bold text-neutral-500 mt-2">
                      {dupesSummary.filesScanned.toLocaleString()} arquivos verificados, tudo limpo
                    </p>
                  </div>
                </div>
              )}

              {/* Groups table */}
              {filteredSortedGroups.map((group, gi) => {
                const key = group.keepPath;
                const isExpanded = dupesExpanded.has(key);
                const allPaths = [group.keepPath, ...group.removePaths];
                const fileName = group.keepPath.split(/[/\\]/).pop() || "";
                const ext = fileName.split(".").pop()?.toUpperCase() || "";

                return (
                  <div key={key} className="border-b border-neutral-800/40 last:border-0">
                    {/* Row */}
                    <button
                      onClick={() => setDupesExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      })}
                      className="w-full grid grid-cols-[2.5rem_1fr_7rem_4.5rem_7rem_2.5rem] items-center px-4 py-3 hover:bg-white/[0.02] transition-colors text-left group"
                    >
                      <span className="text-[10px] font-semibold text-neutral-500">{gi + 1}</span>
                      <div className="flex items-center gap-2 min-w-0 pr-4">
                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-neutral-500 group-hover:text-neutral-400 transition-colors [transition-duration:var(--dur-base)] ${isExpanded ? "rotate-90 text-neutral-400" : ""}`} />
                        <span className="text-[11px] font-bold text-neutral-200 truncate">{fileName}</span>
                        <span className="shrink-0 text-[8px] font-semibold text-neutral-500 bg-neutral-800/80 px-1.5 py-0.5 rounded">{ext}</span>
                      </div>
                      <span className="text-[11px] font-bold text-neutral-500 text-right">{dec(group.sizeBytes / 1e6)} MB</span>
                      <span className="text-[11px] font-bold text-neutral-500 text-right">{allPaths.length}×</span>
                      <span className="text-[11px] font-semibold text-amber-400 text-right">{dec(group.wastedBytes / 1e6)} MB</span>
                      <span />
                    </button>

                    {/* Expanded file list */}
                    {isExpanded && (
                      <div className="px-4 pb-3 animate-in slide-in-from-top-1 duration-200">
                        {/* Sub-header */}
                        <div className="grid grid-cols-[1rem_1fr_7rem_8rem_9rem] gap-x-3 px-3 py-1.5 mb-1">
                          <span />
                          <span className="text-[8px] font-semibold text-neutral-500">Caminho completo</span>
                          <span className="text-[8px] font-semibold text-neutral-500 text-right">Tamanho</span>
                          <span className="text-[8px] font-semibold text-neutral-500 text-right">Modificado</span>
                          <span />
                        </div>
                        {allPaths.map((filePath, fi) => {
                          const isKeep = fi === 0;
                          const parts = filePath.split(/[/\\]/);
                          const name = parts[parts.length - 1];
                          const dir = parts.slice(0, -1).join("/");
                          const fExt = name.split(".").pop()?.toLowerCase() || "";
                          const isImg = ["jpg","jpeg","png","gif"].includes(fExt);
                          const thumbUrl = isImg ? `/api/local-image?path=${encodeURIComponent(filePath)}&w=48` : null;
                          const origin = pathOrigin(filePath);

                          return (
                            <div
                              key={fi}
                              className={`grid grid-cols-[1rem_1fr_7rem_8rem_9rem] gap-x-3 items-center px-3 py-2 rounded-xl mb-0.5 ${isKeep ? "bg-acc2/[0.06]" : "bg-red-500/[0.06]"}`}
                            >
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isKeep ? "bg-acc2" : "bg-red-500/70"}`} />
                              <div className="flex items-center gap-2 min-w-0">
                                {thumbUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={thumbUrl} alt={name} className="w-7 h-7 shrink-0 rounded-lg object-cover border border-neutral-800" />
                                ) : (
                                  <div className="w-7 h-7 shrink-0 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                                    <Layers className="w-3.5 h-3.5 text-neutral-500" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className={`text-[10px] font-bold truncate ${isKeep ? "text-acc2" : "text-neutral-400"}`}>{name}</p>
                                  <p className="text-[8px] text-neutral-500 font-mono truncate mt-0.5">
                                    <span
                                      title={origin.safeToDelete ? undefined : "Fora da sua conta. Apagar aqui apaga na origem, para todo mundo"}
                                      className={`mr-1.5 px-1 py-px rounded not-italic ${
                                        origin.safeToDelete
                                          ? "bg-neutral-800 text-neutral-500"
                                          : "bg-amber-500/15 text-amber-400"
                                      }`}
                                    >
                                      {origin.label}
                                    </span>
                                    {dir}
                                  </p>
                                </div>
                              </div>
                              <span className="text-[10px] font-bold text-neutral-500 text-right">{(group.sizeBytes / 1e6).toFixed(2)} MB</span>
                              <span className="text-[9px] text-neutral-500 font-mono text-right">—</span>
                              <div className="flex items-center justify-end gap-1.5">
                                <span className={`text-[8px] font-semibold px-2 py-0.5 rounded-full ${
                                  isKeep
                                    ? "bg-acc2/15 text-acc2 border border-acc2/20"
                                    : "bg-red-500/10 text-red-400 border border-red-500/15"
                                }`}>
                                  {isKeep ? "Manter" : "Remover"}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); void hidePathFromCatalog(filePath, name); }}
                                  className="p-1 rounded-lg hover:bg-neutral-800 text-neutral-500 hover:text-white transition-colors"
                                  title="Esconder do catálogo (não apaga o arquivo)"
                                >
                                  <EyeOff className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    // A resposta era ignorada: arquivo já apagado ⇒ 404 ⇒ o
                                    // botão não fazia nada e não dizia nada.
                                    const falhou = () => toast.error("Não consegui abrir a pasta", { description: name });
                                    fetch("/api/open-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: filePath }) })
                                      .then((r) => { if (!r.ok) falhou(); })
                                      .catch(falhou);
                                  }}
                                  className="p-1 rounded-lg hover:bg-neutral-800 text-neutral-500 hover:text-white transition-colors"
                                  title="Abrir localização"
                                >
                                  <Folder className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Footer ── */}
            {dupesSummary && dupesGroups.length > 0 && !dupesScanning && (
              <div className="px-6 py-3 bg-neutral-900/30 border-t border-neutral-800 shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <HardDrive className="w-3.5 h-3.5 text-neutral-500" />
                  <p className="text-[10px] font-bold text-neutral-500">
                    {dupesGroups.reduce((acc, g) => acc + g.removePaths.length, 0)} arquivos removíveis,{" "}
                    <span className="text-amber-400">{(dupesSummary.totalWastedBytes / 1e6).toFixed(0)} MB</span> recuperáveis
                  </p>
                </div>
                <p className="text-[9px] text-neutral-500 font-semibold">
                  scripts\remove-dupes.ps1 -Mode Trash
                </p>
              </div>
            )}

        </DialogContent>
      </Dialog>

      {/* Brand Asset Library Modal */}
      <Dialog open={showLibrary} onOpenChange={setShowLibrary}>
        <DialogContent title="Biblioteca de Assets" skin="neutral" showClose={false}
          className="w-[min(56rem,92vw)] max-h-[85vh] rounded-2xl overflow-hidden bg-neutral-900">
            <div className="p-6 border-b border-neutral-800 flex justify-between items-center bg-neutral-950/30">
              <div>
                <h3 className="text-lg font-semibold tracking-tight">Biblioteca de Assets</h3>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-2 h-2 rounded-full bg-white" />
                  <p className="text-[10px] text-neutral-500 font-medium">
                    {brands.find(b => b.id === brandId)?.name}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowLibrary(false)} className="p-2 rounded-xl hover:bg-neutral-800 text-neutral-500 hover:text-white transition-ui press">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
              {loadingAssets ? (
                // Mesma grade dos assets, na mesma proporção: zero salto quando chegam.
                <div
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6"
                  aria-busy
                  aria-label="Sincronizando assets da marca"
                >
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                      <Skeleton className="aspect-square w-full rounded-xl" />
                      <Skeleton className="h-2.5 w-2/3" />
                    </div>
                  ))}
                </div>
              ) : assetError ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="p-4 rounded-full bg-red-500/10 text-red-500"><AlertTriangle className="w-8 h-8" /></div>
                  <p className="text-red-400 text-sm font-bold text-center px-10">{assetError}</p>
                  <button 
                    onClick={openLibrary}
                    className="flex items-center gap-2 text-[10px] font-semibold px-4 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 transition-ui press"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : brandAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2 text-neutral-500">
                  <Library className="w-16 h-16 opacity-10" />
                  <p className="text-sm font-bold">Nenhum asset encontrado</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                  {brandAssets.map(asset => (
                    <button
                      key={asset.id}
                      onClick={() => loadAssetAsArt(asset)}
                      className="group flex flex-col gap-3 text-left animate-in fade-in slide-in-from-bottom-2"
                    >
                      <div className="aspect-square relative bg-white/5 border border-white/5 rounded-2xl overflow-hidden group-hover:border-white/20 group-hover:bg-white/10 transition-ui p-6 shadow-sm group-hover:shadow-2xl group-hover:-translate-y-1 [transition-duration:var(--dur-slow)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img 
                          src={asset.thumbnail} 
                          alt={asset.label} 
                          className="w-full h-full object-contain filter drop-shadow-2xl transition-transform [transition-duration:var(--dur-slow)] group-hover:scale-105"
                        />
                      </div>
                      <div className="px-1">
                        <p className="text-[11px] font-semibold truncate text-neutral-400 group-hover:text-white transition-colors">{asset.label}</p>
                        <p className="text-[9px] text-neutral-500 font-semibold mt-0.5">{asset.variant}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <div className="p-4 bg-neutral-950/50 border-t border-neutral-800 text-center flex items-center justify-center gap-3">
              <ExternalLink className="w-3.5 h-3.5 text-neutral-500" />
              <p className="text-[10px] font-bold text-neutral-500">Selecione um asset para aplicar ao mockup</p>
            </div>
        </DialogContent>
      </Dialog>

      {/* Ingest inteiro: origem, varredura, aprovação e gravação. */}
      <IngestDialog
        open={ingestOpen}
        onClose={() => setIngestOpen(false)}
        onIngested={handleIngested}
      />

      {/* Alvo de soltar da PÁGINA. Antes só o retângulo do painel direito
          aceitava a arte — e só quando o mockup tinha faces editáveis; soltar um
          PNG no grid fazia o navegador abrir o arquivo e perder o trabalho. */}
      <DropOverlay
        visible={dragging}
        message="Solte a arte"
        hint={selected ? `Aplicar em ${selected.name}` : "Escolha um mockup depois"}
      />

      {/* Mesma config do editor — um só jeito de dar retorno no produto inteiro. */}
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{ style: { background: "rgba(24,24,27,0.92)", border: "1px solid rgba(63,63,70,0.6)", color: "#e4e4e7", backdropFilter: "blur(8px)" } }}
      />
    </div>
  );
}
