import { createServer, createConnection, type Server, type Socket } from 'node:net';
import { chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export type PetManagementMethod = 'pet_list' | 'pet_select' | 'pet_add' | 'pet_remove';

export type PetManagementContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface PetManagementResult {
  [key: string]: unknown;
  content: PetManagementContent[];
  isError?: boolean;
}

export type PetManagementHandlers = Record<PetManagementMethod, (params: Record<string, unknown>) => Promise<PetManagementResult>>;

type IpcRequest = { id: string; method: PetManagementMethod; params?: Record<string, unknown> };
type IpcResponse = { id: string; result?: PetManagementResult; error?: string };

const pipeSuffix = typeof process.getuid === 'function' ? String(process.getuid()) : process.env.USERNAME ?? 'user';
export const PET_MANAGEMENT_SOCKET = process.platform === 'win32'
  ? `\\\\.\\pipe\\finch-pet-${pipeSuffix}`
  : join(tmpdir(), `finch-pet-${pipeSuffix}.sock`);

const writeResponse = (socket: Socket, response: IpcResponse) => {
  socket.write(`${JSON.stringify(response)}\n`);
};

export function createPetManagementIpcServer(
  handlers: PetManagementHandlers,
  logger: { warn(message: string, ...args: unknown[]): void },
) {
  let server: Server | undefined;

  const handleConnection = (socket: Socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.trim()) continue;
        void (async () => {
          let request: IpcRequest;
          try {
            request = JSON.parse(line) as IpcRequest;
          } catch {
            writeResponse(socket, { id: '', error: 'invalid request' });
            return;
          }
          const handler = handlers[request.method];
          if (!handler) {
            writeResponse(socket, { id: request.id, error: `unknown method: ${String(request.method)}` });
            return;
          }
          try {
            const result = await handler(request.params ?? {});
            writeResponse(socket, { id: request.id, result });
          } catch (error) {
            writeResponse(socket, { id: request.id, error: error instanceof Error ? error.message : String(error) });
          }
        })();
      }
    });
  };

  return {
    async start() {
      if (server) return;
      if (process.platform !== 'win32') await rm(PET_MANAGEMENT_SOCKET, { force: true }).catch(() => undefined);
      server = createServer(handleConnection);
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(PET_MANAGEMENT_SOCKET, () => {
          server!.off('error', reject);
          resolve();
        });
      });
      if (process.platform !== 'win32') await chmod(PET_MANAGEMENT_SOCKET, 0o600);
    },
    dispose() {
      const active = server;
      server = undefined;
      active?.close();
      if (process.platform !== 'win32') void rm(PET_MANAGEMENT_SOCKET, { force: true }).catch((error: unknown) => {
        logger.warn('remove pet management socket failed', error instanceof Error ? error.message : String(error));
      });
    },
  };
}

export async function callPetManagement(method: PetManagementMethod, params: Record<string, unknown> = {}): Promise<PetManagementResult> {
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return await new Promise<PetManagementResult>((resolve, reject) => {
    const socket = createConnection(PET_MANAGEMENT_SOCKET);
    socket.setEncoding('utf8');
    let buffer = '';
    const fail = (error: Error) => {
      socket.destroy();
      reject(new Error(`Finch Pet extension is unavailable: ${error.message}`));
    };
    socket.once('error', fail);
    socket.once('connect', () => socket.write(`${JSON.stringify({ id, method, params } satisfies IpcRequest)}\n`));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      socket.off('error', fail);
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as IpcResponse;
        if (response.id !== id) throw new Error('mismatched response');
        if (response.error) throw new Error(response.error);
        if (!response.result) throw new Error('empty response');
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
  });
}
