// @ts-check
// Cards of the person's own the flows in the tests are drawn with, beside the ones that ship: a PM, a Designer, an
// Engineer and a Skeptic, each with the line and the level it had while Filament shipped it. A flow is any of the
// person's agents in steps; these give its boxes names of their own to tell apart in the words a flow says.

/** @type {readonly { tag: string, name: string, goodFor: string, may: "read" | "copy" | "edit", thinks: string }[]} */
export const OWN_CARDS = Object.freeze([
  { tag: "pm", name: "PM", goodFor: "Is it worth building, and what is the smallest version", may: "edit", thinks: "You think as a product manager: the smallest version worth having." },
  { tag: "designer", name: "Designer", goodFor: "Where it lives on the page, and in which words", may: "edit", thinks: "You think as the designer of what the person looks at and touches." },
  { tag: "engineer", name: "Engineer", goodFor: "What breaks, and what it costs to build", may: "edit", thinks: "You think as the engineer who has to build this and keep it running." },
  { tag: "skeptic", name: "Skeptic", goodFor: "The cheapest thing that works; what was not tested", may: "read", thinks: "You doubt on purpose: what was assumed and never checked." },
]);

/**
 * Those cards saved in a card store, as the person saves cards of their own.
 * @param {{ create: (input: any) => unknown }} cards
 */
export const saveOwnCards = (cards) => {
  for (const c of OWN_CARDS) cards.create({ ...c });
};
