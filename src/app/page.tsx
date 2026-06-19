"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import ArtFramePanel from "@/components/ArtFramePanel";
import {
  Panel,
  Group as PanelGroup,
  Separator as PanelResizeHandle,
  usePanelRef,
} from "react-resizable-panels";
import {
  Search,
  Filter,
  FolderPlus,
  ChevronRight,
  ChevronDown,
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
  History,
  Library,
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
} from "lucide-react";
import {
  DEFAULT_FRAME,
  type FrameConfig,
  renderFramedArt,
} from "@/lib/art-frame";
import { dedupeRefs } from "@/lib/dedup";
import Lottie from "lottie-react";
import boxLoaderData from "../../public/lottie/box-loader.json";

function MockupCard({
  mockup,
  selected,
  hasArt,
  isRendering,
  onSelect,
  onApply,
  onHide,
  thumbSize,
  renderedUrl,
}: {
  mockup: Reference;
  selected: boolean;
  hasArt: boolean;
  isRendering: boolean;
  onSelect: () => void;
  onApply: () => void;
  onHide: () => void;
  thumbSize: number;
  renderedUrl?: string;
}) {
  const hasImage = !!mockup.referenceImageUrl;

  return (
    <button
      onClick={onSelect}
      className={`group relative rounded-2xl overflow-hidden border transition-all duration-300 text-left bg-neutral-900/40 hover:bg-neutral-900 ${
        selected ? "border-white ring-4 ring-white/10 shadow-2xl" : "border-neutral-800 hover:border-neutral-700"
      }`}
    >
      <div className="relative bg-neutral-900 overflow-hidden" style={{ aspectRatio: '4/3' }}>
        {hasImage ? (
          <Image
            src={mockup.referenceImageUrl}
            alt={mockup.name}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-110"
            sizes={`${thumbSize * 1.5}px`}
            unoptimized
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Layers className="text-neutral-800 w-12 h-12" />
          </div>
        )}
        {renderedUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={renderedUrl}
            alt="Render aplicado"
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
          />
        )}
        
        {(mockup.psdPath || mockup.type === "photo") && !isRendering && (
          <div className="absolute top-2 right-2 flex gap-1">
            {mockup.type === "photo"
              ? <span className="bg-blue-500/90 backdrop-blur-sm text-[9px] font-black px-2 py-0.5 rounded shadow-lg text-white uppercase tracking-tighter">Photo</span>
              : <span className="bg-emerald-500/90 backdrop-blur-sm text-[9px] font-black px-2 py-0.5 rounded shadow-lg text-white uppercase tracking-tighter">PSD</span>
            }
          </div>
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
            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px]"
          >
            <span className="bg-white text-black text-[11px] font-black px-4 py-2 rounded-xl hover:bg-neutral-200 transition-all active:scale-90 shadow-2xl uppercase tracking-widest">
              Abrir
            </span>
          </a>
        )}

        {hasArt && mockup.psdPath && !isRendering && (
          <div
            onClick={(e) => { e.stopPropagation(); onApply(); }}
            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px]"
          >
            <span className="bg-white text-black text-[11px] font-black px-4 py-2 rounded-xl hover:bg-neutral-200 transition-all active:scale-90 shadow-2xl uppercase tracking-widest">
              Aplicar
            </span>
          </div>
        )}

        {!isRendering && (
          <div className="absolute top-2 left-2 z-20 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
            {mockup.psdPath && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fetch("/api/open-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: mockup.psdPath }) });
                }}
                title="Abrir pasta do PSD"
                className="w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm text-white/90 flex items-center justify-center hover:bg-white hover:text-black transition-all active:scale-90 shadow-xl"
              >
                <Folder className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onHide(); }}
              title="Esconder este mockup"
              className="w-7 h-7 rounded-lg bg-black/70 backdrop-blur-sm text-white/90 flex items-center justify-center hover:bg-white hover:text-black transition-all active:scale-90 shadow-xl"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-[11px] font-bold truncate text-neutral-300 group-hover:text-white transition-colors">{mockup.name}</p>
        <p className="text-[9px] font-bold text-neutral-600 truncate uppercase tracking-widest mt-0.5">{mockup.studio || "General"}</p>
      </div>
    </button>
  );
}

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
  return (
    <button
      onClick={onSelect}
      className={`group relative w-48 shrink-0 rounded-2xl overflow-hidden border text-left transition-all duration-300 bg-neutral-900/40 hover:bg-neutral-900 ${
        selected ? "border-white ring-4 ring-white/10 shadow-2xl scale-105 z-10" : "border-neutral-800 hover:border-neutral-700"
      }`}
    >
      <div className="aspect-[4/3] relative bg-neutral-900 overflow-hidden">
        {ref.referenceImageUrl ? (
          <Image 
            src={ref.referenceImageUrl} 
            alt={ref.name} 
            fill 
            className="object-cover transition-transform duration-700 group-hover:scale-110" 
            sizes="192px" 
            unoptimized 
            loading="lazy" 
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-800">
            <Layers className="w-10 h-10" />
          </div>
        )}
        
        {ref.psdPath && !isRendering && (
          <span className="absolute top-2 right-2 bg-emerald-500/90 backdrop-blur-sm text-[8px] font-black px-1.5 py-0.5 rounded text-white uppercase">PSD</span>
        )}

        {isRendering && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
        )}

        {ref.psdPath && !isRendering && (
          <div
            onClick={(e) => { e.stopPropagation(); onApply(); }}
            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center backdrop-blur-[2px]"
          >
            <span className="bg-white text-black text-[10px] font-black px-3 py-1.5 rounded-xl hover:bg-neutral-200 transition-all active:scale-90 shadow-2xl uppercase tracking-widest">
              Aplicar
            </span>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-[11px] font-bold truncate text-neutral-300 group-hover:text-white transition-colors">{ref.name}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {reasons.slice(0, 2).map((r, i) => (
            <span key={i} className="text-[8px] font-bold text-neutral-600 uppercase tracking-tighter bg-neutral-800/50 px-1 rounded-sm">{r}</span>
          ))}
        </div>
      </div>
    </button>
  );
}

interface SmartObjectInfo {
  name: string;
  path: string;
  innerWidth: number;
  innerHeight: number;
}

interface AdjustmentInfo {
  name: string;
  path: string;
  type: string;
  hidden: boolean;
}

interface Face {
  key: string;
  name: string;
  smartObject: string;
  innerWidth: number;
  innerHeight: number;
  linkedCount: number;
}

interface PsdInfo {
  smartObjects: SmartObjectInfo[];
  adjustments: AdjustmentInfo[];
  width: number;
  height: number;
  faces?: Face[];
}

