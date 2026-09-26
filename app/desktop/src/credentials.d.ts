/** C10: the credential broker's index — names and details, never secrets. */

export interface CredentialEntry {
  kind: 'ssh' | 'api';
  name: string;
  /** One display line (user@host or the address's host) — no secret. */
  detail: string;
  at: number;
}

export interface BuiltProfile {
  /** The JSON string to store under keyFor(kind, name) via secretSet. */
  profile?: string;
  /** The index line for the entry. */
  detail?: string;
  /** Why the form was refused, in the person's words. */
  error?: string;
}

export declare const KEY: string;
export declare const SSH_PREFIX: string;
export declare const API_PREFIX: string;
export declare const CAP: number;

/** The id rule broker.rs and secrets.rs enforce. */
export declare function isId(name: string): boolean;
export declare function validKind(kind: string): boolean;
/** The keyring key a profile is stored under, or '' when the name refuses. */
export declare function keyFor(kind: string, name: string): string;
/** The SSH form's input -> the profile JSON broker.rs will read back. */
export declare function sshProfile(input: { user?: string; host?: string; port?: string | number; identity?: string }): BuiltProfile;
/** The API form's input -> the profile JSON broker.rs will read back. */
export declare function apiProfile(input: { base?: string; header?: string; prefix?: string; secret?: string }): BuiltProfile;
/** The index rows — never a secret, never a key. */
export declare function list(storage?: any): CredentialEntry[];
export declare function remember(kind: string, name: string, detail: string, storage?: any): boolean;
export declare function forget(kind: string, name: string, storage?: any): boolean;
