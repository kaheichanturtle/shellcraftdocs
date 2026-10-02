'use strict';

/* ============================================================
   Signal Scope 1.7 — app.js (the detection model)
   Signals: stylistic fingerprint, burstiness, token patterns, perplexity proxy,
   semantic cohesion, perturbation peak, grammar/mechanics. A weighted base is passed
   through a gentle logistic grading curve. Includes actionable per-flag fixes, a real
   grammar checker, adversarial preprocessing, and per-signal highlighting.
   (Syntactic-entropy was removed in 1.7 — see note near the former scoreSyntax.)
   ============================================================ */

const SAMPLES = {
  ai: `The French Revolution was caused by a combination of social, economic, and political factors. It is important to note that the financial crisis, exacerbated by costly wars, placed a significant burden on the lower classes. Moreover, the rigid social hierarchy created widespread discontent among the population. Furthermore, Enlightenment ideas played a crucial role in shaping public opinion. The monarchy was financially weak. The nobility resisted taxation. The common people faced rising prices. These interrelated factors ultimately resulted in the collapse of the monarchy. In conclusion, the French Revolution was the result of multiple interconnected causes that fundamentally transformed society.`,
  human: `France's fiscal collapse in the 1780s was less a sudden shock than the bill for decades of war the crown refused to fund honestly. Bread prices did the rest. After the ruinous intervention in the American Revolution, Calonne tried to tax the nobility and was laughed out of court. The Réveillon riots in 1789 showed how fast hunger turned into fury. Was it inevitable? Probably not. A competent finance minister and one good harvest might have bought the monarchy another decade. It didn't get either.`,
  generic: `The French Revolution happened for many different reasons. The country had serious money problems at the time. The government had spent too much money on wars. The taxes were not fair to most of the people. The poorer citizens did not have enough food to eat. The new ideas from writers also changed how people thought. The king was not able to fix these growing problems. The anger of the people kept building over time. These different issues all came together in the end. The revolution then changed the country in major ways.`
};

const SIGNAL_INFO = {
  burstiness: "Burstiness measures how much sentence length varies. Humans naturally mix short and long sentences while AI tends toward uniform cadence. Thus, low variation leans AI. The amber-underlined run in the text shows the uniform cluster driving it.",
  perplexity: "Perplexity measures how predictable the text is. Low-perplexity words are the statistically obvious next word, which is characteristic of AI. It runs on a local n-gram model of common and academic English plus a bigram lookup, so treat it as one indicator among several.",
  token: "Token patterns look for recycled phrasing. Repeating topic words to answer a question is normal, so content and question-overlapping repeats are not counted; only function-word templates ('one reason is') push the score up.",
  style: "Stylistic fingerprint refers to the unique style of writing. It compares the text to documented AI vocabulary words and phrases, triadic lists, participial padding, inflated copulas, and contrastive formulas. Concrete dates, names, figures, and personal references pull human-ward.",
  cohesion: "Cohesion measures how evenly topic vocabulary is spread across the text. LLMs keep a near-constant semantic density and rarely drift; humans introduce tangents and abrupt shifts. Very high, flat cohesion with no drift leans AI.",
  perturbation: "Perturbation swaps synonyms into a sentence and re-measures predictability. If the original wording sits in a local probability trough (lower perplexity than its variants), it walked the path of maximum probability, which is an AI correlate.",
  grammar: "Minor grammar/punctuation slips and informal wording lean human, since models rarely make them. Em dashes and colon-label constructions lean lightly AI. This is the weakest signal as it is the most subjective."
};

/* ====== ACTIONABLE-FIX REMEDIES (1.5) ======
   Every stylistic / structural tell maps to a context-aware rewrite.
   `fix` may be a string or a function(matchedText) => string for context awareness. */
const REMEDIES = {
  aiWord: {
    why: "Documented far more frequently in machine text than in human writing.",
    fix: (w) => {
      const map = {
        delve: 'examine, look at', delves: 'examines', delving: 'examining',
        leverage: 'use', leverages: 'uses', leveraging: 'using',
        utilize: 'use', utilizes: 'uses', utilizing: 'using', utilization: 'use',
        robust: 'strong, reliable', seamless: 'smooth', seamlessly: 'smoothly',
        multifaceted: 'complex', nuanced: 'subtle', tapestry: 'mix, range',
        navigate: 'handle, deal with', navigating: 'handling',
        underscore: 'show, stress', underscores: 'shows', underscoring: 'showing',
        showcase: 'show', showcases: 'shows', foster: 'encourage', fostering: 'encouraging',
        pivotal: 'key', crucial: 'important', paramount: 'top', myriad: 'many',
        plethora: 'many', realm: 'area', landscape: 'field, area', holistic: 'whole',
        transformative: 'major', comprehensive: 'thorough', profound: 'deep',
        elevate: 'raise, improve', empower: 'enable', cultivate: 'build, grow',
        harness: 'use', embark: 'start', bolster: 'strengthen', intricate: 'detailed',
        vibrant: 'lively', testament: 'proof', cornerstone: 'basis', catalyst: 'trigger',
        moreover: 'also', furthermore: 'and', additionally: 'also', consequently: 'so',
        ultimately: 'in the end', notably: '(cut it)'
      };
      const k = (w || '').toLowerCase();
      return map[k] ? `Swap "${w}" for a plainer word, e.g. ${map[k]}.` : `Replace "${w}" with the plainest word that carries the same meaning.`;
    }
  },
  aiPhrase: {
    why: "A stock hedge, filler, or formulaic transition that models over-produce to sound careful and objective.",
    fix: (p) => {
      const map = {
        'it is important to note': 'Delete the hedge and state the fact directly.',
        "it's important to note": 'Delete the hedge and state the fact directly.',
        'it is worth noting': 'Delete the hedge and lead with the point.',
        'it should be noted': 'Delete it. If it matters, just say it.',
        'plays a crucial role': 'Say what it actually does: "drives", "causes", "shapes".',
        'plays a vital role': 'Name the concrete effect instead.',
        'plays a key role': 'Name the concrete effect instead.',
        'a combination of': 'List the specific factors instead.',
        'in conclusion': 'End on your sharpest point, not a signpost.',
        'in summary': 'Cut it. The reader knows the essay is ending.',
        'in today’s world': 'Name the actual moment or trend.',
        'in the realm of': 'Just name the field: "in economics", "in physics".',
        'a testament to': 'State what it proves: "shows", "proves".',
        'shed light on': 'Say "explains" or "reveals".',
        'when it comes to': 'Cut it and start with the subject.',
        'first and foremost': 'Cut "and foremost", or just say "first".'
      };
      const k = (p || '').toLowerCase();
      return map[k] || 'Cut this stock phrase and state the idea plainly.';
    }
  },
  participial: {
    why: "Participial padding: a trailing '-ing' clause that adds grammar but no information. The single strongest structural AI tell in the research.",
    fix: "Delete the ', -ing …' tail, or split it into its own concrete sentence that says something new."
  },
  triadic: {
    why: "Triadic list ('x, y, and z'), a hallmark of AI's love of symmetry.",
    fix: "Break the rule-of-three: cut to the one item that matters, or add a fourth to break the rhythm."
  },
  copula: {
    why: "Inflated copula ('serves as a', 'stands as a'); AI prefers this over a plain verb.",
    fix: "Replace with 'is' or a stronger concrete verb ('shows', 'proves', 'works as')."
  },
  contrastive: {
    why: "Contrastive formula ('not just X, it's Y'), a recognizable AI rhetorical cadence.",
    fix: "Drop the setup and assert the second half directly."
  },
  intro: {
    why: "Signpost intro that announces structure instead of arguing.",
    fix: "Delete the meta-sentence and open with your actual first claim."
  },
  closer: {
    why: "Formulaic summary closer.",
    fix: "End on your strongest specific point rather than restating."
  },
  combo: {
    why: "Characteristic AI adjective-noun combo (e.g. 'rich tapestry', 'robust framework').",
    fix: "Replace the decorative adjective with a concrete detail, or cut it."
  },
  template: {
    why: "A function-word template that recurs across the text; filler scaffolding rather than content.",
    fix: (k) => {
      const t = (k || "").toLowerCase().trim();
      if (/reason/.test(t)) return `"${k}": you're numbering reasons the same way each time. Drop the "one/another reason is" frame and just state the reason as a claim.`;
      if (/(shows that|means that|is clear)/.test(t)) return `"${k}" tells the reader how to read the evidence. Cut it and let the evidence speak, or state the conclusion directly.`;
      if (/(as a result|due to|leads to|resulted in)/.test(t)) return `"${k}" is a stock cause-effect connector. Replace it with the specific mechanism, or start the sentence with the effect.`;
      if (/(there are many|one of the)/.test(t)) return `"${k}" is a vague quantifier opener. Name the actual number or the specific item instead.`;
      return `"${k}" recurs as scaffolding. Vary how you connect ideas here, or delete the phrase and join the two clauses directly.`;
    }
  },
  perp: {
    why: "This run of words is highly predictable: each word is the statistically obvious continuation of the one before, which is what 'low perplexity' means. It's one indicator among several, not proof on its own.",
    fix: (run) => {
      const r = (run || "").toLowerCase().trim();
      const first = r.split(/\s+/)[0] || "";
      // Context-specific advice based on what the predictable run actually looks like.
      if (/^(the|a|an)\s/.test(r) && /(is|are|was|were)\s/.test(r)) return `"${run}" is a plain "X is Y" definition, the flattest possible shape. Try leading with the more surprising half, e.g. rework it so the specific detail comes first instead of the article.`;
      if (/(in order to|due to the fact|it is important|there are many|as a result)/.test(r)) return `"${run}" is filler scaffolding. Delete it and connect the two ideas directly; the sentence rarely needs the connective.`;
      if (/(and|but|or|so|then)\b/.test(r) && r.split(/\s+/).length <= 5) return `"${run}" chains clauses with a very common connector. Split it into two shorter sentences, or swap the connector for a more specific relationship (because, whereas, unless).`;
      if (/^(this|that|these|those|it|they)\b/.test(r)) return `"${run}" opens with a vague pronoun the model would predict. Name the actual thing it refers to so the opening is less guessable.`;
      if (r.split(/\s+/).length >= 6) return `"${run}" is a long predictable stretch. Break it up: cut it in half, or replace the middle with one concrete noun or figure the reader couldn't guess.`;
      return `"${run}" walks the path of maximum probability. If it's your own phrasing you likely don't need to change it, but to lower the signal, reorder the clause or replace the most expected word ("${first}") with a sharper one, rather than forcing in a fact that doesn't belong.`;
    }
  },
  emdash: {
    why: "Em dashes are a common AI trait, though humans use them too, so this counts only lightly.",
    fix: "Where possible, use a period or comma instead, or vary your punctuation."
  },
  colon: {
    why: "A colon followed by a capitalized clause ('Label: Sentence') is an AI punctuation habit.",
    fix: "Fold the label into the sentence, or use a period."
  },
  burst: {
    why: "Part of a uniform-length run. Even, metronomic cadence is an AI correlate.",
    fix: "Break the pattern: cut one sentence short and let the next run long."
  }
};

function remedyText(kind, matched) {
  const r = REMEDIES[kind];
  if (!r) return null;
  const fix = typeof r.fix === 'function' ? r.fix(matched) : r.fix;
  return { why: r.why, fix };
}

