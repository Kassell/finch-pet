import { createInterface } from 'node:readline';
import { callPetManagement, type PetManagementMethod, type PetManagementResult } from './management-ipc.js';

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

const tools = [
  {
    name: 'pet_list',
    title: 'List desktop pets',
    description: 'List available Petdex desktop pets. Use for infrequent pet-library management and discovery.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'pet_select',
    title: 'Select desktop pet',
    description: 'Select the active Petdex desktop pet by name or slug.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, description: 'Pet name or slug to select.' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'pet_add',
    title: 'Add Petdex pet',
    description: 'Import a Petdex-compatible pet from a local folder, zip, spritesheet image, remote image URL, or Petdex page URL.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', minLength: 1, description: 'Local path, image URL, or https://petdex.dev/pets/<slug> URL.' },
        name: { type: 'string', minLength: 1, description: 'Optional pet name or slug.' },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'pet_remove',
    title: 'Remove Petdex pet',
    description: 'Remove a user-added Petdex pet from local storage. Bundled pets cannot be removed.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, description: 'Pet name or slug to remove.' } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
] as const;

const write = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
const result = (id: JsonRpcId, value: unknown) => write({ jsonrpc: '2.0', id, result: value });
const error = (id: JsonRpcId, code: number, message: string) => write({ jsonrpc: '2.0', id, error: { code, message } });
const textError = (message: string): PetManagementResult => ({ isError: true, content: [{ type: 'text', text: message }] });

const stringArg = (args: Record<string, unknown>, key: string, required = true) => {
  const value = args[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (!required && value === undefined) return undefined;
  throw new Error(`${key} must be a non-empty string`);
};

const callTool = async (name: unknown, args: Record<string, unknown>): Promise<PetManagementResult> => {
  let method: PetManagementMethod;
  let params: Record<string, unknown>;
  try {
    switch (name) {
      case 'pet_list':
        method = 'pet_list';
        params = {};
        break;
      case 'pet_select':
        method = 'pet_select';
        params = { name: stringArg(args, 'name') };
        break;
      case 'pet_add':
        method = 'pet_add';
        params = { source: stringArg(args, 'source'), name: stringArg(args, 'name', false) };
        break;
      case 'pet_remove':
        method = 'pet_remove';
        params = { name: stringArg(args, 'name') };
        break;
      default:
        return textError(`unknown tool: ${String(name)}`);
    }
    return await callPetManagement(method, params);
  } catch (cause) {
    return textError(cause instanceof Error ? cause.message : String(cause));
  }
};

const supportedVersions = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);

const handleRequest = async (request: JsonRpcRequest) => {
  const id = request.id ?? null;
  if (request.id === undefined) return;
  switch (request.method) {
    case 'initialize': {
      const requested = request.params?.protocolVersion;
      const protocolVersion = typeof requested === 'string' && supportedVersions.has(requested) ? requested : '2025-03-26';
      result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'finch-pet', version: '1.0.3' },
      });
      return;
    }
    case 'ping':
      result(id, {});
      return;
    case 'tools/list':
      result(id, { tools });
      return;
    case 'tools/call': {
      const args = request.params?.arguments;
      const output = await callTool(request.params?.name, args && typeof args === 'object' ? args as Record<string, unknown> : {});
      result(id, output);
      return;
    }
    default:
      error(id, -32601, `Method not found: ${request.method}`);
  }
};

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (!line.trim()) return;
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') throw new Error('invalid request');
  } catch {
    error(null, -32700, 'Parse error');
    return;
  }
  void handleRequest(request).catch((cause: unknown) => {
    if (request.id !== undefined) error(request.id, -32603, cause instanceof Error ? cause.message : String(cause));
  });
});
