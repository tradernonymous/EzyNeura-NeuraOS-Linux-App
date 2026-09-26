/** FLUX.2 on this PC as three steps (UMD, node-tested). */
export interface SetupStep { id: 'server' | 'model' | 'run'; label: string; done: boolean; detail: string; action: '' | 'pick-server' | 'get-model' | 'pick-flux' | 'start'; pick?: string; }
export declare const DEFAULT_REPO: string;
/** E5: the Qwen-Image set — diffusion model, VAE and 7B encoder as one folder. */
export declare const QWEN_REPO: string;
export declare function isFlux2(name: string): boolean;
export declare function baseName(path: string): string;
export declare function steps(facts: any, status: any): SetupStep[];
export declare function next(list: SetupStep[]): SetupStep | null;
