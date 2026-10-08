// One turn of Chat, with tools: stream, act on what the model asked for, stream
// again -- until it answers in words or the round limit stops it.
//
// The loop owns no transport and no UI. It is given a `stream` (any provider:
// engine, Hugging Face, Ollama, llama-server), an `execute` (tool-run.ts), and
// an `approve` that resolves when the person clicks Allow or Deny on the card.
// Everything a person should see goes out through `onText` and `onTool`.
//
// Two decisions worth knowing:
//
//   * a DENIED call is not an error. The model is told "the user declined", so
//     it can answer without the tool instead of stalling;
//   * a provider that REFUSES tools outright (a 400 about `tools`) gets the turn
//     again without them, once, and the person is told -- a model that cannot
//     call tools should still be able to talk.
//
// And one rule that outranks both: a turn never ends in silence. Two ways it
// used to. A model that streams only its reasoning (`reasoning_content`, kept
// as <think> so the chat can fold it) left a "Thought" block and no answer. A
// research-shaped request ran out of rounds and left a pile of tool cards and
// no plan. Both now get one closing pass with the tools withheld, which is the
// only thing the model can do with it: answer.
import './tools.js';
import { withImages } from './attach-image';
import type { StreamFrame } from './api';

const tools: typeof import('./tools.js') = (globalThis as any).FreeAI4UTools;

type ToolCall = import('./tools.js').ToolCall;
type ToolDef = import('./tools.js').ToolDef;

export type Message = { role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string };

export type ToolStatus = 'asking' | 'running' | 'done' | 'denied' | 'error' | 'stopped';

/**
 * C7: one local trace line per model call and per tool call. The shape is
 * deliberately small — when, which, how long, whether it worked — because
 * a trace must never hold a prompt, an argument or a result.
 */
export type TraceEvent =
  | { kind: 'model'; chars: number; ms: number; error?: string }
  | { kind: 'tool'; name: string; status: string; ms: number };

export interface ToolEvent {
  id: string;
  name: string;
  args: Record<string, any>;
  summary: string;
  /** Why it asks first; empty when it simply runs. */
  asks: string;
  status: ToolStatus;
  result?: string;
  /** While the call is still streaming in: its arguments so far, for the card. */
  preview?: string;
  /** C6: the person changed the arguments on the card before allowing. */
  edited?: boolean;
  /** Stamped by the screen, for the elapsed timer. */
  startedAt?: number;
  endedAt?: number;
}

export interface TurnOptions {
  messages: Message[];
  tools: ToolDef[];
  stream: (messages: Message[], tools: ToolDef[] | undefined, onFrame: (frame: StreamFrame) => void, signal?: AbortSignal) => Promise<void>;
  /** The signal is the turn's Stop: a tool that can cancel, cancels. */
  execute: (call: ToolCall, args: Record<string, any>, signal?: AbortSignal) => Promise<string>;
  approve: (event: ToolEvent) => Promise<boolean | { args: Record<string, any> }>;
  /**
   * C11: the screen's own gate for whether this call asks at all (the
   * folder's read-only preset). Returns the reason to ask, or '' to run
   * without asking. Without it the decision is tools.needsApproval, as always.
   */
  asks?: (name: string, args: Record<string, any>) => string;
  /** C7: a local line for every model round and tool call — Activity only. */
  onTrace?: (event: TraceEvent) => void;
  onText: (piece: string) => void;
  onTool: (event: ToolEvent) => void;
  onNote?: (note: string) => void;
  signal?: AbortSignal;
  /**
   * The loaded context in characters, when this machine knows it: older tool
   * results are trimmed before each round rather than the server refusing the
   * whole request. Absent for engine models, which manage context themselves.
   */
  charBudget?: number;
  /**
   * Pictures a tool call produced (screen_capture): they follow the tool
   * message as a user turn with image parts, the one place every vision
   * model reads a picture from.
   */
  imagesFor?: (callId: string) => string[];
}

/** What the person would actually read: the answer without its reasoning. */
export function visibleAnswer(text: string): string {
  return String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}

