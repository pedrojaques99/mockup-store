"use client";

/**
 * ColorPicker — swatches + cor livre, no padrão que já existia no `ArtFramePanel`.
 *
 * Colhido de `ArtFramePanel.tsx` (o bloco "Fundo"), que era o seletor de cor
 * mais maduro do repo e estava duplicado no `art-framer.tsx` legado. Aqui ele
 * vira primitivo e serve os dois casos: fundo da arte (onde `null` = sem fundo)
 * e cor de camada do PSD (onde não existe "sem cor").
 *
 * O input é o `<input type="color">` NATIVO, escondido atrás da bolinha. É de
 * propósito: ele traz o seletor do sistema operacional — com conta-gotas de
 * tela, paleta recente e acessibilidade — de graça, e nenhuma roda de matiz
 * escrita à mão empata com isso. A bolinha com `conic-gradient` é o sinal de
 * "clique para escolher" quando nenhum swatch está ativo.
 */

import * as React from "react";

export interface ColorSwatch {
  /** `null` = "sem cor" (transparente). Só faça sentido onde ausência é opção. */
  valor: string | null;
  titulo: string;
}

const XADREZ: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%),linear-gradient(45deg,#555 25%,#222 25%,#222 75%,#555 75%)",
  backgroundSize: "6px 6px",
  backgroundPosition: "0 0,3px 3px",
};

function mesmaCor(a: string | null, b: string | null) {
  if (a === null || b === null) return a === b;
  return a.toLowerCase() === b.toLowerCase();
}

export function ColorPicker({
  value,
  onChange,
  swatches = [],
  label,
  disabled,
  className = "",
}: {
  value: string | null;
  onChange: (cor: string | null) => void;
  /** Atalhos. Para camada de PSD, o primeiro costuma ser a cor original. */
  swatches?: ColorSwatch[];
  /** Rótulo curto à esquerda ("Fundo", "Cor"). Omitido, some. */
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const emSwatch = swatches.some((s) => mesmaCor(s.valor, value));
  const custom = !!value && !emSwatch;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label && <span className="text-[10px] text-zinc-500 shrink-0">{label}</span>}
      <div className="flex items-center gap-1.5">
        {swatches.map((s) => (
          <button
            key={String(s.valor)}
            type="button"
            title={s.titulo}
            aria-label={s.titulo}
            aria-pressed={mesmaCor(s.valor, value)}
            disabled={disabled}
            onClick={() => onChange(s.valor)}
            className={`w-5 h-5 rounded-full border transition-ui disabled:opacity-40 ${
              mesmaCor(s.valor, value)
                ? "ring-2 ring-acc2 border-acc2"
                : "border-zinc-700 hover:border-zinc-500"
            }`}
            style={s.valor === null ? XADREZ : { background: s.valor }}
          />
        ))}

        <label
          title="Cor personalizada"
          className={`w-5 h-5 rounded-full border grid place-items-center overflow-hidden transition-ui ${
            disabled ? "opacity-40" : "cursor-pointer"
          } ${custom ? "ring-2 ring-acc2 border-acc2" : "border-zinc-700 hover:border-zinc-500"}`}
          style={{
            background: custom
              ? (value as string)
              : "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)",
          }}
        >
          <input
            type="color"
            value={value ?? "#ffffff"}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label ? `${label} — cor personalizada` : "Cor personalizada"}
            className="opacity-0 w-full h-full cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
}
