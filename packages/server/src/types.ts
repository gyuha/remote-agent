export type CliKind = 'claude' | 'codex';
export type Profile = 'readonly' | 'standard' | 'trusted';

export interface AgentDefinition {
  name: string;
  folder: string;
  cli: CliKind;
  model?: string;
  profile: Profile;
  /** Shell command prefixes allowed without approval. */
  allow: string[];
  orchestrator: boolean;
  /** Role prompt (markdown body after the frontmatter). */
  prompt: string;
}

/** Events a CLI adapter reports while a turn runs. */
export type TurnEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface RunTurnOptions {
  agent: AgentDefinition;
  prompt: string;
  /** CLI session to resume; omitted for the first turn. */
  sessionId?: string;
  /** Call chain this turn belongs to (lock re-entry, MCP bridge routing). */
  chainId: string;
  onEvent: (event: TurnEvent) => void;
}

export interface TurnResult {
  sessionId: string;
  text: string;
}

export interface CliAdapter {
  runTurn(options: RunTurnOptions): Promise<TurnResult>;
  /** Terminates every child process this adapter spawned. */
  close(): Promise<void>;
}
