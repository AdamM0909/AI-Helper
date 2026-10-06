// Short teaching guides for common subjects. The tutor gets the one that
// matches what the student is working on. Small models teach much better
// with concrete pointers like these than with general instructions alone.
// To add a subject, add an entry: `match` is checked against the student's
// subject, what they're stuck on and the lesson topic.

// Order matters: the first match wins, so languages come before English grammar.
const GUIDES = [
  {
    match: /french|français|francais|passé|passe compose|imparfait|conjug/i,
    guide: `French:
- Always pair French with its English meaning, and have the student produce their own sentences, not just recognize them.
- Passé composé = auxiliary (avoir or être, present tense) + past participle. Être verbs are mostly movement and change of state (DR MRS VANDERTRAMP) plus all reflexive verbs, and their participle agrees with the subject (elle est allée).
- Passé composé is for completed events; imparfait is for background, descriptions, habits and ongoing actions ("I was eating when he arrived").
- Common mistakes: using avoir with être verbs, forgetting agreement, translating word for word from English, wrong gender for nouns (teach le/la together with each noun).
- Show conjugations as a table with pronouns.`,
  },
  {
    match: /spanish|español|espanol|\bser\b|\bestar\b|preterite|preterit/i,
    guide: `Spanish:
- Pair Spanish with English meanings and have the student write their own sentences.
- Ser is for identity, origin, time and lasting traits; estar is for location, feelings and temporary states.
- Preterite is for completed actions; imperfect is for background, habits and descriptions.
- Common mistakes: ser/estar mix-ups, forgetting gender agreement, missing accents that change meaning.
- Show conjugations as a table with pronouns.`,
  },
  {
    match: /diagram|grammar|sentence|clause|phrase|noun|verb|adjective|adverb|preposition|parts of speech|english/i,
    guide: `English grammar and sentence diagrams (Reed-Kellogg):
- Build a diagram one step at a time: first find the verb, then ask "who or what is doing it?" for the subject, then objects, then modifiers.
- Layout: subject | verb on a base line. Direct object after a short line: verb | object. Predicate noun or adjective after a slanted line: verb \\ complement. Adjectives and adverbs go on slanted lines under the word they describe. A prepositional phrase hangs under the word it modifies: the preposition on the slant, its object on a short line.
- Common mistakes: picking a noun inside a prepositional phrase as the subject ("One of the dogs barks": subject is One), mixing up direct objects and predicate adjectives after linking verbs (is, seems, becomes), and forgetting that compound subjects split into branches.`,
  },
  {
    match: /algebra|equation|solve for|math|fraction|slope|linear|quadratic|polynom|factor|inequalit|exponent|function/i,
    guide: `Math:
- Work one step at a time. After each step, ask the student what the next step should be instead of doing it.
- Ask them to explain why a step is allowed ("what did we do to both sides?").
- Teach checking: plug the answer back into the original equation.
- Common mistakes: sign errors, not distributing a negative to every term, doing something to only one side, order of operations, adding fractions without a common denominator.
- Write each step of working on its own line in a code block.`,
  },
  {
    match: /geometry|angle|triangle|circle|proof|area|perimeter|volume|pythag/i,
    guide: `Geometry:
- Ask the student to name the shape's properties and which theorem applies before calculating.
- Sketch figures as simple text diagrams and label the parts.
- Common mistakes: using the wrong formula (area vs perimeter), mixing up radius and diameter, assuming a figure is drawn to scale, forgetting units.`,
  },
  {
    match: /chem|mole|stoich|balanc|atom|element|periodic|reaction|molar|bond/i,
    guide: `Chemistry:
- Have the student write down what they know and what they're looking for, with units.
- Balance equations one element at a time, counting atoms on each side, and change coefficients, never subscripts.
- Use unit conversions step by step (grams → moles → moles → grams).
- Common mistakes: changing subscripts to balance, losing track of units, confusing atoms with molecules, forgetting diatomic elements.`,
  },
  {
    match: /physics|force|velocity|acceleration|newton|energy|momentum|motion/i,
    guide: `Physics:
- Start with knowns, unknowns and units. Pick the equation that connects them.
- For forces, have them list every force on the object (a free body diagram) first.
- Common mistakes: mixing units, sign and direction errors, confusing mass and weight, plugging numbers in before setting up the equation.`,
  },
  {
    match: /bio|cell|dna|gene|evolution|ecolog|photosynth|organ|mitosis|meiosis/i,
    guide: `Biology:
- Connect every structure to its function ("why does it have that shape?").
- Use everyday analogies (a cell membrane is like a security guard) and have the student make their own.
- For processes, have them put the steps in order and explain what goes in and what comes out.
- Common mistakes: mixing up similar terms (mitosis/meiosis, gene/allele), memorizing without understanding the purpose.`,
  },
  {
    match: /history|social studies|government|civics|war|revolution|economics|geography/i,
    guide: `History and social studies:
- Focus on causes and effects, and on claim, evidence and reasoning.
- Ask "why did this happen?" and "what changed because of it?" rather than quizzing on dates alone.
- Help them build an argument; never write their essay or paragraphs for them.`,
  },
  {
    match: /essay|writing|thesis|paragraph|paper|literature|poem|novel|analysis|\bread/i,
    guide: `Writing and literature:
- The student does the writing. You ask questions, point out one improvement at a time and explain why.
- Thesis: a specific, arguable claim. Body paragraphs: claim, evidence (a quote or example), then their explanation of how the evidence supports the claim.
- Never write sentences or paragraphs for them to copy. Give an example on a different topic if they need a model.`,
  },
];

export function guideFor(...texts) {
  const haystack = texts.filter(Boolean).join(" ");
  return GUIDES.find((g) => g.match.test(haystack))?.guide || "";
}
