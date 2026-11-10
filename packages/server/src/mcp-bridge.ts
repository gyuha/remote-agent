// MCP bridge (0008, 0011): the stdio MCP server Claude launches via `--mcp-config`.
// Dependency-free newline-delimited JSON-RPC 2.0; runs directly under `node --experimental-strip-types`.
//
// It holds no policy of its own; every tool call is relayed to the app's internal HTTP bridge at
// REMOTE_AGENT_BRIDGE_URL, tagged with REMOTE_AGENT_CHAIN_ID:
//
//   POST /approve                {chainId, tool_name, input}  → 200 {behavior:'allow'} | {behavior:'deny', message?}
//   POST /tools/list_agents      {chainId, arguments}         → 200 {text} | non-2xx {error}
//   POST /tools/send_to_agent    {chainId, arguments}         → 200 {text} | non-2xx {error}
//
// Design choice: all three tools are always listed. Whether a chain may use list_agents/send_to_agent
// (orchestrator agents only) is decided by the app, which knows the agent behind the chainId; a refusal
// comes back as a non-2xx response and is surfaced as an MCP tool error (`isError: true`). Enforcement has
// to live in the app anyway, so filtering tools/list here would only duplicate it.
//
// approve fails closed: any transport or protocol failure becomes {"behavior":"deny"}.
//
// HTTP goes through node:http rather than fetch: an approval waits for a human (up to 30 min) and
// send_to_agent waits for a whole sub-agent turn, both beyond undici's default 5-minute headers timeout.
import http from 'node:http';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: Tool[] = [
  {
    name: 'approve',
    description: 'Permission prompt for Claude tool use; relayed to the remote-agent owner.',
    inputSchema: {
      type: 'object',
      properties: { tool_name: { type: 'string' }, input: { type: 'object' } },
      required: ['tool_name', 'input'],
    },
  },
  {
    name: 'list_agents',
    description: 'List the agents in this working folder (name, cli, profile). Orchestrator agents only.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_to_agent',
    description: "Run one turn of another agent in this folder and return its reply. Orchestrator agents only.",
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, message: { type: 'string' } },
      required: ['name', 'message'],
    },
  },
];

const bridgeUrl = process.env.REMOTE_AGENT_BRIDGE_URL ?? '';
const chainId = process.env.REMOTE_AGENT_CHAIN_ID ?? '';

function send(message: object): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

function post(route: string, body: object): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      new URL(route, bridgeUrl.endsWith('/') ? bridgeUrl : bridgeUrl + '/'),
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          let json: Record<string, unknown> = {};
          try {
            const parsed: unknown = JSON.parse(data);
            if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
          } catch {
            /* non-JSON body: leave empty */
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const textResult = (text: string, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError } : {}) });

async function approve(args: Record<string, unknown>) {
  const input = args.input && typeof args.input === 'object' ? args.input : {};
  let decision: Record<string, unknown>;
  try {
    const { status, json } = await post('approve', { chainId, tool_name: args.tool_name, input });
    decision =
      status >= 200 && status < 300 && json.behavior === 'allow'
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: typeof json.message === 'string' ? json.message : 'Denied by remote-agent' };
  } catch (err) {
    decision = { behavior: 'deny', message: `remote-agent bridge unreachable: ${(err as Error).message}` };
  }
  return textResult(JSON.stringify(decision));
}

async function forward(name: string, args: Record<string, unknown>) {
  try {
    const { status, json } = await post(`tools/${name}`, { chainId, arguments: args });
    if (status >= 200 && status < 300) return textResult(typeof json.text === 'string' ? json.text : '');
    return textResult(typeof json.error === 'string' ? json.error : `${name} failed (HTTP ${status})`, true);
  } catch (err) {
    return textResult(`remote-agent bridge unreachable: ${(err as Error).message}`, true);
  }
}

async function handle(msg: JsonRpcMessage): Promise<void> {
  const { id, method, params = {} } = msg;
  if (id === undefined || id === null) return; // notifications (e.g. notifications/initialized) need no reply
  switch (method) {
    case 'initialize':
      return send({
        id,
        result: {
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'remote_agent', version: '0.0.0' },
        },
      });
    case 'ping':
      return send({ id, result: {} });
    case 'tools/list':
      return send({ id, result: { tools: TOOLS } });
    case 'tools/call': {
      const name = params.name;
      const args = params.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {};
      if (name === 'approve') return send({ id, result: await approve(args) });
      if (name === 'list_agents' || name === 'send_to_agent') return send({ id, result: await forward(name, args) });
      return send({ id, error: { code: -32602, message: `Unknown tool: ${String(name)}` } });
    }
    default:
      return send({ id, error: { code: -32601, message: `Method not found: ${String(method)}` } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    // Calls run concurrently; replies are matched by id.
    handle(msg).catch((err: unknown) => {
      if (msg.id !== undefined && msg.id !== null) send({ id: msg.id, error: { code: -32603, message: String(err) } });
    });
  }
});
process.stdin.on('end', () => process.exit(0));