function splitSentences(t) { return t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(s => s.length > 0); }
const STARTERS = new Set(["The", "This", "These", "Those", "That", "Moreover", "Furthermore", "Additionally", "However", "Therefore", "Thus", "Consequently", "Nevertheless", "In", "It", "They", "Their", "A", "An", "As", "While", "Although", "Because", "Finally", "First", "Second", "Third", "Overall", "One", "Many", "Some", "Most"]);
function words(t) { return t.toLowerCase().match(/[a-z']+/g) || []; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

/* ====== ADVERSARIAL / OBFUSCATION PREPROCESSING (1.5) ====== */
const HOMOGLYPH_MAP = {
  // Cyrillic -> Latin
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
  'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'і': 'i', 'ј': 'j',
  'Ѕ': 'S', 'ѕ': 's',
  // Greek -> Latin
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'υ': 'u', 'ν': 'v', 'ι': 'i',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I',
  'Κ': 'K', 'Μ': 'M', 'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T',
  'Υ': 'Y', 'Χ': 'X',
  // Fullwidth Latin -> ASCII (a few common)
  'ａ': 'a', 'ｅ': 'e', 'ｏ': 'o'
};
const ZERO_WIDTH_RE = /[​‌‍‎‏⁠﻿­᠎]/g;
// paraphraser / spinbot signature markers: awkward thesaurus swaps + telltale connective substitutions
const PARAPHRASER_MARKERS = ["utilize", "utilise", "commence", "endeavour", "endeavor", "ascertain", "furthermore", "nevertheless", "henceforth", "thusly", "aforementioned", "whilst", "amongst", "hereby", "wherein", "notwithstanding", "in order to", "due to the fact that", "a large number of", "for the purpose of", "in the event that", "prior to", "subsequent to", "with regard to", "it is imperative", "plethora", "myriad of"];

/* Add a missing space after sentence-ending punctuation so run-together lines (common when the
   editor's newlines are lost) still split into separate sentences for the detector. Only fires on
   "word. Capital" patterns; protects decimals (10.1), initials (A.B.), and section refs (s19). */
const SENT_ABBR = new Set(["mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "eg", "ie", "no", "cf", "al", "inc", "ltd", "co", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);
function normalizeSentenceSpacing(text) {
  // Insert a space between "wordEnd.NextWord" where the stop clearly ends a sentence.
  return text.replace(/([A-Za-z]{2,})([.!?])([A-Z][a-z])/g, (m, word, punct, next) => {
    if (SENT_ABBR.has(word.toLowerCase())) return m; // don't split known abbreviations
    return word + punct + " " + next;
  });
}

function preprocess(raw) {
  const report = { homoglyphs: 0, zeroWidth: 0, paraphraser: [], changed: false, spacingFixes: 0 };
  // 1. strip zero-width / invisible
  const zw = raw.match(ZERO_WIDTH_RE);
  if (zw) report.zeroWidth = zw.length;
  let text = raw.replace(ZERO_WIDTH_RE, '');
  // 2. homoglyph -> ASCII
  let out = '';
  for (const ch of text) {
    if (HOMOGLYPH_MAP[ch]) { out += HOMOGLYPH_MAP[ch]; report.homoglyphs++; }
    else out += ch;
  }
  text = out;
  // 2b. fix missing space after full stops so run-together sentences split correctly
  const beforeSpacing = text;
  text = normalizeSentenceSpacing(text);
  if (text !== beforeSpacing) report.spacingFixes = 1;
  // 3. paraphraser signature scan (on cleaned text)
  const low = text.toLowerCase();
  const seen = new Set();
  PARAPHRASER_MARKERS.forEach(m => {
    if (low.includes(m) && !seen.has(m)) { seen.add(m); report.paraphraser.push(m); }
  });
  report.changed = report.homoglyphs > 0 || report.zeroWidth > 0;
  return { text, report };
}

/* ====== AI-TELL DATABASES ====== */
const AI_WORDS = new Set("delve delves delving tapestry tapestries multifaceted nuanced nuance landscape comprehensive comprehensively pivotal crucial crucially leverage leverages leveraging robust robustly streamline streamlined streamlines utilize utilizes utilizing utilization facilitate facilitates facilitating endeavor endeavors paramount unprecedented sophisticated sophistication salient efficacy cognizant camaraderie palpable fleeting amidst genuinely supercharge supercharged unleash unleashing democratize democratizing showcase showcases showcasing harness harnessing harnessed embark embarking foster fostering fosters spearhead spearheading navigate navigating navigates seamless seamlessly holistic holistically transformative transform transforms transforming intricate intricately vibrant myriad plethora realm realms underscore underscores underscoring underscored bolster bolsters bolstering elevate elevates elevating empower empowers empowering empowerment cultivate cultivating cultivates testament beacon intricacies interplay profound profoundly compelling compellingly notably moreover furthermore additionally consequently nevertheless ultimately meticulous meticulously invaluable indispensable commendable noteworthy versatile versatility dynamic dynamically innovative innovation cutting-edge pioneering groundbreaking remarkable remarkably essential essentially vital vitally significant significantly enhance enhances enhancing enhanced enhancement optimize optimizes optimizing optimal integral nurture nurturing resonate resonates resonating resonance cornerstone catalyst catalyze framework frameworks paradigm paradigms synergy synergize ecosystem trajectory trajectories spectrum nexus confluence juncture facet facets dimension dimensions manifold overarching underlying inherent inherently intrinsic intrinsically fundamental fundamentally quintessential epitome epitomize embodiment embody embodies embodying hallmark hallmarks plenitude abundance array arrays gamut continuum tenet tenets ethos zeitgeist milieu purview ambit aforementioned henceforth hitherto albeit whilst amongst thereby wherein whereby heretofore notwithstanding insofar ergo thusly conversely correspondingly accordingly subsequently ostensibly arguably undoubtedly invariably inevitably markedly decidedly appreciably substantially considerably exceedingly immensely tremendously abundantly manifestly evidently palpably discernibly perceptibly copious prolific ubiquitous ubiquity omnipresent pervasive prevalent widespread far-reaching wide-ranging all-encompassing multifarious heterogeneous variegated kaleidoscope mosaic amalgam amalgamation fusion synthesis interweave intertwine interwoven weave interconnected interconnectedness interdependence symbiosis symbiotic harmonious harmony equilibrium counterbalance juxtapose juxtaposition dichotomy dichotomies polarity duality contrast disparate divergent convergence converge coalesce culminate culmination manifest manifestation materialize crystallize galvanize invigorate rejuvenate revitalize reinvigorate amplify amplifies magnify intensify accentuate accentuates heighten augment augments augmenting augmentation propel propels propelling spur spurs fuel fuels ignite ignites kindle spark sparks sparking precipitate engender beget yield yields render renders afford affords confer confers bestow imbue imbues infuse infuses permeate permeates suffuse saturate encompass encompasses encompassing span spans traverse traverses transcend transcends transcending surpass surpasses eclipse outpace outweigh supersede delineate delineates elucidate elucidates illuminate illuminates illuminating clarify distill distills encapsulate encapsulates exemplify exemplifies exemplifying typify characterize characterizes underpin underpins underpinning substantiate corroborate validate affirm attest testify evince betoken signify signifies denote connote portend foreshadow herald usher augur behoove necessitate necessitates warrant warrants mandate entail entails predicate hinge hinges contingent predicated commensurate tantamount akin analogous comparable reminiscent evocative indicative emblematic symbolic representative illustrative demonstrative poignant stirring captivating enthralling mesmerizing riveting gripping spellbinding alluring enticing tantalizing beguiling intriguing fascinating persuasive cogent trenchant incisive astute perspicacious sagacious judicious prudent discerning perceptive insightful enlightening edifying instructive revelatory seminal landmark watershed defining formative foundational bedrock linchpin keystone backbone mainstay bulwark bastion stalwart steadfast resolute unwavering unflinching indomitable tenacious relentless dogged persistent enduring abiding perennial timeless lasting indelible monumental momentous consequential weighty gravity import significance magnitude scope breadth depth scale extent remit testament vista panorama optimise optimises optimising optimisation utilise utilises utilising utilisation organise organises organising emphasise emphasises emphasising recognise recognises recognising prioritise prioritises prioritising realise realises realising analyse analyses analysing characterise characterises summarise summarises maximise maximises minimise minimises specialise specialises revolutionise revolutionises standardise standardises legitimise legitimises catalyse catalyses behoves whilst learnt burnt spelt dreamt leapt favour favours favourable colour colours coloured behaviour behaviours behavioural honour honours honourable labour labours endeavour endeavours endeavouring neighbour neighbours flavour flavours rigour rigorous vigour vigorous fervour candour rumour rumours splendour centre centres central calibre fibre litre lustre metre theatre sceptre defence offence licence pretence practise practising programme programmes catalogue catalogues dialogue dialogues analogue travelled travelling traveller modelled modelling labelled labelling fuelled signalled counsellor jewellery enrolment fulfilment instalment skilful wilful".split(/\s+/).filter(Boolean));

const AI_PHRASES_DB = ["it is important to note", "it's important to note", "it is worth noting", "it's worth noting", "it is important to understand", "it is important to remember", "it is important to recognize", "it is essential to note", "it should be noted", "it is worth mentioning", "it bears mentioning", "one must consider", "it is crucial to understand", "needless to say", "it goes without saying", "suffice it to say", "at its core", "at the heart of", "at the end of the day", "when all is said and done", "in the grand scheme of things", "in the final analysis", "when it comes to", "with respect to", "in terms of", "in the context of", "in the realm of", "in the world of", "in the sphere of", "in the domain of", "in an era where", "in a world where", "in today's digital age", "in today's fast-paced world", "in today's modern world", "in today's society", "in modern society", "in recent years", "in this day and age", "now more than ever", "more than ever before", "this is particularly true", "this is especially true", "this holds true", "one might argue", "some might argue", "it could be argued", "it can be argued", "one could say", "it is often said", "many believe that", "experts agree that", "studies have shown", "research suggests", "research indicates", "evidence suggests", "it is widely believed", "it is commonly understood", "on the other hand", "on the contrary", "by the same token", "in much the same way", "in a similar vein", "along the same lines", "in a similar fashion", "by contrast", "in stark contrast", "conversely speaking", "that being said", "with that being said", "with that said", "having said that", "with that in mind", "keeping this in mind", "bearing this in mind", "in light of this", "in light of these", "given these points", "taking this into account", "taking all of this into consideration", "navigate the complexities", "navigating the complexities", "navigate the challenges", "navigating the landscape", "navigate the intricacies", "navigate this terrain", "a testament to", "stands as a testament", "serves as a testament", "shed light on", "sheds light on", "shedding light on", "shine a light on", "bring to light", "harness the power", "harness the potential", "harnessing the power", "unlock the potential", "unlocking the potential", "unleash the potential", "tap into the potential", "realize the full potential", "foster innovation", "foster a culture", "foster collaboration", "foster growth", "drive innovation", "drive engagement", "drive growth", "drive change", "drive results", "empower individuals", "empower people", "empower users", "empower communities", "resonate with", "resonates deeply", "strike a chord", "strike a balance", "walk a fine line", "tread carefully", "pave the way", "paving the way", "lay the groundwork", "set the stage", "open the door", "open the floodgates", "the building blocks", "a stepping stone", "a double-edged sword", "a slippery slope", "the tip of the iceberg", "a recipe for", "a perfect storm", "a beacon of", "a cornerstone of", "the backbone of", "the lifeblood of", "the driving force", "a catalyst for", "a gateway to", "a springboard for", "in conclusion", "to conclude", "in summary", "to summarize", "to sum up", "in closing", "to wrap up", "all things considered", "all in all", "in essence", "in a nutshell", "the bottom line", "the takeaway is", "key takeaways", "to recap", "let us recap", "first and foremost", "last but not least", "without a doubt", "make no mistake", "rest assured", "mark my words", "plays a crucial role", "plays a vital role", "plays a significant role", "plays a key role", "plays a pivotal role", "plays an important role", "plays a central role", "played a crucial role", "played a pivotal role", "a crucial role in", "a vital role in", "a key role in", "a combination of", "a wide range of", "a wide array of", "a broad spectrum of", "a diverse array of", "a multitude of", "a myriad of", "a plethora of", "an abundance of", "a vast array of", "a host of", "a variety of", "a significant burden", "a significant impact", "a profound impact", "a lasting impact", "a far-reaching impact", "a transformative impact", "widespread discontent", "widespread adoption", "fundamentally transformed", "fundamentally changed", "fundamentally altered", "radically transformed", "rich tapestry", "rich history", "rich tradition", "rich diversity", "rapidly evolving", "ever-evolving", "ever-changing", "constantly evolving", "fast-evolving", "an ever-evolving landscape", "the evolving landscape", "the changing landscape", "the broader landscape", "the digital landscape", "the modern landscape", "the competitive landscape", "the political landscape", "the cultural landscape", "stands as a", "serves as a", "acts as a", "functions as a", "stark reminder", "gentle reminder", "constant reminder", "powerful reminder", "sobering reminder", "paradigm shift", "seismic shift", "fundamental shift", "tectonic shift", "sea change", "game changer", "game-changing", "when we consider", "as we navigate", "as we delve", "as we explore", "as we embark", "as we move forward", "moving forward", "going forward", "looking ahead", "on the horizon", "in the foreseeable future", "for the foreseeable future", "leaves a lasting", "an indelible mark", "leave an indelible", "cannot be overstated", "cannot be understated", "cannot be ignored", "cannot be denied", "it cannot be denied", "more important than ever", "has never been more important", "has never been more critical", "has never been more relevant", "the importance of", "the significance of", "the value of", "the power of", "the role of", "the impact of", "the essence of", "the beauty of", "the magic of", "the art of", "the science of", "at the forefront", "on the cutting edge", "push the boundaries", "push the envelope", "break new ground", "raise the bar", "set a new standard", "redefine the", "reimagine the", "reshape the", "revolutionize the", "transform the way", "change the way we", "the way we think about", "when it comes down to it", "at its very core", "deeply rooted in", "grounded in", "rooted in tradition", "steeped in", "a wealth of", "a treasure trove", "a goldmine of", "a wellspring of", "a fountain of", "brimming with", "teeming with", "replete with", "awash with", "fraught with", "rife with", "laden with", "imbued with", "infused with", "suffused with", "characterized by", "defined by", "marked by", "distinguished by", "underpinned by", "driven by", "fueled by", "powered by", "anchored by", "bolstered by", "one of the most", "some of the most", "among the most", "arguably the most", "perhaps the most", "quite possibly the", "without question the", "by far the most", "in no small part", "to a great extent", "to a large degree", "in many respects", "in countless ways", "in myriad ways", "in profound ways", "time and time again", "again and again", "over and over", "day in and day out", "across the board", "on all fronts", "from all angles", "through the lens of", "through the prism of", "from the perspective of", "viewed through", "seen through", "when viewed through", "it serves to", "it works to", "it aims to", "it seeks to", "it strives to", "it endeavors to", "designed to", "intended to", "meant to", "poised to", "positioned to", "ready to", "equipped to", "well-positioned to", "in order to fully", "so as to", "with the aim of", "with the goal of", "for the purpose of", "in pursuit of", "in the pursuit of", "striking the right balance", "finding the right balance", "achieving the perfect balance", "walking the tightrope", "threading the needle", "the perfect blend", "the ideal combination", "a delicate balance", "a careful balance", "the intersection of", "at the crossroads of", "at the nexus of", "at the confluence of", "the marriage of", "the fusion of", "the synthesis of", "the convergence of", "not only that", "but also", "not just a", "not merely a", "more than just", "far more than", "nothing short of", "nothing less than"];

const PARTICIPIAL = "highlighting reflecting underscoring emphasizing showcasing demonstrating illustrating solidifying ensuring allowing enabling providing offering creating fostering paving marking signaling cementing reinforcing contributing representing embodying capturing yielding resulting leading driving prompting spurring sparking triggering facilitating promoting encouraging empowering equipping positioning bolstering strengthening enhancing amplifying accelerating catalyzing transforming reshaping redefining revolutionizing cultivating nurturing sustaining preserving safeguarding mitigating alleviating addressing tackling overcoming navigating balancing bridging aligning integrating unifying harmonizing streamlining optimizing maximizing leveraging harnessing unlocking unleashing propelling elevating setting laying building forging shaping molding carving weaving knitting binding anchoring grounding rooting establishing affirming validating confirming corroborating substantiating exemplifying epitomizing encapsulating symbolizing signifying denoting heralding ushering foreshadowing portending ranging spanning encompassing covering extending stretching reaching touching".split(/\s+/);

const AI_ADJ_NOUN = ["rich tapestry", "seamless integration", "holistic approach", "transformative impact", "vibrant community", "comprehensive overview", "comprehensive understanding", "comprehensive guide", "robust framework", "robust solution", "robust system", "intricate interplay", "profound impact", "profound effect", "compelling narrative", "compelling argument", "compelling case", "invaluable insights", "invaluable resource", "pivotal role", "pivotal moment", "crucial role", "crucial aspect", "vital role", "vital component", "significant impact", "significant role", "dynamic landscape", "dynamic environment", "innovative solutions", "innovative approach", "cutting-edge technology", "cutting-edge research", "unprecedented opportunity", "unprecedented access", "remarkable transformation", "remarkable journey", "powerful tool", "powerful reminder", "valuable resource", "valuable insights", "essential component", "essential element", "integral part", "integral role", "critical role", "critical importance", "fundamental shift", "fundamental aspect", "key factor", "key driver", "key takeaway", "key insight", "central role", "central theme", "driving force", "guiding principle", "underlying principle", "overarching theme", "broader context", "broader implications", "far-reaching consequences", "lasting legacy", "lasting impact", "enduring legacy", "meaningful impact", "meaningful change", "tangible benefits", "tangible results", "measurable impact", "sustainable growth", "sustainable future", "collective effort", "collective responsibility", "shared vision", "shared responsibility", "nuanced understanding", "deeper understanding", "greater appreciation", "newfound appreciation", "unique perspective", "fresh perspective", "valuable perspective", "diverse perspectives", "myriad ways", "countless ways", "endless possibilities", "limitless potential", "boundless opportunities", "vast potential", "immense potential", "untapped potential", "full potential", "true potential", "delicate balance", "careful balance", "intricate balance", "fine line", "thin line", "slippery slope", "double-edged sword", "perfect storm", "silver lining", "turning point", "tipping point", "focal point", "starting point", "vantage point", "common ground", "middle ground", "solid foundation", "strong foundation", "firm foundation"];

/* ====== common-English + academic frequency table for the perplexity proxy ====== */
const COMMON_UNIGRAMS = ("the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been has had said did get made find here thing great man world life still own under last right move thing general school never same another begin while number part turn real leave might want point form off child few small since against ask late home interest large person end open public follow during present without again hold govern around possible head consider word program problem however lead system set order eye plan run keep face fact group play stand increase early course change help line city put close case force meet once water upon war build hear light unite live every country bring center let side try provide continue name certain power pay result question study woman member until far night always service away report something company week church toward start social room figure nature though young less enough almost read include president nation side learn body although per call type job field word view full mean policy mother kind business private next fall important meaning develop without between sometimes whole point feel might able since within those base hand high believe sense matter mind country area money family student period need book stop word company several local feel money fact thing right need value house need community example level period money society process information statement understand experience economic government national education student political important development different period public movement national medical model design product market economy industry growth project growth research analysis evidence support method strategy structure relationship factor solution approach element function feature quality nature manner range scale degree extent amount measure cause effect impact influence pattern trend issue concern challenge opportunity benefit advantage limitation difference similarity comparison balance contrast variety category aspect characteristic property condition requirement standard principle theory concept idea notion assumption argument claim conclusion implication consequence outcome objective purpose goal aim intention reason motivation perspective viewpoint position attitude opinion belief judgment assessment evaluation interpretation observation description explanation definition distinction connection association combination integration distribution arrangement organization institution authority committee department division section category instance situation circumstance context environment background framework foundation basis ground premise context scope domain dimension boundary limit threshold criterion benchmark indicator variable parameter component constituent ingredient material substance object item unit entity individual organism creature species population sample subject participant respondent observer investigator researcher scholar expert specialist professional practitioner author writer reader audience public citizen resident inhabitant member colleague partner associate representative official administrator manager director leader founder pioneer innovator creator producer consumer customer client user provider supplier vendor stakeholder beneficiary recipient contributor participant collaborator competitor rival opponent ally advocate critic supporter opponent proponent skeptic believer follower adherent disciple successor predecessor ancestor descendant heir generation era period epoch century decade millennium phase stage step process procedure operation activity action task duty responsibility obligation commitment undertaking initiative effort attempt endeavor enterprise venture project mission campaign movement program scheme plan proposal strategy tactic technique method approach manner mode style fashion form format structure pattern design layout configuration arrangement composition organization system network web matrix grid hierarchy order sequence series chain cycle loop circuit flow stream current wave pulse rhythm tempo pace rate speed velocity momentum force pressure tension stress strain load weight mass volume density quantity number figure amount sum total aggregate whole portion fraction segment part piece component section division branch department unit module block chunk batch set group cluster collection assembly gathering crowd audience public mass population community society civilization culture tradition custom practice habit routine ritual ceremony celebration festival holiday occasion event incident episode affair matter issue topic subject theme motif element detail particular specific instance example case sample illustration demonstration representation depiction portrayal image picture scene view sight vision perception impression sensation feeling emotion mood sentiment passion desire wish hope dream aspiration ambition goal target objective purpose intention plan design scheme strategy approach solution answer response reply reaction feedback comment remark statement assertion claim argument point question inquiry investigation examination analysis study research experiment test trial assessment evaluation measurement calculation estimation approximation prediction forecast projection expectation anticipation assumption hypothesis theory model framework paradigm concept idea notion thought reflection consideration contemplation meditation deliberation reasoning logic rationale justification explanation interpretation understanding comprehension knowledge awareness consciousness recognition realization discovery finding result outcome consequence effect impact influence significance importance relevance value worth merit quality excellence superiority advantage benefit gain profit reward return yield output product result").split(/\s+/).filter(Boolean);

const ACADEMIC_WORDS = new Set(("factor factors social economic political financial economy society government people public opinion power class classes result results cause caused causes effect effects impact important significant role idea ideas system rigid hierarchy population crisis war wars tax taxation revolution monarchy nobility collapse change changed transform transformed combination multiple various several many influence influenced widespread discontent interconnected interrelated ultimately resulted exacerbated burden lower upper rising prices weak strong major key main reason reasons example examples evidence argument therefore however moreover furthermore additionally consequently thus overall conclusion summary issue issues problem problems solution solutions approach process development growth increase decrease level levels period time history modern century world country countries nation national international community individual individuals group groups structure function role purpose value values benefit benefits challenge challenges opportunity context environment condition conditions situation event events action actions response responsible policy policies measure measures resource resources knowledge information data analysis research study studies theory concept concepts principle method aspect element feature quality nature form type kind manner means terms regard relation relationship connection difference similarity comparison balance range scale degree extent amount number century democracy democratic empire imperial colonial colony independence freedom liberty equality justice rights citizen citizens constitution legislation legislature parliament congress senate assembly council court judicial executive sovereignty territory border region province state federal union republic regime dynasty reign emperor king queen ruler leadership administration bureaucracy institution agency authority jurisdiction governance reform reforms policy ideology philosophy doctrine principle theory movement uprising rebellion protest demonstration strike riot conflict tension dispute negotiation treaty alliance coalition diplomacy trade commerce industry agriculture manufacturing production labor labour workforce employment unemployment wage income wealth poverty inequality distribution capital investment market economy enterprise corporation business commerce finance banking currency inflation recession depression prosperity development industrialization urbanization globalization modernization technology innovation invention discovery progress advancement transformation transition shift movement migration immigration emigration settlement colonization expansion conquest invasion occupation liberation independence revolution evolution adaptation").split(/\s+/));

const EXTRA_WORDS = ("ability able about above accept access accident accompany accomplish account accurate achieve acid acquire across act active activity actual actually add address adequate adjust admit adult advance advice affair afford afraid afternoon age agency agent ago agree agreement ahead air airline alive allow almost alone along already alright also although always amazing among amount ancient anger angle angry animal announce annual answer anxiety anybody anymore anyone anything anyway anywhere apart apartment apparent appeal appear apple apply appoint appreciate approach appropriate approval approve area argue arise arm army arrange arrest arrive art article artist aside aspect assist assume assure athlete atmosphere attach attack attempt attend attention attitude attract attractive audience author authority available average avoid awake award aware awful baby background bad bag balance ball band bank bar bare barely barrier base baseball basic basis basket bath bathroom battle beach bear beat beautiful beauty bed bedroom beer before begin beginning behavior behind being belief believe bell belong below belt bench bend beneath benefit beside besides best bet better beyond bicycle bid big bike bill billion bind biology bird birth birthday bit bite bitter black blade blame blank blanket blind block blood blow blue board boat body boil bomb bond bone bonus book boom boot border bore boring born borrow boss both bother bottle bottom bounce bound bowl box boy brain branch brand brave bread break breakfast breast breath breathe breed brick bridge brief bright brilliant bring broad broken brother brown brush budget build building bullet bunch burden burn burst bury bus bush business busy butter button buy cabin cabinet cable cake calculate call calm camera camp campaign campus can cancel cancer candidate candle candy capable capacity capital captain capture car carbon card care career careful careless cargo carpet carry cart case cash cast castle casual cat catch category cattle cause caution cave cell cent center central century ceremony certain certainly chain chair challenge chamber champion chance change channel chaos chapter character charge charity charm chart chase cheap cheat check cheek cheese chemical chemistry chest chicken chief child childhood chip chocolate choice choose chop chronic church cigarette circle circuit circumstance cite citizen city civil civilian claim class classic classroom clean clear clerk clever click client cliff climate climb clinic clock close closet cloth clothes cloud club clue cluster coach coal coast coat code coffee cognitive coin cold collapse collar colleague collect college colony color column combat combine come comfort comfortable command comment commercial commission commit commitment committee common communicate community company compare compete competition complain complaint complete complex complicate component compose comprehensive compromise computer concentrate concept concern conclude concrete condition conduct conference confidence confident confirm conflict confront confuse congress connect conscious consensus consent consequence conservative consider consist constant constitute construct consult consume consumer contact contain container contemporary content contest context continue contract contrast contribute control controversy convention conversation convert convince cook cookie cool cooperate cope copy core corn corner corporate correct cost cottage cotton couch council counsel count counter country county couple courage course court cousin cover cow crack craft crash crazy cream create creature credit crew crime criminal crisis criteria critic critical criticism crop cross crowd crucial crude cruel crush cry crystal cultural culture cup curious current curtain curve custom customer cut cycle dad daily damage dance danger dangerous dare dark data date daughter dawn day dead deadline deal dealer dear death debate debt decade decide decision deck declare decline decorate decrease deep deeply deer defeat defend defense deficit define definitely definition degree delay deliberate delicate deliver delivery demand democracy democratic demonstrate deny depart department depend dependent depict deposit depression depth deputy derive describe desert deserve design designer desire desk desperate despite destroy destruction detail detailed detect determine develop device devote diagnose dialogue diamond diary die diet differ difference different difficult difficulty dig digital dignity dimension dining dinner direct direction director dirt dirty disability disagree disappear disaster discipline disclose discount discover discovery discuss discussion disease dish dismiss disorder display dispute distance distant distinct distinguish distribute district disturb dive diverse divide division divorce doctor document dog domestic dominant dominate door dose dot double doubt down downtown dozen draft drag drama dramatic draw drawer drawing dream dress drift drink drive driver drop drought drug drum drunk dry duck due dull dump during dust duty dwell dying dynamic eager ear early earn earnings earth ease easily east eastern easy eat economic economics economist economy edge edit edition editor educate education educational effect effective efficiency efficient effort egg eight either elaborate elbow elder elderly elect election electric electrical electricity electronic element elementary eliminate elite else elsewhere email embarrass embrace emerge emergency emission emotion emotional emphasis emphasize empire employ employee employer employment empty enable encounter encourage end enemy energy enforce engage engagement engine engineer engineering enhance enjoy enormous enough ensure enter enterprise entertain entire entirely entitle entity entrance entry envelope environment environmental episode equal equally equation equipment equivalent era error escape especially essay essence essential establish estate estimate ethics ethnic evaluate evaluation even evening event eventually ever every everybody everyday everyone everything everywhere evidence evil evolve exact exactly examine example exceed excellent except exception exchange excited exciting exclude excuse execute executive exercise exhaust exhibit exist existence exit expand expansion expect expectation expense expensive experience experiment expert explain explanation explode explore explosion expose exposure express expression extend extension extensive extent external extra extraordinary extreme extremely eye fabric face facility fact factor factory fade fail failure faint fair fairly faith fall false fame familiar family famous fan fancy fantasy far farm farmer fashion fast fat fate father fault favor favorite fear feather feature federal fee feed feel feeling fellow female fence festival fetch fever few fewer fiber fiction field fierce fifteen fifth fifty fight figure file fill film filter final finally finance financial find fine finger finish fire firm fish fit fitness fix flag flame flash flat flavor flee flesh flight float flood floor flour flow flower fluid fly focus fold folk follow food fool foot football force foreign forest forever forget forgive fork form formal format formation former formula fort forth fortune forward found foundation founder fountain four fourth frame framework frank free freedom freeze frequency frequent fresh friend friendly friendship frighten front frozen fruit frustrate fuel fulfill full fun function fund fundamental funding funeral funny furniture furthermore future gain galaxy gallery game gang gap garage garden garlic gas gate gather gay gaze gear gender gene general generate generation generous genetic genius genre gentle gentleman genuine gesture ghost giant gift gifted girl give glad glance glass global globe glory glove glow goal goat god gold golden golf good goods govern government governor grab grace grade gradual graduate grain grand grandfather grandmother grant grape graph grasp grass grateful grave gravity gray great green greet grey grief grin grip grocery gross ground group grow growth guarantee guard guess guest guide guideline guilt guilty guitar gun guy habit hair half hall hand handful handle hang happen happy harbor hard hardly harm harsh harvest hat hate haul have hay hazard head headache headline headquarters heal health healthy heap hear heart heat heaven heavily heavy heel height hell hello helmet help helpful hence herb here heritage hero hesitate hidden hide high highlight highly highway hill hint hip hire historian historic historical history hit hobby hockey hold hole holiday hollow holy home homeless honest honey honor hope horizon horn horror horse hospital host hostage hostile hot hotel hour house household housing however huge human humble humor hundred hunger hungry hunt hunter hurry hurt husband hut hypothesis ice icon idea ideal identical identify identity ideology idle ignore ill illegal illness illustrate image imagine immediate immediately immigrant immigration impact implement implication imply import importance important impose impossible impress impression impressive improve improvement impulse incentive incident include income incorporate increase increasingly incredible indeed independence independent index indicate indication individual industrial industry inevitable infant infection inflation influence inform information ingredient initial initially initiative injury inner innocent innovation input inquiry inside insight insist inspire install instance instant instead institute institution instruct instruction instructor instrument insult insurance intact integrate integrity intellectual intelligence intelligent intend intense intensity intention interaction interest interesting interior internal international internet interpret interpretation interrupt interval intervention interview intimate introduce introduction invade invasion invent invest investigate investigation investment investor invite involve involved involvement iron ironic island isolate issue item jacket jail jar jaw jazz jeans jet jewelry job join joint joke journal journalist journey joy judge judgment juice jump junior jury just justice justify keen keep key keyboard kick kid kill killer kilometer kind king kingdom kiss kitchen knee kneel knife knock knot know knowledge lab label labor laboratory lack ladder lady lake land landscape lane language lap large largely laser last late later latter laugh launch laundry law lawn lawsuit lawyer lay layer layout lazy lead leader leadership leaf league lean leap learn lease least leather leave lecture left leg legacy legal legend legislation legislative legitimate leisure lemon lend length lens less lesson let letter level liberal liberty library license lid lie life lifestyle lifetime lift light like likely limit limited line link lip liquid list listen literally literary literature little live lively liver living load loan lobby local locate location lock logic logical lonely long look loop loose lord lose loss lost lot loud love lovely lover low lower loyal luck lucky lunch lung luxury machine mad magazine magic magnitude mail main mainly maintain maintenance major majority make maker male mall man manage management manager mandate manner manual manufacture manufacturer many map marathon marble march margin marine mark market marriage married marry mask mass massive master match mate material math mathematics matter mature maximum maybe mayor meal mean meaning meaningful means meanwhile measure meat mechanism medal media medical medication medicine medium meet meeting member membership memory mental mention menu mere merely merge merit mess message metal method middle midnight might mild mile military milk mill million mind mine mineral minimal minimize minimum minister minor minority minute miracle mirror miss missile mission mistake mix mixture mobile mode model moderate modern modest modify mom moment momentum money monitor monkey month monthly mood moon moral more moreover morning mortgage most mostly mother motion motivate motivation motor mount mountain mouse mouth move movement movie much mud multiple murder muscle museum music musical musician must mutual mystery myth nail naked name narrative narrow nation national native natural naturally nature navy near nearby nearly neat necessarily necessary neck need needle negative neglect negotiate negotiation neighbor neighborhood neither nerve nervous nest net network neutral never nevertheless new newly news newspaper next nice night nightmare nine nobody nod noise nominee none nonetheless noon nor normal normally north northern nose note notebook nothing notice notion novel now nowhere nuclear number numerous nurse nut object objective obligation observation observe observer obtain obvious obviously occasion occasionally occupation occupy occur ocean odd odds offense offensive offer office officer official often oil okay old olympic once one ongoing onion online only onto open opening operate operation operator opinion opponent opportunity oppose opposite opposition opt option orange order ordinary organ organic organization organize orientation origin original originally other otherwise ought outcome outdoor outline output outside outstanding oven over overall overcome overlook overnight overseas overwhelm owe own owner ownership pace pack package page pain painful paint painter painting pair palace pale palm pan panel panic pant paper parade parent park parking part participant participate participation particular particularly partly partner partnership party pass passage passenger passion passive past pasta paste pat patch path patience patient pattern pause pay payment peace peaceful peak peanut pear pen penalty pencil pension people pepper per perceive percentage perception perfect perfectly perform performance perhaps period permanent permission permit person personal personality personally personnel perspective persuade pet phase phenomenon philosophy phone photo photograph photographer phrase physical physically physician physics piano pick picture pie piece pile pill pillow pilot pin pine pink pioneer pipe pit pitch pity place plain plan plane planet plant plastic plate platform play player playoff plea pleasant please pleasure plenty plot plus pocket poem poet poetry point poison pole police policy political politically politician politics poll pollution pool poor pop popular population porch port portion portrait portray pose position positive possess possibility possible possibly post poster pot potato potential potentially pottery pound pour poverty powder power powerful practical practice praise pray prayer preach precise precisely predator predict prediction prefer preference pregnancy pregnant preparation prepare presence present presentation preserve president presidential press pressure pretend pretty prevent previous previously price pride priest primarily primary prime principal principle print prior priority prison prisoner privacy private privilege prize probably problem procedure proceed process produce producer product production profession professional professor profile profit profound program progress prohibit project prominent promise promote prompt proof proper properly property proportion proposal propose proposed prosecutor prospect protect protection protein protest proud prove provide provider province provision provoke psychological psychology public publication publish publisher pull pulse pump punch punish punishment pupil purchase pure purple purpose pursue push put puzzle qualify quality quantity quarter queen quest question quick quickly quiet quietly quit quite quote race racial rack radar radiation radical radio rage raid rail railroad rain raise rally random range rank rapid rapidly rare rarely rate rather rating ratio rational raw ray reach react reaction read reader reading ready real reality realize really realm rear reason reasonable rebel recall receive recent recently reception recipe recipient recognition recognize recommend recommendation record recording recover recovery recruit reduce reduction refer reference reflect reflection reform refugee refuse regard regardless regime region regional register regret regular regularly regulate regulation reinforce reject relate relation relationship relative relatively relax release relevant reliable relief religion religious reluctant rely remain remaining remark remarkable remember remind remote removal remove render renew rent repair repeat repeatedly replace replacement reply report reporter represent representation representative reproduce republic reputation request require requirement rescue research researcher resemble reserve resident resign resist resistance resolution resolve resort resource respect respond response responsibility responsible rest restaurant restore restrict restriction result resume retail retain retire retirement retreat return reveal revenue reverse review revise revolution reward rhythm rice rich rid ride rider ridiculous rifle right rigid ring riot rip rise risk ritual rival river road rob robot rock rocket role roll roman romance romantic roof room root rope rose rough roughly round route routine row royal rub rubber rude ruin rule ruling rumor run runner running rural rush sacred sacrifice sad safe safety sail sailor sake salad salary sale sales salt sample sand satellite satisfaction satisfy sauce save saving scale scan scandal scared scary scatter scenario scene scent schedule scheme scholar scholarship school science scientific scientist scope score scratch scream screen script sea seal search season seat second secondary secret secretary section sector secure security see seed seek seem segment seize seldom select selection self sell senate senator send senior sense sensitive sentence separate sequence series serious seriously servant serve service session set setting settle settlement seven several severe sex sexual shade shadow shake shall shallow shame shape share sharp she shed sheep sheer sheet shelf shell shelter shift shine ship shirt shock shoe shoot shop shopping shore short shortly shot should shoulder shout show shower shrink shrug shut shy sibling sick side sidewalk sigh sight sign signal significance significant significantly silence silent silk silly silver similar similarly simple simply sin since sing singer single sink sir sister sit site situation six size ski skill skilled skin skip skirt sky slave sleep slice slide slight slightly slip slope slow slowly small smart smell smile smoke smooth snake snap snow so soak soap soccer social society sock soft software soil solar soldier sole solid solution solve some somebody somehow someone something sometimes somewhat somewhere son song soon sophisticated sorry sort soul sound soup source south southern space span spare spark speak speaker special specialist species specific specifically specify speech speed spell spend sphere spill spin spirit spiritual spit split spoil sponsor sport spot spouse spray spread spring sprint spy square squeeze stab stable stack staff stage stair stake stamp stance stand standard star stare start starve state statement station statistics status stay steady steal steam steel steep steer stem step stick stiff still stimulate stir stock stomach stone stop storage store storm story stove straight strain strange stranger strategic strategy stream street strength strengthen stress stretch strict strike string strip stroke strong strongly structure struggle student studio study stuff stumble stupid style subject submit subscribe subsequent substance substantial substitute subtle suburb succeed success successful successfully such sudden suddenly suffer sufficient sugar suggest suggestion suit suitable suite sum summary summer summit sun super superior supply support supporter suppose supreme sure surely surface surgeon surgery surplus surprise surprised surprising surround survey survival survive survivor suspect suspend suspicion sustain swallow swear sweat sweep sweet swell swim swing switch symbol symptom system table tackle tactic tag tail take tale talent talk tall tank tap tape target task taste tax taxi tea teach teacher teaching team tear technical technique technology teenager telephone telescope television tell temperature temporary tempt ten tend tendency tension tent term terms terrible terrify territory terror test testify testimony text textbook texture than thank thanks theater theft theme then theory therapy there therefore thick thin thing think thinking third thirty this thorough thought thousand thread threat threaten three threshold thrive throat through throughout throw thumb thus ticket tide tie tight time tiny tip tire tired tissue title toast tobacco today toe together toilet token tolerate toll tomato tomorrow tone tongue tonight too tool tooth top topic torture toss total totally touch tough tour tourist tournament toward towel tower town toxic toy trace track trade tradition traditional traffic tragedy tragic trail train trainer training trait transfer transform transformation transit transition translate transmit transport trap travel tray treasure treat treatment treaty tree tremendous trend trial tribe trick trigger trip triumph troop trouble truck true truly trust truth try tube tumor tune tunnel turn tutor twelve twenty twice twin twist two type typical typically tyranny ugly ultimate ultimately umbrella unable uncertain uncle uncover under undergo undergraduate underground underlying understand understanding undertake unemployment unexpected unfair unfold unfortunately uniform union unique unit unite unity universal universe university unknown unless unlike unlikely unprecedented until unusual unveil upcoming update upgrade upon upper upset upstairs upward urban urge urgent usage use useful user usual usually utility utilize vacation vaccine vacuum vague valid valley valuable value van vanish variable variation variety various vary vast vegetable vehicle venture venue verbal verdict verse version versus vertical very vessel veteran via victim victory video view viewer village violate violation violence violent virtual virtually virtue virus visible vision visit visitor visual vital vitamin vivid vocal voice volume voluntary volunteer vote voter voyage vulnerable wage wagon wait wake walk wall wander want war ward warehouse warfare warm warmth warn warning warrior wash waste watch water wave wax way weak weakness wealth wealthy weapon wear weather weave web wedding week weekend weekly weigh weight weird welcome welfare well west western wet whale what whatever wheat wheel when whenever where whereas wherever whether which while whip whisper white who whole whom whose why wide widely widespread widow width wife wild wilderness wildlife will willing win wind window wine wing winner winter wipe wire wisdom wise wish withdraw within without witness woman wonder wonderful wood wooden wool word work worker workforce workplace workshop world worldwide worried worry worse worship worst worth worthy would wound wrap wrist write writer writing wrong yard yeah year yell yellow yes yesterday yet yield young youngster youth zone").split(/\s+/);

const MORE_WORDS = ("abandon abbey abdomen abide abolish abortion abrupt absence absent absolute absorb abstract absurd abundant abuse academy accelerate accent acceptance acclaim accommodate accordance accountant accumulate accuracy accusation accuse ache acknowledge acne acoustic acre activate activist actor actress acute adapt addiction additional adhere adjacent adjective administer admiration admire admission adolescent adopt adoption adore adorn adrift advent adventure adverb adversary adverse advertise adviser advocate aesthetic affection affiliate affirm affluent aftermath afterward agenda aggravate aggregate aggression aggressive agile agitate agony aide ailment aircraft aisle alarm album alcohol alert algebra algorithm alias alibi alien align allege allegiance allergy alley alliance allocate allotment ally almond aloft aloud alphabet altar alter alteration alternate alternative altitude altogether aluminum amateur ambassador ambient ambiguous ambition ambitious ambulance ambush amend amendment amenity amid ammonia amnesty amour ample amplify amuse anatomy ancestor anchor anecdote angel angelic anguish ankle annex annihilate anniversary annotate announcement annoy annoyance anonymous antagonist anthem anthropology antibiotic anticipate antibody antidote antique antiquity antler anxious apathy aperture apex aplomb apology apostle apparatus apparel appendix appetite applaud applause appliance applicant appraisal appraise apprentice apron aptitude aquarium aqueduct arbitrary arbiter arcade arch archaeology archaic archery architect architecture archive arctic ardent arduous arena arid aristocrat arithmetic armor aroma array arrears arrogant arsenal arson artery arthritis artifact artillery artisan ascend ascent ascertain ashamed ashore aspiration aspire assassin assault assemble assert assertion asset assign assignment assimilate assistance assistant associate assorted assumption asterisk asteroid asthma astonish astound astray astronaut astronomy asylum atom atomic atrium atrocious atrophy attain attainment attic attire attorney attribute auction audacious audible audit auditor augment auspicious austere authentic authorize autism autograph automate automatic automobile autonomy autumn auxiliary avail availability avalanche avenue aviation avid avocado await awe awkward axis axle azure babble bachelor backbone backdrop backpack backward bacon bacteria badge baffle baggage bait bakery balcony bald ballad ballet balloon ballot bamboo banal bandage bandit banish banister banker bankrupt banner banquet baptism barbarian barber bargain barge baritone barley barn barometer baron barracks barrel barren barricade barrister barter basement bashful basil basin bask bassoon baste bastion batch bate baton batter battery bazaar beacon beaker beam beard bearer beast beaver beckon bedlam bedrock beehive beetle befall befit befriend beget beggar beguile behalf behold belated beleaguer belfry belittle bellow belly beloved bemoan beverage bewilder bias bibliography biceps bicker bigot bile bilingual binary binoculars biography biopsy birch biscuit bishop bison bizarre blackmail blacksmith bladder blanch bland blare blaspheme blaze bleach bleak blemish blend bless blight blink bliss blister blizzard bloat blob bloc blockade blockage blond blossom blot blouse blueprint bluff blunder blunt blur blurt blush bluster boardwalk boast bobbin bodice bog bogus boisterous bondage bonfire boon boost booth booty botany botch bough boulder boulevard bountiful bounty boutique bovine boycott bracket braid brake bramble bran brandish brash brassy bravado brawl brawn brazen breach breaker breakthrough breakwater bream brethren brevity brewery briar bribe brigade brigand brilliance brim brine bristle brittle broach brocade broil broker bronchitis bronze brooch brood brook broom broth brothel browse bruise brunch brunt brusque brutal brute bubble buckle bucolic buddy budge buffalo buffer buffet bugle bulb bulge bulk bulldoze bullion bullock bully bulwark bumper bumpkin bundle bungalow bungle bunker bunny buoy buoyant burden bureau bureaucrat burgeon burglar burial burlap burly burnish burrow bursar bustle butcher butler buttress buzzard cabaret cabbage caboose cache cackle cadence cadet cafe cafeteria caffeine cage cajole calamity calcium calculus caldron calendar caliber calligraphy callous calorie camouflage canal canary cancellation candid candidacy candied cane canine canister cannon canny canoe canon canopy cantankerous canteen canvas canyon capacity cape caper capillary capitalist capitulate capricious capsize capsule caption captivate caravan carbohydrate carcass cardiac cardinal cardiology caress caretaker caricature carnage carnival carnivore carol carouse carpenter carriage carrion carton cartoon cartridge cascade casino casket cassette caste castigate casualty cataclysm catalog catapult cataract catastrophe catchy categorize cater caterpillar cathedral cathode cauldron cauliflower causeway caustic cauterize cautious cavalier cavalry cavern cavity cease cedar cede celebrate celebrity celery celestial celibate cellar cellular cement cemetery censor censure census centennial centigrade centipede centralize ceramic cereal cerebral certificate certify cessation chafe chagrin chalice chalk chamber chameleon champagne chancellor chandelier chaplain charade charcoal charisma charitable charlatan charter chasm chaste chateau chauffeur cheddar cheer cherish cherub chess chestnut chevron chic chide chili chime chimney chimp chink chirp chisel chivalry chlorine choir choke choleric chord chore choreography chorus chowder chrome chromosome chronicle chrysalis chubby chuckle chunk churn cinch cinder cinema cinnamon cipher circa circuitous circulate circumference circumvent cistern citadel citation civic clad clairvoyant clamber clammy clamor clamp clandestine clang clank clarify clarity clash clasp classify clatter clause claustrophobia clavicle cleanse cleaver clemency clench clergy cleric clerical cliche clientele climactic clinch clinical clip clique cloak clobber clockwise clod clog cloister clone closure clot cloture clove clover clown cloying cluck clump clumsy clung cluster clutch clutter coalition coarse coax cobalt cobble cobra cocaine cocoa cocoon coddle codify coerce coercion coexist cogent cogitate cognac cognition cognizant cohabit cohere cohesion cohort coil coincide coincidence coliseum collaborate collage collateral collegiate collide collie colloquial collude cologne colonel colonnade colossal colt comatose combatant combustible combustion comedian comely comet comical comma commemorate commence commencement commend commensurate commentary commiserate commissar commodity commonplace commonwealth commotion communal commune communiqu commute companion comparable comparative compartment compassion compatible compel compendium compensate competent competitive compile complacent complement complexity compliance complicit compliment comply comportment composite composure compound comprehend compress comprise comptroller compulsion compulsory compunction computation comrade concave conceal concede conceit conceive concentric conception concerto concession conch conciliate concise conclave conclusive concoct concord concourse concur concurrent concuss condemn condense condescend condiment condolence condone conducive conductor conduit confection confederate confer confess confetti confidant configuration confine confiscate conflagration conform confound congeal congenial congenital congest conglomerate congratulate congregate conjecture conjugate conjunction conjure connive connoisseur connotation conquer conquest conscience conscientious conscript consecrate consecutive consent consequential conservatory considerable consign console consolidate consonant consort conspicuous conspiracy constable constellation consternation constituent constrain constraint constrict construe consul consummate contagion contagious contaminate contemplate contempt contend contender contentious contiguous continental contingency contortion contraband contraception contraction contractor contraption contrary contravene contribution contrite contrive controller controversial conundrum convalesce convene convenient convent convention converge conversant converse convex convey conveyance convict conviction convivial convoke convoluted convoy convulse cookery coop cooperative coordinate copious copper copyright cordial cordon corduroy cornea cornice cornucopia corollary coronary coronation coroner corporal corpse corpulent corral correlate correspond corridor corroborate corrode corrosion corrugate corrupt corruption corsage cortex cosmetic cosmic cosmopolitan costume cosy coterie cottage cougar council counsel countdown countenance counteract counterfeit counterpart countess countless countryside coup couple coupon courier courteous courtesy courtier courtship covenant cover covert covet cower coy cozy crab cradle craft crafty crag cram cramp cranberry crane cranium crank cranny crater cravat crave craven crawl crayon craze creak creamery crease creator credential credible credo creed creek creep cremate crepe crescendo crescent crest crestfallen crevice crewman cribbage cricket crimp crimson cringe crinkle cripple crisp criterion croak crochet crockery crocodile crone crony crook croon crop croquet crossroad crouch crow crucible crucifix crude cruise crumb crumble crumple crunch crusade crust crutch crux crypt cryptic crystallize cubicle cuckoo cucumber cuddle cudgel cuff cuisine culinary cull culminate culvert cumbersome cumulative cunning curate curator curb curdle cure curfew curio curiosity curl currant currency curriculum curse cursive cursory curt curtail cushion cuspid custard custodian customary cutlass cutlery cutter cyanide cyclic cyclone cylinder cymbal cynic cynical cypress dabble daffodil dagger dainty dairy daisy dale dam damask damp damsel dandelion dandy dapper dappled darn dart dashboard dastardly daub daunt dauntless dawdle daze dazzle deacon deadlock deaf dean dearth debacle debark debase debilitate debonair debris debunk debut decade decadent decanter decapitate decay deceased deceit deceive decelerate decency decent decentralize deception decibel deciduous decimal decipher decisive declaim declamation declension decode decompose decor decorum decoy decree decrepit decry dedicate deduce deduct deed deem deface defame default defeatist defecate defect defendant defer deference defiance deficient defile definitive deflate deflect deform defraud deft defunct defuse defy degenerate degrade dehydrate deify deign deity dejected delectable delegate delete deleterious deliberate delineate delinquent delirious deliverance dell delta delude deluge delusion deluxe demagogue demarcate demean demeanor demented demise demobilize democrat demolish demon demoralize demote demur den denigrate denim denizen denominator denote denounce dense dental dentist denude denunciation deodorant depart departure dependent depict deplete deplorable deplore deploy deport depose depot deprave deprecate depreciate depredation deprivation deprive deputize deputy deranged derelict deride derision derivative derogatory descend descendant descent descry desecrate desert desiccate designate designation desist desolate despair desperado despicable despise despoil despondent despot dessert destination destine destitute detain detect detection detective detente detention detergent deteriorate determinate deterrent detest detonate detour detoxify detract detriment devastate deviate device devious devise devoid devotee devour devout dexterity diabetes diabolic diadem diagnose diagonal diagram dial dialect diameter diaphragm diatribe dictate dictator diction dictionary dictum didactic diesel dietary differentiate diffident diffuse digest digestion digit dignify dignitary digress dilapidated dilate dilemma diligent dilute dimension diminish diminutive dimple dingy dinosaur diocese dioxide diphtheria diploma diplomat dire directive dirge dirigible disable disagreeable disallow disarm disarray disaster disavow disband disbelief disburse discard discern discharge disciple disciplinarian disclaim disclose discolor discomfit disconcert disconnect disconsolate discontent discontinue discord discount discourage discourse discourteous discredit discrepancy discrete discretion discriminate discus disdain disembark disenchant disengage disfigure disgrace disgruntle disguise disgust dishearten dishevel dishonest disillusion disinfect disinherit disintegrate disinterested disjointed dislocate dislodge dismal dismantle dismay dismember disobedient disorder disorganize disorient disown disparage disparate dispassionate dispatch dispel dispensary dispense disperse displace displease disposable disposal disposition dispossess disprove dispute disqualify disquiet disregard disrepair disreputable disrespect disrobe disrupt dissatisfy dissect dissemble disseminate dissension dissent dissertation disservice dissident dissimilar dissipate dissociate dissolute dissolve dissonance dissuade distend distill distinction distort distract distraught distress distrust disturbance disunity disuse ditch dither diurnal diva diverge diversify diversion divert divest divine divisive divulge dizzy docile dock docket doctorate doctrine document dodge doe doff dogma dogmatic doily doldrums dole doleful dolphin domain dome domesticate domicile dominion donate donor doodle doom doormat dormant dormitory dosage dossier dote dour dovetail dowager dowdy dowel dower dowry doze drab draconian drainage drake drape drastic drawl drawn dread dreary dredge dregs drench dribble drift drill drivel drizzle droll drone droop dropout drought drove drowsy drudgery drupe dual dubious duchess ductile dude duel duet duffel dulcet dumbfound dummy dune dungeon duo dupe duplex duplicate duplicity durable duration duress dusk dutiful dwarf dwell dwindle dyad dye dynamo dynasty dyslexia eagle earnest earthen earthly earthquake easel eastward eatery eaves ebb ebony eccentric ecclesiastical echelon eclectic eclipse ecology economical ecosystem ecstasy ecumenical eddy edible edict edifice edify editorial educator eerie efface effervescent effigy effortless effrontery effusive egalitarian egotist egregious egress eject elaborate elapse elastic elated elder elect electorate electrify electrocute electrode electron elegant elegy element elephant elevate elevation elevator elicit eligible eliminate elite elixir elliptical elocution elongate elope eloquent elucidate elude elusive emaciate emanate emancipate embalm embankment embargo embarkation embassy embed embellish ember embezzle embitter emblazon emblem embodiment emboss embrace embroider embroil embryo emcee emend emerald emergent emeritus emery emigrant eminence eminent emissary emit emollient emotive empathy emperor emphatic empirical emporium emulate enable enact enamel encampment encase enchant enclave enclose encode encompass encore encroach encumber encyclopedia endanger endear endeavor endemic endorse endow endowment endurance enervate enforce enfranchise engender engrave engross engulf enhance enigma enjoin enlighten enlist enliven enmity ennoble ennui enormity enrapture enrich enroll ensemble enshrine enslave ensnare ensue ensure entail entangle enterprise entertain enthrall enthuse entice entirety entitle entity entomb entourage entrant entreat entrench entrepreneur entrust entwine enumerate enunciate envelop enviable envious environs envision envoy enzyme epaulet ephemeral epic epicenter epidemic epigram epilepsy epilogue episode epistle epitaph epithet epitome epoch equanimity equate equator equestrian equilateral equilibrium equine equinox equip equitable equity equivocal eradicate erase erect ermine erode erosion erotic err errand errant erratic erroneous erudite erupt eruption escalate escapade escarpment eschew escort esoteric espionage espouse essence establishment esteem estimable estrange estuary etch eternal eternity ether ethereal ethical ethnicity ethos etiquette etymology eucalyptus eugenics eulogy euphemism euphony euphoria evacuate evade evaluate evanescent evangelist evaporate evasion eventful eventual evergreen everlasting evict evidently evince eviscerate evoke evolution evolve ewe exacerbate exacting exalt examination exasperate excavate exceedingly excel excellence excerpt excessive exchequer excise exclaim exclamation exclusive excommunicate excrement excruciating exculpate excursion excusable execrable execute executor exemplary exemplify exempt exemption exertion exhale exhaust exhaustive exhilarate exhort exhume exigent exile exodus exonerate exorbitant exorcise exotic expanse expatriate expedient expedite expedition expel expend expenditure experiential experimental expire explicable explicit exploit exploration exponent exposition expostulate exposure expound expulsion expunge expurgate exquisite extant extemporaneous extenuate exterior exterminate extinct extinguish extol extort extract extracurricular extradite extraneous extrapolate extravagant extricate extrinsic extrovert extrude exuberant exude exult fable fabricate facade facet facetious facile facilitate facsimile faction factual faculty faddish fahrenheit failsafe fairway fallacy fallible fallow falsify falter familial famine fanatic fanciful fanfare farce farcical farewell farmstead farsighted fascinate fascism fastidious fatal fatalism fathom fatigue fatuous fauna faux fawn faze fealty feasible feat feather feckless fecund federation feeble feign feint feisty felicity feline fell fellowship felon felony feminine fend feral ferment ferocious ferret ferrous ferry fertile fervent fervid fervor fester festive festoon fete fetid fetish fetter feud feudal fiasco fiat fickle fictitious fidelity fidget fiduciary fiend fiendish fiery fiesta figment figurative figurehead filament filch filial filibuster filigree filly finale financier finch finesse finite firearm firefly firmament fiscal fissure fixate fixture fjord flabbergast flaccid flagon flagrant flair flak flamboyant flammable flank flannel flatten flatter flaunt flavorful flax fledgling fleece fleet flex flexible flick flimsy flinch flippant flit flora floral florid florist flotilla flounder flourish flout flowery fluctuate flue fluency fluffy fluke fluorescent flurry fluster flux foal foible foil foist foliage folio folklore folly foment fondle fondness font forage foray forbear forbearance forbid forceful forceps forebear foreboding forecast forefather forefront forego foregone forehead foreman foremost forensic forerunner foresee foreshadow foresight forestall forethought foretell forewarn forfeit forge forgery forgo forklift forlorn formaldehyde formality formative formidable formulate forsake forswear forte forthcoming forthright forthwith fortify fortitude fortnight fortress fortuitous forum fossil fount founder foundling foundry fowl foyer fracas fraction fracture fragile fragment fragrance frail frailty frantic fraternal fraternity fraud fraudulent fraught fray frazzle freckle freelance freight frenetic frenzy fresco fret friction frigate fright frigid frill fringe frivolous frock frolic frontier frostbite froth froward frown frowzy frugal fruitful fruition fruitless frustration fugitive fulcrum fulminate fulsome fumble fume fumigate functional fundamental fungus funnel furious furlough furnace furnish furor furrow furtive fury fuse fusillade fussy fusty futile futility gadfly gadget gaffe gaiety gainful gait gala gale gallant galleon gallery galley gallivant gallon gallop gallows galore galvanize gambit gambol gamut gander gangly gangrene gangster gantlet gape garble gargantuan gargle gargoyle garish garland garlic garment garner garnet garnish garret garrison garrote garrulous gaseous gash gaslight gastric gateau gauche gaudy gauge gaunt gauntlet gauze gavel gawk gawky gazebo gazelle gazette gear gecko geld gelid gem gendarme genealogy generality generalize generic generosity genesis genetics genial genie genital genocide genre genteel gentility gentry genuflect genus geographer geography geology geometry geranium geriatric germane germinate gerund gestate gesticulate geyser ghastly gherkin ghetto ghoul gibberish gibbon gibe giddy gild gilt gimlet gimmick gingerly gird girder girdle girth gist glacial glacier glade gladiator glamour glaucoma glaze gleam glean glee glen glib glimmer glimpse glint glisten glitch glitter gloat globule gloom glorify glossary glossy glower glucose glue glum glut glutinous glutton glycerin gnarl gnash gnat gnaw gnome goad goatee goblet goblin gondola gonorrhea gore gorge gorgeous gorilla gory gosling gospel gossamer gossip gouge gourd gourmand gourmet gout governance governess gown grab gracious gradation gradient granary grandeur grandiose grandstand granite granular granule graph graphite grapple grate grateful gratify grating gratis gratitude gratuitous gratuity grave gravel gravitate gravitation graze grease greasy greed greedy gregarious gremlin grenade grid griddle gridlock grievance grieve grievous griffin grill grim grimace grime grimy grin grind grindstone grip gripe grisly gristle grit gritty grizzled groan grocer groggy groin grommet groom groove grope gross grotesque grotto grouchy grout grove grovel growl grub grubby grudge grueling gruesome gruff grumble grumpy grunt guarantee guava gudgeon guerrilla guffaw guidance guile guileless guillotine guise gulch gull gullet gullible gully gulp gumption gunny gurgle guru gush gusset gust gusto gutsy gutter guttural guzzle gymnasium gymnast gynecology gyrate gyroscope habitat habitual hacienda hackle hackneyed haggard haggle haiku hail halberd halcyon hale halibut halitosis hallmark hallow hallucinate halo halt halter halve hamlet hammock hamper hamster hanker haphazard hapless harangue harass harbinger harbor hardihood hardy hare harem hark harlequin harmonica harness harp harpoon harpsichord harrow harry harsh harvester hashish hassle hasten hatch hatchery hatchet haughty haul haunch haunt haute haven havoc hawk hawthorn hazard haze hazel headfirst headland headlong headstrong headway heady heal hearken hearsay hearse hearten hearth heath heathen heather heave heaven heckle hectare hectic hedge hedonist heed heedless heel hefty hegemony heifer heigh height heinous heir heirloom helical helicopter helium helix hellish helm helmet helpless hemisphere hemlock hemoglobin hemorrhage hemp hence henceforth henchman hepatitis herald herbal herbivore herculean herd hereafter hereby hereditary heresy heretic heritage hermetic hermit hernia heroic heroin heroine heron herringbone hesitant heterogeneous heuristic hew hexagon heyday hiatus hibernate hibiscus hiccup hickory hideous hierarchy hieroglyph hilarious hillock hilt hinder hindrance hindsight hinge hinterland hippopotamus hireling hirsute histamine histogram historian historic histrionic hither hoard hoarse hoary hoax hobble hobby hobgoblin hobnail hock hodgepodge hoe hogshead hoist holistic hollow holly holocaust hologram holster homage homely homestead homicide homily homogeneous homonym hone honeycomb honeydew honorarium honorary hoodlum hoodwink hoof hookah hooligan hoop horde horizon hormone hornet horoscope horrendous horrible horrid horrify horticulture hosiery hospitable hostel hostess hostility hovel hover howitzer hubbub hubris huckster huddle hue huff hulk hull humane humanity humble humbug humdrum humid humidity humiliate humility hummock humongous humorist humus hunch hundredth hunger hunker hurdle hurl hurrah hurricane hurtle husbandry hush husk husky hustle hutch hyacinth hybrid hydrant hydraulic hydrogen hyena hygiene hymn hype hyperbole hypnosis hypochondria hypocrisy hypocrite hypotenuse hypothermia hysteria hysterical").split(/\s+/);
const ALL_UNIGRAMS = COMMON_UNIGRAMS.concat(EXTRA_WORDS).concat(MORE_WORDS);
const UNI_RANK = {}; ALL_UNIGRAMS.forEach((w, i) => { if (!(w in UNI_RANK)) UNI_RANK[w] = i; });
const UNI_SPAN = ALL_UNIGRAMS.length;
const UNI_LEN = Object.keys(UNI_RANK).length;

/* ====== Compact Bloom filter over common bigrams (space-efficient predictability lookup) ====== */
const COMMON_BIGRAM_LIST = ["of the", "in the", "to the", "on the", "and the", "to be", "it is", "is a", "for the", "that the", "at the", "as a", "with the", "from the", "this is", "there is", "by the", "in a", "one of", "it was", "there are", "such as", "is the", "has been", "have been", "will be", "can be", "is that", "the most", "a combination", "important to", "crucial role", "a significant", "led to", "resulted in", "due to", "based on", "as well", "in order", "the same", "a result", "in conclusion", "play a", "plays a", "is important", "note that", "combination of", "social economic", "economic and", "and political", "political factors", "financial crisis", "the lower", "lower classes", "social hierarchy", "public opinion", "the monarchy", "the nobility", "the common", "common people", "rising prices", "interrelated factors", "the collapse", "the french", "french revolution", "caused by", "among the", "ideas played", "the population", "the result", "number of", "part of", "out of", "kind of", "sort of", "most of", "some of", "all of", "much of", "many of", "because of", "instead of", "in terms", "as a result", "on the other", "at the same", "for example", "in fact", "of course", "in particular", "in addition", "as well as", "more than", "rather than", "as much", "going to", "want to", "need to", "have to", "used to", "able to", "trying to", "would be", "could be", "should be", "might be", "must be", "was a", "were a", "in this", "of this", "for this", "with this", "to this", "this text", "the fact", "fact that", "the way", "way that", "the time", "at least", "at most", "more and", "and more", "each other", "one another", "the first", "the last", "the next", "the best", "the only", "the whole", "a lot", "lot of", "kind of", "type of", "form of", "sense of", "point of", "end of", "start of", "top of", "front of", "back of", "middle of", "side of", "part of", "sort of", "series of", "range of", "set of", "group of", "list of", "number of", "amount of", "level of", "kind of", "the idea", "an idea", "the reason", "one reason", "the problem", "the solution", "the answer", "the question", "the point", "the case", "the truth", "the world", "the people", "the government", "the country", "the economy", "the market", "the process", "the system", "the result", "the effect", "the impact", "the change", "the state", "the power", "the value", "the role", "the need", "the use", "the same time"];
class BloomFilter {
  constructor(bits, k) { this.bits = bits; this.size = bits.length * 32; this.arr = bits; this.k = k; }
  static create(items, size = 4096, k = 4) {
    const arr = new Uint32Array(Math.ceil(size / 32));
    const bf = new BloomFilter(arr, k); bf.size = size;
    items.forEach(it => bf.add(it));
    return bf;
  }
  _hashes(s) {
    // two independent FNV-style hashes -> k derived hashes (Kirsch-Mitzenmacher)
    let h1 = 2166136261 >>> 0, h2 = 5381 >>> 0;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (((h2 << 5) + h2) + c) >>> 0; }
    const out = [];
    for (let i = 0; i < this.k; i++) out.push((h1 + Math.imul(i, h2)) % this.size);
    return out;
  }
  add(s) { this._hashes(s).forEach(idx => { this.arr[idx >>> 5] |= (1 << (idx & 31)); }); }
  test(s) { return this._hashes(s).every(idx => (this.arr[idx >>> 5] & (1 << (idx & 31))) !== 0); }
}
const BIGRAM_BLOOM = BloomFilter.create(COMMON_BIGRAM_LIST, 4096, 4);

function surprisalForWord(prev, word) {
  let s = 0.80;
  if (word in UNI_RANK) { s = 0.10 + (UNI_RANK[word] / UNI_SPAN) * 0.34; }
  else if (ACADEMIC_WORDS.has(word)) { s = 0.30; }
  else if (word.length > 12) { s = 0.92; }
  if (prev && BIGRAM_BLOOM.test(prev + " " + word)) s = Math.min(s, 0.08);
  return s;
}

/* ============================================================
   SCORING PRIMITIVES (1.5)
   ============================================================ */
// Document-length confidence curve (drives the confidence LABEL; does not crush the score).
// Calibrated so a normal paragraph (~100 words) reads as reasonable, 150+ as solid.
function calculateLengthConfidence(wordCount) {
  if (wordCount < 25) return 0.2;
  if (wordCount >= 160) return 1.0;
  // smooth ramp from 0.35 (25 words) to 1.0 (160 words)
  return clamp(0.35 + (wordCount - 25) / (160 - 25) * 0.65, 0.2, 1.0);
}

function scorePerplexity(t, question) {
  const toks = words(t);
  if (toks.length < 10) return { score: 50, detail: "Too short to estimate predictability.", dir: "neutral", lowSpans: [] };
  const qWords = new Set(words(question || "").filter(x => x.length > 3));
  const freq = {}; toks.forEach(w => freq[w] = (freq[w] || 0) + 1);
  let surprisals = []; const wordScores = [];
  for (let i = 0; i < toks.length; i++) {
    const prev = i > 0 ? toks[i - 1] : null;
    let base = surprisalForWord(prev, toks[i]);
    if (qWords.has(toks[i])) base = Math.max(base, 0.55);
    const selfPredict = qWords.has(toks[i]) ? 0 : clamp((freq[toks[i]] - 1) / 4, 0, 0.4);
    const blended = clamp(base - selfPredict * 0.5, 0.02, 1);
    surprisals.push(blended); wordScores.push({ w: toks[i], s: blended });
  }
  const meanSurprisal = surprisals.reduce((a, b) => a + b, 0) / surprisals.length;
  const lowFrac = surprisals.filter(s => s < 0.40).length / surprisals.length;
  const score = clamp(Math.round(clamp((lowFrac - 0.45) / 0.35, 0, 1) * 100), 0, 100);
  const lowSpans = []; let run = [];
  for (let i = 0; i < wordScores.length; i++) {
    if (wordScores[i].s < 0.22) { run.push(i); }
    else { if (run.length >= 4) lowSpans.push([run[0], run[run.length - 1]]); run = []; }
  }
  if (run.length >= 4) lowSpans.push([run[0], run[run.length - 1]]);
  // Individual low-perplexity token indices (surprisal < 0.40) — these are exactly the words that
  // drive the score. Used by "Highlight in text" to show the full reason behind the perplexity score.
  const lowWordIdx = [];
  for (let i = 0; i < wordScores.length; i++) { if (wordScores[i].s < 0.40) lowWordIdx.push(i); }
  const detail = `${Math.round(lowFrac * 100)}% of words register as predictable against a ${UNI_LEN.toLocaleString()}-word model plus a ${COMMON_BIGRAM_LIST.length}-bigram Bloom filter (mean surprisal ${meanSurprisal.toFixed(2)}).`;
  return { score, detail, dir: score >= 55 ? "AI" : "human", meanSurprisal, lowFrac, lowSpans, lowWordIdx, wordScores, toks };
}

function scoreBurstiness(sents) {
  if (sents.length < 2) return { score: 50, detail: "Not enough sentences to judge rhythm.", dir: "neutral", runIdx: new Set() };
  const lens = sents.map(s => (s.match(/[a-z']+/gi) || []).length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const score = clamp(Math.round((1 - clamp((cv - 0.30) / 0.35, 0, 1)) * 100), 0, 100);
  let bestRun = [], cur = [];
  for (let i = 0; i < lens.length; i++) {
    if (cur.length === 0 || Math.abs(lens[i] - lens[cur[cur.length - 1]]) <= 2) { cur.push(i); }
    else { if (cur.length > bestRun.length) bestRun = cur; cur = [i]; }
  }
  if (cur.length > bestRun.length) bestRun = cur;
  const runIdx = new Set((bestRun.length >= 3 && cv < 0.50) ? bestRun : []);
  const detail = `Lengths [${lens.join(', ')}], avg ${mean.toFixed(1)}, variation ${cv.toFixed(2)}. ${cv < 0.30 ? "Very uniform, strong AI correlate." : cv < 0.50 ? "Moderately uniform, leans AI." : "Varied, human-typical rhythm."}${runIdx.size ? ` Marked run of ${runIdx.size} near-equal sentences.` : ""}`;
  return { score, detail, dir: score >= 55 ? "AI" : "human", lens, cv, mean, runIdx };
}

const FUNCTION_TEMPLATES = ["one reason is", "another reason is", "a final reason", "it is important", "it shows that", "this shows that", "as a result", "in order to", "due to the", "the fact that", "it can be", "there are many", "one of the", "this is because", "leads to the", "resulted in the", "is important to", "it is clear", "this means that", "plays a role", "play a role"];
function scoreTokenPattern(t, question) {
  const w = words(t).filter(x => x.length > 2); if (w.length < 12) return { score: 50, detail: "Too short to assess repetition.", dir: "neutral", tmpl: [] };
  const qWords = new Set(words(question || "").filter(x => x.length > 3));
  const STOP = new Set(["the", "and", "that", "for", "with", "was", "were", "are", "this", "these", "their", "from", "have", "has", "had", "not", "but", "which", "while", "into", "also", "they", "them", "very", "more", "most"]);
  const big = {}; const wl = words(t);
  for (let i = 0; i < wl.length - 1; i++) { const k = wl[i] + " " + wl[i + 1]; big[k] = (big[k] || 0) + 1; }
  let repeats = Object.entries(big).filter(([, c]) => c > 1);
  const flagged = [];
  repeats.forEach(([k, c]) => {
    const parts = k.split(" ");
    if (parts.every(x => STOP.has(x))) return;
    const overlapsQuestion = parts.some(p => qWords.has(p));
    const isFunctionTemplate = FUNCTION_TEMPLATES.some(ft => ft.includes(k) || k.includes(ft.split(" ").slice(0, 2).join(" ")));
    let weight;
    if (isFunctionTemplate) weight = c - 1;
    else weight = 0;

    if (weight > 0.01) flagged.push({ k, c, weight, kind: isFunctionTemplate ? "function template" : (overlapsQuestion ? "question-anchored" : "content repeat") });
  });
  flagged.sort((a, b) => b.weight - a.weight);
  const uniq = new Set(w).size, ttr = uniq / w.length;
  const pen = flagged.reduce((a, f) => a + f.weight, 0);
  const score = clamp(Math.round((1 - clamp((ttr - 0.42) / 0.34, 0, 1)) * 45 + clamp(pen * 8, 0, 35)), 0, 100);
  let ev = flagged.length
    ? `Repeats: ${flagged.slice(0, 4).map(f => `<em>${f.k} (×${f.c}, ${f.kind})</em>`).join(", ")}. Function templates count fully; content/question-anchored repeats not counted.`
    : `No suspicious templating. Topic-word repeats treated as normal link-back.`;
  const detail = `Diversity ${ttr.toFixed(2)}. ${question ? "Question provided: prompt repeats downweighted." : "Tip: paste the essay question to downweight topic repeats."} Only function-word templates push AI-ward.`;
  return { score, detail, ev, dir: score >= 55 ? "AI" : "human", tmpl: flagged.filter(f => f.kind === "function template").map(f => [f.k, f.c]) };
}

function scoreStylistic(t) {
  const low = t.toLowerCase(); let flags = []; const styleSpans = []; let aiPoints = 0;
  let m; const triadRe = /\b\w+,\s+\w+,\s+and\s+\w+/g;
  while ((m = triadRe.exec(t)) !== null) { flags.push("triadic list"); aiPoints += 2; styleSpans.push({ s: m.index, e: m.index + m[0].length, kind: "triadic", tip: "Stylistic: triadic list ('x, y, and z'), a hallmark of AI symmetry. Leans AI." }); }
  let im; const introRe = /^(in this essay|this essay will|firstly|first of all|this report|in this article)[^.]*\./i;
  if ((im = introRe.exec(t.trim()))) { flags.push("signpost intro"); aiPoints += 2; const idx = t.indexOf(im[0]); styleSpans.push({ s: idx, e: idx + im[0].length, kind: "intro", tip: "Stylistic: signpost intro that announces structure. Leans AI." }); }
  let cm; const closeRe = /(in conclusion|to conclude|in summary|to sum up|all in all|in essence)[^.]*\./i;
  if ((cm = closeRe.exec(t))) { flags.push("summary closer"); aiPoints += 2; const idx = t.search(closeRe); styleSpans.push({ s: idx, e: idx + cm[0].length, kind: "closer", tip: "Stylistic: formulaic summary closer. Leans AI." }); }
  const seenW = {}; let wm; const wordRe = /[A-Za-z][a-z'-]+/g;
  while ((wm = wordRe.exec(t)) !== null) { const lw = wm[0].toLowerCase(); if (AI_WORDS.has(lw) && !seenW[wm.index]) { seenW[wm.index] = 1; aiPoints += 1.4; styleSpans.push({ s: wm.index, e: wm.index + wm[0].length, kind: "aiWord", matched: wm[0], tip: `Stylistic: "${wm[0]}" is documented as far more frequent in AI text than human writing. Leans AI.` }); } }
  AI_PHRASES_DB.forEach(p => { let i = low.indexOf(p); while (i !== -1) { aiPoints += 1.8; styleSpans.push({ s: i, e: i + p.length, kind: "aiPhrase", matched: p, tip: `Stylistic: "${p}" is a stock AI phrase (hedge / filler / formulaic transition). Leans AI.` }); i = low.indexOf(p, i + p.length); } });
  AI_ADJ_NOUN.forEach(p => { let i = low.indexOf(p); if (i !== -1) { aiPoints += 1.2; styleSpans.push({ s: i, e: i + p.length, kind: "combo", matched: p, tip: `Stylistic: "${p}" is a characteristic AI adjective-noun combo. Leans AI.` }); } });
  let pp; const ppRe = /,\s+(\w+ing)\b/g;
  while ((pp = ppRe.exec(t)) !== null) { if (PARTICIPIAL.includes(pp[1].toLowerCase())) { flags.push("participial padding"); aiPoints += 2.2; styleSpans.push({ s: pp.index + 1, e: pp.index + pp[0].length, kind: "participial", tip: "Stylistic: participial padding (', " + pp[1] + " ...'). The single strongest structural AI tell in research. Leans AI." }); } }
  let sv2; const servesRe = /\b(serves as|stands as|acts as)\s+(a|an|the)\b/gi;
  while ((sv2 = servesRe.exec(t)) !== null) { flags.push("inflated copula"); aiPoints += 1; styleSpans.push({ s: sv2.index, e: sv2.index + sv2[0].length, kind: "copula", tip: "Stylistic: inflated copula ('serves as a'). AI prefers this over plain 'is'. Leans AI." }); }
  let cf; const contrastRe = /\b(it'?s not just|not only|isn'?t just|this isn'?t)\b[^.]{0,40}?\b(it'?s|but|they'?re)\b/gi;
  while ((cf = contrastRe.exec(t)) !== null) { flags.push("contrastive formula"); aiPoints += 1.5; styleSpans.push({ s: cf.index, e: cf.index + cf[0].length, kind: "contrastive", tip: "Stylistic: contrastive formula ('not just X, it's Y'). A recognizable AI rhetorical cadence. Leans AI." }); }
  const dates = (t.match(/\b1[0-9]{3}\b|\b20[0-9]{2}\b/g) || []).length;
  let propers = 0; let pmm; const propScan = /(?<=[a-z,]\s)[A-Z][a-z]{2,}/g;
  while ((pmm = propScan.exec(t)) !== null) { if (!STARTERS.has(pmm[0])) propers++; }
  const numbers = (t.match(/\b\d+([.,]\d+)?%?\b/g) || []).length;
  const firstPerson = (low.match(/\b(i|my|we|our|us)\b/g) || []).length;
  const spec = dates + propers + numbers + Math.min(firstPerson, 4);
  const wc = (t.match(/[a-z']+/gi) || []).length || 1;
  const density = aiPoints / (wc / 100);
  let score = clamp(Math.round(38 + density * 7 - clamp(spec * 4, 0, 30)), 0, 100);
  const ep = [];
  if (flags.length) { const uniq = [...new Set(flags)]; ep.push(`AI structure: <em>${uniq.join("</em>, <em>")}</em>`); }
  if (styleSpans.length) ep.push(`<em>${styleSpans.length}</em> AI vocabulary/phrase hit(s)`);
  if (spec) ep.push(`human specifics: <em>${dates} date(s), ${propers} name(s), ${numbers} figure(s), ${firstPerson} personal ref(s)</em>`);
  const ev = ep.length ? ep.join(". ") + "." : null;
  const detail = `AI tells per 100 words: ${density.toFixed(1)}. 1,000+ documented vocabulary words & phrases, triadic lists, participial padding, inflated copulas push AI-ward; concrete dates, names, figures, personal references pull human-ward.`;
  return { score, detail, ev, dir: score >= 55 ? "AI" : "human", dates, propers, styleSpans, aiPoints, wc };
}

/* Syntactic-entropy signal removed in 1.7: a suffix-based POS tagger cannot reliably tell a
   noun from a verb, so POS trigrams almost never repeated and the score sat at the floor for
   nearly all text. Rather than ship a signal that doesn't discriminate, it was dropped and its
   weight redistributed to the signals that do work. */



/* ====== SEMANTIC COHESION / DRIFT (redesigned, 1.6) ======
   LLM prose keeps a very even topical texture: each sentence pulls from the same core
   vocabulary and the lexical density barely changes. Humans drift — some sentences are
   dense and specific, others loose and tangential. We measure two things across a sliding
   window of sentences: (1) how evenly the document's top topic words are spread, and
   (2) how little the content-word density varies. Very even + very stable => leans AI. */
const COHESION_STOP = new Set(["the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for", "with", "as", "is", "are", "was", "were", "be", "been", "it", "this", "that", "these", "those", "they", "them", "their", "he", "she", "we", "you", "i", "his", "her", "its", "our", "not", "no", "so", "if", "then", "than", "which", "who", "what", "from", "into", "also", "have", "has", "had", "do", "did", "does", "will", "would", "can", "could", "more", "most", "very", "there", "here", "when", "while", "such", "some", "any", "one", "two", "how", "why"]);
function contentWords(s) {
  return (s.toLowerCase().match(/[a-z']+/g) || []).filter(x => x.length > 3 && !COHESION_STOP.has(x));
}
function scoreCohesion(t) {
  const sents = splitSentences(t);
  if (sents.length < 4) return { score: 50, detail: "Neutral, needs at least 4 sentences to judge topical drift.", dir: "neutral", insufficient: true };
  // document-wide top topic terms
  const docFreq = {}; let docTotal = 0;
  sents.forEach(s => contentWords(s).forEach(w => { docFreq[w] = (docFreq[w] || 0) + 1; docTotal++; }));
  const topTerms = Object.entries(docFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(e => e[0]);
  const topSet = new Set(topTerms);
  // per-sentence: fraction of content words that are top-terms (topic adherence) + content density
  const adherence = []; const density = [];
  sents.forEach(s => {
    const cw = contentWords(s);
    const total = (s.match(/[a-z']+/gi) || []).length || 1;
    const hits = cw.filter(w => topSet.has(w)).length;
    adherence.push(cw.length ? hits / cw.length : 0);
    density.push(cw.length / total);
  });
  const mean = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  const cv = arr => { const m = mean(arr); if (m === 0) return 0; const v = mean(arr.map(x => (x - m) ** 2)); return Math.sqrt(v) / m; };
  const adhMean = mean(adherence);      // higher = every sentence sticks to the same topic words
  const densCV = cv(density);           // higher = human bursts of dense/loose writing
  // cohesionIndex: high adherence + low density variation => AI-like even texture
  const cohesionIndex = clamp(adhMean * 0.65 + (1 - clamp(densCV / 0.45, 0, 1)) * 0.35, 0, 1);
  const score = clamp(Math.round(cohesionIndex * 120 - 12), 3, 97);
  const detail = `Top topic terms appear in a steady ${(adhMean * 100).toFixed(0)}% of each sentence's content; content-density variation ${densCV.toFixed(2)} across ${sents.length} sentences. ${cohesionIndex >= 0.6 ? "Very even topical texture with little drift, leans AI." : cohesionIndex >= 0.42 ? "Some thematic variation." : "Noticeable drift and uneven density, human-typical."}`;
  return { score, detail, dir: score >= 55 ? "AI" : score <= 45 ? "human" : "neutral", adhMean, densCV, cohesionIndex, topTerms };
}


/* ====== PERTURBATION-STYLE LOCAL-PROBABILITY-PEAK CHECK (1.5) ====== */
const SYNONYMS = {
  heavy: ["massive", "large", "hefty"], significant: ["major", "notable", "large"], important: ["key", "crucial", "vital"],
  crucial: ["key", "vital", "critical"], major: ["big", "significant", "large"], different: ["varied", "distinct", "diverse"],
  many: ["numerous", "several", "countless"], change: ["shift", "alter", "transform"], caused: ["created", "produced", "drove"],
  showed: ["revealed", "displayed", "demonstrated"], help: ["aid", "assist", "support"], big: ["large", "huge", "vast"],
  problem: ["issue", "trouble", "difficulty"], idea: ["notion", "concept", "thought"], people: ["citizens", "individuals", "population"],
  good: ["fine", "solid", "strong"], made: ["created", "produced", "formed"], began: ["started", "commenced", "opened"]
};
function sentPerplexity(s) {
  const w = words(s); if (w.length < 4) return null;
  let sc = 0; for (let i = 0; i < w.length; i++) sc += surprisalForWord(i > 0 ? w[i - 1] : null, w[i]);
  return sc / w.length;
}
function scorePerturbation(sents) {
  const cand = sents.filter(s => (s.match(/[a-z']+/gi) || []).length >= 6).slice(0, 12);
  if (cand.length < 2) return { score: 50, detail: "Too short for a perturbation test.", dir: "neutral", peakSents: [] };
  let peakCount = 0, tested = 0; const peakSents = [];
  cand.forEach(s => {
    const orig = sentPerplexity(s); if (orig == null) return;
    // build up to 5 perturbations by swapping a known synonym
    const variants = [];
    const w = s.split(/(\s+)/);
    for (let i = 0; i < w.length && variants.length < 5; i++) {
      const bare = w[i].toLowerCase().replace(/[^a-z']/g, "");
      if (SYNONYMS[bare]) {
        SYNONYMS[bare].forEach(syn => {
          if (variants.length < 5) { const copy = w.slice(); copy[i] = w[i].replace(bare, syn); variants.push(copy.join("")); }
        });
      }
    }
    if (!variants.length) return;
    tested++;
    const variantPerps = variants.map(sentPerplexity).filter(x => x != null);
    if (!variantPerps.length) return;
    const meanVar = variantPerps.reduce((a, b) => a + b, 0) / variantPerps.length;
    // if the original sits in a probability trough (lower perplexity than all perturbations) => machine-like peak
    if (orig < meanVar - 0.04 && variantPerps.every(v => v >= orig)) { peakCount++; peakSents.push(s); }
  });
  if (tested === 0) return { score: 50, detail: "No perturbable phrases found (needs common swappable words).", dir: "neutral", peakSents: [] };
  const peakFrac = peakCount / tested;
  const score = clamp(Math.round(peakFrac * 100), 0, 100);
  const detail = `${peakCount} of ${tested} testable sentences sit on a local probability peak (lower perplexity than their synonym variants). ${peakFrac > 0.5 ? "Text tends to walk the path of maximum probability, leans AI." : "Perturbations do not consistently raise perplexity, human-typical."}`;
  return { score, detail, dir: score >= 55 ? "AI" : "human", peakFrac, peakSents };
}

/* ====== per-sentence verdict (for highlighting) ====== */
function scoreSentence(s, ctxMean) {
  const low = s.toLowerCase(); const wc = (s.match(/[a-z']+/gi) || []).length;
  let ai = 0, human = 0, reasons = [];
  if (/\b\w+,\s+\w+,\s+and\s+\w+/.test(s)) { ai += 1.5; reasons.push("triadic list"); }
  if (/\b(in conclusion|to conclude|in summary|to sum up)\b/.test(low)) { ai += 1.5; reasons.push("summary closer"); }
  FUNCTION_TEMPLATES.forEach(ft => { if (low.includes(ft)) { ai += 1; reasons.push(`template "${ft}"`); } });
  let vw = 0; (low.match(/[a-z'-]+/g) || []).forEach(w => { if (AI_WORDS.has(w)) vw++; });
  if (vw > 0) { ai += vw * 1.2; reasons.push(`${vw} AI vocab word(s)`); }
  let ph = 0; AI_PHRASES_DB.forEach(p => { if (low.includes(p)) { ph++; } }); if (ph > 0) { ai += ph * 1.6; reasons.push(`${ph} AI phrase(s)`); }
  let ppc = 0; let ppm; const ppRe = /,\s+(\w+ing)\b/g; while ((ppm = ppRe.exec(s)) !== null) { if (PARTICIPIAL.includes(ppm[1].toLowerCase())) ppc++; } if (ppc > 0) { ai += ppc * 1.8; reasons.push("participial padding"); }
  const dates = (s.match(/\b1[0-9]{3}\b|\b20[0-9]{2}\b/g) || []).length;
  let propers = 0; let pq; const pqRe = /(?<=[a-z,]\s)[A-Z][a-z]{2,}/g; while ((pq = pqRe.exec(s)) !== null) { if (!STARTERS.has(pq[0])) propers++; }
  const numbers = (s.match(/\b\d+([.,]\d+)?%?\b/g) || []).length;
  if (dates + propers + numbers > 0) { human += 2; reasons.push(`${dates + propers + numbers} concrete specific(s)`); }
  if (/\b(i|my|we|our|us)\b/.test(low)) { human += 1; reasons.push("personal reference"); }
  if (/[?!]$/.test(s.trim())) { human += 1; reasons.push("varied punctuation"); }
  if (wc <= 5 || wc >= 28) { human += 1; reasons.push(`distinctive length (${wc} words)`); }
  else if (ctxMean && Math.abs(wc - ctxMean) < 2) { ai += 0.75; reasons.push("uniform length"); }
  const sw = words(s); if (sw.length >= 4) { let sc = 0; for (let i = 0; i < sw.length; i++) sc += surprisalForWord(i > 0 ? sw[i - 1] : null, sw[i]); const ms = sc / sw.length; if (ms < 0.32) { ai += 1; reasons.push("over-predictable wording"); } else if (ms > 0.6) { human += 0.5; } }
  const verdict = ai > human ? "AI" : "human";
  const reasonStr = reasons.join("; ");
  const tags = {
    triadic: /triadic/.test(reasonStr),
    closer: /summary closer/.test(reasonStr),
    template: /template/.test(reasonStr),
    vocab: /AI vocab/.test(reasonStr),
    phrase: /AI phrase/.test(reasonStr),
    participial: /participial/.test(reasonStr),
    uniform: /uniform length/.test(reasonStr),
    predictable: /over-predictable/.test(reasonStr)
  };
  return { verdict, reasonText: reasons.length ? reasons.slice(0, 3).join("; ") : "no strong signals", wc, tags };
}

// Build a tailored rewrite for a whole flagged sentence, based on which tells actually fired.
function sentenceFix(sv, inBurstRun) {
  const t = sv.tags || {};
  const parts = [];
  if (t.phrase) parts.push("cut the stock phrase and state the point plainly");
  if (t.vocab) parts.push("swap the AI-flagged vocabulary for plainer words");
  if (t.participial) parts.push("delete the trailing ', -ing' clause or make it a real sentence");
  if (t.triadic) parts.push("break the rule-of-three list (drop to one item or add a fourth)");
  if (t.template) parts.push("vary the opening instead of the recurring template");
  if (t.closer) parts.push("end on a specific point rather than a formulaic closer");
  if (t.predictable && parts.length === 0) parts.push("rephrase the wording so it is less templated");
  if (inBurstRun || t.uniform) parts.push("vary the sentence length so it breaks the even rhythm");
  if (!parts.length) return "Add a concrete detail or vary the phrasing so it reads less machine-smooth.";
  // Capitalize first, join naturally.
  const joined = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}

/* ====== REAL GRAMMAR CHECKER (Grammarly-style, 1.6) ======
   Flags genuine writing errors with a concrete suggestion for each. The results feed the
   detector (many real slips => human-leaning; perfectly clean mechanics => neutral) AND are
   surfaced to the writer as an actual proofreading aid. Each issue: {s,e,type,msg,fix,kind,v}. */
const COMMON_MISSPELLINGS = {
  "teh": "the", "adn": "and", "recieve": "receive", "recieved": "received", "seperate": "separate", "definately": "definitely", "occured": "occurred", "occassion": "occasion", "untill": "until", "wich": "which", "becuase": "because", "beleive": "believe", "acheive": "achieve", "arguement": "argument", "enviroment": "environment", "goverment": "government", "existance": "existence", "occurence": "occurrence", "publically": "publicly", "neccessary": "necessary", "accomodate": "accommodate", "concious": "conscious", "embarass": "embarrass", "millenium": "millennium", "priviledge": "privilege", "wierd": "weird", "alot": "a lot", "thier": "their", "freind": "friend", "greatful": "grateful", "independant": "independent", "maintainance": "maintenance", "occassionally": "occasionally", "persistant": "persistent", "relevent": "relevant", "succesful": "successful", "tommorow": "tomorrow", "truely": "truly", "wether": "whether"
};
/* Irregular present -> past for tense correction after a past-time marker. */
const PAST_TENSE = { eat: "ate", go: "went", run: "ran", see: "saw", come: "came", take: "took", give: "gave", make: "made", write: "wrote", drive: "drove", speak: "spoke", break: "broke", choose: "chose", drink: "drank", swim: "swam", begin: "began", ring: "rang", sing: "sang", buy: "bought", bring: "brought", think: "thought", teach: "taught", catch: "caught", fight: "fought", find: "found", feel: "felt", keep: "kept", sleep: "slept", leave: "left", meet: "met", pay: "paid", say: "said", sell: "sold", tell: "told", win: "won", get: "got", forget: "forgot", grow: "grew", know: "knew", throw: "threw", fly: "flew", draw: "drew", hold: "held", stand: "stood", understand: "understood", build: "built", send: "sent", spend: "spent", lose: "lost", lead: "led", read: "read", hear: "heard", hit: "hit", cut: "cut", put: "put", let: "let", set: "set", cost: "cost", become: "became", fall: "fell", feed: "fed", hide: "hid", ride: "rode", rise: "rose", shake: "shook", steal: "stole", wear: "wore", wake: "woke", freeze: "froze", is: "was", are: "were", have: "had", has: "had", do: "did", does: "did" };
const REGULAR_PAST = (v) => { // naive regular-verb past former
  if (/e$/.test(v)) return v + "d";
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + "ied";
  return v + "ed";
};
const PAST_MARKERS = ["yesterday", "ago", "last week", "last year", "last month", "last night", "earlier", "previously", "formerly", "back then", "in the past", "once"];
const PLURAL_PRON = new Set(["they", "we", "you", "these", "those"]);
const SING_PRON = new Set(["he", "she", "it", "this", "that"]);

function checkGrammar(t) {
  const issues = [];
  const push = (s, e, type, msg, fix, kind, v) => { if (s < e && s >= 0) issues.push({ s, e, type, msg, fix, kind: kind || "grammar", v: v || "human" }); };

  // 1) Repeated word ("the the")
  let m; const dupRe = /\b(\w+)\s+\1\b/gi;
  while ((m = dupRe.exec(t)) !== null) { if (m[1].length > 1 && !/^(that|had|is)$/i.test(m[1])) push(m.index, m.index + m[0].length, "Repeated word", `"${m[1]} ${m[1]}" repeats the same word.`, `Delete the duplicate "${m[1]}".`, "grammar"); }

  // 2) a/an misuse
  const anRe = /\b(a|an)\s+([a-z]+)/gi;
  while ((m = anRe.exec(t)) !== null) {
    const art = m[1].toLowerCase(); const next = m[2].toLowerCase();
    const startsVowelSound = /^[aeiou]/.test(next) && !/^(uni|use|user|euro|one|once|ubiqu|unil)/.test(next);
    const startsConsSound = !/^[aeiou]/.test(next) || /^(uni|use|user|euro|one|once|ubiqu|unil)/.test(next);
    const isHonest = /^(hour|honest|honou?r|heir)/.test(next); // silent h -> vowel sound
    if (art === "a" && (startsVowelSound || isHonest)) push(m.index, m.index + m[1].length, "Article", `Use "an" before a vowel sound ("${next}").`, `Change "a" to "an" before "${next}".`, "grammar");
    else if (art === "an" && startsConsSound && !isHonest) push(m.index, m.index + m[1].length, "Article", `Use "a" before a consonant sound ("${next}").`, `Change "an" to "a" before "${next}".`, "grammar");
  }

  // 3) its / it's
  const itsPoss = /\bits\s+(is|was|has|been)\b/gi;
  while ((m = itsPoss.exec(t)) !== null) push(m.index, m.index + 3, "its / it's", `"its" is possessive; before "${m[1]}" you mean "it's" (it is/has).`, `Change "its" to "it's".`, "grammar");
  const itsBeforeNoun = /\bit's\s+(own|way|time|place|role|purpose|nature)\b/gi;
  while ((m = itsBeforeNoun.exec(t)) !== null) push(m.index, m.index + 4, "it's / its", `"it's" means "it is"; before "${m[1]}" you likely mean the possessive "its".`, `Change "it's" to "its".`, "grammar");

  // 4) their / there / they're
  const thereRe = /\bthere\s+(house|car|dog|book|idea|point|argument|essay|work|family|friend|opinion|view|own|parents|children|rights)\b/gi;
  while ((m = thereRe.exec(t)) !== null) push(m.index, m.index + 5, "there / their", `Possessive expected before "${m[1]}".`, `Change "there" to "their".`, "grammar");
  const theyreRe = /\btheir\s+(is|are|was|were|going|coming|not)\b/gi;
  while ((m = theyreRe.exec(t)) !== null) push(m.index, m.index + 5, "their / they're", `Before "${m[1]}" you likely mean "they're" (they are).`, `Change "their" to "they're".`, "grammar");

  // 5) your / you're
  const yourRe = /\byour\s+(a|an|the|going|not|very|so|really|welcome|right|wrong)\b/gi;
  while ((m = yourRe.exec(t)) !== null) push(m.index, m.index + 4, "your / you're", `Before "${m[1]}" you likely mean "you're" (you are).`, `Change "your" to "you're".`, "grammar");
  const youreRe = /\byou're\s+(house|car|book|idea|opinion|family|work|friend|dog|parents)\b/gi;
  while ((m = youreRe.exec(t)) !== null) push(m.index, m.index + 6, "you're / your", `Before the noun "${m[1]}" you mean the possessive "your".`, `Change "you're" to "your".`, "grammar");

  // 6) then / than (comparison)
  const thenThanRe = /\b(more|less|better|worse|greater|rather|other|larger|smaller|higher|lower|faster|slower)\s+then\b/gi;
  while ((m = thenThanRe.exec(t)) !== null) { const at = m.index + m[0].length - 4; push(at, at + 4, "then / than", `Comparisons use "than", not "then".`, `Change "then" to "than".`, "grammar"); }

  // 7) could of / would of / should of
  const ofRe = /\b(could|would|should|must|might)\s+of\b/gi;
  while ((m = ofRe.exec(t)) !== null) { const at = m.index + m[1].length + 1; push(at, at + 2, "could of", `"${m[1]} of" should be "${m[1]} have".`, `Change "of" to "have".`, "grammar"); }

  // 8) subject-verb agreement: singular pronoun + base plural verb ("he go", "she run")
  const svRe = /\b(he|she|it)\s+(go|run|walk|make|take|see|come|say|do|have|want|need|know|think|give|find|feel|become|eat|write|read|play|work|live|move|use|seem|show|tell|leave|keep|begin|bring|hold|stand)\b/gi;
  while ((m = svRe.exec(t)) !== null) { const vb = m[2].toLowerCase(); const at = m.index + m[1].length + 1; const corrected = vb === "have" ? "has" : vb === "do" ? "does" : vb === "go" ? "goes" : /(s|sh|ch|x|z)$/.test(vb) ? vb + "es" : vb + "s"; push(at, at + m[2].length, "Subject-verb", `"${m[1]} ${vb}": a singular subject needs "${corrected}".`, `Change "${vb}" to "${corrected}".`, "grammar"); }
  // plural pronoun + singular "was" ("they was", "we was")
  const pluralWasRe = /\b(they|we|you)\s+(was)\b/gi;
  while ((m = pluralWasRe.exec(t)) !== null) { const at = m.index + m[1].length + 1; push(at, at + 3, "Subject-verb", `"${m[1]} was": a plural subject needs "were".`, `Change "was" to "were".`, "grammar"); }
  // "he/she/it were"
  const singWereRe = /\b(he|she|it)\s+(were)\b/gi;
  while ((m = singWereRe.exec(t)) !== null) { const at = m.index + m[1].length + 1; push(at, at + 4, "Subject-verb", `"${m[1]} were": a singular subject needs "was".`, `Change "were" to "was".`, "grammar"); }

  // 9) verb tense after a past-time marker ("yesterday I eat", "I eat beef yesterday")
  // Operate on the raw text; flag a base-form verb only when a past-time marker sits within
  // ~60 characters (same-clause proximity), so newlines/spacing never break the check.
  const tenseRe = /\b(i|we|you|they|he|she|it)\s+(eat|go|run|see|come|take|give|make|write|drive|speak|break|choose|drink|begin|buy|bring|think|teach|catch|find|feel|keep|leave|meet|pay|say|sell|tell|win|get|grow|know|throw|fly|draw|hold|stand|build|send|spend|lose|lead|hear|become|fall|ride|rise|wear|wake)\b/gi;
  let tm;
  while ((tm = tenseRe.exec(t)) !== null) {
    const verb = tm[2].toLowerCase();
    const past = PAST_TENSE[verb] || REGULAR_PAST(verb);
    if (past === verb) continue;
    const windowText = t.slice(Math.max(0, tm.index - 60), tm.index + tm[0].length + 60).toLowerCase();
    const marker = PAST_MARKERS.find(mk => windowText.includes(mk));
    if (!marker) continue;
    const at = tm.index + tm[1].length + 1;
    push(at, at + tm[2].length, "Verb tense", `Past-time context ("${marker}") needs the past tense of "${verb}".`, `Change "${verb}" to "${past}".`, "grammar");
  }

  // 10) "a lot" written as "alot" is in misspellings; also "should of" handled. Double negative.
  const dblNegRe = /\b(don't|doesn't|didn't|can't|won't|couldn't|wouldn't|shouldn't|isn't|aren't|wasn't|weren't|haven't|hasn't)\s+(no|nothing|nobody|none|never|nowhere)\b/gi;
  while ((m = dblNegRe.exec(t)) !== null) push(m.index, m.index + m[0].length, "Double negative", `"${m[1]} ${m[2]}" is a double negative.`, `Use "${m[1]} ${m[2] === 'no' ? 'any' : m[2] === 'nothing' ? 'anything' : m[2] === 'nobody' ? 'anybody' : m[2] === 'none' ? 'any' : m[2] === 'never' ? 'ever' : 'anywhere'}".`, "grammar");

  // 11) double space
  const dsRe = / {2,}/g;
  while ((m = dsRe.exec(t)) !== null) push(m.index, m.index + m[0].length, "Spacing", "Multiple spaces in a row.", "Replace with a single space.", "style", "human");

  // 12) space before punctuation
  const spbRe = /\s+([,.;:!?])/g;
  while ((m = spbRe.exec(t)) !== null) push(m.index, m.index + m[0].length, "Spacing", `Remove the space before "${m[1]}".`, `Delete the space before "${m[1]}".`, "style", "human");

  // 13) lowercase sentence start (incl. standalone "i")
  const sentStartRe = /(^|[.!?]\s+)([a-z])/g;
  while ((m = sentStartRe.exec(t)) !== null) { const idx = m.index + m[1].length; push(idx, idx + 1, "Capitalization", `Sentences should start with a capital letter.`, `Capitalize "${m[2]}".`, "grammar", "human"); }
  const loneIRe = /(^|[^\w'])i(?=[^\w']|$)/g;
  while ((m = loneIRe.exec(t)) !== null) { const idx = m.index + m[1].length; push(idx, idx + 1, "Capitalization", `The pronoun "I" is always capitalized.`, `Capitalize "i" to "I".`, "grammar", "human"); }

  // 14) common misspellings
  const wordRe = /\b[a-z]+\b/gi;
  while ((m = wordRe.exec(t)) !== null) { const lw = m[0].toLowerCase(); if (COMMON_MISSPELLINGS[lw]) push(m.index, m.index + m[0].length, "Spelling", `"${m[0]}" is a common misspelling.`, `Did you mean "${COMMON_MISSPELLINGS[lw]}"?`, "grammar", "human"); }

  // 15) informal/colloquial
  const infRe = /\b(gonna|wanna|kinda|sorta|gotta|dunno|ain't|cuz|coz)\b/gi;
  while ((m = infRe.exec(t)) !== null) { const full = { gonna: "going to", wanna: "want to", kinda: "kind of", sorta: "sort of", gotta: "have to", dunno: "don't know", "ain't": "isn't / aren't", cuz: "because", coz: "because" }[m[0].toLowerCase()]; push(m.index, m.index + m[0].length, "Register", `"${m[0]}" is informal for academic writing.`, `Use "${full}".`, "style", "human"); }

  // 16) missing end punctuation on final sentence
  const trimmedEnd = t.replace(/\s+$/, "");
  if (trimmedEnd.length > 20 && !/[.!?]["')\]]?$/.test(trimmedEnd)) push(trimmedEnd.length - 1, trimmedEnd.length, "Punctuation", "The final sentence has no ending punctuation.", "Add a full stop.", "grammar", "human");

  // AI mechanical tells (lightly AI-leaning) — em dash + colon-label
  let em; const emRe = /—|–|\s--\s/g; while ((em = emRe.exec(t)) !== null) push(em.index, em.index + em[0].length, "Em dash", "Em dashes are common in AI text (humans use them too, so this is weak).", "Consider a comma or full stop if you didn't intend an em dash.", "aiMech", "AI");
  let cc; const colonRe = /[a-z]:\s+[A-Z][a-z]/g; while ((cc = colonRe.exec(t)) !== null) push(cc.index + 1, cc.index + cc[0].length, "Colon construction", "A colon then a capitalized clause is an AI punctuation habit (weak).", "Fold the label into the sentence or use a full stop.", "aiMech", "AI");

  // de-duplicate overlapping issues at the same span (keep first)
  issues.sort((a, b) => a.s - b.s || a.e - b.e);
  const deduped = []; let lastKey = "";
  issues.forEach(i => { const key = i.s + ":" + i.e + ":" + i.type; if (key !== lastKey) { deduped.push(i); lastKey = key; } });
  return deduped;
}

function scoreGrammar(t, sents) {
  const issues = checkGrammar(t);
  const grammarSpans = [];
  let humanSlips = 0, aiMech = 0;
  issues.forEach(iss => {
    const cls = iss.v === "AI" ? (iss.type === "Colon construction" ? "hl-style" : "hl-perp") : "hl-human";
    grammarSpans.push({ s: iss.s, e: iss.e, cls, v: iss.v, label: iss.type, kind: iss.v === "AI" ? (iss.type === "Em dash" ? "emdash" : "colon") : "grammarErr", tip: iss.msg, fix: iss.fix });
    if (iss.v === "AI") aiMech++; else humanSlips++;
  });
  // Real human errors pull the grammar signal human-ward; AI mechanical tells nudge AI-ward.
  const aiNudge = clamp(aiMech * 4, 0, 18);
  const score = clamp(50 - humanSlips * 9 + aiNudge, 6, 72);
  let dir = "neutral";
  if (score >= 56) dir = "AI"; else if (humanSlips) dir = "human";
  const errTypes = [...new Set(issues.filter(i => i.v !== "AI").map(i => i.type))];
  const bits = [];
  if (humanSlips) bits.push(`<em>${humanSlips}</em> real writing issue(s) found (${errTypes.slice(0, 4).join(", ")}); genuine errors lean human, and are listed for you to fix.`);
  if (aiMech) bits.push(`<em>${aiMech}</em> AI mechanical tell(s) (em dash or colon-label), weakly AI.`);
  if (!bits.length) bits.push(`Clean mechanics, no errors found. Neutral on its own (clean writing is not proof of AI).`);
  const detail = `Real grammar and spelling errors lean human; AI mechanical habits lean lightly AI.`;
  const ev = bits.join(" ");
  return { score, detail, ev, dir, issues, humanSlips, aiMech, grammarSpans };
}

/* ============================================================
   HIGHLIGHT BUILDER
   ============================================================ */
let MARK_INDEX = [];
function buildHighlights(t, R, showHuman) {
  MARK_INDEX = [];
  const sents = splitSentences(t);
  const mean = R.burst.mean || (sents.reduce((a, s) => a + (s.match(/[a-z']+/gi) || []).length, 0) / Math.max(sents.length, 1));
  let cursor = 0; const segs = sents.map(se => { let i = t.indexOf(se.slice(0, Math.min(14, se.length)), cursor); const st = i === -1 ? cursor : i; cursor = st + se.length; return { st, en: st + se.length, text: se }; });
  const perpPhraseSet = new Set();
  if (R.perp.lowSpans && R.perp.toks) { R.perp.lowSpans.forEach(([a, b]) => { perpPhraseSet.add(R.perp.toks.slice(a, b + 1).join(" ")); }); }
  let html = ""; let aiMarks = 0; let aiSents = 0; let totalSents = segs.length; let markN = 0;
  segs.forEach((seg, si) => {
    if (si > 0) { const prevEnd = segs[si - 1].en; if (seg.st > prevEnd) html += escWithBreaks(t.slice(prevEnd, seg.st)); }
    else if (seg.st > 0) { html += escWithBreaks(t.slice(0, seg.st)); }
    // Use the ORIGINAL text slice (keeps any newlines the user typed inside a sentence) rather than
    // the whitespace-collapsed sentence, so highlighting never reformats the text. Offsets line up
    // because a "\n" and a space are both one character. Fall back to seg.text if lengths differ.
    const origSlice = t.slice(seg.st, seg.en);
    const local = (origSlice.length === seg.text.length) ? origSlice : seg.text;
    const lowLocal = local.toLowerCase();
    const spans = [];
    // Each span carries a `sig` key so we can optionally show ONLY one signal's detections.
    const wantSig = SOLO_SIGNAL;
    const allow = (sig) => !wantSig || wantSig === sig;
    if (wantSig === "perplexity") {
      // SOLO perplexity: highlight EVERY predictable word (surprisal < 0.40) so the user sees the
      // full reason behind the score, not just the long runs shown in normal mode.
      const qset = new Set(words(LAST && LAST.question || "").filter(x => x.length > 3));
      let wm2; const wre = /[A-Za-z']+/g; let prevTok = null;
      while ((wm2 = wre.exec(local)) !== null) {
        const tok = wm2[0].toLowerCase();
        let s = surprisalForWord(prevTok, tok);
        if (qset.has(tok)) s = Math.max(s, 0.55);
        prevTok = tok;
        if (s < 0.40) spans.push({ s: wm2.index, e: wm2.index + wm2[0].length, cls: "hl-perp", v: "AI", sig: "perplexity", label: "Predictable word", kind: "perp", tip: `"${wm2[0]}" is a high-probability continuation (low perplexity). Words like this are what push the perplexity score up.` });
      }
    } else if (allow("perplexity")) perpPhraseSet.forEach(ph => { if (ph.split(" ").length >= 4) { const i = lowLocal.indexOf(ph); if (i !== -1) spans.push({ s: i, e: i + ph.length, cls: "hl-perp", v: "AI", sig: "perplexity", label: "Low perplexity", kind: "perp", tip: "A run of highly predictable words. An AI correlate, one indicator among several." }); } });
    if (wantSig === "cohesion") {
      // SOLO cohesion: highlight the document's top topic terms wherever they recur, showing the
      // even topical texture that drives the score.
      const topSet = new Set((R.cohesion.topTerms || []));
      if (topSet.size) { let wm3; const wre3 = /[A-Za-z']+/g; while ((wm3 = wre3.exec(local)) !== null) { if (topSet.has(wm3[0].toLowerCase())) spans.push({ s: wm3.index, e: wm3.index + wm3[0].length, cls: "hl-token", v: "AI", sig: "cohesion", label: "Topic term", kind: null, tip: `"${wm3[0]}" is one of the document's core topic words. The more evenly these recur across every sentence, the more even (AI-like) the topical texture.` }); } }
    }
    if (allow("token")) R.token.tmpl && R.token.tmpl.slice(0, 6).forEach(([k]) => { let i = 0; while ((i = lowLocal.indexOf(k, i)) !== -1) { spans.push({ s: i, e: i + k.length, cls: "hl-token", v: "AI", sig: "token", label: "Templated repeat", kind: "template", tip: "A function-word template that recurs across the text. Leans AI." }); i += k.length; } });
    if (allow("style")) R.style.styleSpans && R.style.styleSpans.forEach(sp => {
      if (sp.s >= seg.st && sp.e <= seg.en) {
        let label = "Stylistic";
        const kind = sp.kind || "";
        if (kind === "aiWord") label = "AI word";
        else if (kind === "aiPhrase") label = "AI phrase";
        else if (kind === "participial") label = "Participial padding";
        else if (kind === "triadic") label = "Triadic list";
        else if (kind === "closer") label = "Summary closer";
        else if (kind === "intro") label = "Signpost intro";
        else if (kind === "combo") label = "AI combo";
        else if (kind === "copula") label = "Inflated copula";
        else if (kind === "contrastive") label = "Contrastive formula";
        spans.push({ s: sp.s - seg.st, e: sp.e - seg.st, cls: "hl-style", v: "AI", sig: "style", label, kind, matched: sp.matched, tip: sp.tip.replace(/^Stylistic:\s*/, "") });
      }
    });
    if (allow("grammar")) R.grammar.grammarSpans && R.grammar.grammarSpans.forEach(sp => {
      if (sp.s >= seg.st && sp.e <= seg.en) {
        if (sp.v === "AI") { spans.push({ s: sp.s - seg.st, e: sp.e - seg.st, cls: sp.cls || "hl-perp", v: "AI", sig: "grammar", label: sp.label || "AI mechanics", kind: sp.kind, tip: sp.tip, fix: sp.fix }); }
        else if (showHuman || wantSig === "grammar") { spans.push({ s: sp.s - seg.st, e: sp.e - seg.st, cls: "hl-human", v: "human", sig: "grammar", label: sp.label || "Grammar", kind: "grammarErr", tip: sp.tip.replace(/^Grammar:\s*/, ""), fix: sp.fix }); }
      }
    });
    if (showHuman && !wantSig) {
      let dm; const dRe = /\b1[0-9]{3}\b|\b20[0-9]{2}\b/g; while ((dm = dRe.exec(local)) !== null) { spans.push({ s: dm.index, e: dm.index + dm[0].length, cls: "hl-human", v: "human", sig: "style", label: "Specific", tip: "A concrete date. Verifiable specificity is the most durable human marker." }); }
      let pm; const pRe = /(?<=[a-z,]\s)[A-Z][a-z]{2,}/g; while ((pm = pRe.exec(local)) !== null) { if (!STARTERS.has(pm[0])) spans.push({ s: pm.index, e: pm.index + pm[0].length, cls: "hl-human", v: "human", sig: "style", label: "Specific", tip: "A named reference (proper noun). Concrete specifics pull human-ward." }); }
    }
    spans.sort((a, b) => a.s - b.s || (a.e - a.s) - (b.e - b.s));
    const kept = []; let last = -1; for (const sp of spans) { if (sp.s >= last) { kept.push(sp); last = sp.e; } }
    let inner = ""; let idx = 0;
    for (const sp of kept) {
      if (sp.s > idx) inner += esc(local.slice(idx, sp.s));
      if (sp.v === "AI") aiMarks++;
      markN++;
      const snippet = local.slice(sp.s, sp.e);
      const rem = sp.v === "AI" ? remedyText(sp.kind, sp.matched || snippet) : null;
      // grammar spans carry their own concrete fix; prefer it.
      const whyText = sp.tip;
      const fixText = sp.fix || (rem ? rem.fix : null);
      MARK_INDEX.push({ n: markN, label: sp.label, tip: whyText, text: snippet, cls: sp.cls, sentence: local, why: (rem && !sp.fix) ? rem.why : whyText, fix: fixText });
      const dataFix = fixText ? ` data-fix="${esc(fixText)}"` : "";
      inner += `<mark class="${sp.cls}" data-n="${markN}" data-label="${esc(sp.label)}" data-tip="${esc((rem && !sp.fix) ? rem.why : whyText)}"${dataFix} data-v="${sp.v}">${esc(snippet)}</mark>`;
      idx = sp.e;
    }
    if (idx < local.length) inner += esc(local.slice(idx));
    const inBurstRun = R.burst.runIdx && R.burst.runIdx.has(si);
    const sv = scoreSentence(seg.text, mean);
    const classes = [];
    // In solo mode we only draw the burstiness underline (for the burstiness signal); the composite
    // "ai-sent" shading is suppressed so the view shows exactly one signal's detections.
    const soloBurstOnly = SOLO_SIGNAL === "burstiness";
    const soloPerturb = SOLO_SIGNAL === "perturbation";
    const suppressSent = SOLO_SIGNAL && SOLO_SIGNAL !== "burstiness";
    // SOLO perturbation: shade the sentences that sat on a local probability peak.
    const isPeak = soloPerturb && R.perturbation.peakSents && R.perturbation.peakSents.indexOf(seg.text) !== -1;
    if (isPeak) { aiMarks++; html += `<span class="hl-sent ai-sent" data-label="Probability peak" data-tip="This sentence sits on a local probability peak: it has lower perplexity than its synonym-swapped variants, meaning it walked the path of maximum probability. That is what drives the perturbation score." data-fix="Rewrite it with a less expected word choice or clause order so a synonym swap would not lower its perplexity." data-v="AI">${inner}</span>`; return; }
    if (sv.verdict === "AI" && !suppressSent && !soloBurstOnly) { classes.push("ai-sent"); aiSents++; }
    if (inBurstRun && (!SOLO_SIGNAL || soloBurstOnly)) classes.push("burst-run");
    if (classes.length) {
      let label, tip, fix;
      if (classes.indexOf("ai-sent") !== -1) {
        let reason = sv.reasonText; if (inBurstRun) reason += "; uniform-length run";
        label = "Likely AI sentence"; tip = reason + ".";
        fix = sentenceFix(sv, inBurstRun);
      }
      else { label = "Burstiness flag"; tip = "Part of a uniform-length run. Even cadence is an AI correlate; no other AI markers here."; fix = REMEDIES.burst.fix; }
      const dataFix = fix ? ` data-fix="${esc(fix)}"` : "";
      html += `<span class="hl-sent ${classes.join(" ")}" data-label="${esc(label)}" data-tip="${esc(tip)}"${dataFix} data-v="${classes.indexOf("ai-sent") !== -1 ? "AI" : "burst"}">${inner}</span>`;
    } else { html += inner; }
  });
  const sentFrac = totalSents ? aiSents / totalSents : 0;
  const markDensity = totalSents ? clamp(aiMarks / totalSents, 0, 2) / 2 : 0;
  const hlScore = Math.round(clamp(sentFrac * 0.6 + markDensity * 0.4, 0, 1) * 100);
  return { html, hlScore, aiMarks, aiSents, totalSents };
}

function threeWay(total) {
  const aiM = clamp((total - 45) / 40, 0, 1);
  const humanM = clamp((55 - total) / 40, 0, 1);
  const mixM = clamp(1 - Math.abs(total - 50) / 30, 0, 1);
  let ai = aiM, mix = mixM * 0.9, human = humanM;
  const sum = ai + mix + human || 1;
  ai = Math.round(ai / sum * 100); mix = Math.round(mix / sum * 100); human = 100 - ai - mix;
  if (human < 0) human = 0;
  return { ai, mix, human };
}
function verdictWinner(p) { const max = Math.max(p.ai, p.mix, p.human); if (max === p.ai) return "ai"; if (max === p.human) return "human"; return "mix"; }

/* ============================================================
   MAIN COMPUTE
   ============================================================ */
/* Signal weights (sum to 1). The base score is a calibrated weighted average of the
   sub-signals — this is the reliable core. A gentle logistic curve is then applied on
   top so that once several signals agree the score saturates toward the extremes
   (the "grading curve"), without collapsing genuine AI text into the middle. */
const WEIGHTS = {
  style: 0.24,
  burstiness: 0.20,
  token: 0.15,
  perplexity: 0.28,
  cohesion: 0.05,
  perturbation: 0.04,
  grammar: 0.04
};
const WEIGHT_KEYS = ["style", "burstiness", "token", "perplexity", "cohesion", "perturbation", "grammar"];
function displayWeight(key) { return WEIGHTS[key]; }

// Weighted average of sub-signal scores (0..100). This is the primary, calibrated scorer.
function weightedBase(sigMap) {
  let sum = 0, wsum = 0;
  WEIGHT_KEYS.forEach(k => { const s = (sigMap[k] != null ? sigMap[k] : 50); sum += WEIGHTS[k] * s; wsum += WEIGHTS[k]; });
  return wsum ? sum / wsum : 50;
}

// S-curve applied AROUND 50. Asymmetric on purpose: the upper half (likely-AI, base > 50) is
// steeper than the lower half, so a confident AI score is pushed up harder than a borderline
// human score is pushed down. Keeps genuine human text from being over-penalised while making
// clear AI text read clearly AI.
const CURVE_STEEPNESS = 0.09;      // lower half (base < 50): gentle
const CURVE_STEEPNESS_HI = 0.13;   // upper half (base > 50): steeper, boosts high AI scores
function applyGradingCurve(base) {
  const k = base >= 50 ? CURVE_STEEPNESS_HI : CURVE_STEEPNESS;
  const prob = 1 / (1 + Math.exp(-k * (base - 50)));
  return prob * 100;
}
// Sample the curve for display in "Why this score".
function curveSamples() {
  return [20, 35, 50, 65, 80].map(b => ({ base: b, out: Math.round(applyGradingCurve(b)) }));
}
// Render the grading curve as an inline SVG line chart, marking (base -> displayed).
function curveSVG(base, w, h) {
  w = w || 300; h = h || 150;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const X = v => pad.l + (v / 100) * iw;          // input base 0..100
  const Y = v => pad.t + (1 - v / 100) * ih;       // output 0..100
  // curve path
  let d = "";
  for (let x = 0; x <= 100; x += 2) { const y = applyGradingCurve(x); d += (x === 0 ? "M" : "L") + X(x).toFixed(1) + "," + Y(y).toFixed(1) + " "; }
  // diagonal reference (y=x, i.e. no curve)
  const diag = `M${X(0)},${Y(0)} L${X(100)},${Y(100)}`;
  const outVal = applyGradingCurve(base);
  const grid = [0, 25, 50, 75, 100];
  let gridLines = grid.map(g => `<line x1="${X(g)}" y1="${pad.t}" x2="${X(g)}" y2="${pad.t + ih}" stroke="#f3ddcf" stroke-width="1"/><line x1="${pad.l}" y1="${Y(g)}" x2="${pad.l + iw}" y2="${Y(g)}" stroke="#f3ddcf" stroke-width="1"/>`).join("");
  let xLabels = grid.map(g => `<text x="${X(g)}" y="${h - 8}" font-size="8" fill="#a99383" text-anchor="middle">${g}</text>`).join("");
  let yLabels = [0, 50, 100].map(g => `<text x="${pad.l - 6}" y="${Y(g) + 3}" font-size="8" fill="#a99383" text-anchor="end">${g}</text>`).join("");
  const col = colorFor(outVal).replace('var(--ai)', '#d64545').replace('var(--amber)', '#d98a1f').replace('var(--human)', '#2f9e54');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">
    ${gridLines}
    <path d="${diag}" stroke="#ecc9b6" stroke-width="1.2" stroke-dasharray="3 3" fill="none"/>
    <path d="${d}" stroke="#e8732e" stroke-width="2.4" fill="none"/>
    <line x1="${X(base)}" y1="${pad.t}" x2="${X(base)}" y2="${Y(outVal)}" stroke="${col}" stroke-width="1.4" stroke-dasharray="2 2"/>
    <line x1="${pad.l}" y1="${Y(outVal)}" x2="${X(base)}" y2="${Y(outVal)}" stroke="${col}" stroke-width="1.4" stroke-dasharray="2 2"/>
    <circle cx="${X(base)}" cy="${Y(outVal)}" r="4.5" fill="${col}" stroke="#fff" stroke-width="1.5"/>
    ${gridLines ? "" : ""}${xLabels}${yLabels}
    <text x="${pad.l + iw / 2}" y="${h - 0.5}" font-size="8.5" fill="#6b5749" text-anchor="middle" font-weight="700">base score &rarr;</text>
  </svg>`;
}

let LAST = null, SCORES_OPEN = true, SOLO_SIGNAL = null;
const editor = document.getElementById('editor');

/* ---- caret helpers ----
   The editor uses CSS `white-space: pre-wrap`, so newlines are literal "\n" characters inside
   text nodes. Caret save/restore MUST count characters identically to `getEditorText`
   (which reads textContent), otherwise the offset drifts by the newline after Enter and the
   caret appears to jump back up once highlight markup is re-rendered. So getCaretOffset walks
   the same text nodes and sums their lengths up to the caret, matching setCaretOffset exactly. */
function getCaretOffset() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return null;
  // Build a range from the start of the editor to the caret, then count its text-node characters
  // the same way textContent does (Range.toString drops trailing "\n", which caused the drift).
  const pre = range.cloneRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  const frag = pre.cloneContents();
  return frag.textContent.length;
}
function setCaretOffset(offset) {
  if (offset == null) return;
  let remaining = offset;
  const sel = window.getSelection();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
  let node, last = null;
  while ((node = walker.nextNode())) {
    last = node;
    const len = node.nodeValue.length;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining); range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range);
      return;
    }
    remaining -= len;
  }
  const range = document.createRange();
  if (last) { range.setStart(last, last.nodeValue.length); range.collapse(true); }
  else { range.selectNodeContents(editor); range.collapse(false); }
  sel.removeAllRanges(); sel.addRange(range);
}
function getEditorText() {
  return editor.textContent.split(String.fromCharCode(160)).join(" ");}

// Live word + character counts, shown under the editor.
function updateCounts(text) {
  const t = text != null ? text : getEditorText();
  const wc = (t.trim().match(/\S+/g) || []).length;
  const cc = t.length;
  const we = document.getElementById('wordCount'), ce = document.getElementById('charCount');
  if (we) we.textContent = wc.toLocaleString();
  if (ce) ce.textContent = cc.toLocaleString();
}

function compute() {
  const rawText = getEditorText();
  updateCounts(rawText);
  const { text: t, report: obf } = preprocess(rawText);
  const trimmed = t.trim();
  const question = document.getElementById('question').value.trim();
  const showHuman = document.getElementById('showHuman').checked;
  if (trimmed.length < 40) {
    document.getElementById('resultBox').classList.add('hidden');
    document.getElementById('resultEmpty').classList.remove('hidden');
    document.getElementById('resultEmpty').innerHTML = `${trimmed.length === 0 ? "Start typing, your AI-likeness score appears here." : "Keep going, a few sentences are needed for a reliable read."}`;
    LAST = null;
    if (editor.querySelector('mark')) paint(escWithBreaks(rawText), true);
    saveDoc();
    return;
  }
  const sents = splitSentences(trimmed);
  const wordCount = words(trimmed).length;
  const burst = scoreBurstiness(sents),
    perp = scorePerplexity(trimmed, question),
    token = scoreTokenPattern(trimmed, question),
    style = scoreStylistic(trimmed),
    cohesion = scoreCohesion(t),
    perturbation = scorePerturbation(sents),
    grammar = scoreGrammar(trimmed, sents);

  const sigMap = { style: style.score, burstiness: burst.score, token: token.score, perplexity: perp.score, cohesion: cohesion.score, perturbation: perturbation.score, grammar: grammar.score };

  // Primary calibrated scorer: weighted average, then a GENTLE grading curve on top.
  const base = weightedBase(sigMap);           // 0..100 linear
  const curved = applyGradingCurve(base);      // 0..100 S-curved around 50
  const lengthConf = calculateLengthConfidence(wordCount); // 0.2..1.0 — used for the confidence LABEL only
  // Only very short samples are nudged toward 50, and only slightly (never crush a real signal).
  const shortNudge = wordCount < 40 ? (40 - wordCount) / 40 * 0.35 : 0; // max 35% pull, only under 40 words
  const signalScore = Math.round(curved + (50 - curved) * shortNudge);

  const sigs = [
    { key: "style", name: "Stylistic fingerprint", ...style, w: displayWeight("style") },
    { key: "burstiness", name: "Burstiness", ...burst, w: displayWeight("burstiness") },
    { key: "perplexity", name: "Perplexity proxy", ...perp, w: displayWeight("perplexity") },
    { key: "token", name: "Token patterns", ...token, w: displayWeight("token") },
    { key: "cohesion", name: "Semantic cohesion", ...cohesion, w: displayWeight("cohesion") },
    { key: "perturbation", name: "Perturbation peak", ...perturbation, w: displayWeight("perturbation") },
    { key: "grammar", name: "Grammar & mechanics", ...grammar, w: displayWeight("grammar") },
  ];
  LAST = { t, trimmed, question, R: { burst, perp, token, style, cohesion, perturbation, grammar }, sigs, obf, lengthConf, wordCount, rawText, base };
  const hl = buildHighlights(trimmed, LAST.R, showHuman);
  // blend calibrated signal with sentence-level highlight agreement
  const blended = signalScore * 0.80 + hl.hlScore * 0.20;
  const total = clamp(Math.round(blended), 0, 100);
  LAST.total = total; LAST.hl = hl;

  // Rebuild the visible (highlighted) editor from the ORIGINAL raw text so the user's
  // exact characters (incl. newlines) are preserved; highlights use cleaned offsets mapped back.
  renderEditor(rawText, trimmed, hl, obf);

  renderResults(total, sigs, hl, obf, lengthConf);
  renderObfuscation(obf);
  buildPrintView();
  saveDoc();
}

// escape HTML but KEEP literal newlines (the editor renders them via CSS white-space: pre-wrap)
function escWithBreaks(s) { return esc(s); }

// Render the editor with highlight HTML; newlines stay literal and render via pre-wrap.
function renderEditor(rawText, trimmed, hl, obf) {
  const cleaned = preprocess(rawText).text;
  const leadLen = cleaned.length - cleaned.trimStart().length;
  const trailLen = cleaned.length - cleaned.trimEnd().length;
  let fullHtml = escWithBreaks(cleaned.slice(0, leadLen)) + hl.html + escWithBreaks(cleaned.slice(cleaned.length - trailLen));
  if (SCORES_OPEN) { paint(fullHtml, true); }
  else if (editor.querySelector('mark')) { paint(escWithBreaks(cleaned), true); }
}

/* Render highlighted HTML into the editor; restore caret. Editor is ALWAYS editable.
   Newlines are literal "\n" (pre-wrap). A browser will not let the caret sit on a final
   empty line unless a <br> follows the trailing "\n", so we append one sentinel <br> when the
   content ends in a newline. A <br> contributes nothing to textContent, so caret math (a plain
   character count) stays correct. This is what fixes "Enter jumps the caret back up". */
function paint(html, keepCaret) {
  const caret = keepCaret ? getCaretOffset() : null;
  // Append a sentinel <br> when the visible content ends in a newline, so the browser lets the
  // caret sit on that final empty line. A <br> adds no character to textContent, so caret math
  // is unaffected. Check the html's own trailing text (tags stripped), not the stale DOM.
  const tailText = html.replace(/<[^>]*>/g, "");
  if (/\n$/.test(tailText) || html === "") html = html + '<br>';
  editor.innerHTML = html;
  if (keepCaret && caret != null) setCaretOffset(caret);
}
function colorFor(s) { if (s >= 62) return "var(--ai)"; if (s >= 42) return "var(--amber)"; return "var(--human)"; }
function overallLabel(s) { if (s >= 65) return "Reads AI-typical"; if (s >= 55) return "Leans AI-typical"; if (s >= 42) return "Genuinely ambiguous"; if (s >= 30) return "Leans human-typical"; return "Reads human-typical"; }
function confLabel(c) { if (c >= 0.85) return "High confidence"; if (c >= 0.6) return "Moderate confidence"; if (c >= 0.4) return "Low confidence"; return "Very low, short text"; }

function setScoresOpen(open) {
  SCORES_OPEN = open;
  document.getElementById('app').classList.toggle('scores-hidden', !open);
  document.getElementById('toggleScores').textContent = open ? "Hide score" : "Show score";
  compute();
}
function saveDoc() { try { localStorage.setItem('signalscope15', JSON.stringify({ text: getEditorText(), question: document.getElementById('question').value })); } catch (e) { } }
function loadDoc() { try { const d = JSON.parse(localStorage.getItem('signalscope15') || 'null'); if (d) { if (d.text) editor.innerHTML = escWithBreaks(d.text); if (d.question) document.getElementById('question').value = d.question; compute(); } } catch (e) { } }

function renderResults(total, sigs, hl, obf, lengthConf) {
  document.getElementById('resultEmpty').classList.add('hidden');
  document.getElementById('resultBox').classList.remove('hidden');
  const num = document.getElementById('scoreNum'); num.textContent = total; num.style.color = colorFor(total);
  const arc = document.getElementById('ringArc'); const circ = 295; arc.style.strokeDashoffset = circ - (circ * total / 100); arc.style.stroke = colorFor(total);
  const ol = document.getElementById('overallLabel'); ol.textContent = overallLabel(total); ol.style.color = colorFor(total);
  const conf = document.getElementById('confPill'); conf.textContent = confLabel(lengthConf);
  const p = threeWay(total);
  document.getElementById('barAi').style.width = p.ai + "%"; document.getElementById('pctAi').textContent = p.ai + "%";
  document.getElementById('barMix').style.width = p.mix + "%"; document.getElementById('pctMix').textContent = p.mix + "%";
  document.getElementById('barHuman').style.width = p.human + "%"; document.getElementById('pctHuman').textContent = p.human + "%";
  const w = verdictWinner(p);
  const labelHtml = w === "ai" ? `<span class="va">AI generated</span>` : w === "human" ? `<span class="vh">human written</span>` : `<span class="vm">a mix of AI and human</span>`;
  document.getElementById('verdictLine').innerHTML = `If we have to guess, this text is most likely ${labelHtml}.`;
  document.getElementById('vreason').innerHTML = buildReason(total, sigs, hl, lengthConf);
  renderSignals(sigs);
  const gsig = sigs.find(s => s.key === "grammar");
  renderGrammar(LAST.R.grammar.issues || [], gsig, document.getElementById('showHuman').checked);
  renderSoloBanner(sigs, hl);
}
// Banner shown above the editor when a single signal is being highlighted in isolation.
function renderSoloBanner(sigs, hl) {
  const el = document.getElementById('soloBanner');
  if (!el) return;
  if (!SOLO_SIGNAL) { el.classList.add('hidden'); el.innerHTML = ""; return; }
  const sig = sigs.find(s => s.key === SOLO_SIGNAL);
  if (!sig) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (SOLO_SIGNAL === "burstiness") {
    const runN = (LAST.R.burst.runIdx && LAST.R.burst.runIdx.size) || 0;
    el.innerHTML = `<b>Showing only: Burstiness (${sig.score}/100).</b> The amber underline marks a run of ${runN || 'no'} near-uniform-length sentences. Even cadence is an AI correlate. <button class="solo-clear" data-sig="">Show all signals</button>`;
    return;
  }
  const n = hl.aiMarks;
  const desc = {
    style: "every documented AI word, stock phrase, triadic list, participial padding and inflated copula found",
    token: "every function-word template that recurs across the text",
    perplexity: "every highly predictable (low-perplexity) word driving the score, not just the long runs",
    cohesion: "every occurrence of the document's core topic words, showing how evenly they recur",
    perturbation: "every sentence that sits on a local probability peak (lower perplexity than its synonym variants)",
    grammar: "every grammar, spelling and mechanics issue (green = human-leaning errors, red = AI mechanical tells)"
  }[SOLO_SIGNAL] || "this signal's detections";
  el.innerHTML = `<b>Showing only: ${esc(sig.name)} (${sig.score}/100).</b> This is the full reason behind the score: ${n} highlight${n === 1 ? '' : 's'} covering ${desc}. Hover any mark for why and how to fix. <button class="solo-clear" data-sig="">Show all signals</button>`;
}
// Grammar-check panel (inside the Signal breakdown card). Only shown when the human-leaning
// toggle is on, since it lists human-leaning writing issues.
function renderGrammar(issues, gsig, showHuman) {
  const block = document.getElementById('grammarBlock');
  const list = document.getElementById('grammarList');
  const count = document.getElementById('grammarCount');
  const sigEl = document.getElementById('grammarSignal');
  if (!block || !list) return;
  block.classList.toggle('hidden', !showHuman);
  if (!showHuman) return;
  const human = issues.filter(i => i.v !== "AI");
  const ai = issues.filter(i => i.v === "AI");
  count.textContent = issues.length ? `${issues.length} found` : "clean";
  count.classList.toggle('clean', issues.length === 0);
  if (sigEl && gsig) {
    const badge = gsig.dir === "AI" ? `<span class="dir ai">&#9650; AI</span>` : gsig.dir === "human" ? `<span class="dir human">&#9660; human</span>` : `<span class="dir neutral">neutral</span>`;
    sigEl.innerHTML = `<div class="gsig-row"><span class="gsig-lbl">Grammar signal</span><span class="gsig-bar"><i style="width:${gsig.score}%;background:${colorFor(gsig.score)}"></i></span><span class="gsig-num" style="color:${colorFor(gsig.score)}">${gsig.score}</span>${badge}</div><div class="gsig-note">${human.length} real error(s) lean human · ${ai.length} AI mechanical tell(s). Real errors pull this signal toward "human", since models rarely make them. They are underlined in green in the text above.</div>`;
  }
  if (!issues.length) { list.innerHTML = `<div class="grammar-clean">&#10003; No grammar, spelling, or punctuation issues found.</div>`; return; }
  const order = human.concat(ai);
  list.innerHTML = order.slice(0, 40).map(iss => {
    const quote = LAST && LAST.t ? LAST.t.slice(iss.s, iss.e) : "";
    return `<div class="gitem ${iss.v === 'AI' ? 'g-ai' : ''}"><div class="gtype">${esc(iss.type)}${iss.v === 'AI' ? ' · AI tell' : ' · human-leaning'}</div>${quote.trim() ? `<span class="gquote">${esc(quote.length > 40 ? quote.slice(0, 40) + '…' : quote)}</span>` : ''}<div class="gmsg">${esc(iss.msg)}</div><div class="gfix">&#8594; ${esc(iss.fix)}</div></div>`;
  }).join("");
}
function buildReason(total, sigs, hl, lengthConf) {
  const top = [...sigs].sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
  const aiDrivers = top.filter(s => s.dir === "AI").slice(0, 2).map(s => s.name.toLowerCase());
  const humanDrivers = top.filter(s => s.dir === "human").slice(0, 2).map(s => s.name.toLowerCase());
  const base = LAST ? Math.round(LAST.base) : total;
  const cur = clamp(Math.round(applyGradingCurve(base)), 0, 100);
  let parts = [`<strong>Why:</strong> a weighted average of the ${sigs.length} signals gives a base of <strong>${base}/100</strong>, which the grading curve maps to <strong>${total}/100</strong>.`];
  if (aiDrivers.length) parts.push(`Pushed up mainly by ${aiDrivers.join(" and ")}.`);
  if (humanDrivers.length) parts.push(`Pulled toward human by ${humanDrivers.join(" and ")}.`);
  if (hl) parts.push(`${hl.aiSents} of ${hl.totalSents} sentences and ${hl.aiMarks} phrase(s) flagged.`);
  if (lengthConf < 0.6) parts.push(`Only ${LAST ? LAST.wordCount : ''} words, so treat this as ${confLabel(lengthConf).toLowerCase()}. A single word can swing a short sample.`);
  if (total >= 42 && total < 55) parts.push(`This is the ambiguous band where clean human and AI writing converge, so treat it as undecided.`);
  else if (total < 42) parts.push(`Specificity and rhythm variation are the strongest human evidence here.`);
  else if (total >= 55) parts.push(`Well-written honest essays can land here too, so treat it as an indicator, not proof.`);
  // Grading curve visual (real SVG line chart)
  parts.push(`<div class="curve-box"><div class="curve-h">Grading curve: your base to displayed score</div>${curveSVG(base, 320, 160)}<div class="curve-note">Solid orange = the S-curve. Dashed grey = a straight 1:1 line (no curve). The dot marks your base <strong>${base}</strong> mapping to <strong>${cur}</strong>: weak signals stay near the line, strong agreement is pushed toward the extremes.</div></div>`);
  parts.push(`<button class="detail-btn" id="openDetail">Open detailed grading report &rarr;</button>`);
  return parts.join(" ");
}
function dirBadge(dir) { if (dir === "AI") return `<span class="dir ai">&#9650; AI</span>`; if (dir === "human") return `<span class="dir human">&#9660; human</span>`; return `<span class="dir neutral">neutral</span>`; }
// Which signals produce per-word/-sentence highlights that can be shown in isolation.
const HIGHLIGHTABLE = new Set(["style", "token", "perplexity", "burstiness", "grammar", "cohesion", "perturbation"]);
function renderSignals(sigs) {
  const host = document.getElementById('signalList'); host.innerHTML = "";
  sigs.forEach(sig => {
    const el = document.createElement('div'); el.className = "signal";
    const canHl = HIGHLIGHTABLE.has(sig.key);
    const active = SOLO_SIGNAL === sig.key;
    const btn = canHl
      ? `<button class="sig-hl-btn${active ? ' active' : ''}" data-sig="${sig.key}">${active ? 'Clear highlight' : 'Highlight in text'}</button>`
      : `<span class="sig-hl-note">document-level signal, no per-word marks</span>`;
    el.innerHTML = `
      <div class="signal-top">
        <span class="nm">${sig.name}</span>
        <span class="info" data-info="${esc(SIGNAL_INFO[sig.key])}">i</span>
        ${dirBadge(sig.dir)}
      </div>
      <div class="signal-meter">
        <div class="track"><i style="width:${sig.score}%;background:${colorFor(sig.score)}"></i></div>
        <div class="pct" style="color:${colorFor(sig.score)}">${sig.score}</div>
        <div class="wt">wt ${Math.round(sig.w * 100)}%</div>
      </div>
      ${sig.ev ? `<div class="signal-ev">${sig.ev}</div>` : `<div class="signal-ev">${sig.detail}</div>`}
      <div class="sig-actions">${btn}</div>`;
    host.appendChild(el);
  });
}
function renderObfuscation(obf) {
  const card = document.getElementById('obfuscCard');
  const body = document.getElementById('obfuscBody');
  const bits = [];
  if (obf.homoglyphs) bits.push(`<em>${obf.homoglyphs}</em> homoglyph character(s) (e.g. Cyrillic/Greek look-alikes) normalized to ASCII before scoring.`);
  if (obf.zeroWidth) bits.push(`<em>${obf.zeroWidth}</em> zero-width / invisible character(s) stripped.`);
  if (obf.paraphraser.length) bits.push(`Possible paraphraser signature. Awkward thesaurus markers found: <em>${obf.paraphraser.slice(0, 6).join(", ")}</em>. Flagging <b>likely paraphrased / spin-bot active</b>.`);
  if (!bits.length) { card.style.display = "none"; return; }
  card.style.display = "";
  body.innerHTML = bits.join(" ");
}

// Detailed grading report shown in a popout modal — full step-by-step progression.
function buildDetailReport() {
  if (!LAST) return;
  const base = Math.round(LAST.base);
  const curved = Math.round(applyGradingCurve(LAST.base));
  const hlBlend = Math.round(LAST.hl.hlScore);
  const total = LAST.total;
  const p = threeWay(total);
  const w = verdictWinner(p);
  const verdictTxt = w === "ai" ? "AI generated" : w === "human" ? "human written" : "a mix of AI and human";
  // Signal contribution table (weight × score), sorted by absolute contribution to deviation from 50.
  const rows = LAST.sigs.map(s => {
    const contrib = s.w * s.score;
    const pull = s.w * (s.score - 50); // signed pull relative to neutral
    return { name: s.name, score: s.score, w: s.w, contrib, pull, dir: s.dir };
  }).sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull));
  const tableRows = rows.map(r => {
    const col = colorFor(r.score).replace('var(--ai)', '#d64545').replace('var(--amber)', '#d98a1f').replace('var(--human)', '#2f9e54');
    const pullStr = (r.pull >= 0 ? "+" : "") + r.pull.toFixed(1);
    return `<tr><td>${esc(r.name)}</td><td style="font-weight:700;color:${col}">${r.score}</td><td>${Math.round(r.w * 100)}%</td><td><div class="d-bar"><i style="width:${Math.round(r.score)}%;background:${col}"></i></div></td><td style="text-align:right;font-weight:700;color:${r.pull >= 0 ? '#d64545' : '#2f9e54'}">${pullStr}</td></tr>`;
  }).join("");
  const grammarIssues = (LAST.R.grammar.issues || []).filter(i => i.v !== "AI");
  const gList = grammarIssues.length ? grammarIssues.slice(0, 20).map(iss => {
    const quote = LAST.t.slice(iss.s, iss.e).trim();
    return `<div class="gitem"><div class="gtype">${esc(iss.type)}</div>${quote ? `<span class="gquote">${esc(quote.length > 50 ? quote.slice(0, 50) + '…' : quote)}</span>` : ''}<div class="gmsg">${esc(iss.msg)}</div><div class="gfix">&#8594; ${esc(iss.fix)}</div></div>`;
  }).join("") : `<div class="grammar-clean">&#10003; No grammar or spelling issues found.</div>`;

  const dateStr = new Date().toLocaleString();
  document.getElementById('detailBody').innerHTML = `
    <div class="d-h">Detailed grading report</div>
    <div class="d-sub">Signal Scope 1.7 · ${LAST.wordCount} words · ${confLabel(LAST.lengthConf)} · generated ${esc(dateStr)}</div>

    <h3>1 · How the final score was built</h3>
    <div class="d-steps">
      <div class="d-step"><b>${base}</b><span>weighted base</span></div>
      <div class="d-arrow">&rarr;</div>
      <div class="d-step"><b>${curved}</b><span>after curve</span></div>
      <div class="d-arrow">&rarr;</div>
      <div class="d-step"><b>${hlBlend}</b><span>highlight agree</span></div>
      <div class="d-arrow">&rarr;</div>
      <div class="d-step" style="border-color:var(--brand);box-shadow:2px 2px 0 var(--brand)"><b style="color:var(--brand-2)">${total}</b><span>final</span></div>
    </div>
    <div class="d-formula">
      base = &Sigma;(weight&times;signal) = <b>${base}</b><br>
      curved = logistic(base), steepness ${CURVE_STEEPNESS_HI} above 50 / ${CURVE_STEEPNESS} below &rarr; <b>${curved}</b><br>
      final = 0.80&times;curved + 0.20&times;highlight(${hlBlend}) = <b>${total}</b> / 100<br>
      verdict: AI ${p.ai}% · mix ${p.mix}% · human ${p.human}% &rarr; <b>${verdictTxt}</b>
    </div>

    <h3>2 · The grading curve</h3>
    <div class="d-curve-wrap">${curveSVG(LAST.base, 380, 200)}</div>
    <div class="d-note">The solid orange line is the S-curve; the dashed diagonal is a straight 1:1 mapping. The curve is asymmetric on purpose: the upper half (base above 50) is steeper, so a confident AI score is pushed up harder than a borderline human score is pushed down. Your base <b>${base}</b> lands at <b>${curved}</b>.</div>

    <h3>3 · Signal contributions (sorted by pull from neutral)</h3>
    <table class="d-table">
      <thead><tr><th>Signal</th><th>Score</th><th>Weight</th><th>Level</th><th style="text-align:right">Pull</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div class="d-note">"Pull" = weight × (score − 50). Positive (red) pushes toward AI; negative (green) pushes toward human. These sum to the base's deviation from 50.</div>

    <h3>4 · Grammar &amp; proofreading (${grammarIssues.length} issue${grammarIssues.length === 1 ? '' : 's'})</h3>
    <div class="grammar-list">${gList}</div>

    <div class="d-note" style="margin-top:20px;padding-top:14px;border-top:1px dashed var(--line-2)">This tool reads statistical residue, not authorship. Clean, well-organized human writing (and ESL writing) can score high. Use the score to start a conversation, never to end one.</div>
  `;
}

function clsColor(cls) { return cls === "hl-perp" ? "#f8d7d4" : cls === "hl-burst" ? "#fbe6c4" : cls === "hl-token" ? "#e0d4f7" : cls === "hl-style" ? "#f7d4e6" : cls === "hl-human" ? "#d4f0dd" : "#eee"; }
function buildPrintView() {
  if (!LAST) { document.getElementById('printView').innerHTML = ""; return; }
  const p = threeWay(LAST.total); const w = verdictWinner(p);
  const verdictTxt = w === "ai" ? "AI generated" : w === "human" ? "human written" : "a mix of AI and human";
  const vColor = LAST.total >= 62 ? "#d64545" : LAST.total >= 42 ? "#d98a1f" : "#2f9e54";
  const ptext = renderPrintText(LAST.trimmed, LAST.R, document.getElementById('showHuman').checked);
  const sigRows = LAST.sigs.map(s => `<div class="pb"><i style="width:${Math.round(s.score * 0.9)}px;background:${s.score >= 62 ? '#d64545' : s.score >= 42 ? '#d98a1f' : '#2f9e54'}"></i> ${s.name}: <b>${s.score}</b>/100 · ${s.dir} · wt ${Math.round(s.w * 100)}%</div>`).join("");
  const obfLine = (LAST.obf && (LAST.obf.homoglyphs || LAST.obf.zeroWidth || LAST.obf.paraphraser.length)) ?
    `<div style="font-size:11px;color:#c85a18;margin-top:8px"><b>Adversarial preprocessing:</b> ${LAST.obf.homoglyphs} homoglyph(s), ${LAST.obf.zeroWidth} invisible char(s)${LAST.obf.paraphraser.length ? `, paraphraser markers: ${LAST.obf.paraphraser.slice(0, 5).join(", ")}` : ""}.</div>` : "";
  // page 2: each numbered mark with full sentence, highlight, why + actionable fix
  const items = MARK_INDEX.map(m => {
    let sent = m.sentence;
    const i = sent.indexOf(m.text);
    let sentHtml;
    if (i !== -1) { sentHtml = esc(sent.slice(0, i)) + `<mark style="background:${clsColor(m.cls)}">${esc(m.text)}</mark>` + esc(sent.slice(i + m.text.length)); }
    else sentHtml = esc(sent);
    const fixHtml = m.fix ? `<div class="pfix"><b>How to fix:</b> ${esc(m.fix)}</div>` : "";
    return `<div class="pitem"><div class="ph"><span class="pn">#${m.n}</span>${esc(m.label)}</div><div class="psent">${sentHtml}</div><div class="pwhy"><b>Why:</b> ${esc(m.why)}</div>${fixHtml}</div>`;
  }).join("");
  const dateStr = new Date().toLocaleDateString();
  document.getElementById('printView').innerHTML = `
    <div class="print-page">
      <div class="phead">
        <h1>Signal Scope Analysis Report</h1>
        <div class="pbrand">Signal Scope 1.7<br>by KH</div>
      </div>
      <div class="pmeta">Trained via Claude Opus 4.8 · Model licensed CC BY-NC-SA 4.0 · Generated ${dateStr} · kaheichan.neocities.org</div>
      <div class="pscore-wrap">
        <div class="pscore-big"><b style="color:${vColor}">${LAST.total}</b><span>/ 100 AI-likeness</span></div>
        <div class="pscore-side">
          <div class="pverdict">Best guess: <span style="color:${vColor}">${verdictTxt}</span> · ${confLabel(LAST.lengthConf)}</div>
          <div class="pbars">AI ${p.ai}% &nbsp;/&nbsp; AI+human ${p.mix}% &nbsp;/&nbsp; Human ${p.human}%<br>${sigRows}</div>
          ${obfLine}
        </div>
      </div>
      <h2 class="psec">Annotated text (${MARK_INDEX.length} marks)</h2>
      <div class="ptext">${ptext}</div>
    </div>
    <div class="print-page">
      <div class="phead"><h1>Highlight Index &amp; Feedback</h1><div class="pbrand">Signal Scope 1.7</div></div>
      <div class="pmeta">Each number matches a highlight on the previous page. For every flag you get the sentence, why it fired, and a concrete rewrite you can apply.</div>
      <h2 class="psec">What the numbers mean &amp; how to fix them</h2>
      ${items || "<div class='pitem'>No AI tells were flagged in this text.</div>"}
      <div class="pfoot">Signal Scope 1.7 by KH · © 2026 KH · Model licensed CC BY-NC-SA 4.0 · kaheichan.neocities.org · This detector can be wrong; treat every score as an indicator, never proof.</div>
    </div>
  `;
}
function buildPrintDoc() {
  const text = getEditorText();
  document.getElementById('printView').innerHTML = `<div class="print-page"><div class="ptext" style="white-space:pre-wrap;font-size:13px;line-height:2.0">${esc(text)}</div></div>`;
}
function renderPrintText(t, R, showHuman) {
  let n = 0;
  const sents = splitSentences(t);
  let cursor = 0; const segs = sents.map(se => { let i = t.indexOf(se.slice(0, Math.min(14, se.length)), cursor); const st = i === -1 ? cursor : i; cursor = st + se.length; return { st, en: st + se.length, text: se }; });
  const perpPhraseSet = new Set(); if (R.perp.lowSpans && R.perp.toks) { R.perp.lowSpans.forEach(([a, b]) => perpPhraseSet.add(R.perp.toks.slice(a, b + 1).join(" "))); }
  let html = "";
  segs.forEach((seg, si) => {
    if (si > 0) { const pe = segs[si - 1].en; if (seg.st > pe) html += esc(t.slice(pe, seg.st)); } else if (seg.st > 0) { html += esc(t.slice(0, seg.st)); }
    const local = seg.text; const low = local.toLowerCase(); const spans = [];
    perpPhraseSet.forEach(ph => { if (ph.split(" ").length >= 4) { const i = low.indexOf(ph); if (i !== -1) spans.push({ s: i, e: i + ph.length, cls: "hl-perp" }); } });
    R.token.tmpl && R.token.tmpl.slice(0, 6).forEach(([k]) => { let i = 0; while ((i = low.indexOf(k, i)) !== -1) { spans.push({ s: i, e: i + k.length, cls: "hl-token" }); i += k.length; } });
    R.style.styleSpans && R.style.styleSpans.forEach(sp => { if (sp.s >= seg.st && sp.e <= seg.en) spans.push({ s: sp.s - seg.st, e: sp.e - seg.st, cls: "hl-style" }); });
    R.grammar.grammarSpans && R.grammar.grammarSpans.forEach(sp => { if (sp.s >= seg.st && sp.e <= seg.en) { if (sp.v === "AI") spans.push({ s: sp.s - seg.st, e: sp.e - seg.st, cls: sp.cls || "hl-perp" }); else if (showHuman) spans.push({ s: sp.s - seg.st, e: sp.e - seg.st, cls: "hl-human" }); } });
    if (showHuman) { let dm; const dRe = /\b1[0-9]{3}\b|\b20[0-9]{2}\b/g; while ((dm = dRe.exec(local)) !== null) spans.push({ s: dm.index, e: dm.index + dm[0].length, cls: "hl-human" }); let pm; const pRe = /(?<=[a-z,]\s)[A-Z][a-z]{2,}/g; while ((pm = pRe.exec(local)) !== null) { if (!STARTERS.has(pm[0])) spans.push({ s: pm.index, e: pm.index + pm[0].length, cls: "hl-human" }); } }
    spans.sort((a, b) => a.s - b.s || (a.e - a.s) - (b.e - b.s));
    const kept = []; let last = -1; for (const sp of spans) { if (sp.s >= last) { kept.push(sp); last = sp.e; } }
    let inner = ""; let idx = 0;
    for (const sp of kept) { if (sp.s > idx) inner += esc(local.slice(idx, sp.s)); n++; inner += `<mark style="background:${clsColor(sp.cls)}">${esc(local.slice(sp.s, sp.e))}<sup class="hn">${n}</sup></mark>`; idx = sp.e; }
    if (idx < local.length) inner += esc(local.slice(idx));
    html += inner;
  });
  return html;
}

/* ============================================================
   WIRING
   ============================================================ */
let debounce;
function liveUpdate() { clearTimeout(debounce); debounce = setTimeout(() => compute(), 200); }
let UNDO = [], REDO = [], lastSnap = "";
editor.addEventListener('beforeinput', () => { const t = getEditorText(); if (t !== lastSnap) { UNDO.push({ text: t, caret: getCaretOffset() || 0 }); if (UNDO.length > 120) UNDO.shift(); REDO = []; lastSnap = t; } });
editor.addEventListener('input', () => { lastSnap = getEditorText(); updateCounts(lastSnap); liveUpdate(); });
editor.addEventListener('keydown', e => {
  // Enter inserts a literal "\n" character (rendered by pre-wrap). No <br>, no block <div>,
  // so caret offsets stay a simple character count.
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    document.execCommand('insertText', false, '\n');
    lastSnap = getEditorText();
    liveUpdate();
    return;
  }
  const z = (e.key === 'z' || e.key === 'Z'), y = (e.key === 'y' || e.key === 'Y'), mod = e.ctrlKey || e.metaKey;
  if (mod && z && !e.shiftKey) { e.preventDefault(); if (UNDO.length) { REDO.push({ text: getEditorText(), caret: getCaretOffset() || 0 }); const s = UNDO.pop(); editor.innerHTML = escWithBreaks(s.text); lastSnap = s.text; setCaretOffset(s.caret); clearTimeout(debounce); debounce = setTimeout(() => compute(), 200); } }
  else if (mod && (y || (z && e.shiftKey))) { e.preventDefault(); if (REDO.length) { UNDO.push({ text: getEditorText(), caret: getCaretOffset() || 0 }); const s = REDO.pop(); editor.innerHTML = escWithBreaks(s.text); lastSnap = s.text; setCaretOffset(s.caret); clearTimeout(debounce); debounce = setTimeout(() => compute(), 200); } }
});
// floating tooltip for highlights + (i) info — now includes actionable fix
const floatTip = document.getElementById('floatTip');
function showFloat(target) {
  let label, tip, v, fix = null;
  if (target.dataset.info !== undefined) { label = "What this signal means"; tip = target.dataset.info; v = "info"; }
  else { label = target.dataset.label; tip = target.dataset.tip; v = target.dataset.v; fix = target.dataset.fix || null; }
  if (!tip) return;
  const badgeCls = v === "AI" ? "ai" : v === "human" ? "human" : v === "burst" ? "burst" : "";
  let html = (v === "info" ? "" : `<span class="badge ${badgeCls}">${esc(label)}</span>`);
  html += `<div class="tip-why">${v === "info" ? "" : "<b style='color:#ffd9a8;font-size:9.5px;letter-spacing:.05em'>WHY</b> "}${esc(tip)}</div>`;
  if (fix) html += `<div class="tip-fix"><b>How to fix</b><br>${esc(fix)}</div>`;
  floatTip.innerHTML = html;
  floatTip.classList.add('show');
  const r = target.getBoundingClientRect();
  let top = r.bottom + 8, left = r.left;
  floatTip.style.left = "0px"; floatTip.style.top = "0px";
  const tw = floatTip.offsetWidth, th = floatTip.offsetHeight;
  if (left + tw > window.innerWidth - 12) left = window.innerWidth - tw - 12;
  if (left < 8) left = 8;
  if (top + th > window.innerHeight - 12) top = r.top - th - 8;
  floatTip.style.left = left + "px"; floatTip.style.top = top + "px";
}
function hideFloat() { floatTip.classList.remove('show'); }
document.addEventListener('mouseover', e => { const m = e.target.closest('mark[data-tip], .hl-sent[data-tip], .info[data-info]'); if (m) showFloat(m); });
document.addEventListener('mouseout', e => { const m = e.target.closest('mark[data-tip], .hl-sent[data-tip], .info[data-info]'); if (m) hideFloat(); });
editor.addEventListener('paste', e => { e.preventDefault(); const text = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, text); liveUpdate(); });
document.getElementById('question').addEventListener('input', liveUpdate);
document.getElementById('toggleScores').addEventListener('click', () => setScoresOpen(!SCORES_OPEN));
document.getElementById('showHuman').addEventListener('change', () => compute());
// Per-signal "Highlight in text" buttons + the banner's "Show all" — toggle SOLO_SIGNAL.
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.sig-hl-btn, .solo-clear');
  if (!b) return;
  const key = b.dataset.sig;
  SOLO_SIGNAL = (key && SOLO_SIGNAL !== key) ? key : null;
  compute();
});
document.getElementById('whyToggle').addEventListener('click', () => {
  const w = document.getElementById('vreason'), btn = document.getElementById('whyToggle');
  const open = w.classList.toggle('hidden') === false;
  btn.textContent = open ? "Hide reasoning" : "Why this score?";
  btn.classList.toggle('open', open);
});
document.getElementById('printReport').addEventListener('click', () => { if (!LAST) { alert("Write a few sentences first."); return; } buildPrintView(); document.body.classList.add('print-report'); window.print(); setTimeout(() => document.body.classList.remove('print-report'), 200); });
document.getElementById('printDoc').addEventListener('click', () => { buildPrintDoc(); document.body.classList.add('print-doc'); window.print(); setTimeout(() => document.body.classList.remove('print-doc'), 200); });
document.getElementById('clear').addEventListener('click', () => {
  editor.innerHTML = ""; document.getElementById('question').value = ""; document.getElementById('showHuman').checked = false; LAST = null; lastSnap = ""; SOLO_SIGNAL = null; updateCounts(""); saveDoc();
  document.getElementById('resultBox').classList.add('hidden'); document.getElementById('resultEmpty').classList.remove('hidden');
  document.getElementById('resultEmpty').innerHTML = `Start typing, your AI-likeness score appears here.`;
});
document.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', () => { editor.innerHTML = escWithBreaks(SAMPLES[b.dataset.sample]); lastSnap = getEditorText(); compute(); }));
document.getElementById('openReport').addEventListener('click', () => document.getElementById('reportModal').classList.add('open'));
document.getElementById('closeReport').addEventListener('click', () => document.getElementById('reportModal').classList.remove('open'));
document.getElementById('reportModal').addEventListener('click', e => { if (e.target.id === 'reportModal') document.getElementById('reportModal').classList.remove('open'); });
// Detailed grading report modal (open button is created dynamically inside "Why this score")
document.addEventListener('click', e => {
  if (e.target && e.target.id === 'openDetail') { if (!LAST) return; buildDetailReport(); document.getElementById('detailModal').classList.add('open'); }
});
document.getElementById('closeDetail').addEventListener('click', () => document.getElementById('detailModal').classList.remove('open'));
document.getElementById('detailModal').addEventListener('click', e => { if (e.target.id === 'detailModal') document.getElementById('detailModal').classList.remove('open'); });
// Release notes modal
document.getElementById('openReleases').addEventListener('click', e => { e.preventDefault(); document.getElementById('releaseModal').classList.add('open'); });
document.getElementById('closeReleases').addEventListener('click', () => document.getElementById('releaseModal').classList.remove('open'));
document.getElementById('releaseModal').addEventListener('click', e => { if (e.target.id === 'releaseModal') document.getElementById('releaseModal').classList.remove('open'); });
window.addEventListener('beforeunload', () => { try { saveDoc(); } catch (e) { } });
loadDoc();
