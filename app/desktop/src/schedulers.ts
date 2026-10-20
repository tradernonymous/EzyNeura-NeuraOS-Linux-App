// The background recipe scheduler, apart from the screen it belongs to.
//
// App calls the hook on every start, whatever screen is showing -- which used
// to make RecipesScreen part of the first bundle just so a hook could exist.
// The decision "is anything due?" needs only the small UMD library; the screen
// module (which knows how to run a recipe) is fetched the first time something
// is actually due. On most starts that is never, and the screen stays in its
// own lazy chunk. (Evals scheduler removed in the lean build.)
import { useEffect } from 'react';
import { pushToast } from './components/Toasts';
import './recipes.js';

const recipesLib: typeof import('./recipes.js') = (globalThis as any).FreeAI4URecipes;

/** While the app runs: once a minute, run whatever recipes are due (recipes.js nextRun). */
export function useRecipeScheduler() {
  useEffect(() => {
    const running = new Set<string>();
    const tick = () => {
      const now = Date.now();
      const due = recipesLib.dueRecipes(recipesLib.list(), recipesLib.lastRuns(), now)
        .filter((recipe) => !running.has(recipe.id));
      if (!due.length) return;
      for (const recipe of due) {
        running.add(recipe.id);
        // Stamped before the reply, so a slow model is not started twice.
        recipesLib.recordRun(recipe.id, { at: now, ok: true });
      }
      import('./screens/RecipesScreen')
        .then(({ runRecipeInBackground }) => {
          for (const recipe of due) {
            runRecipeInBackground(recipe, {}, now).finally(() => running.delete(recipe.id));
          }
        })
        .catch((e: unknown) => {
          due.forEach((recipe) => running.delete(recipe.id));
          pushToast('error', `Scheduled recipes could not start: ${String((e as Error)?.message || e)}`);
        });
    };
    const first = setTimeout(tick, 5000);
    const timer = setInterval(tick, 60000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
}
