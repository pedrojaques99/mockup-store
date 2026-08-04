/**
 * photo-mockup-io — helpers de I/O do editor de foto-mockup: File↔dataURL↔URL e
 * um fetch JSON com erro tipado. Extraídos de photo-mockup/page.tsx (sem mudança
 * de comportamento) pra serem reusados pelos hooks de domínio.
 */

export function toBase64File(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    // Ver mask-compose: `onerror = rej` rejeita com o Event cru e vira
    // "[object Event]" no overlay. O nome do arquivo é a pista útil.
    fr.onerror = () => rej(new Error(`Não deu para ler o arquivo "${file.name}"`));
    fr.readAsDataURL(file);
  });
}

export async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(new Error(`Não deu para ler os bytes de ${url}`));
    fr.readAsDataURL(blob);
  });
}

export function dataUrlToFile(dataUrl: string, name: string): File {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

export async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, opts);
  const j = await r.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!r.ok) throw new Error((j as any).error ?? `HTTP ${r.status}`);
  return j as T;
}
