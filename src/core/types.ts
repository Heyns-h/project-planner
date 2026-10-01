// Core data shapes (blueprint v0.2 §4, plan §5).
// Nothing in core/ may import browser or UI code.

/**
 * A vault domain id, e.g. the value of a note's `domain:` key. Domains are
 * configuration, not code: each repo declares its own (see DomainDef).
 */
export type Domain = string;

/** One domain of the target repo, supplied by settings rather than hard-coded. */
export interface DomainDef {
  id: Domain; // value used in `domain:` frontmatter
  folder: string; // top-level folder, e.g. "01-Example"
  label: string; // display name
}

export type PlannerType = 'project' | 'subproject' | 'task';
export type StoredStatus = 'idea' | 'active' | 'on-hold' | 'done' | 'archived';
export type Priority = 'low' | 'medium' | 'high';

/** File name without `.md`. Unique across the repo for planner files. */
export type Stem = string;

/** A file as fetched from the repo. `sha` is the git blob SHA. */
export interface RepoFile {
  path: string;
  sha: string;
  content: string;
}

export type ProblemCode =
  | 'missing-key'
  | 'title-key'
  | 'unresolved-link'
  | 'bad-value'
  | 'hierarchy'
  | 'cycle'
  | 'conflict-markers'
  | 'unparseable';

export interface Problem {
  code: ProblemCode;
  severity: 'error' | 'warning';
  message: string;
  field?: string;
}

export interface PlannerNode {
  id: string; // planner_id (ULID)
  path: string;
  stem: Stem;
  title: string; // aliases[0] ?? stem
  plannerType: PlannerType;
  domain: Domain;
  status: StoredStatus;
  parent: Stem | null;
  priority: Priority;
  owner: Stem | null;
  people: Stem[];
  tags: string[];
  start: string | null; // YYYY-MM-DD, kept as a string
  due: string | null;
  blockedBy: Stem[];
  relates: Stem[];
  references: Stem[];
  drive: string[];
  created: string;
  updated: string;
  body: string;
  problems: Problem[];
  readOnly: boolean;
}

export interface Person {
  stem: Stem;
  path: string;
  name: string; // aliases[0] ?? stem
  domain: Domain;
}

export interface TagList {
  domain: Domain;
  path: string;
  tags: string[];
}

export interface Graph {
  nodes: Map<string, PlannerNode>; // by planner_id
  byStem: Map<Stem, string>; // stem → planner_id
  children: Map<string, string[]>; // derived from parent
  blocks: Map<string, string[]>; // derived from blockedBy
  people: Map<Stem, Person>;
  tags: Map<Domain, TagList>;
  allStems: Set<Stem>; // every .md in the repo, for link checks and uniqueness
}

/** Fields a `set` op may change. */
export type Field =
  | 'title'
  | 'status'
  | 'parent'
  | 'priority'
  | 'owner'
  | 'people'
  | 'tags'
  | 'start'
  | 'due'
  | 'blockedBy'
  | 'relates'
  | 'references'
  | 'drive';

/** Input for a new node file (serialize.newNodeContent). */
export interface NewNode {
  id: string;
  plannerType: PlannerType;
  title: string;
  domain: Domain;
  parent: Stem | null;
  owner?: Stem | null;
  status?: StoredStatus;
  priority?: Priority;
  tags?: string[];
  start?: string | null;
  due?: string | null;
  blockedBy?: Stem[];
  body?: string;
}

export interface NewPerson {
  name: string;
  domain: Domain;
}

export type Op =
  | { kind: 'set'; nodeId: string; field: Field; from: unknown; to: unknown }
  | { kind: 'body'; nodeId: string; from: string; to: string }
  | { kind: 'create'; node: NewNode; path: string }
  | { kind: 'createPerson'; person: NewPerson; path: string }
  | { kind: 'addTag'; domain: Domain; tag: string; meaning: string };

export interface QueuedOp {
  opId: string;
  batchId: string; // one UI action = one batch
  summary: string; // the batch's description, for commit messages, e.g. "edit 'Buy glue' (status)"
  op: Op;
  at: string; // ISO timestamp, device-local
  device: string;
  seq: number; // queue order
  conflict?: Conflict;
}

export interface Conflict {
  opId: string;
  nodeId: string;
  field: Field | 'body' | 'deleted';
  base: unknown;
  mine: unknown;
  theirs: unknown;
  /** The note has conflict markers or broken frontmatter: only "theirs" (drop) can resolve it. */
  readOnly?: boolean;
}

export type SyncState =
  | { s: 'idle'; lastSync: string | null }
  | { s: 'pulling' }
  | { s: 'pushing' }
  | { s: 'offline'; since: string }
  | { s: 'conflicts'; items: Conflict[] }
  | { s: 'error'; message: string; retryAt?: string };

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  device: string; // label used in commit messages, e.g. "phone"
  tokenExpires: string | null; // YYYY-MM-DD, typed at setup (plan §6)
  domains: DomainDef[]; // detected from the repo at setup, editable in settings
}
