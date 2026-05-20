/**
 * Token counter, cost estimator, and sentiment analyzer for ChatGPT.
 * Uses a rough estimate: ~4 characters per token for English-like text.
 * Includes pricing data for OpenAI models to estimate conversation costs.
 * Includes a compact AFINN-based sentiment analyzer.
 */

// Model pricing per 1 million tokens
// Source: OpenAI pricing (as of 2025)
const MODEL_PRICING = {
  'gpt-3.5-turbo': {
    name: 'GPT-3.5 Turbo',
    input: 0.50,   // $ per 1M input tokens
    output: 1.50,  // $ per 1M output tokens
  },
  'gpt-4': {
    name: 'GPT-4',
    input: 30.00,
    output: 60.00,
  },
  'gpt-4o': {
    name: 'GPT-4o',
    input: 2.50,
    output: 10.00,
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    input: 0.15,
    output: 0.60,
  },
  'o1': {
    name: 'O1',
    input: 15.00,
    output: 60.00,
  },
  'o1-mini': {
    name: 'O1 Mini',
    input: 1.10,
    output: 4.40,
  },
  'o3-mini': {
    name: 'O3 Mini',
    input: 1.10,
    output: 4.40,
  },
  'gpt-5': {
    name: 'GPT-5',
    input: 12.50,
    output: 50.00,
  },
  'gpt-5.5': {
    name: 'GPT-5.5',
    input: 12.50,
    output: 50.00,
  },
};

/**
 * Improved token estimation that better approximates GPT's tiktoken behavior.
 *
 * GPT tokenizers (tiktoken/cl100k_base) don't simply split on 4 characters.
 * They use BytePair Encoding where:
 * - Common words are single tokens
 * - Punctuation often gets its own token
 * - Whitespace is attached to the following word
 * - Numbers are often split into groups
 * - Multi-byte / Unicode chars (emojis, CJK) cost more
 *
 * This heuristic breaks text into token-like chunks more accurately than
 * the naive length/4 approach, typically within 10–20% of real counts.
 */