/** The nudge that closes a turn the model left open. */
const CLOSING_NUDGE =
  'Answer now, in words, using what you already have. Do not call any more tools.';

export async function runTurn(options: TurnOptions): Promise<void> {
  const messages = options.messages.slice();
  let offered: ToolDef[] | undefined = options.tools.length ? options.tools : undefined;

  // One closing pass, at most, per turn: stream once more with no tools on
  // offer and an explicit ask for the answer. `why` is what the person is
  // told, so the app never just goes quiet on them.
  let closed = false;
  const closeOut = async (why: string, history: Message[]): Promise<void> => {
    if (closed) return;
    closed = true;
    options.onNote?.(why);
    const asked = history.concat([{ role: 'user', content: CLOSING_NUDGE }]);
    let said = '';
    await options.stream(asked, undefined, (frame: StreamFrame) => {
      if (frame.content) { said += frame.content; options.onText(frame.content); }
    }, options.signal);
    if (!visibleAnswer(said)) {
      options.onNote?.('The model had nothing more to say. Ask again, or try another model.');
    }
  };

  // Cards shown as working or asking, by id: a Stop settles them to a
  // `stopped` state instead of leaving a spinner running forever.
  const openCards = new Map<string, ToolEvent>();
  const settleStopped = () => {
    for (const card of openCards.values()) {
      options.onTool({ ...card, status: 'stopped', result: 'The turn was stopped.', endedAt: Date.now() });
    }
    openCards.clear();
  };

  for (let round = 0; round < tools.MAX_ROUNDS; round += 1) {
    // The context is fixed at load on a local model: trim old tool results
    // before asking, rather than after the server refuses the request.
    if (options.charBudget) {
      const shrunk = tools.shrink(messages, options.charBudget);
      if (shrunk.clipped) {
        shrunk.messages.forEach((m, i) => { messages[i] = m; });
        options.onNote?.('Older tool results were trimmed to fit the model’s context.');
      }
    }
    let text = '';
    let pending: any[] = [];
    const startedAt = Date.now();
    let lastPreview = 0;
    const onFrame = (frame: StreamFrame) => {
      if (frame.content) {
        text += frame.content;
        options.onText(frame.content);
      }
      if (frame.toolCalls) {
        pending = tools.collect(pending, frame.toolCalls);
        // The card shows the command assembling: a preview throttled to four
        // a second, keyed by the call's real id so the finished event (or
        // the one that runs) replaces it rather than joining it.
        const now = Date.now();
        if (now - lastPreview >= 250) {
          const live = pending.filter((c) => c && c.id && c.name && c.arguments);
          const last = live[live.length - 1];
          if (last) {
            lastPreview = now;
            const previewEvent: ToolEvent = {
              id: last.id,
              name: last.name,
              args: {},
              summary: tools.summarise(last.name, {}),
              asks: '',
              status: 'running',
              preview: String(last.arguments).slice(-600),
            };
            // Tracked like any running card: Stop settles it too, and the
            // real event for this id replaces it a moment later.
            openCards.set(previewEvent.id, previewEvent);
            options.onTool({ ...previewEvent });
          }
        }
      }
    };

    try {
      await options.stream(messages, offered, onFrame, options.signal);
    } catch (err) {
      const message = (err as Error)?.message || String(err);
      // Only before anything was said, only once, and only when the refusal
      // reads like it is about tools.
      if (offered && !text && round === 0 && (err as Error)?.name !== 'AbortError' && tools.isToolsRefusal(message)) {
        offered = undefined;
        options.onNote?.('This model does not take tools, so it is answering without them.');
        round -= 1;
        continue;
      }
      // The round never produced anything: the trace still says when and why.
      options.onTrace?.({ kind: 'model', chars: text.length, ms: Date.now() - startedAt, error: message.slice(0, 200) });
      // Stop lands mid-stream as an AbortError: the cards go with it.
      if (options.signal?.aborted || (err as Error)?.name === 'AbortError') settleStopped();
      throw err;
    }
    options.onTrace?.({ kind: 'model', chars: text.length, ms: Date.now() - startedAt });

    const calls = tools.finish(pending);
    if (!calls.length) {
      // Reasoning is not an answer. A model that thought out loud and stopped
      // gets one chance to say the thing it was thinking about.
      if (!visibleAnswer(text) && !options.signal?.aborted) {
        await closeOut('That reply was only the model thinking. Asking it for the answer.', messages);
      }
      return;
    }

    messages.push(tools.assistantMessage(text, calls));

    // One call, from card to conversation: the approval when it asks, the
    // run, the trace, and the messages the model reads next. Returned rather
    // than pushed, so a batch can still push them in the order asked.
    const runOne = async (call: ToolCall): Promise<Message[]> => {
      if (options.signal?.aborted) return [];
      const out: Message[] = [];
      let args = tools.parseArgs(call.arguments);
      const event: ToolEvent = {
        id: call.id,
        name: call.name,
        args,
        summary: tools.summarise(call.name, args),
        asks: options.asks ? options.asks(call.name, args) : tools.needsApproval(call.name),
        status: 'running',
      };
      let result: string;
      if (event.asks) {
        event.status = 'asking';
        openCards.set(event.id, { ...event });
        options.onTool({ ...event });
        const decision = await options.approve({ ...event });
        if (!decision) {
          event.status = 'denied';
          event.result = 'The user declined this action.';
          openCards.delete(event.id);
          options.onTool({ ...event });
          out.push(tools.toolMessage(call, event.result));
          return out;
        }
        // C6: what runs is what was typed on the card, not what was asked
        // for — and the model is told, so its next words describe reality.
        if (typeof decision === 'object') {
          args = decision.args;
          event.args = args;
          event.summary = tools.summarise(call.name, args);
          event.edited = true;
        }
        event.status = 'running';
      }
      openCards.set(event.id, { ...event });
      options.onTool({ ...event });
      const toolStartedAt = Date.now();
      try {
        result = await options.execute(call, args, options.signal);
        event.status = 'done';
      } catch (err) {
        result = `Error: ${(err as Error)?.message || String(err)}`;
        event.status = 'error';
      }
      options.onTrace?.({ kind: 'tool', name: call.name, status: event.status, ms: Date.now() - toolStartedAt });
      event.result = tools.clip(result);
      openCards.delete(event.id);
      options.onTool({ ...event });
      // C8: a result from the web, a repository or somebody else's file is
      // labelled where the model reads it — data, not instructions.
      const shown = tools.markUntrusted(call.name, result);
      const note = event.edited
        ? `The person edited this tool call before it ran; these are the arguments that ran: ${JSON.stringify(args)}\n`
        : '';
      out.push(tools.toolMessage(call, note + shown));
      const images = options.imagesFor?.(call.id) || [];
      if (images.length) {
        out.push({ role: 'user', content: withImages(`[The picture from ${call.name}.]`, images) });
      }
      return out;
    };

    // A run of calls that ask nothing goes at once: read-only tools do not
    // wait on each other. An asking call is always alone — the approval path
    // is a conversation. The conversation is still written in call order.
    let at = 0;
    while (at < calls.length) {
      if (options.signal?.aborted) {
        settleStopped();
        return;
      }
      const batch: ToolCall[] = [];
      while (at < calls.length) {
        const c = calls[at];
        const ask = options.asks ? options.asks(c.name, tools.parseArgs(c.arguments)) : tools.needsApproval(c.name);
        if (ask) break;
        batch.push(c);
        at += 1;
      }
      if (!batch.length) {
        const pushed = await runOne(calls[at]);
        at += 1;
        pushed.forEach((m) => messages.push(m));
        continue;
      }
      const results = await Promise.all(batch.map((c) => runOne(c)));
      for (const pushed of results) pushed.forEach((m) => messages.push(m));
    }
  }
  if (!options.signal?.aborted) {
    await closeOut(
      `That is ${tools.MAX_ROUNDS} rounds of tool calls. Asking for the answer with what it has.`,
      messages,
    );
  }
}