interface ArtSlot {
  file: File | null;
  preview: string;
  dims: { width: number; height: number } | null;
  frame: FrameConfig;
  img: HTMLImageElement | null;
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
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const [studios, setStudios] = useState<Studio[]>([]);
  const [allTags, setAllTags] = useState<Record<string, TagEntry[]>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [studio, setStudio] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"AND" | "OR">("AND");
  const [hideDuplicates, setHideDuplicates] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [lastHidden, setLastHidden] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [expandedDims, setExpandedDims] = useState<Set<string>>(new Set());
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState("");
  const [showFolderInput, setShowFolderInput] = useState(false);
  // Wizard: step 0=hidden, 1=path input, 2=confirm preview
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardPreview, setWizardPreview] = useState<{ psdCount: number; refCount: number } | null>(null);
  const [wizardScanError, setWizardScanError] = useState<string | null>(null);
  const [wizardScanning, setWizardScanning] = useState(false);

  const [visantConnected, setVisantConnected] = useState<boolean | null>(null);
  const [visantLoginUrl, setVisantLoginUrl] = useState<string | null>(null);
  const [visantConnecting, setVisantConnecting] = useState(false);
  const [visantAuthError, setVisantAuthError] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<string>("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
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

  // Duplicates modal
  type DupeGroup = { hash: string; sizeBytes: number; keepPath: string; removePaths: string[]; wastedBytes: number };
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
              addLog(`Listados ${ev.filesFound.toLocaleString()} arquivos — ${ev.candidates} candidatos com tamanho duplicado`);
            } else if (ev.type === "progress") {
              setDupesProgress({ hashed: ev.hashed, total: ev.total, pct: ev.pct });
              if (ev.currentFile) addLog(`Hashing ${ev.hashed}/${ev.total} — ${ev.currentFile}`);
            } else if (ev.type === "group") {
              setDupesGroups((p) => [...p, ev.group]);
              const name = ev.group.keepPath.split(/[/\\]/).pop() || "";
              addLog(`Duplicata: ${name} × ${ev.group.removePaths.length + 1} cópias — ${(ev.group.wastedBytes / 1e6).toFixed(1)} MB desperdiçados`);
            } else if (ev.type === "complete") {
              setDupesSummary({ filesScanned: ev.filesScanned, totalWastedBytes: ev.totalWastedBytes });
              addLog(`✓ Concluído — ${ev.groups} grupos encontrados em ${ev.filesScanned.toLocaleString()} arquivos`);
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
  const [showSmartObjects, setShowSmartObjects] = useState(true);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [expandSoList, setExpandSoList] = useState(false);

  // Sync: fechar Smart Objects fecha o painel de arte automaticamente
  useEffect(() => { if (!showSmartObjects) setArtSectionCollapsed(true); }, [showSmartObjects]);

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
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerReqId = useRef(0);
  const previewBlobUrl = useRef<string | null>(null);

  const fetchPage = useCallback(
    async (pageNum: number, append: boolean) => {
      if (loading) return;
      setLoading(true);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const params = new URLSearchParams({
        page: String(pageNum),
        limit: "60",
      });
      if (search) params.set("search", search);
      if (studio) params.set("studio", studio);
      if (activeTags.length) {
        params.set("tags", activeTags.join(","));
        params.set("tagMode", tagMode);
      }
      params.set("has_psd", "true");

      try {
        const res = await fetch(`/api/references?${params}`, {
          signal: controller.signal,
        });
        const data = await res.json();

        if (append) {
          setRefs((prev) => [...prev, ...data.references]);
        } else {
          setRefs(data.references);
        }
        setTotal(data.total);
        setHasMore(pageNum < data.pages);
        setPage(pageNum);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        setLoading(false);
        setInitialLoad(false);
      }
    },
    [search, studio, activeTags, tagMode, loading]
  );

  useEffect(() => {
    setRefs([]);
    setPage(1);
    setHasMore(true);
    setInitialLoad(true);
    fetchPage(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, studio, activeTags, tagMode]);

  useEffect(() => {
    fetch("/api/references/studios")
      .then((r) => r.json())
      .then(setStudios);
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
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
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
      throw new Error("Login expirou — tente novamente");
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
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
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
    loadSuggestions({ limit: 18 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const [assetError, setAssetError] = useState<string | null>(null);

  const openLibrary = useCallback(async () => {
    if (!brandId) return;
    setShowLibrary(true);
    setLoadingAssets(true);
    setAssetError(null);
    try {
      const res = await fetch(`/api/brands/${encodeURIComponent(brandId)}/assets`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
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

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          fetchPage(page + 1, true);
        }
      },
      { rootMargin: "600px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, page, fetchPage]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (fullscreen) { setFullscreen(false); return; }
        if (selected) { setSelected(null); return; }
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, refs, fullscreen]);

  const selectRef = (ref: Reference) => {
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
  };

  const handleSearchInput = (value: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setSearch(value), 300);
  };

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
      console.error("Copiar PNG falhou:", err);
    }
  };

  const handleArtSelect = (file: File, slotIdx?: number) => {
    if (!file.type.startsWith("image/")) return;
    const idx = slotIdx ?? activeSlotRef.current;
    setRenderResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const img = new window.Image();
      img.onload = () => {
        setArtSlots((s) => ({
          ...s,
          [idx]: {
            file,
            preview: url,
            dims: { width: img.naturalWidth, height: img.naturalHeight },
            frame: DEFAULT_FRAME,
            img,
          },
        }));
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
      const slot = artSlots[0];
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
    setCurrentStep("compositing…");

    return new Promise<void>((resolve) => {
      const cleanup = (err?: string) => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        if (err) setRenderLogs([{ step: "error", detail: err }]);
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
    if (!selected?.psdPath) return;

    const arts = buildArts(selected);
    if (arts.length === 0) return;

    // Preview → client-side Worker (fast, no TCP)
    if (preview) {
      return handlePreviewWorker(selected, arts);
    }

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
        const err = await res.json();
        setRenderLogs([{ step: "error", detail: err.error }]);
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
        setRenderCache((c) => ({ ...c, [selected.id]: { url, name: selected.name } }));
      }
    } catch (err) {
      setRenderLogs((prev) => [...prev, { step: "error", detail: String(err) }]);
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

  // Carrega/persiste a lista de mockups ocultados manualmente.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mockup-store:hiddenIds");
      if (saved) setHiddenIds(new Set(JSON.parse(saved)));
    } catch {}
  }, []);
  const persistHidden = useCallback((next: Set<string>) => {
    setHiddenIds(next);
    try {
      localStorage.setItem("mockup-store:hiddenIds", JSON.stringify([...next]));
    } catch {}
  }, []);
  const hideMockup = useCallback(
    (ref: Reference) => {
      persistHidden(new Set(hiddenIds).add(ref.id));
      setLastHidden({ id: ref.id, name: ref.name });
    },
    [hiddenIds, persistHidden]
  );
  const unhideMockup = useCallback(
    (id: string) => {
      const next = new Set(hiddenIds);
      next.delete(id);
      persistHidden(next);
      setLastHidden((cur) => (cur?.id === id ? null : cur));
    },
    [hiddenIds, persistHidden]
  );

  // Grid: tira ocultados manualmente, depois colapsa duplicados.
  const { kept: displayRefs, hiddenDupes } = useMemo(() => {
    const visible = hiddenIds.size ? refs.filter((r) => !hiddenIds.has(r.id)) : refs;
    if (!hideDuplicates) return { kept: visible, hiddenDupes: 0 };
    const { kept, hidden } = dedupeRefs(visible);
    return { kept, hiddenDupes: hidden };
  }, [refs, hideDuplicates, hiddenIds]);

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
      if (prev.length >= MAX_TAGS) return prev; // teto de 5 tags simultâneas
      return [...prev, tag];
    });
  };

  const handleIngestFolder = async () => {
    const path = folderInput.trim();
    if (!path) return;
    setIngesting(true);
    setIngestResult(null);
    try {
      const res = await fetch("/api/ingest-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: path }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIngestResult(`Erro: ${data.error}`);
        return;
      }
      setIngestResult(
        `+${data.referencesCreated} refs, ${data.psdOnlyCreated} PSDs, ${data.psdMetadataScanned} scanned`
      );
      setFolderInput("");
      setShowFolderInput(false);
      setWizardStep(0);
      fetch("/api/references/studios").then((r) => r.json()).then(setStudios);
      fetchPage(1, false);
    } catch (err) {
      setIngestResult(`Erro: ${String(err)}`);
    } finally {
      setIngesting(false);
    }
  };

  const openFolderWizard = () => {
    setFolderInput("");
    setWizardStep(1);
    setWizardPreview(null);
    setWizardScanError(null);
    setIngestResult(null);
  };

  const wizardScan = async () => {
    const path = folderInput.trim();
    if (!path) return;
    setWizardScanning(true);
    setWizardScanError(null);
    try {
      const res = await fetch(`/api/ingest-folder/scan?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!res.ok) { setWizardScanError(data.error || `HTTP ${res.status}`); return; }
      setWizardPreview({ psdCount: data.psdCount ?? 0, refCount: data.refCount ?? 0 });
      setWizardStep(2);
    } catch (err) {
      setWizardScanError(String(err));
    } finally {
      setWizardScanning(false);
    }
  };

  const wizardConfirm = async () => {
    await handleIngestFolder();
    setWizardStep(0);
  };

  const activeSoName = selectedSo || selected?.smartObjectName || "";
  const selectedSoInfo =
    psdInfo?.smartObjects.find((s) => s.path === activeSoName || s.name === activeSoName) ||
    (psdInfo?.smartObjects.length === 1 ? psdInfo.smartObjects[0] : null);

  // SO dims: face ativa → psdInfo live → metadata do DB (disponível na hora)
  const activeFace = faces[activeSlot] ?? null;
  const soWidth = activeFace?.innerWidth || selectedSoInfo?.innerWidth || selected?.soInnerWidth;
  const soHeight = activeFace?.innerHeight || selectedSoInfo?.innerHeight || selected?.soInnerHeight;

  const renderDisabled =
    filledCount === 0 ||
    rendering ||
    (faces.length === 0 && psdInfo != null && psdInfo.smartObjects.length > 1 && !selectedSo);

  // Auto-preview: dispara handleRender(true) 600ms após crop/zoom parar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (renderDisabled || !artPreview) return;
    if (autoPreviewTimer.current) clearTimeout(autoPreviewTimer.current);
    autoPreviewTimer.current = setTimeout(() => { handleRender(true); }, 250);
    return () => { if (autoPreviewTimer.current) clearTimeout(autoPreviewTimer.current); };
  }, [frame.cropPixels, frame.mode]);

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
      <header className="h-14 border-b border-neutral-900 bg-neutral-950/50 backdrop-blur-md flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              const panel = leftPanelRef.current;
              if (panel) panel.isCollapsed() ? panel.expand() : panel.collapse();
            }}
            className="p-2 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition-all active:scale-95"
            title="Toggle Sidebar"
          >
            <PanelLeft className="w-5 h-5" />
          </button>
          
          <div className="flex items-center gap-2 pr-4 border-r border-neutral-900">
            <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center">
              <div className="w-3.5 h-3.5 bg-black rounded-sm" />
            </div>
            <h1 className="text-sm font-black tracking-tighter uppercase">Boxy Store</h1>
          </div>

          <Link
            href="/photo-mockup"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white hover:bg-white/5 transition-all border border-neutral-800 hover:border-neutral-600"
          >
            <Camera className="w-3.5 h-3.5" />
            Scene Maker
          </Link>

          <div className="flex items-center gap-6 pl-2">
            <div className="flex items-center gap-3">
              <LayoutGrid className="w-4 h-4 text-neutral-600" />
              <input 
                type="range" 
                min="150" 
                max="450" 
                step="10"
                value={thumbSize}
                onChange={(e) => setThumbSize(parseInt(e.target.value))}
                className="w-32 accent-white h-1 bg-neutral-800 rounded-full appearance-none cursor-pointer"
              />
              <span className="text-[10px] font-bold text-neutral-600 w-8">{thumbSize}px</span>
            </div>
          </div>
        </div>

        <div className="flex-1 max-w-xl px-8">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 group-focus-within:text-white transition-colors" />
            <input
              type="search"
              placeholder="Buscar mockups..."
              defaultValue={search}
              onChange={(e) => handleSearchInput(e.target.value)}
              className="w-full h-9 rounded-full bg-neutral-900/50 border border-neutral-800 pl-10 pr-4 text-xs placeholder:text-neutral-600 focus:outline-none focus:border-neutral-600 focus:bg-neutral-900 transition-all"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {total > 0 && (
            <div className="px-3 py-1 rounded-full bg-white/5 border border-white/5 text-[10px] font-bold text-neutral-400">
              {total.toLocaleString()} Mockups
            </div>
          )}

          {Object.keys(renderCache).length > 0 && (
            <button
              onClick={() => { setShowSession(true); setSessionSelected(new Set()); }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition-all active:scale-95"
              title="Renders desta sessão"
            >
              <Download className="w-3.5 h-3.5" />
              Session ({Object.keys(renderCache).length})
            </button>
          )}

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-white/5 text-neutral-500 hover:text-white transition-all active:scale-95"
            title="Configurações avançadas"
          >
            <Settings2 className="w-4.5 h-4.5" />
          </button>
          
          <button 
            onClick={() => {
              const panel = rightPanelRef.current;
              if (panel) panel.isCollapsed() ? panel.expand() : panel.collapse();
            }}
            className={`p-2 rounded-lg hover:bg-white/5 text-neutral-400 hover:text-white transition-all active:scale-95 ${!selected ? 'opacity-20 pointer-events-none' : ''}`}
            title="Toggle Details"
          >
            <PanelRight className="w-5 h-5" />
          </button>
        </div>
      </header>

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
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-white text-black text-[11px] font-black px-3 py-2.5 hover:bg-neutral-200 transition-all disabled:opacity-50 active:scale-[0.98] uppercase tracking-wider"
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

            {brands.length > 0 && (
              <div className="mb-4 space-y-2.5">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-600 px-1">Marca Selecionada</p>
                <select
                  value={brandId}
                  onChange={(e) => setBrandId(e.target.value)}
                  className="w-full h-10 rounded-xl bg-neutral-900 border border-neutral-800 px-3 text-xs font-bold focus:outline-none focus:border-neutral-600 transition-colors appearance-none cursor-pointer shadow-inner"
                >
                  <option value="">Sem marca</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                {brandId && (
                  <div className="flex items-center gap-2 px-1">
                    {(brands.find((b) => b.id === brandId)?.colors || [])
                      .slice(0, 8)
                      .map((c, i) => (
                        <span
                          key={`${c.hex}-${i}`}
                          title={c.name}
                          className="w-4 h-4 rounded-full border border-white/10 ring-2 ring-black/50 shadow-lg"
                          style={{ backgroundColor: c.hex }}
                        />
                      ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 mb-4">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-600 px-1">Filtros</p>
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
                <select
                  value={studio}
                  onChange={(e) => setStudio(e.target.value)}
                  className="w-full h-10 rounded-xl bg-neutral-900 border border-neutral-800 pl-9 pr-3 text-xs font-bold focus:outline-none appearance-none cursor-pointer shadow-inner"
                >
                  <option value="">Todos Estúdios</option>
                  {studios.map((s) => (
                    <option key={s.name} value={s.name}>{s.name} ({s.count})</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600 pointer-events-none" />
              </div>
              <button
                onClick={() => setHideDuplicates((v) => !v)}
                className={`flex items-center justify-between gap-2 h-9 rounded-xl border px-3 text-[10px] font-black uppercase tracking-widest transition-all active:scale-[0.98] ${
                  hideDuplicates
                    ? "bg-neutral-900 border-neutral-700 text-neutral-300"
                    : "bg-transparent border-neutral-800 text-neutral-600 hover:text-neutral-400"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5" />
                  Esconder duplicados
                </span>
                <span className="flex items-center gap-2">
                  {hideDuplicates && hiddenDupes > 0 && (
                    <span className="text-neutral-500 normal-case tracking-normal">{hiddenDupes} ocultos</span>
                  )}
                  <span className={`w-7 h-4 rounded-full relative transition-colors ${hideDuplicates ? "bg-emerald-500/80" : "bg-neutral-700"}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${hideDuplicates ? "left-3.5" : "left-0.5"}`} />
                  </span>
                </span>
              </button>
              {hiddenIds.size > 0 && (
                <button
                  onClick={() => persistHidden(new Set())}
                  className="flex items-center justify-between gap-2 h-9 rounded-xl border border-neutral-800 px-3 text-[10px] font-black uppercase tracking-widest text-neutral-500 hover:text-neutral-300 hover:border-neutral-600 transition-all active:scale-[0.98]"
                >
                  <span className="flex items-center gap-2">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restaurar ocultos
                  </span>
                  <span className="text-neutral-600 normal-case tracking-normal">{hiddenIds.size}</span>
                </button>
              )}
            </div>


            {wizardStep === 0 && (
              <>
                <button
                  onClick={openFolderWizard}
                  className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl border-2 border-dashed border-neutral-800 px-4 text-[11px] font-black uppercase tracking-widest text-neutral-500 hover:border-neutral-600 hover:bg-neutral-900/50 hover:text-neutral-300 transition-all mb-2 group shadow-sm"
                >
                  <FolderPlus className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  Adicionar pasta
                </button>
                {ingestResult && (
                  <p className={`text-[10px] font-bold py-2 px-3 rounded-xl mb-2 flex items-center gap-2 ${ingestResult.startsWith("Erro") ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${ingestResult.startsWith("Erro") ? "bg-red-400" : "bg-emerald-400"}`} />
                    {ingestResult}
                  </p>
                )}
              </>
            )}
            {wizardStep === 1 && (
              <div className="flex flex-col gap-2 mb-2 animate-in slide-in-from-top-1 duration-300">
                <div className="flex items-center gap-2 px-1 mb-0.5">
                  <div className="w-4 h-4 rounded-full bg-white text-black flex items-center justify-center text-[9px] font-black shrink-0">1</div>
                  <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Caminho da pasta</p>
                  <button onClick={() => setWizardStep(0)} className="ml-auto text-neutral-600 hover:text-neutral-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={folderInput}
                    onChange={(e) => setFolderInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && wizardScan()}
                    placeholder="ex: H:/Mockups/Layouts"
                    autoFocus
                    className="flex-1 min-w-0 h-10 rounded-xl bg-neutral-900 border border-neutral-700 px-4 text-xs focus:outline-none focus:border-neutral-500 shadow-xl"
                  />
                  <button
                    onClick={wizardScan}
                    disabled={wizardScanning || !folderInput.trim()}
                    className="shrink-0 h-10 rounded-xl bg-white text-black text-[11px] font-black px-4 disabled:opacity-30 active:scale-90 transition-all shadow-lg"
                  >
                    {wizardScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : "Scan"}
                  </button>
                </div>
                {wizardScanError && <p className="text-[10px] text-red-400 font-bold px-1">{wizardScanError}</p>}
              </div>
            )}
            {wizardStep === 2 && wizardPreview && (
              <div className="flex flex-col gap-2 mb-2 animate-in slide-in-from-top-1 duration-300">
                <div className="flex items-center gap-2 px-1 mb-0.5">
                  <div className="w-4 h-4 rounded-full bg-white text-black flex items-center justify-center text-[9px] font-black shrink-0">2</div>
                  <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Confirmar</p>
                  <button onClick={() => setWizardStep(1)} className="ml-auto text-neutral-600 hover:text-neutral-400 transition-colors text-[10px] font-bold">← voltar</button>
                </div>
                <div className="rounded-2xl bg-neutral-900 border border-neutral-800 p-3 flex flex-col gap-1.5">
                  <p className="text-[10px] text-neutral-500 truncate font-mono">{folderInput}</p>
                  <div className="flex gap-3">
                    <div className="flex-1 bg-neutral-800/60 rounded-xl p-2 text-center">
                      <p className="text-sm font-black text-white">{wizardPreview.psdCount}</p>
                      <p className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest">PSDs</p>
                    </div>
                    <div className="flex-1 bg-neutral-800/60 rounded-xl p-2 text-center">
                      <p className="text-sm font-black text-white">{wizardPreview.refCount}</p>
                      <p className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest">Refs</p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setWizardStep(0)} className="flex-1 h-9 rounded-xl border border-neutral-800 text-[11px] font-black text-neutral-500 hover:bg-neutral-900 transition-all active:scale-95">Cancelar</button>
                  <button
                    onClick={wizardConfirm}
                    disabled={ingesting}
                    className="flex-1 h-9 rounded-xl bg-white text-black text-[11px] font-black disabled:opacity-30 active:scale-90 transition-all shadow-lg"
                  >
                    {ingesting ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Ingerir"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0 space-y-8 no-scrollbar">
            {activeTags.length > 0 && (
              <div className="animate-in fade-in zoom-in duration-300">
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-600">
                    Filtros Ativos ({activeTags.length}/{MAX_TAGS})
                  </p>
                  <div className="flex items-center gap-2">
                    {activeTags.length > 1 && (
                      <div className="flex rounded-full bg-neutral-900 border border-neutral-800 p-0.5">
                        {(["AND", "OR"] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setTagMode(m)}
                            className={`text-[9px] font-black px-2.5 py-1 rounded-full transition-all ${
                              tagMode === m ? "bg-white text-black" : "text-neutral-500 hover:text-neutral-300"
                            }`}
                          >
                            {m === "AND" ? "E" : "OU"}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => setActiveTags([])}
                      className="text-[9px] font-black uppercase tracking-widest text-neutral-600 hover:text-neutral-300 transition-colors"
                    >
                      Limpar
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeTags.map((t) => (
                    <button
                      key={t}
                      onClick={() => toggleTag(t)}
                      className="inline-flex items-center gap-2 bg-white text-black text-[10px] font-black px-3.5 py-1.5 rounded-full hover:bg-neutral-200 transition-all shadow-xl active:scale-95"
                    >
                      {t}
                      <X className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="pb-10">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-600 mb-4 px-1">Taxonomia</p>
              {Object.entries(allTags).map(([dim, tags]) => {
                const label = DIM_LABELS[dim] || dim;
                const expanded = expandedDims.has(dim);
                const visible = expanded ? tags : tags.slice(0, 10);

                return (
                  <div key={dim} className="mb-6">
                    <button
                      onClick={() => toggleDim(dim)}
                      className="group/tag flex items-center gap-3 text-[11px] font-black text-neutral-400 hover:text-white mb-3 transition-colors w-full"
                    >
                      <ChevronRight
                        className={`w-4 h-4 transition-transform duration-300 ${expanded ? "rotate-90 text-white" : "text-neutral-700"}`}
                      />
                      <span className="flex-1 text-left uppercase tracking-wider">{label}</span>
                      <span className="text-[9px] text-neutral-700 font-bold group-hover/tag:text-neutral-500">{tags.length}</span>
                    </button>
                    <div className="flex flex-wrap gap-2 pl-7">
                      {visible.map((t) => {
                        const isActive = activeTags.includes(t.value);
                        const capped = !isActive && activeTags.length >= MAX_TAGS;
                        return (
                          <button
                            key={`${dim}-${t.value}`}
                            onClick={() => toggleTag(t.value)}
                            disabled={capped}
                            title={capped ? `Máximo de ${MAX_TAGS} tags` : undefined}
                            className={`text-[10px] px-3 py-1.5 rounded-lg transition-all font-bold ${
                              isActive
                                ? "bg-white text-black shadow-2xl scale-110 z-10"
                                : capped
                                ? "bg-neutral-900/40 text-neutral-700 border border-neutral-900 cursor-not-allowed opacity-50"
                                : "bg-neutral-900 text-neutral-500 border border-neutral-800 hover:border-neutral-600 hover:text-neutral-300"
                            }`}
                          >
                            {t.value}
                            <span className={`ml-2 ${isActive ? "opacity-40" : "text-neutral-800"}`}>{t.count}</span>
                          </button>
                        );
                      })}
                      {!expanded && tags.length > 10 && (
                        <button onClick={() => toggleDim(dim)} className="text-[9px] font-black px-3 py-1.5 text-neutral-700 hover:text-neutral-400 uppercase">+{tags.length - 10} mais</button>
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
          <main className="flex-1 overflow-y-auto p-8 no-scrollbar">
            {brandId && (
              <div className="mb-12 animate-in fade-in slide-in-from-left-4 duration-700">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-lg shadow-emerald-500/50" />
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-500">
                      Matches Inteligentes para <span className="text-white bg-white/5 px-2 py-1 rounded-md">{brands.find((b) => b.id === brandId)?.name}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {loadingSuggestions && <Loader2 className="w-5 h-5 text-neutral-600 animate-spin" />}
                    <button
                      onClick={() => loadSuggestions({ force: true })}
                      disabled={loadingSuggestions}
                      title="Regenerar matches (re-analisa a marca)"
                      className="flex items-center gap-2 h-8 px-3 rounded-full bg-neutral-900 border border-neutral-800 text-[10px] font-black uppercase tracking-widest text-neutral-400 hover:text-white hover:border-neutral-600 transition-all active:scale-90 disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingSuggestions ? "animate-spin" : ""}`} />
                      Regenerar
                    </button>
                    <button onClick={() => setBrandId("")} className="w-8 h-8 rounded-full flex items-center justify-center bg-neutral-900 border border-neutral-800 text-neutral-600 hover:text-white hover:border-neutral-600 transition-all active:scale-90"><X className="w-4 h-4" /></button>
                  </div>
                </div>
                {suggestError ? (
                  <div className="p-5 bg-red-500/5 border border-red-500/10 rounded-2xl text-[11px] text-red-400 font-bold flex items-center gap-3"><AlertTriangle className="w-5 h-5" /> {suggestError}</div>
                ) : !loadingSuggestions && suggestions.length === 0 ? (
                  <div className="p-8 rounded-3xl border border-dashed border-neutral-900 flex flex-col items-center gap-3 opacity-40">
                    <Zap className="w-8 h-8" />
                    <p className="text-xs font-bold uppercase tracking-widest text-center">Nenhuma recomendação disponível para os ativos atuais desta marca.</p>
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
                        className="shrink-0 w-32 rounded-2xl border border-dashed border-neutral-800 flex flex-col items-center justify-center gap-2 text-neutral-600 hover:text-neutral-300 hover:border-neutral-600 transition-all active:scale-95 disabled:opacity-40"
                      >
                        {loadingSuggestions ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                        <span className="text-[10px] font-black uppercase tracking-widest">Ver mais</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {initialLoad ? (
              <div className="grid gap-8" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}>
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
            ) : refs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-neutral-600 animate-in zoom-in-95 duration-500">
                <div className="w-20 h-20 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                  <Search className="w-8 h-8 opacity-20" />
                </div>
                <div className="text-center">
                  <p className="text-base font-black uppercase tracking-widest text-neutral-400">Nenhum mockup encontrado</p>
                  <p className="text-xs font-bold text-neutral-600 mt-2 uppercase tracking-widest">Tente redefinir seus filtros ou buscar outro termo</p>
                </div>
              </div>
            ) : (
              <>
                <div 
                  className="grid gap-8 transition-all duration-500"
                  style={{ 
                    gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` 
                  }}
                >
                  {displayRefs.map((ref, i) => (
                    <MockupCard
                      key={`${ref.id}-${i}`}
                      mockup={ref}
                      selected={selected?.id === ref.id}
                      hasArt={anyArt}
                      isRendering={renderingRefId === ref.id}
                      thumbSize={thumbSize}
                      renderedUrl={renderCache[ref.id]?.url}
                      onSelect={() => selectRef(ref)}
                      onApply={() => {
                        selectRef(ref);
                        pendingRenderRef.current = ref;
                      }}
                      onHide={() => hideMockup(ref)}
                    />
                  ))}
                </div>

                <div ref={sentinelRef} className="flex flex-col items-center justify-center py-20 gap-6">
                  {loading && (
                    <div className="flex items-center gap-4 text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em] bg-neutral-900/50 backdrop-blur-xl px-6 py-3 rounded-full border border-neutral-800 shadow-2xl">
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      Carregando Catálogo
                    </div>
                  )}
                  {!hasMore && refs.length > 0 && (
                    <div className="flex items-center gap-4 text-neutral-700 text-[10px] font-black uppercase tracking-[0.3em]">
                      <div className="h-[1px] w-12 bg-neutral-900" />
                      Fim da Biblioteca
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
                className="flex items-center gap-2 bg-white text-black text-[10px] font-black uppercase tracking-widest px-3.5 py-2 rounded-xl hover:bg-neutral-200 transition-all active:scale-90"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Desfazer
              </button>
              <button onClick={() => setLastHidden(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-600 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
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
            className="flex flex-col bg-neutral-950 border-l border-neutral-900 shadow-2xl z-10 animate-in slide-in-from-right-8 duration-500 overflow-hidden"
          >
            <div className="p-4 border-b border-neutral-900 flex justify-between items-center shrink-0">
              <div className="min-w-0">
                <h2 className="font-bold text-sm truncate pr-2">{selected.name}</h2>
                <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">{selected.studio}</p>
              </div>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-neutral-900 text-neutral-500 hover:text-white transition-all active:scale-90">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar">
              <div
                className="relative aspect-[4/3] bg-neutral-900 group/preview overflow-hidden ring-1 ring-white/5 mx-4 mt-4 rounded-2xl"
                onClick={!renderResult ? () => fileInputRef.current?.click() : undefined}
                style={!renderResult ? { cursor: "pointer" } : undefined}
              >
                {renderResult ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={renderResult} alt="Render" className="absolute inset-0 w-full h-full object-contain cursor-pointer transition-transform duration-500 group-hover/preview:scale-105" onClick={() => setFullscreen(true)} />
                ) : selected.referenceImageUrl ? (
                  <>
                    <Image src={selected.referenceImageUrl} alt={selected.name} fill className="object-contain" unoptimized priority />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 opacity-0 group-hover/preview:opacity-100 transition-opacity duration-200 bg-black/50">
                      <Upload className="w-6 h-6 text-white" />
                      <span className="text-[11px] font-bold text-white">Adicionar arte</span>
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-700 group-hover/preview:text-neutral-400 transition-colors">
                    <Upload className="w-7 h-7" />
                    <span className="text-[11px] font-bold">Adicionar arte</span>
                  </div>
                )}
                {/* Render loading overlay — shown over the thumb for both preview (Worker) and final render */}
                {rendering && (
                  <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center px-6">
                    <div className="flex flex-col items-center gap-2 w-full max-w-[220px]">
                      <Lottie animationData={boxLoaderData} loop className={previewRendering ? "w-10 h-10" : "w-16 h-16"} />
                      <div className="flex items-center gap-2 text-[10px] font-bold text-white/70">
                        <span className="animate-pulse">{currentStep || (previewRendering ? "compositing…" : "Processando…")}</span>
                        {!previewRendering && <span className="text-white/40">{renderElapsed}s</span>}
                      </div>
                      {!previewRendering && (
                        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-white animate-progress-indefinite rounded-full" style={{ width: "40%" }} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                <div className="absolute top-3 left-3 flex gap-2 opacity-0 group-hover/preview:opacity-100 transition-all translate-y-2 group-hover/preview:translate-y-0 duration-300">
                  {renderResult && (
                    <>
                      <button onClick={() => setFullscreen(true)} className="bg-black/80 backdrop-blur shadow-xl hover:bg-white hover:text-black text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90">
                        <Maximize2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={copyRenderAsPng}
                        title="Copiar como PNG"
                        className={`backdrop-blur shadow-xl w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 ${copiedPng ? "bg-emerald-500 text-black" : "bg-black/80 hover:bg-white hover:text-black text-white"}`}
                      >
                        {copiedPng ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </>
                  )}
                  {selected.psdPath && (
                    <button
                      onClick={() => fetch("/api/open-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: selected.psdPath }) })}
                      className="bg-black/80 backdrop-blur shadow-xl hover:bg-white hover:text-black text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
                    >
                      <Folder className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {renderResult && isPreviewResult && (
                  <div className="absolute top-3 right-3 bg-amber-500 text-black text-[10px] font-black px-2 py-0.5 rounded-md shadow-lg shadow-amber-500/20">PREVIEW</div>
                )}
                {renderTime != null && renderTime > 0 && (
                  <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur text-[10px] font-bold text-neutral-400 px-2 py-1 rounded-md">{(renderTime / 1000).toFixed(1)}s</div>
                )}
              </div>

              <div className="flex flex-col p-4 gap-5">
                {/* Controls Accordion */}
                <div className="space-y-3">
                  {/* Section: Smart Objects — Photoshop-style layers */}
                  {psdInfo && psdInfo.smartObjects.length > 0 && (
                    <div className="bg-neutral-900/30 border border-neutral-800 rounded-2xl overflow-hidden">
                      <button
                        onClick={() => setShowSmartObjects(!showSmartObjects)}
                        className="w-full flex items-center justify-between px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500 hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center gap-2 text-neutral-300">
                          <Layers className="w-3.5 h-3.5 text-neutral-500" />
                          Smart Objects ({psdInfo.smartObjects.length})
                        </div>
                        <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${showSmartObjects ? "" : "-rotate-90"}`} />
                      </button>
                      {showSmartObjects && (
                        <div className="border-t border-neutral-800 overflow-y-auto max-h-60 no-scrollbar">
                          {psdInfo.smartObjects.map((so, i) => {
                            const faceIdx = faces.findIndex(f => f.name === so.name || f.smartObject === (so.path || so.name));
                            const isFace = faceIdx >= 0;
                            const slot = isFace ? (artSlots[faceIdx] ?? null) : null;
                            const isActive = isFace && activeSlot === faceIdx;
                            return (
                              <div
                                key={i}
                                onClick={() => {
                                  if (!isFace) return;
                                  setActiveSlot(faceIdx);
                                  setSelectedSo(so.path || so.name);
                                  setFrame((f) => ({ ...f, cropPixels: undefined }));
                                  setArtSectionCollapsed(false);
                                }}
                                className={`flex items-center gap-3 px-3 py-2.5 border-b border-neutral-900/70 last:border-b-0 transition-all select-none ${
                                  isFace
                                    ? isActive
                                      ? "bg-white/8 cursor-pointer"
                                      : "hover:bg-white/4 cursor-pointer"
                                    : "opacity-35 cursor-default"
                                }`}
                              >
                                {/* Active dot */}
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-white" : isFace ? "bg-neutral-600" : "bg-neutral-800"}`} />
                                {/* Name + path */}
                                <div className="flex-1 min-w-0">
                                  <p className={`text-[11px] font-bold truncate ${isActive ? "text-white" : isFace ? "text-neutral-300" : "text-neutral-500"}`}>{so.name}</p>
                                  {so.path && so.path.includes(" > ") && (
                                    <p className="text-[9px] text-neutral-700 truncate">{so.path.split(" > ").slice(0, -1).join(" › ")}</p>
                                  )}
                                </div>
                                {/* Dims */}
                                <span className={`text-[9px] font-mono shrink-0 ${isActive ? "text-neutral-400" : "text-neutral-700"}`}>{so.innerWidth}×{so.innerHeight}</span>
                                {/* Face slot thumbnail */}
                                {isFace ? (
                                  <div
                                    className={`shrink-0 w-8 h-8 rounded-lg overflow-hidden border transition-all ${isActive ? "border-white/40 shadow-lg shadow-white/5" : "border-neutral-800"}`}
                                    onClick={(e) => { e.stopPropagation(); setActiveSlot(faceIdx); setArtSectionCollapsed(false); if (!slot?.preview) fileInputRef.current?.click(); }}
                                  >
                                    {slot?.preview ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={slot.preview} alt={so.name} className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center bg-neutral-900 group-hover:bg-neutral-800">
                                        <ImageIcon className="w-3 h-3 text-neutral-700" />
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="w-8 shrink-0" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Section: Adjustments */}
                  {psdInfo && psdInfo.adjustments.filter(a => !a.hidden).length > 0 && (
                    <div className="bg-neutral-900/30 border border-neutral-800 rounded-2xl overflow-hidden transition-all duration-300">
                      <button 
                        onClick={() => setShowAdjustments(!showAdjustments)}
                        className="w-full flex items-center justify-between p-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500 hover:bg-white/5 transition-colors"
                      >
                        <div className="flex items-center gap-2 text-neutral-300"><Settings2 className="w-3.5 h-3.5 text-neutral-500" /> Camadas de ajuste</div>
                        <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${showAdjustments ? "" : "-rotate-90"}`} />
                      </button>
                      <div className={`overflow-hidden transition-all duration-300 ${showAdjustments ? "max-h-[500px] border-t border-neutral-800" : "max-h-0"}`}>
                        <div className="p-2 space-y-0.5">
                          {psdInfo.adjustments.filter(a => !a.hidden).map((a, i) => (
                            <label key={i} className={`flex items-center gap-3 py-2 px-3 rounded-xl cursor-pointer transition-all ${hiddenLayers.has(a.path || a.name) ? "opacity-40" : "hover:bg-white/5"}`}>
                              <input type="checkbox" checked={!hiddenLayers.has(a.path || a.name)} onChange={() => toggleLayer(a.path || a.name)} className="accent-white w-3.5 h-3.5" />
                              <span className={`text-[11px] font-bold truncate flex-1 ${hiddenLayers.has(a.path || a.name) ? "line-through" : "text-neutral-300"}`}>{a.name}</span>
                              <span className="text-[9px] font-bold text-neutral-700 uppercase">{a.type}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {selected.description && (
                  <div className="bg-neutral-900/20 p-4 rounded-2xl border border-neutral-900">
                    <p className="text-[11px] text-neutral-500 leading-relaxed italic line-clamp-4">&ldquo;{selected.description}&rdquo;</p>
                  </div>
                )}
                
                <div className="flex flex-col gap-2 pt-2 pb-6 border-b border-neutral-900">
                  <div className="flex items-center justify-center gap-2 text-[10px] font-bold text-neutral-700 uppercase tracking-widest">
                    <History className="w-3 h-3" /> Info do arquivo
                  </div>
                  <p className="text-[10px] text-neutral-600 text-center leading-relaxed">
                    {selected.psdPath?.split(/[/\\]/).pop()}
                    {selected.psdSizeBytes ? ` · ${(selected.psdSizeBytes / 1e6).toFixed(1)} MB` : ""}
                    {psdInfo ? ` · ${psdInfo.width}×${psdInfo.height} px` : ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Art Input — colapsável. Hidden quando não há faces editáveis. */}
            {faces.length > 0 && (
              <div className="shrink-0 flex flex-col border-t border-neutral-900 bg-neutral-950">
              {/* Header — clica para colapsar */}
              <button
                onClick={() => setArtSectionCollapsed((v) => !v)}
                className="h-8 flex items-center justify-between px-4 w-full group select-none"
              >
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-neutral-600 group-hover:text-neutral-400 transition-colors">
                  {faces.length > 1 && activeFace ? `Arte · ${activeFace.name}` : "Sua Arte"}
                </p>
                <ChevronDown className={`w-3.5 h-3.5 text-neutral-700 group-hover:text-neutral-500 transition-all duration-200 ${artSectionCollapsed ? "" : "rotate-180"}`} />
              </button>

              {/* Conteúdo colapsável */}
              {!artSectionCollapsed && (
                <div className="px-4 pb-4 flex flex-col gap-2">
                  <div className={brandId && !artPreview ? "flex gap-2 items-stretch" : undefined}>
                    <div
                      onDrop={handleDrop}
                      onDragOver={(e) => e.preventDefault()}
                      onClick={() => !artPreview && fileInputRef.current?.click()}
                      className={`rounded-2xl flex flex-col gap-2 transition-all relative ${
                        artPreview
                          ? "border border-neutral-800 bg-neutral-900/40 p-2"
                          : `border-2 border-dashed cursor-pointer flex items-center justify-center px-3 py-3 group ${brandId ? "flex-1" : ""} border-neutral-800 hover:border-neutral-600 bg-neutral-900/30 hover:bg-neutral-900/50`
                      }`}
                    >
                      {artPreview ? (
                        <div onClick={(e) => e.stopPropagation()}>
                          <ArtFramePanel
                            artPreview={artPreview}
                            artDims={artDims}
                            frame={frame}
                            onFrameChange={setFrame}
                            soWidth={soWidth}
                            soHeight={soHeight}
                            fileName={artFile?.name || "Área de transferência"}
                            onClear={() => { clearSlot(activeSlot); setRenderResult(null); }}
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
                            <p className="text-[10px] text-neutral-600">JPG, PNG ou Ctrl+V</p>
                          </div>
                        </div>
                      )}
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleArtSelect(f); }} />
                    </div>

                    {/* Brand shortcuts — só quando sem arte */}
                    {brandId && !artPreview && (
                      <div className="flex flex-col gap-2 shrink-0 w-[4.5rem]">
                        <button onClick={(e) => { e.stopPropagation(); loadBrandLogoAsArt(); }} className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-neutral-800 text-[10px] font-bold text-neutral-400 hover:bg-white hover:text-black transition-all active:scale-95 py-1"><Zap className="w-4 h-4" /><span>Logo</span></button>
                        <button onClick={(e) => { e.stopPropagation(); openLibrary(); }} className="flex-1 flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-neutral-800 text-[10px] font-bold text-neutral-400 hover:bg-white hover:text-black transition-all active:scale-95 py-1"><Library className="w-4 h-4" /><span>Library</span></button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Actions Footer */}
            <div className="p-4 border-t border-neutral-900 bg-neutral-950/80 backdrop-blur shrink-0 space-y-4 shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
              <div className="flex gap-3">
                <button
                  onClick={() => handleRender(true)}
                  disabled={renderDisabled}
                  className="flex-1 py-3 rounded-xl border border-neutral-800 text-xs font-bold text-neutral-300 disabled:opacity-30 hover:bg-neutral-900 hover:text-white transition-all active:scale-[0.97]"
                >
                  Preview Rápido
                </button>
                <button
                  onClick={() => handleRender(false)}
                  disabled={renderDisabled}
                  className="flex-1 py-3 rounded-xl bg-white text-black font-black text-xs disabled:opacity-30 hover:bg-neutral-200 transition-all active:scale-[0.97] shadow-xl shadow-white/5"
                >
                  RENDER FINAL{faces.length > 1 ? ` · ${filledCount}/${faces.length}` : ""}
                </button>
                {renderLogs.length > 0 && (
                  <button
                    onClick={() => setShowLogs(true)}
                    title="Ver logs do render"
                    className={`px-3 py-3 rounded-xl border text-xs font-bold transition-all active:scale-[0.97] ${renderLogs.some(l => l.step === "error") ? "border-red-500/40 text-red-400 hover:bg-red-500/10" : "border-neutral-800 text-neutral-500 hover:bg-neutral-900 hover:text-white"}`}
                  >
                    <Terminal className="w-4 h-4" />
                  </button>
                )}
              </div>

              {renderResult && !rendering && !isPreviewResult && (
                <a
                  href={renderResult}
                  download={`${selected.name.replace(/\s+/g, "_")}_mockup.png`}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 text-black text-xs font-black hover:bg-emerald-400 transition-all active:scale-[0.97] shadow-lg shadow-emerald-500/10"
                >
                  <Download className="w-4 h-4" /> DOWNLOAD PNG
                </a>
              )}

              {renderLogs.some((l) => l.step === "error") && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] text-red-400 font-medium flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {renderLogs.filter((l) => l.step === "error").map((l) => l.detail).join(", ")}
                </div>
              )}
            </div>
          </Panel>
        )}
      </PanelGroup>

      {/* Render Logs modal */}
      {showLogs && (
        <div className="fixed inset-0 z-[95] bg-black/85 backdrop-blur-sm flex items-end justify-end p-4 animate-in fade-in duration-150" onClick={() => setShowLogs(false)}>
          <div
            className="w-[500px] max-h-[70vh] flex flex-col rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-900">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-neutral-500" />
                <span className="text-[11px] font-black text-neutral-300 tracking-wide uppercase">Render Logs</span>
                <span className="text-[10px] font-bold text-neutral-600 bg-neutral-900 px-1.5 py-0.5 rounded-md border border-neutral-800">{renderLogs.length}</span>
              </div>
              <button onClick={() => setShowLogs(false)} className="text-neutral-600 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 space-y-0.5 font-mono">
              {renderLogs.map((log, i) => (
                <div key={i} className={`flex gap-2 py-0.5 text-[10px] leading-relaxed ${log.step === "error" ? "text-red-400" : log.step === "complete" ? "text-emerald-400" : log.step === "warning" ? "text-amber-400" : "text-neutral-500"}`}>
                  <span className="shrink-0 text-neutral-700 w-5 text-right">{i + 1}</span>
                  <span className={`shrink-0 font-bold ${log.step === "error" ? "text-red-500" : log.step === "complete" ? "text-emerald-500" : log.step === "warning" ? "text-amber-500" : "text-neutral-600"}`}>{log.step}</span>
                  {log.detail && <span className="break-all">{log.detail}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
          <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm flex flex-col animate-in fade-in duration-200" onClick={() => setShowSession(false)}>
            <div className="flex flex-col h-full max-w-5xl w-full mx-auto" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-950">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-black text-white">Session</h2>
                  <span className="text-[10px] font-bold text-neutral-500 bg-neutral-900 px-2 py-0.5 rounded-full border border-neutral-800">{entries.length} renders</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSessionSelected(allSelected ? new Set() : new Set(entries.map(([id]) => id)))}
                    className="px-3 py-1.5 rounded-lg border border-neutral-800 text-[10px] font-bold text-neutral-400 hover:text-white hover:border-neutral-600 transition-all"
                  >
                    {allSelected ? "Desmarcar tudo" : "Selecionar tudo"}
                  </button>
                  <button
                    onClick={() => triggerDownloads(downloadTargets)}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-white text-black text-[10px] font-black hover:bg-neutral-200 transition-all active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {sessionSelected.size > 0 ? `Baixar selecionados (${sessionSelected.size})` : "Baixar todos"}
                  </button>
                  <button
                    onClick={() => { setRenderCache({}); setShowSession(false); }}
                    className="px-3 py-1.5 rounded-lg border border-red-500/20 text-[10px] font-bold text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    Limpar sessão
                  </button>
                  <button onClick={() => setShowSession(false)} className="p-1.5 rounded-lg text-neutral-500 hover:text-white hover:bg-white/5 transition-all ml-1">
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
                        className={`relative rounded-2xl overflow-hidden border cursor-pointer transition-all duration-200 group ${isChecked ? "border-white ring-2 ring-white/20" : "border-neutral-800 hover:border-neutral-600"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={name} className="w-full aspect-[4/3] object-cover" />
                        {/* Checkbox */}
                        <div className={`absolute top-2 left-2 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${isChecked ? "bg-white border-white" : "bg-black/50 border-neutral-600 opacity-0 group-hover:opacity-100"}`}>
                          {isChecked && <CheckCircle2 className="w-3.5 h-3.5 text-black" />}
                        </div>
                        {/* Download button */}
                        <button
                          onClick={(e) => { e.stopPropagation(); triggerDownloads([[id, { url, name }]]); }}
                          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-white hover:text-black transition-all"
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
          </div>
        );
      })()}

      {/* Fullscreen overlay */}
      {fullscreen && renderResult && (
        <div
          className="fixed inset-0 z-[100] bg-black/98 flex flex-col animate-in fade-in duration-300"
          onClick={() => setFullscreen(false)}
        >
          <div className="p-4 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <ImageIcon className="w-5 h-5 text-neutral-500" />
              <span className="text-sm font-bold text-neutral-300">{selected?.name}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); copyRenderAsPng(); }}
                className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl transition-all active:scale-95 ${copiedPng ? "bg-emerald-500 text-black" : "bg-neutral-800 hover:bg-neutral-700 text-white"}`}
              >
                {copiedPng ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copiedPng ? "Copiado!" : "Copiar PNG"}
              </button>
              <a
                href={renderResult}
                download={`${selected?.name || "render"}-render.${isPreviewResult ? "jpg" : "png"}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 bg-white text-black text-xs font-bold px-4 py-2 rounded-xl hover:bg-neutral-200 transition-all active:scale-95"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
              <button
                onClick={() => setFullscreen(false)}
                className="bg-neutral-800 hover:bg-neutral-700 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
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

          <div className="p-4 text-center text-[10px] font-bold text-neutral-600 uppercase tracking-widest bg-neutral-950/50">
            {renderTime != null && renderTime > 0 && `Processado em ${(renderTime / 1000).toFixed(1)}s`}
            {renderResult && ` · ${isPreviewResult ? "JPEG Preview" : "PNG Lossless"}`}
          </div>
        </div>
      )}

      {/* Advanced Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" onClick={() => setShowSettings(false)} />
          <div className="relative w-full max-w-sm bg-neutral-950 border border-neutral-800 rounded-3xl flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/30 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-neutral-800 flex items-center justify-center">
                  <Settings2 className="w-4 h-4 text-neutral-300" />
                </div>
                <p className="text-sm font-black text-white">Configurações avançadas</p>
              </div>
              <button onClick={() => setShowSettings(false)} className="p-2 rounded-xl hover:bg-neutral-800 text-neutral-500 hover:text-white transition-all active:scale-90">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <button
                onClick={() => { setShowSettings(false); setShowDupes(true); if (!dupesGroups.length && !dupesScanning) scanDuplicates(); }}
                className="w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl bg-amber-500/8 border border-amber-500/15 hover:bg-amber-500/15 hover:border-amber-500/30 transition-all active:scale-[0.98] group text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0 group-hover:bg-amber-500/25 transition-colors">
                  <Copy className="w-4.5 h-4.5 text-amber-400" />
                </div>
                <div>
                  <p className="text-sm font-black text-amber-300">Duplicatas</p>
                  <p className="text-[10px] text-neutral-500 font-medium">Encontrar e remover PSDs duplicados</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicates Modal */}
      {showDupes && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-xl" onClick={() => setShowDupes(false)} />
          <div className="relative w-full max-w-5xl bg-neutral-950 border border-neutral-800 rounded-3xl flex flex-col max-h-[92vh] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">

            {/* ── Header ── */}
            <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/30 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                  <Copy className="w-4 h-4 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-black tracking-tight">Arquivos Duplicados</h3>
                  <p className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest mt-0.5 flex items-center gap-2">
                    <span>
                      {dupesScanning && !dupesSummary
                        ? dupesGroups.length > 0
                          ? `${dupesGroups.length} grupo${dupesGroups.length > 1 ? "s" : ""} encontrado${dupesGroups.length > 1 ? "s" : ""}...`
                          : "Iniciando scan..."
                        : dupesSummary
                        ? `${dupesGroups.length} grupos · ${dupesSummary.filesScanned.toLocaleString()} arquivos · `
                        : "Pronto para escanear"}
                      {dupesSummary && (
                        <span className="text-amber-400">{(dupesSummary.totalWastedBytes / 1e6).toFixed(0)} MB desperdiçados</span>
                      )}
                    </span>
                    {dupesScanning && (
                      <span className="font-mono text-neutral-700 tabular-nums">
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-800 text-[10px] font-bold text-neutral-400 hover:bg-neutral-700 hover:text-white transition-all active:scale-95 disabled:opacity-40"
                >
                  <RefreshCw className={`w-3 h-3 ${dupesScanning ? "animate-spin" : ""}`} />
                  {dupesScanning ? "Escaneando..." : "Re-escanear"}
                </button>
                <button onClick={() => setShowDupes(false)} className="p-1.5 rounded-xl hover:bg-neutral-800 text-neutral-600 hover:text-white transition-all active:scale-90">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* ── Progress bar (durante scan) ── */}
            {dupesScanning && dupesProgress && (
              <div className="px-6 py-2.5 bg-neutral-900/20 border-b border-neutral-800/50 shrink-0">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">
                    Hashing {dupesProgress.hashed.toLocaleString()} / {dupesProgress.total.toLocaleString()} arquivos candidatos
                  </span>
                  <span className="text-[10px] font-black text-amber-500">{dupesProgress.pct}%</span>
                </div>
                <div className="w-full h-[3px] bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${dupesProgress.pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* ── Toolbar (filter + sort) ── */}
            {(dupesGroups.length > 0 || dupesSummary) && (
              <div className="px-6 py-3 bg-neutral-900/20 border-b border-neutral-800/50 flex items-center gap-3 shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600" />
                  <input
                    type="text"
                    value={dupesFilter}
                    onChange={(e) => setDupesFilter(e.target.value)}
                    placeholder="Filtrar por nome ou caminho..."
                    className="w-full h-8 rounded-xl bg-neutral-900 border border-neutral-800 pl-9 pr-4 text-xs focus:outline-none focus:border-neutral-600 transition-colors placeholder:text-neutral-700"
                  />
                  {dupesFilter && (
                    <button onClick={() => setDupesFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-white">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[9px] font-black text-neutral-700 uppercase tracking-widest mr-1">Sort</span>
                  {(["wasted", "size", "copies"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setDupesSort(s)}
                      className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                        dupesSort === s ? "bg-white text-black" : "bg-neutral-900 text-neutral-600 hover:text-white border border-neutral-800"
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
                  <span key={i} className={`text-[9px] font-black uppercase tracking-[0.15em] text-neutral-700 ${i >= 2 && i < 5 ? "text-right" : ""}`}>{h}</span>
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
                  <button onClick={() => scanDuplicates()} className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 transition-all active:scale-95">
                    Tentar novamente
                  </button>
                </div>
              )}

              {/* Initial idle state */}
              {!dupesScanning && !dupesError && dupesGroups.length === 0 && !dupesSummary && (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-neutral-700">
                  <HardDrive className="w-10 h-10 opacity-20" />
                  <p className="text-xs font-bold uppercase tracking-widest">Clique em Re-escanear para iniciar</p>
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
                      <span className="text-neutral-600 font-mono tabular-nums shrink-0">
                        {String(Math.floor(dupesElapsed / 60)).padStart(2, "0")}:{String(dupesElapsed % 60).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-neutral-900 rounded-full overflow-hidden">
                      {dupesProgress ? (
                        <div className="h-full bg-amber-500 rounded-full transition-all duration-300" style={{ width: `${dupesProgress.pct}%` }} />
                      ) : (
                        <div className="h-full bg-amber-500/60 animate-progress-indefinite rounded-full" style={{ width: "40%" }} />
                      )}
                    </div>
                  </div>
                  <div className="bg-black/40 rounded-xl border border-neutral-800/50 p-3 h-36 overflow-y-auto no-scrollbar font-mono text-[10px] leading-relaxed space-y-0.5">
                    {dupesLogs.map((line, i) => (
                      <p key={i} className={line.startsWith("✓") ? "text-emerald-500" : line.startsWith("✗") ? "text-red-400" : line.startsWith("Duplicata") ? "text-amber-400/80" : "text-neutral-600"}>
                        <span className="text-neutral-800 mr-2 select-none">{String(i + 1).padStart(2, " ")} ›</span>{line}
                      </p>
                    ))}
                    <div ref={dupesLogsEndRef} />
                  </div>
                </div>
              )}

              {/* Clean state — scan done, zero dupes */}
              {!dupesScanning && dupesSummary && dupesGroups.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-black text-white uppercase tracking-widest">Nenhuma duplicata</p>
                    <p className="text-[10px] font-bold text-neutral-600 mt-2 uppercase tracking-widest">
                      {dupesSummary.filesScanned.toLocaleString()} arquivos verificados — tudo limpo!
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
                      <span className="text-[10px] font-black text-neutral-700">{gi + 1}</span>
                      <div className="flex items-center gap-2 min-w-0 pr-4">
                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 text-neutral-700 group-hover:text-neutral-400 transition-all duration-200 ${isExpanded ? "rotate-90 text-neutral-400" : ""}`} />
                        <span className="text-[11px] font-bold text-neutral-200 truncate">{fileName}</span>
                        <span className="shrink-0 text-[8px] font-black text-neutral-700 bg-neutral-800/80 px-1.5 py-0.5 rounded">{ext}</span>
                      </div>
                      <span className="text-[11px] font-bold text-neutral-500 text-right">{(group.sizeBytes / 1e6).toFixed(1)} MB</span>
                      <span className="text-[11px] font-bold text-neutral-500 text-right">{allPaths.length}×</span>
                      <span className="text-[11px] font-black text-amber-400 text-right">{(group.wastedBytes / 1e6).toFixed(1)} MB</span>
                      <span />
                    </button>

                    {/* Expanded file list */}
                    {isExpanded && (
                      <div className="px-4 pb-3 animate-in slide-in-from-top-1 duration-200">
                        {/* Sub-header */}
                        <div className="grid grid-cols-[1rem_1fr_7rem_8rem_6.5rem] gap-x-3 px-3 py-1.5 mb-1">
                          <span />
                          <span className="text-[8px] font-black text-neutral-700 uppercase tracking-[0.15em]">Caminho completo</span>
                          <span className="text-[8px] font-black text-neutral-700 uppercase tracking-[0.15em] text-right">Tamanho</span>
                          <span className="text-[8px] font-black text-neutral-700 uppercase tracking-[0.15em] text-right">Modificado</span>
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

                          return (
                            <div
                              key={fi}
                              className={`grid grid-cols-[1rem_1fr_7rem_8rem_6.5rem] gap-x-3 items-center px-3 py-2 rounded-xl mb-0.5 ${isKeep ? "bg-emerald-500/[0.06]" : "bg-red-500/[0.06]"}`}
                            >
                              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isKeep ? "bg-emerald-500" : "bg-red-500/70"}`} />
                              <div className="flex items-center gap-2 min-w-0">
                                {thumbUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={thumbUrl} alt={name} className="w-7 h-7 shrink-0 rounded-md object-cover border border-neutral-800" />
                                ) : (
                                  <div className="w-7 h-7 shrink-0 rounded-md bg-neutral-800 border border-neutral-700 flex items-center justify-center">
                                    <Layers className="w-3.5 h-3.5 text-neutral-600" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <p className={`text-[10px] font-bold truncate ${isKeep ? "text-emerald-300" : "text-neutral-400"}`}>{name}</p>
                                  <p className="text-[8px] text-neutral-700 font-mono truncate mt-0.5">{dir}</p>
                                </div>
                              </div>
                              <span className="text-[10px] font-bold text-neutral-600 text-right">{(group.sizeBytes / 1e6).toFixed(2)} MB</span>
                              <span className="text-[9px] text-neutral-700 font-mono text-right">—</span>
                              <div className="flex items-center justify-end gap-1.5">
                                <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${
                                  isKeep
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                                    : "bg-red-500/10 text-red-400 border border-red-500/15"
                                }`}>
                                  {isKeep ? "Manter" : "Remover"}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); fetch("/api/open-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: filePath }) }); }}
                                  className="p-1 rounded-lg hover:bg-neutral-800 text-neutral-700 hover:text-white transition-all"
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
                  <HardDrive className="w-3.5 h-3.5 text-neutral-700" />
                  <p className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">
                    {dupesGroups.reduce((acc, g) => acc + g.removePaths.length, 0)} arquivos removíveis ·{" "}
                    <span className="text-amber-400">{(dupesSummary.totalWastedBytes / 1e6).toFixed(0)} MB</span> recuperáveis
                  </p>
                </div>
                <p className="text-[9px] text-neutral-700 font-bold uppercase tracking-widest">
                  scripts\remove-dupes.ps1 -Mode Trash
                </p>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Brand Asset Library Modal */}
      {showLibrary && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-xl" onClick={() => setShowLibrary(false)} />
          <div className="relative w-full max-w-4xl bg-neutral-900 border border-neutral-800 rounded-3xl flex flex-col max-h-[85vh] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-neutral-800 flex justify-between items-center bg-neutral-950/30">
              <div>
                <h3 className="text-lg font-black tracking-tight">Biblioteca de Assets</h3>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-2 h-2 rounded-full bg-white" />
                  <p className="text-[10px] text-neutral-500 font-black uppercase tracking-[0.2em]">
                    {brands.find(b => b.id === brandId)?.name}
                  </p>
                </div>
              </div>
              <button onClick={() => setShowLibrary(false)} className="p-2 rounded-xl hover:bg-neutral-800 text-neutral-500 hover:text-white transition-all active:scale-90">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
              {loadingAssets ? (
                <div className="flex flex-col items-center justify-center h-64 gap-4">
                  <Loader2 className="w-10 h-10 border-2 border-neutral-700 border-t-white rounded-full animate-spin" />
                  <p className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Sincronizando assets...</p>
                </div>
              ) : assetError ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="p-4 rounded-full bg-red-500/10 text-red-500"><AlertTriangle className="w-8 h-8" /></div>
                  <p className="text-red-400 text-sm font-bold text-center px-10">{assetError}</p>
                  <button 
                    onClick={openLibrary}
                    className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 transition-all active:scale-95"
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : brandAssets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-2 text-neutral-600">
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
                      <div className="aspect-square relative bg-white/5 border border-white/5 rounded-2xl overflow-hidden group-hover:border-white/20 group-hover:bg-white/10 transition-all p-6 shadow-sm group-hover:shadow-2xl group-hover:-translate-y-1 duration-300">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img 
                          src={asset.thumbnail} 
                          alt={asset.label} 
                          className="w-full h-full object-contain filter drop-shadow-2xl transition-transform duration-500 group-hover:scale-110"
                        />
                      </div>
                      <div className="px-1">
                        <p className="text-[11px] font-black truncate text-neutral-400 group-hover:text-white transition-colors">{asset.label}</p>
                        <p className="text-[9px] text-neutral-600 font-bold uppercase tracking-widest mt-0.5">{asset.variant}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <div className="p-4 bg-neutral-950/50 border-t border-neutral-800 text-center flex items-center justify-center gap-3">
              <ExternalLink className="w-3.5 h-3.5 text-neutral-700" />
              <p className="text-[10px] font-bold text-neutral-600 uppercase tracking-widest">Selecione um asset para aplicar ao mockup</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
