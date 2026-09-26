// FLUX.2 on this PC, as three steps (UI plan follow-up): the sd-server
// build, a model set, and the server running. Pure: the card hands in the
// shell's facts and status and draws the answer, so the states are tested
// without a shell.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeAI4UFluxSetup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** The set the first step offers: FLUX.2 [klein] 4B, the size most GPUs take. */
  var DEFAULT_REPO = 'Comfy-Org/flux2-klein-4B';
  /** E5: the other image model's set — diffusion model, VAE and 7B encoder
   *  under the folders hf-models.js reads as roles, so it lands as one set. */
  var QWEN_REPO = 'Comfy-Org/Qwen-Image_ComfyUI';

  /** FLUX.2 in any of its spellings (the same rule as sd.rs is_flux2). */
  function isFlux2(name) {
    var n = String(name || '').toLowerCase();
    return n.indexOf('flux2') >= 0 || n.indexOf('flux-2') >= 0 || n.indexOf('flux.2') >= 0 || n.indexOf('klein') >= 0;
  }

  function baseName(path) {
    var p = String(path || '').replace(/[\\/]+$/, '');
    var parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
  }

  /**
   * steps(facts, status) -> [{ id, label, done, detail, action }]
   * action names what the button does when the step is not done:
   * 'pick-server' | 'get-model' | 'start'. A done step has action ''.
   */
  function steps(facts, status) {
    var f = facts || {};
    var s = status || {};
    var hasServer = !!f.found;
    var model = String(f.model || '');
    var models = Array.isArray(f.models) ? f.models : [];
    var fluxOnDisk = models.filter(function (m) { return m && isFlux2(m.name || m.path); });
    var hasFlux = !!model && isFlux2(model);
    var running = s.state === 'ready';
    var starting = s.state === 'starting';
    return [
      {
        id: 'server',
        label: 'sd-server',
        done: hasServer,
        detail: hasServer ? baseName(f.binary) : 'Choose the sd-server from a stable-diffusion.cpp build (the Vulkan Linux zip).',
        action: hasServer ? '' : 'pick-server',
      },
      {
        id: 'model',
        label: 'Image model',
        done: hasFlux,
        detail: hasFlux
          ? baseName(model)
          : fluxOnDisk.length
            ? 'A FLUX.2 set is on disk: pick it as the model.'
            : model
              ? baseName(model) + ' is chosen; an image model is one click away.'
              : 'Download an image model from Hugging Face — FLUX.2 [klein] 4B or Qwen-Image, each one folder.',
        action: hasFlux ? '' : fluxOnDisk.length ? 'pick-flux' : 'get-model',
        pick: fluxOnDisk.length ? fluxOnDisk[0].path : '',
      },
      {
        id: 'run',
        label: 'Running',
        done: running,
        detail: running ? 'On ' + (s.base_url || '127.0.0.1') : starting ? 'Loading the model…' : hasServer && hasFlux ? 'Start it; the first draw takes a while.' : 'Needs the two steps above.',
        action: running || starting ? '' : hasServer && hasFlux ? 'start' : '',
      },
    ];
  }

  /** The first step that is not done, or null when all three are. */
  function next(list) {
    for (var i = 0; i < list.length; i++) if (!list[i].done) return list[i];
    return null;
  }

  return { DEFAULT_REPO: DEFAULT_REPO, QWEN_REPO: QWEN_REPO, isFlux2: isFlux2, baseName: baseName, steps: steps, next: next };
});
