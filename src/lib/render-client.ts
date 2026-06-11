// Cliente headless do render-server (TCP :4200) para a API do agente.
// Cria o job, acompanha o progresso e persiste o estado em status.json —
// assim o GET /api/agent/v1/jobs/:id funciona entre processos/restarts.

import { writeFile, mkdir, readFile, rename } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { createConnection } from "net";

const TMP_DIR = join(process.cwd(), ".tmp", "renders");
const RENDER_PORT = parseInt(process.env.RENDER_PORT || "4200");
const TIMEOUT = parseInt(process.env.RENDER_TIMEOUT_MS || "120000");

export interface JobStatus {
  jobId: string;
  status: "queued" | "rendering" | "done" | "error";
  step?: string;
  error?: string;
  durationMs?: number;
  preview?: boolean;
  createdAt: string;
}

export interface RenderJobInput {
  psdPath: string;
  artBuffer: Buffer;
  smartObject: string;
  hideLayers?: string[];
  preview?: boolean;
}

async function writeStatus(jobDir: string, status: JobStatus): Promise<void> {
  // Escrita atômica (temp + rename) — leitores nunca veem JSON pela metade
  try {
    const tmp = join(jobDir, `status.${process.pid}.tmp`);
    await writeFile(tmp, JSON.stringify(status), "utf-8");
    await rename(tmp, join(jobDir, "status.json"));
  } catch {}
}

export async function readJobStatus(jobId: string): Promise<JobStatus | null> {
  if (jobId.includes("..") || jobId.includes("/") || jobId.includes("\\")) return null;
  try {
    return JSON.parse(await readFile(join(TMP_DIR, jobId, "status.json"), "utf-8")) as JobStatus;
  } catch {
    return null;
  }
}

export function jobOutputPath(jobId: string): string {
  return join(TMP_DIR, jobId, "output.png");
}

/**
 * Inicia um render e retorna o jobId imediatamente. O progresso fica em
 * status.json; o PNG final em output.png (mesmo cache de 30 min do /api/render).
 */
export async function startRenderJob(input: RenderJobInput): Promise<JobStatus> {
  const jobId = randomUUID();
  const jobDir = join(TMP_DIR, jobId);
  await mkdir(jobDir, { recursive: true });

  const artPath = join(jobDir, "art.png");
  const outputPath = join(jobDir, "output.png");
  await writeFile(artPath, input.artBuffer);

  const status: JobStatus = {
    jobId,
    status: "queued",
    preview: input.preview === true,
    createdAt: new Date().toISOString(),
  };
  await writeStatus(jobDir, status);

  // Render em background — o chamador acompanha via readJobStatus/awaitJob
  void runJob(jobDir, status, {
    psdPath: input.psdPath,
    artPath,
    outputPath,
    smartObject: input.smartObject,
    hideLayers: input.hideLayers || [],
    preview: input.preview === true,
  });

  return status;
}

/** Espera o job terminar (ou estourar o timeout do render). */
export async function awaitJob(jobId: string, timeoutMs = TIMEOUT + 5000): Promise<JobStatus | null> {
  const deadline = Date.now() + timeoutMs;
  let last: JobStatus | null = null;
  while (Date.now() < deadline) {
    // Agora a escrita é atômica (writeStatus usa temp + rename), mas mantemos
    // o retry por segurança contra latência de IO ou arquivos expirados.
    const status = await readJobStatus(jobId);
    if (status) {
      last = status;
      if (status.status === "done" || status.status === "error") return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return (await readJobStatus(jobId)) ?? last;
}

function runJob(
  jobDir: string,
  status: JobStatus,
  job: {
    psdPath: string;
    artPath: string;
    outputPath: string;
    smartObject: string;
    hideLayers: string[];
    preview: boolean;
  }
): Promise<void> {
  return new Promise((resolve) => {
    const socket = createConnection({ port: RENDER_PORT, host: "127.0.0.1" });
    let data = "";
    let settled = false;

    const finish = async (patch: Partial<JobStatus>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      Object.assign(status, patch);
      await writeStatus(jobDir, status);
      resolve();
    };

    const timer = setTimeout(() => {
      socket.destroy();
      void finish({ status: "error", error: "Render timeout" });
    }, TIMEOUT);

    socket.on("connect", () => {
      status.status = "rendering";
      void writeStatus(jobDir, status);
      socket.write(JSON.stringify(job) + "\n");
    });

    socket.on("data", (chunk) => {
      data += chunk.toString();
      let nlIdx: number;
      while ((nlIdx = data.indexOf("\n")) !== -1) {
        const line = data.slice(0, nlIdx);
        data = data.slice(nlIdx + 1);

        if (line.startsWith("progress:")) {
          try {
            const progress = JSON.parse(line.slice("progress:".length));
            if (progress.step) {
              status.step = progress.step;
              void writeStatus(jobDir, status);
            }
          } catch {}
          continue;
        }

        try {
          const result = JSON.parse(line);
          if (result.ok) {
            void finish({ status: "done", step: "done", durationMs: result.durationMs });
          } else if (result.error) {
            void finish({ status: "error", error: result.error });
          }
        } catch {}
      }
    });

    socket.on("end", () => {
      if (!settled) {
        const ok = existsSync(job.outputPath);
        void finish(
          ok
            ? { status: "done", step: "done" }
            : { status: "error", error: "Render terminou sem output" }
        );
      }
    });

    socket.on("error", (err) => {
      void finish({
        status: "error",
        error: `Render server indisponível (porta ${RENDER_PORT}): ${err.message}`,
      });
    });
  });
}
