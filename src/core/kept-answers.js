// @ts-check
// Answers kept by what they rest on (the 10-29 speed pass, on the owner's words of 10-29 on the Changes tab: "not to
// mention how slow those are"): a read whose inputs did not move answers as it did, the same read once under way
// serving every ask; a store keeps `most` keys and `perKey` answers under each, the one asked longest ago going first.

/**
 * A store of answers by key (a run), each kept while its basis holds, by query. A read that fails is not kept, nor an
 * answer `keep` refuses — one that says the read went wrong, which the next ask reads again. `budget`: what the answers
 * kept weigh in all at most (`weigh`, each weighed once it came, a weight that is no finite count none): past it, the
 * keys asked longest ago that weigh something go, never the key of the answer just weighed — so a key that alone weighs
 * more is kept until another's answer comes, and a key whose reads are under way, which frees nothing, stays.
 * @param {{ most: number, perKey: number, budget?: number, weigh?: (answer: any) => number }} o
 */
export function keptAnswers({ most, perKey, budget = Infinity, weigh = () => 0 }) {
  /** @typedef {{ basis: string, answers: Map<string, Promise<any>>, weights: Map<string, number> }} Kept */
  /** @type {Map<string, Kept>} */
  const store = new Map();
  let total = 0;
  /** @param {Kept} kept @param {string} query */
  const unweigh = (kept, query) => {
    total -= kept.weights.get(query) || 0;
    kept.weights.delete(query);
  };
  /** @param {string} key */
  const letGo = (key) => {
    const kept = store.get(key);
    if (!kept) return;
    for (const w of kept.weights.values()) total -= w;
    kept.weights.clear();
    store.delete(key);
  };
  return {
    /**
     * The answer to `query` under `key`: the one kept while `basis` holds, else `read()`'s, kept where `keep` takes it.
     * @template T @param {string} key @param {string} basis @param {string} query @param {() => Promise<T>} read
     * @param {(answer: T) => boolean} [keep]
     * @returns {Promise<T>}
     */
    get(key, basis, query, read, keep = () => true) {
      let kept = store.get(key);
      if (kept && kept.basis !== basis) {
        letGo(key);
        kept = undefined;
      }
      if (!kept) kept = { basis, answers: new Map(), weights: new Map() };
      store.delete(key);
      store.set(key, kept);
      while (store.size > most) letGo(/** @type {string} */ (store.keys().next().value));
      const had = kept.answers.get(query);
      if (had) {
        kept.answers.delete(query);
        kept.answers.set(query, had);
        return had;
      }
      const p = read();
      const entry = kept;
      entry.answers.set(query, p);
      while (entry.answers.size > perKey) {
        const oldest = /** @type {string} */ (entry.answers.keys().next().value);
        entry.answers.delete(oldest);
        unweigh(entry, oldest);
      }
      const drop = () => {
        if (entry.answers.get(query) !== p) return;
        entry.answers.delete(query);
        unweigh(entry, query);
      };
      p.then((answer) => {
        if (!keep(answer)) return void drop();
        // Weighed where it is kept still; past the budget, the other keys go, the one asked longest ago first.
        if (store.get(key) !== entry || entry.answers.get(query) !== p || budget === Infinity) return;
        const said = Number(weigh(answer));
        const w = Number.isFinite(said) && said > 0 ? said : 0;
        entry.weights.set(query, w);
        total += w;
        for (const k of [...store.keys()]) {
          if (total <= budget) break;
          if (k !== key && [...(/** @type {Kept} */ (store.get(k)).weights.values())].some((x) => x > 0)) letGo(k);
        }
      }, drop);
      return p;
    },
    /** How many keys are kept. */
    size: () => store.size,
    /** What the answers kept weigh in all. */
    weight: () => total,
  };
}