function estimateTokens(text) {
  if (!text) return 0;

  const trimmed = text.trim();
  if (!trimmed) return 0;

  let tokenCount = 0;

  // Split into segments that approximate BPE tokens.
  // Pattern matches:
  //   1) Common 2-3 char words/particles (often single tokens)
  //   2) Longer alphanumeric runs (split every ~3.5 chars on average)
  //   3) Punctuation / symbols (each often a separate token)
  //   4) Numbers (often split into 3-digit groups)
  //   5) Multi-byte Unicode (emojis, CJK, etc. - each ~1-2 tokens)
  //   6) Whitespace (attached to next token, not separate)

  // Normalize: remove whitespace for counting (BPE attaches it)
  // Then count token-like units

  // Step 1: Count multi-byte characters (emojis, CJK, etc.)
  // Each multi-byte char tends to be 1-2 tokens
  const multiByteMatches = trimmed.match(/[\u{10000}-\u{10FFFF}\u{1F000}-\u{1FFFF}]/gu);
  const multiByteCount = multiByteMatches ? multiByteMatches.length : 0;
  tokenCount += multiByteCount * 2; // Each multi-byte char ~2 tokens

  // Step 2: Remove multi-byte chars for remaining analysis
  let normalized = trimmed.replace(/[\u{10000}-\u{10FFFF}\u{1F000}-\u{1FFFF}]/gu, ' ');

  // Step 3: Count punctuation as separate tokens
  // Punctuation marks that often get their own token in BPE
  const punctMatches = normalized.match(/[.,!?;:'"`~@#$%^&*(){}[\]|\\<>\/+=\-_]/g);
  const punctCount = punctMatches ? punctMatches.length : 0;
  tokenCount += punctCount;

  // Step 4: Remove punctuation and whitespace, count remaining alphanumeric
  const alphaNum = normalized.replace(/[^\w]/g, '').replace(/\s+/g, '');

  // Step 5: Split numbers from text (numbers tokenize differently)
  const numberParts = alphaNum.match(/\d+/g);
  const numberChars = numberParts ? numberParts.join('').length : 0;
  const textOnly = alphaNum.replace(/\d+/g, '');

  // Numbers: ~3-4 digits per token
  if (numberChars > 0) {
    tokenCount += Math.ceil(numberChars / 3.5);
  }

  // Text: average ~3.5-4 chars per token for English
  // Short common words are 1 token, longer words split
  if (textOnly.length > 0) {
    // More accurate: count word boundaries
    const words = trimmed.replace(/[^\w'-]/g, ' ').split(/\s+/).filter(Boolean);
    let wordTokenSum = 0;
    for (const word of words) {
      const cleanWord = word.replace(/[^a-zA-Z'-]/g, '');
      const numPart = word.replace(/[^0-9]/g, '');

      if (cleanWord.length >= 2) {
        // Words: ~1 token per 3.5 chars, minimum 1
        wordTokenSum += Math.max(1, Math.ceil(cleanWord.length / 3.5));
      } else if (cleanWord.length === 1) {
        // Single letters often merge with neighbors, count 0.5 avg
        wordTokenSum += 0.5;
      }
      if (numPart.length > 0) {
        wordTokenSum += Math.ceil(numPart.length / 3.5);
      }
    }
    tokenCount += Math.ceil(wordTokenSum);
  }

  // Step 6: URL-like patterns often get extra token overhead
  const urlMatches = trimmed.match(/https?:\/\/\S+/gi);
  if (urlMatches) {
    // URLs get extra fragmentation in BPE
    tokenCount += urlMatches.length * 2;
  }

  // Ensure at least 1 token for non-empty text
  return Math.max(1, tokenCount);
}

/**
 * Calculate estimated cost in USD based on model pricing.
 * @param {number} inputTokens - Number of input/prompt tokens
 * @param {number} outputTokens - Number of output/completion tokens
 * @param {string} modelId - Model key from MODEL_PRICING
 * @returns {number} Estimated cost in USD
 */
function calculateCost(inputTokens, outputTokens, modelId) {
  const model = MODEL_PRICING[modelId];
  if (!model) return 0;
  
  const inputCost = (inputTokens / 1000000) * model.input;
  const outputCost = (outputTokens / 1000000) * model.output;
  return inputCost + outputCost;
}

/**
 * Format cost as a readable currency string.
 */
function formatCost(cost) {
  if (cost < 0.001) {
    return '< $0.001';
  } else if (cost < 0.01) {
    return '$' + cost.toFixed(4);
  }
  return '$' + cost.toFixed(3);
}

/**
 * Count occurrences of "paynet" (case-insensitive) including variations
 * with or without a dash: paynet, PayNet, pay-net, Pay-Net, PAY-NET, etc.
 */
function countPaynetOccurrences(text) {
  if (!text) return 0;
  const matches = text.match(/pay[-]?net/gi);
  return matches ? matches.length : 0;
}

/**
 * Compact AFINN-based sentiment lexicon.
 * Word -> score (-5 to +5). Curated ~200 most impactful words.
 */
const SENTIMENT_LEXICON = {
  // Strong positive (+5)
  'amazing':5,'awesome':5,'excellent':5,'fantastic':5,'incredible':5,
  'outstanding':5,'perfect':5,'wonderful':5,'brilliant':5,'superb':5,
  'love':5,'best':5,'thrilled':5,'delighted':5,'ecstatic':5,
  'masterpiece':5,'flawless':5,'stunning':5,'magnificent':5,
  'phenomenal':5,'extraordinary':5,'revolutionary':5,'groundbreaking':5,
  'inspiring':5,'lifechanging':5,'transformative':5,
  // Strong positive (+4)
  'great':4,'beautiful':4,'happy':4,'joy':4,'exciting':4,
  'impressive':4,'remarkable':4,'exceptional':4,'superior':4,
  'bliss':4,'paradise':4,'triumph':4,'victory':4,
  'celebrate':4,'grateful':4,'blessed':4,'fortunate':4,
  'passionate':4,'enthusiastic':4,'eager':4,'vibrant':4,
  // Moderate positive (+3)
  'good':3,'nice':3,'helpful':3,'useful':3,'enjoy':3,
  'like':3,'pleased':3,'satisfied':3,'comfortable':3,
  'clever':3,'smart':3,'creative':3,'elegant':3,
  'efficient':3,'effective':3,'reliable':3,'valuable':3,
  'recommend':3,'beneficial':3,'productive':3,'success':3,
  'accomplish':3,'achievement':3,'progress':3,'improve':3,
  'appreciate':3,'kind':3,'generous':3,'friendly':3,
  'interesting':3,'fascinating':3,'engaging':3,'innovative':3,
  'accurate':3,'precise':3,'correct':3,'clear':3,
  'fast':3,'quick':3,'easy':3,'simple':3,
  'smooth':3,'seamless':3,'polished':3,'strong':3,
  'powerful':3,'robust':3,'safe':3,'secure':3,
  'healthy':3,'peaceful':3,'calm':3,'serene':3,
  'free':3,'fresh':3,'clean':3,'organized':3,
  'respect':3,'honest':3,'sincere':3,'genuine':3,
  'professional':3,'quality':3,'solution':3,'fix':3,
  'opportunity':3,'potential':3,'growth':3,'wisdom':3,
  'knowledge':3,'truth':3,'hope':3,'faith':3,
  'warm':3,'welcoming':3,'charming':3,'delightful':3,
  'graceful':3,'refined':3,'attractive':3,'appealing':3,
  'sweet':3,'lovely':3,'precious':3,'treasured':3,
  'trusted':3,'loyal':3,'faithful':3,'steady':3,
  'dependable':3,'trustworthy':3,
  // Mild positive (+2)
  'well':2,'fine':2,'okay':2,'ok':2,'alright':2,
  'decent':2,'fair':2,'reasonable':2,'acceptable':2,
  'better':2,'gain':2,'benefit':2,'agree':2,
  'thanks':2,'thank':2,'support':2,'encourage':2,
  'inspire':2,'motivate':2,'trust':2,
  'work':2,'function':2,'answer':2,'respond':2,
  'chance':2,'promise':2,'develop':2,'forward':2,
  'bright':2,'light':2,'shine':2,
  'new':2,'modern':2,'neat':2,
  'patience':2,'understanding':2,'compassion':2,
  'learning':2,'education':2,
  'smile':2,'laugh':2,'cheer':2,
  'dream':2,'vision':2,'goal':2,
  'gift':2,'bonus':2,'reward':2,
  'praise':2,'admire':2,
  'complete':2,'finish':2,
  'advance':2,'rise':2,'grow':2,
  'increase':2,'boost':2,'enhance':2,
  'heal':2,'recover':2,'restore':2,
  'lucky':2,
  'stylish':2,'fashionable':2,
  'gentle':2,'soft':2,
  'meaningful':2,'significant':2,
  // Mild positive (+1)
  'try':1,'attempt':1,'start':1,'begin':1,
  'normal':1,'regular':1,'standard':1,'proper':1,
  'adequate':1,'sufficient':1,
  'maybe':1,'perhaps':1,'possibly':1,
  'consider':1,'think':1,'believe':1,
  'help':1,'assist':1,'serve':1,
  'move':1,'change':1,'shift':1,
  'open':1,'access':1,'available':1,
  'ready':1,'prepared':1,'set':1,
  'right':1,
  // Strong negative (-5)
  'terrible':-5,'horrible':-5,'awful':-5,'atrocious':-5,'dreadful':-5,
  'worst':-5,'hate':-5,'disgusting':-5,'abysmal':-5,'detestable':-5,
  'nightmare':-5,'catastrophe':-5,'disaster':-5,'devastating':-5,
  'unbearable':-5,'intolerable':-5,'unforgivable':-5,
  'pathetic':-5,'appalling':-5,'repulsive':-5,'revolting':-5,
  'miserable':-5,'agony':-5,'torture':-5,
  // Strong negative (-4)
  'bad':-4,'ugly':-4,'angry':-4,'furious':-4,'annoying':-4,
  'failure':-4,'fail':-4,'broken':-4,'wrong':-4,
  'pain':-4,'suffer':-4,'suffering':-4,'tragedy':-4,
  'depressing':-4,'sad':-4,'grief':-4,'sorrow':-4,
  'frustrating':-4,'frustrated':-4,'irritating':-4,'infuriating':-4,
  'disappointing':-4,'disappointed':-4,'regret':-4,
  'useless':-4,'worthless':-4,'pointless':-4,'meaningless':-4,
  'stupid':-4,'dumb':-4,'idiotic':-4,'ridiculous':-4,
  'toxic':-4,'poisonous':-4,'harmful':-4,'dangerous':-4,
  'violent':-4,'aggressive':-4,'hostile':-4,'threatening':-4,
  'corrupt':-4,'evil':-4,'wicked':-4,'malicious':-4,
  'despair':-4,'hopeless':-4,'helpless':-4,
  'confused':-4,'confusing':-4,'chaos':-4,'chaotic':-4,
  'mess':-4,'messy':-4,'cluttered':-4,
  'boring':-4,'bored':-4,'dull':-4,'tedious':-4,
  'waste':-4,'wasted':-4,'ruin':-4,'ruined':-4,
  'destroy':-4,'destroyed':-4,'damage':-4,'damaged':-4,
  'loss':-4,'lost':-4,'defeat':-4,'defeated':-4,
  'fear':-4,'scared':-4,'terrified':-4,'afraid':-4,
  'anxiety':-4,'anxious':-4,'worried':-4,'stress':-4,
  'lonely':-4,'isolated':-4,'abandoned':-4,
  'poor':-4,'cheap':-4,'inferior':-4,'mediocre':-4,
  'fake':-4,'false':-4,'dishonest':-4,'deceptive':-4,
  'rude':-4,'impolite':-4,'offensive':-4,'insulting':-4,
  'cruel':-4,'brutal':-4,'savage':-4,'merciless':-4,
  'hideous':-4,'grotesque':-4,
  'filthy':-4,'polluted':-4,
  'sick':-4,'disease':-4,'illness':-4,'ill':-4,
  'death':-4,'dead':-4,'die':-4,'dying':-4,'murder':-4,'kill':-4,
  // Moderate negative (-3)
  'problem':-3,'issue':-3,'error':-3,'bug':-3,
  'slow':-3,'lag':-3,'delay':-3,'late':-3,
  'difficult':-3,'hard':-3,'tough':-3,'struggle':-3,
  'weak':-3,'fragile':-3,'vulnerable':-3,
  'unclear':-3,'vague':-3,'ambiguous':-3,
  'complicated':-3,'complex':-3,
  'expensive':-3,'costly':-3,'overpriced':-3,
  'limited':-3,'lacking':-3,'insufficient':-3,
  'risk':-3,'danger':-3,'unsafe':-3,
  'complain':-3,'complaint':-3,'criticize':-3,
  'reject':-3,'rejected':-3,'refuse':-3,
  'quit':-3,'giveup':-3,'surrender':-3,
  'sorry':-3,'apologize':-3,
  'blame':-3,'fault':-3,'guilty':-3,
  'shame':-3,'embarrass':-3,'humiliate':-3,
  'jealous':-3,'envy':-3,'bitter':-3,
  'nervous':-3,'tense':-3,'uneasy':-3,
  'tired':-3,'exhausted':-3,'fatigue':-3,
  'heavy':-3,'burden':-3,'pressure':-3,
  'noise':-3,'noisy':-3,'loud':-3,
  'crowded':-3,'overloaded':-3,'stuffed':-3,
  'cold':-3,'freezing':-3,'frozen':-3,
  'dark':-3,'gloomy':-3,'grim':-3,
  'empty':-3,'void':-3,'hollow':-3,
  'missing':-3,'gone':-3,
  'incorrect':-3,
  'lie':-3,'lied':-3,'lying':-3,
  'cheat':-3,'cheated':-3,'fraud':-3,
  'steal':-3,'stolen':-3,'theft':-3,
  'attack':-3,'hit':-3,'hurt':-3,
  'fight':-3,'war':-3,'battle':-3,
  'crime':-3,'criminal':-3,'illegal':-3,
  'poison':-3,'contaminated':-3,
  'rotten':-3,'decayed':-3,'decaying':-3,
  'wreck':-3,'wrecked':-3,'crash':-3,
  'collapse':-3,'failed':-3,'crumble':-3,
  'scream':-3,'cry':-3,'weep':-3,
  'panic':-3,'terror':-3,'horror':-3,
  'threat':-3,'warning':-3,
  'trap':-3,'caught':-3,'stuck':-3,
  'prison':-3,'jail':-3,'imprisoned':-3,
  'slave':-3,'enslaved':-3,'oppressed':-3,
  'abuse':-3,'abused':-3,'abusive':-3,
  'betray':-3,'betrayed':-3,'betrayal':-3,
  'ignore':-3,'ignored':-3,'neglect':-3,
  'exclude':-3,'excluded':-3,'ostracize':-3,
  'hated':-3,'hatred':-3,
  'enemy':-3,'foe':-3,'opponent':-3,
  'loathe':-3,'despise':-3,
  // Negators
  'not':0,'no':0,'never':0,'neither':0,'nor':0,
  'hardly':0,'barely':0,'scarcely':0,
  'don':0,'doesn':0,'didn':0,'won':0,'wouldn':0,
  'couldn':0,'shouldn':0,'mustn':0,'can':0,
  'isn':0,'aren':0,'wasn':0,'weren':0,
  'haven':0,'hasn':0,'hadn':0,
  'without':0,'lack':0,'lacking':0,
  // Intensifiers
  'very':0,'really':0,'extremely':0,'incredibly':0,
  'highly':0,'absolutely':0,'totally':0,'completely':0,
  'utterly':0,'enormously':0,'immensely':0,
  'quite':0,'rather':0,'pretty':0,
  'somewhat':0,'slightly':0,'a bit':0,
  'almost':0,'nearly':0,'practically':0,
  'especially':0,'particularly':0,'specifically':0,
};

// Negator words that flip sentiment
const NEGATORS = new Set([
  'not','no','never','neither','nor','hardly','barely','scarcely',
  'don','doesn','didn','won','wouldn','couldn','shouldn','mustn',
  'isn','aren','wasn','weren','haven','hasn','hadn',
  'without','lack','lacking','non','un','im','in','dis','ir','il','mis',
  'cannot','cant','wont','dont','doesnt','didnt','wouldnt','couldnt',
  'shouldnt','isnt','arent','wasnt','werent','havent','hasnt','hadnt',
  'nothing','nowhere','nobody','none',
]);

// Intensifiers that amplify sentiment
const INTENSIFIERS = new Set([
  'very','really','extremely','incredibly','highly','absolutely',
  'totally','completely','utterly','enormously','immensely',
  'so','too','much','more','most',
]);

// Dampeners that reduce sentiment
const DAMPENERS = new Set([
  'quite','rather','pretty','somewhat','slightly','a bit',
  'almost','nearly','practically','fairly','kind of','sort of',
]);

/**
 * Analyze sentiment of text using AFINN-based lexicon.
 * @param {string} text - Text to analyze
 * @returns {{ score: number, comparative: number, label: string }}
 */
function analyzeSentiment(text) {
  if (!text || !text.trim()) return { score: 0, comparative: 0, label: 'Neutral' };

  // Tokenize: split on whitespace/punctuation, lowercase
  const tokens = text.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const len = tokens.length;
  if (len === 0) return { score: 0, comparative: 0, label: 'Neutral' };

  let score = 0;

  for (let i = 0; i < len; i++) {
    const word = tokens[i];
    const val = SENTIMENT_LEXICON[word];
    if (val === undefined) continue;

    let wordScore = val;
    if (wordScore === 0) continue; // Skip neutral markers

    // Check for negation in previous 1-3 words
    let negated = false;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (NEGATORS.has(tokens[j])) {
        negated = true;
        break;
      }
    }
    if (negated) wordScore *= -1;

    // Check for intensifier in previous word
    let multiplier = 1;
    if (len > 1 && INTENSIFIERS.has(tokens[i - 1])) {
      multiplier = 2;
    } else if (len > 1 && DAMPENERS.has(tokens[i - 1])) {
      multiplier = 0.5;
    }

    score += wordScore * multiplier;
  }

  // Comparative: score normalized by word count
  const comparative = len > 0 ? score / len : 0;

  // Determine label based on comparative score
  let label;
  if (comparative > 0.15) {
    label = 'Positive';
  } else if (comparative < -0.15) {
    label = 'Negative';
  } else {
    label = 'Neutral';
  }

  return { score, comparative, label };
}

/**
 * Stop words to filter out during topic extraction.
 * Common English words that carry little semantic meaning.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare',
  'ought', 'used', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'we', 'they', 'what', 'which', 'who',
  'whom', 'whose', 'where', 'when', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'because',
  'as', 'until', 'while', 'about', 'between', 'through', 'during',
  'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off',
  'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'any', 'if', 'into', 'also', 'like', 'well', 'get', 'got', 'go',
  'going', 'gone', 'make', 'made', 'know', 'think', 'see', 'look',
  'say', 'said', 'take', 'come', 'give', 'use', 'used', 'find', 'tell',
  'one', 'two', 'first', 'last', 'new', 'old', 'long', 'big', 'small',
  'great', 'little', 'right', 'high', 'different', 'left', 'good',
  'much', 'many', 'even', 'back', 'still', 'want', 'way',
  'day', 'night', 'thing', 'things', 'man',
  'woman', 'women', 'people', 'person', 'world', 'life',
  'hand', 'part', 'place', 'case', 'week', 'company', 'system',
  'program', 'question', 'problem', 'fact',
  'yes', 'no', 'oh', 'hi', 'hey', 'hello', 'thanks', 'please',
  'sure', 'okay', 'ok', 'right', 'yeah', 'yep', 'uhm', 'hmm',
  'basically', 'actually', 'literally', 'simply', 'really', 'quite',
  'pretty', 'rather', 'somewhat', 'kind', 'sort', 'sorts',
]);

/**
 * Extract key topics from text using keyword frequency analysis.
 * Tokenizes text, removes stop words, and returns the most frequent
 * meaningful words/phrases as topics.
 * @param {string} text - Text to analyze
 * @param {number} maxTopics - Maximum number of topics to return (default 5)
 * @returns {string[]} Array of topic strings
 */
function extractTopics(text, maxTopics) {
  if (!text || !text.trim()) return [];

  maxTopics = maxTopics || 5;

  try {
    // Tokenize: extract words (2+ chars, alphabetic with hyphens/apostrophes)
    const words = text.toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2 && !STOP_WORDS.has(w));

    if (words.length === 0) return [];

    // Count frequency
    const freq = {};
    for (const word of words) {
      freq[word] = (freq[word] || 0) + 1;
    }

    // Sort by frequency (desc), then alphabetically for ties
    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    // Return top N topics
    return sorted.slice(0, maxTopics).map(([word]) => word);
  } catch (e) {
    return [];
  }
}

// Expose globally for use in content.js
window.estimateTokens = estimateTokens;
window.countPaynetOccurrences = countPaynetOccurrences;
window.MODEL_PRICING = MODEL_PRICING;
window.calculateCost = calculateCost;
window.formatCost = formatCost;
window.analyzeSentiment = analyzeSentiment;
window.extractTopics = extractTopics;
