import type { WorkerRequest, WorkerResponse } from "../workers/protocol";

type RequestWithoutId = WorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class DataWorkerClient {
  private worker = new Worker(
    new URL("../workers/data.worker.ts", import.meta.url),
    { type: "module" },
  );
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor() {
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError);
  }

  request<T>(request: RequestWithoutId, transfer: Transferable[] = []): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ ...request, id } satisfies WorkerRequest, transfer);
    });
  }

  dispose() {
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError);
    this.worker.terminate();
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Local processing was stopped."));
    }
    this.pending.clear();
  }

  private handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.data);
    else pending.reject(new Error(response.error ?? "Local processing failed."));
  };

  private handleError = () => {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("The local processing worker stopped unexpectedly."));
    }
    this.pending.clear();
  };
}
