/**
 * Which model produced the thing you are reading, and how it got the job.
 *
 * Every agent prompt goes to both backends at once and the first valid answer is
 * the one kept (see backend/agents/race.py), so "which model wrote this" is a fact
 * about one result rather than about the deployment. A score is worth less if you
 * cannot tell whose judgement it is — especially when the local model took a lane
 * the hosted one normally holds — so the row carries its own attribution and it is
 * shown wherever a result is.
 *
 * Deliberately colourless. The palette has one rule: sodium is what Cortex is
 * doing, jade is what is on file, tally is a stop. A credit is none of those, and
 * colouring the two models differently would say one of them is the good outcome.
 * They are both the result; only the note says whether anything went wrong.
 */

const MODELS = {
  gemini: { name: 'Gemini', where: 'hosted' },
  llama: { name: 'Llama 3', where: 'local' },
}

export function ModelBadge({ model }) {
  if (!model) return null

  // An unrecognised name is still shown rather than hidden: a row written by a
  // backend this build has not heard of is exactly when the credit matters most.
  const { name, where } = MODELS[model] ?? { name: model, where: '' }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-seam bg-house px-2.5 py-1 font-mono text-eyebrow text-lit-soft">
      {name}
      {where && <span className="text-shade">{where}</span>}
    </span>
  )
}

/**
 * The credit line: who produced this, and one sentence on how the race went.
 *
 * ``note`` is the interesting half — "Both models answered. Kept Gemini (2.1s)
 * over Llama 3 (local) (41.0s)" is the comparison happening in the open, and
 * "Gemini failed, so Llama 3 (local) answered instead" is why this result looks
 * different from the last one. Rendered as plain text at eyebrow size: it is
 * provenance, not a warning, and a candidate who does not care should be able to
 * slide past it.
 */
export default function ModelCredit({ model, note, prefix = 'Answered by', className = '' }) {
  if (!model) return null

  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${className}`}>
      <span className="font-mono text-eyebrow uppercase tracking-[0.14em] text-shade">
        {prefix}
      </span>
      <ModelBadge model={model} />
      {note && <span className="font-mono text-eyebrow leading-relaxed text-shade">{note}</span>}
    </p>
  )
}
