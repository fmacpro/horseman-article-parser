import nlp from 'compromise'
import { fetch as undiciFetch } from 'undici'
import { capitalizeFirstLetter, stripPossessive } from '../helpers.js'
import logger from './logger.js'

const DEFAULT_HINTS = Object.freeze({ first: [], middle: [], last: [], suffix: [], secondary: null })
const COMMON_LAST_SUFFIXES = [
  'sson', 'son', 'sen', 'ez', 'es', 'is', 'os', 'as', 'ian', 'yan', 'ov', 'ova', 'ev', 'eva', 'ski', 'sky', 'stein',
  'berg', 'ford', 'well', 'wood', 'land', 'ton', 'dson', 'dsen', 'man', 'mann', 'vich', 'vych', 'wicz', 'witz', 'escu',
  'opoulos', 'ashvili', 'dottir'
]
const LIST_CONJUNCTIONS = ['and', 'or', 'und', 'et', 'y', 'e']
const LIST_CONJUNCTION_PATTERN = LIST_CONJUNCTIONS.join('|')
const LIST_CONJUNCTION_SET = new Set(LIST_CONJUNCTIONS.map(word => word.toLowerCase()))
const NAME_TOKEN_PATTERN = "[A-Z][\\p{L}\\p{M}'’.-]*"
const NAME_PATTERN = `${NAME_TOKEN_PATTERN}(?:\\s+${NAME_TOKEN_PATTERN})+`
const GENERIC_NAME_PART_PATTERN = /^[\p{Lu}][\p{L}\p{M}'’.-]*$/u
const INITIAL_NAME_PART_PATTERN = /^[\p{Lu}](?:[.’']|\.)?$/u
const ALL_UPPER_WORD_PATTERN = /^[\p{Lu}]+$/u
const TRAILING_UPPER_WORD_PATTERN = /[\p{Lu}](?![\p{Ll}])[\p{Lu}'’.-]*$/u
const NAME_LIST_PUNCTUATION_CLASS = '[,;·•‧∙・、，|/&]'
const NAME_LIST_SEPARATOR_PATTERN = `(?:${NAME_LIST_PUNCTUATION_CLASS}|\\b(?:${LIST_CONJUNCTION_PATTERN})\\b)`
const NAME_LIST_PATTERN = new RegExp(
  `(${NAME_PATTERN}(?:\\s*${NAME_LIST_SEPARATOR_PATTERN}\\s*${NAME_PATTERN})+)`,
  'gu'
)
const DENSE_NAME_SEQUENCE_PATTERN = new RegExp(`(${NAME_PATTERN}(?:\\s+${NAME_PATTERN}){1,})`, 'gu')
const NAME_LIST_SPLIT_PATTERN = new RegExp(`\\s*${NAME_LIST_SEPARATOR_PATTERN}\\s*`, 'giu')
const LIST_CONJUNCTION_SPLIT_PATTERN = new RegExp(`\b(?:${LIST_CONJUNCTION_PATTERN})\b`, 'iu')
const NAME_PUNCTUATION_SPLIT_PATTERN = new RegExp(`\\s*${NAME_LIST_PUNCTUATION_CLASS}+\\s*`, 'u')
const HAS_NAME_PUNCTUATION_PATTERN = new RegExp(NAME_LIST_PUNCTUATION_CLASS, 'u')
const NAME_LIST_STOP_WORDS = new Set([
  'and', 'or', 'und', 'et', 'y', 'e', 'team', 'teams', 'group', 'groups', 'committee', 'committees', 'department',
  'departments', 'office', 'offices', 'project', 'projects', 'programme', 'programmes', 'program', 'programs', 'initiative',
  'initiatives', 'model', 'models', 'privacy', 'compute', 'computing', 'data', 'budget', 'budgets', 'research', 'development',
  'infrastructure', 'maintenance', 'support', 'gemma', 'vaultgemma', 'google', 'deepmind'
])
const PERSON_NAME_STOP_WORDS = new Set(['gemma', 'gemma 2', 'gemma2', 'vaultgemma', 'vaultgemma 1b', 'vaultgemma1b'])
const JOB_TITLE_PREPOSITIONS = new Set([
  'at', 'for', 'with', 'from', 'by', 'via', 'in', 'on', 'to', 'into', 'onto', 'through', 'within', 'without', 'over', 'under',
  'against', 'toward', 'towards', 'around', 'across', 'after', 'before', 'during', 'since', 'because', 'while', 'when', 'where',
  'among', 'between', 'per', 'including', 'inside', 'outside', 'along', 'behind', 'beyond', 'upon', 'amid', 'amidst', 'amongst',
  'beside', 'besides', 'concerning', 'regarding', 'about', 'according', 'off', 'of'
])
const JOB_TITLE_CONNECTORS = new Set(['and', '&', '+', 'plus', '/', '|'])
const JOB_TITLE_CORE_WORDS = new Set([
  'advisor', 'adviser', 'advocate', 'ambassador', 'analyst', 'architect', 'artist', 'associate', 'attorney', 'author', 'captain',
  'ceo', 'chair', 'chairman', 'chairwoman', 'chairperson', 'chief', 'cofounder', 'co-founder', 'coo', 'cfo', 'cto', 'cmo', 'cio',
  'commissioner', 'consultant', 'coordinator', 'councilmember', 'councilor', 'councillor', 'councilwoman', 'councilman',
  'councilperson', 'creator', 'curator', 'dean', 'developer', 'designer', 'director', 'editor', 'educator', 'engineer',
  'entrepreneur', 'executive', 'fellow', 'founder', 'founders', 'governor', 'head', 'instructor', 'investigator', 'investor',
  'journalist', 'lawyer', 'lecturer', 'leader', 'lead', 'manager', 'minister', 'musician', 'nurse', 'officer', 'owner', 'partner',
  'philanthropist', 'photographer', 'physician', 'pilot', 'planner', 'president', 'principal', 'producer', 'professor',
  'programmer', 'psychologist', 'researcher', 'reporter', 'scientist', 'singer', 'specialist', 'strategist', 'student', 'surgeon',
  'teacher', 'technician', 'technologist', 'trustee', 'vice', 'vp', 'svp', 'evp'
])
const JOB_TITLE_MODIFIER_WORDS = new Set([
  'academic', 'acting', 'adjunct', 'administrative', 'administration', 'advanced', 'ai', 'analytics', 'applied', 'assistant',
  'associate', 'business', 'capital', 'chief', 'client', 'clinical', 'commercial', 'communications', 'community', 'compliance',
  'content', 'corporate', 'creative', 'customer', 'data', 'digital', 'economic', 'education', 'engineering', 'enterprise',
  'environmental', 'equity', 'executive', 'financial', 'global', 'government', 'growth', 'health', 'human', 'impact', 'industrial',
  'innovation', 'insights', 'institutional', 'interim', 'international', 'investment', 'legal', 'logistics', 'marketing',
  'medical', 'national', 'operations', 'operational', 'partnership', 'people', 'performance', 'policy', 'portfolio', 'press',
  'principal', 'private', 'product', 'production', 'program', 'project', 'public', 'quality', 'regional', 'reliability',
  'research', 'resources', 'sales', 'senior', 'software', 'solution', 'solutions', 'strategic', 'strategy', 'support',
  'sustainability', 'talent', 'tech', 'technical', 'technology', 'trade', 'training', 'transport', 'venture'
])
const NAME_PARTICLE_WORDS = new Set([
  'al', 'ap', 'af', 'bin', 'ibn', 'de', 'del', 'della', 'der', 'di', 'dos', 'das', 'do', 'du', 'la', 'le', 'mac', 'mc', 'saint',
  'santa', 'st', 'st.', 'van', 'von', 'ter', 'ten', 'ben', 'abu', 'el', 'da'
])
const NAME_LIST_CONTEXT_WORDS = [
  'people', 'contributors', 'thanks', 'thank', 'team', 'teams', 'author', 'authors', 'colleague', 'colleagues',
  'supporters', 'support', 'engineer', 'engineers', 'researcher', 'researchers', 'scientist', 'scientists', 'leaders',
  'members', 'acknowledgements', 'acknowledgments', 'acknowledgement', 'acknowledgment', 'gratitude', 'credit', 'credits'
]
const SENTENCE_STARTER_WORDS = new Set(['we', 'our', 'ours', 'the', 'this', 'that', 'these', 'those'])
const SENTENCE_BOUNDARY_FOLLOW_PATTERN = /([.!?]["']?\s+)([A-Z][\p{L}\p{M}'’.-]*)/gu
const LEADING_JUNK_PATTERN = new RegExp("^[\\s\\u00A0,;·•‧∙・、，|/&(){}\\[\\]<>\"'“”‘’—–-]+", 'u')
const HONORIFIC_PREFIXES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'dame', 'rev', 'reverend', 'lord', 'lady'])

export function normalizeEntity (w) {
  if (typeof w !== 'string') return ''
  return w
    .replace(/[’']/g, '')
    .replace(/[^A-Za-z0-9-]+/g, ' ')
    .trim()
    .toLowerCase()
}


const MULTI_WORD_COUNTRY_NAMES = new Set([
  'United States',
  'United States of America',
  'United Kingdom',
  'United Arab Emirates',
  'New Zealand',
  'New Caledonia',
  'Papua New Guinea',
  'Equatorial Guinea',
  'Guinea Bissau',
  'Guinea-Bissau',
  'Czech Republic',
  'Dominican Republic',
  'Central African Republic',
  'Democratic Republic of the Congo',
  'Republic of the Congo',
  'South Africa',
  'South Korea',
  'South Sudan',
  'North Korea',
  'Saudi Arabia',
  'Costa Rica',
  'Sierra Leone',
  'Ivory Coast',
  'Cote d\'Ivoire',
  'El Salvador',
  'San Marino',
  'Sri Lanka',
  'Trinidad and Tobago',
  'Trinidad y Tobago',
  'Antigua and Barbuda',
  'Antigua y Barbuda',
  'Bosnia and Herzegovina',
  'Marshall Islands',
  'Solomon Islands',
  'Cabo Verde',
  'Cape Verde',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Vincent and the Grenadines',
  'Federated States of Micronesia',
  'Micronesia',
  'Timor Leste',
  'East Timor',
  'Western Sahara',
  'Puerto Rico',
  'Hong Kong',
  'Northern Ireland',
  'American Samoa',
  'French Polynesia',
  'Cayman Islands',
  'Faroe Islands',
  'Cook Islands',
  'Vatican City',
  'Holy See',
  'State of Palestine',
  'Palestinian Territories',
  'Sao Tome and Principe',
  'Saint Barthelemy',
  'Saint Pierre and Miquelon',
  'Wallis and Futuna',
  'Turks and Caicos Islands',
  'British Virgin Islands',
  'United States Virgin Islands',
  'Isle of Man',
  'Bonaire Sint Eustatius and Saba',
  'Sint Maarten',
  'Saint Martin'
].map(name => normalizeEntity(name)))

const MULTI_WORD_COUNTRY_PREFIXES = new Set()
for (const name of MULTI_WORD_COUNTRY_NAMES) {
  const tokens = name.split(' ').filter(Boolean)
  for (let i = 1; i < tokens.length; i++) {
    MULTI_WORD_COUNTRY_PREFIXES.add(tokens.slice(0, i).join(' '))
  }
}

const KNOWN_PLACE_PHRASES = new Set(['white house', 'palestinian authority', 'hamas authority'].map(name => normalizeEntity(name)))

const TRAILING_LOCATION_ABBREVIATIONS = new Set(['uk', 'us', 'usa', 'uae', 'eu', 'un'].map(name => normalizeEntity(name)))
const KNOWN_ORGANIZATION_TAIL_PATTERNS = [
  ['al', 'jazeera']
]

const PLACE_TAIL_STOP_WORDS = new Set([
  'in',
  'on',
  'at',
  'to',
  'from',
  'into',
  'onto',
  'against',
  'towards',
  'toward',
  'versus',
  'vs',
  'amid',
  'amidst',
  'among',
  'amongst',
  'around',
  'about',
  'near',
  'outside',
  'inside',
  'beyond',
  'within',
  'without',
  'after',
  'before',
  'during',
  'through',
  'throughout',
  'including',
  'targeting',
  'via',
  'over',
  'under'
])

const PLACE_PUNCTUATION_SPLIT_PATTERN = /[\u00B7\u2022,;\/|&]+/u
const PLACE_CONJUNCTION_SPLIT_PATTERN = new RegExp('\\b(?:' + LIST_CONJUNCTION_PATTERN + '|vs|versus)\\b', 'iu')
function dedupeNameList (values) {
  const seen = new Set()
  const out = []
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = normalizeEntity(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function coerceHints (rawHints) {
  if (!rawHints || typeof rawHints !== 'object') rawHints = DEFAULT_HINTS
  const hints = {
    first: dedupeNameList(rawHints.first || rawHints.firstNames),
    middle: dedupeNameList(rawHints.middle || rawHints.middleNames),
    last: dedupeNameList(rawHints.last || rawHints.lastNames),
    suffix: dedupeNameList(rawHints.suffix || rawHints.suffixes),
    secondary: normalizeSecondaryConfig(rawHints.secondary)
  }
  return hints
}

function buildHintSets (hints) {
  const makeSet = (list) => new Set(list.map(normalizeEntity).filter(Boolean))
  return {
    first: makeSet(hints.first),
    middle: makeSet(hints.middle),
    last: makeSet(hints.last),
    suffix: makeSet(hints.suffix)
  }
}

function startsWithUpper (word) {
  return typeof word === 'string' && /^[\p{Lu}]/u.test(word.trim())
}

function likelySuffix (word, hintSets) {
  const normalized = normalizeEntity(word)
  if (!normalized) return false
  if (hintSets.suffix.has(normalized)) return true
  return /^(?:jr|sr|ii|iii|iv|phd|md|esq)$/i.test(normalized)
}

function likelyLast (word, hintSets) {
  const normalized = normalizeEntity(word)
  if (!normalized) return false
  if (hintSets.last.has(normalized)) return true
  if (COMMON_LAST_SUFFIXES.some(suffix => normalized.endsWith(suffix))) return true
  try {
    const doc = nlp(word)
    if (doc.has('#LastName') || doc.has('#Surname')) return true
  } catch {}
  return false
}

function likelyFirst (word, hintSets) {
  const normalized = normalizeEntity(word)
  if (!normalized) return false
  if (hintSets.first.has(normalized) || hintSets.middle.has(normalized)) return true
  try {
    const doc = nlp(word)
    if (doc.has('#FirstName') || doc.has('#FemaleName') || doc.has('#MaleName')) return true
  } catch {}
  return false
}

function maybeSplitBySpacing (text) {
  if (typeof text !== 'string') return null
  if (!/[\s\u00A0]{2,}|[\r\n]/.test(text)) return null
  const parts = text
    .split(/(?:\r?\n|\r|[\u00A0\s]{2,})+/)
    .map(s => s.trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : null
}

function maybeSplitByPunctuationSeparators (text) {
  if (typeof text !== 'string') return null
  if (!HAS_NAME_PUNCTUATION_PATTERN.test(text)) return null
  const parts = text
    .split(NAME_PUNCTUATION_SPLIT_PATTERN)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : null
}

function hasListContext (text, index, candidateCount) {
  if (typeof text !== 'string') return false
  if (candidateCount >= 3) return true
  const start = Math.max(0, (typeof index === 'number' ? index : 0) - 120)
  const context = text.slice(start, typeof index === 'number' ? index : 0).toLowerCase()
  if (!context) return false
  if (context.includes(':') || context.includes(';') || context.includes('(') || context.includes('–') || context.includes('—')) {
    return true
  }
  return NAME_LIST_CONTEXT_WORDS.some(word => context.includes(word))
}

function cleanNameCandidate (part) {
  if (typeof part !== 'string') return ''
  return part
    .replace(/^[^\p{L}\p{N}'’.-]+/gu, '')
    .replace(/[^\p{L}\p{N}'’.-]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegex (str) {
  return String(str || '').replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')
}

function startsWithLowercaseContinuation (text) {
  if (typeof text !== 'string') return false
  const trimmed = text.replace(LEADING_JUNK_PATTERN, '')
  if (!trimmed) return false
  return /^[\p{Ll}]/u.test(trimmed)
}

function hasSentenceBoundaryBeforeWord (rawSegment, lastWord, hintSets) {
  if (typeof rawSegment !== 'string' || typeof lastWord !== 'string') return false
  const match = rawSegment.match(/([.!?])["']?\s+([A-Z][\p{L}\p{M}'’.-]*)\s*$/u)
  if (!match) return false
  const nextWord = cleanNameCandidate(match[2])
  if (!nextWord) return false
  if (normalizeEntity(nextWord) !== normalizeEntity(lastWord)) return false
  if (INITIAL_NAME_PART_PATTERN.test(nextWord)) return false
  if (likelyFirst(nextWord, hintSets) || likelyLast(nextWord, hintSets) || likelySuffix(nextWord, hintSets)) return false
  return true
}

function trimCommaDelimitedTail (words, context, hintSets) {
  if (!Array.isArray(words) || words.length < 3) return words
  if (typeof context !== 'string' || !context) return words
  for (let split = words.length - 1; split >= 2; split--) {
    const prefixWords = words.slice(0, split)
    const suffixWords = words.slice(split)
    if (!prefixWords.length || !suffixWords.length) continue
    const prefix = prefixWords.join(' ')
    const suffix = suffixWords.join(' ')
    const pattern = new RegExp(`${escapeRegex(prefix)}\\s*,\\s*${escapeRegex(suffix)}`, 'u')
    if (!pattern.test(context)) continue
    let suspicious = true
    for (const word of suffixWords) {
      if (!word) continue
      if (likelySuffix(word, hintSets) || INITIAL_NAME_PART_PATTERN.test(word)) {
        suspicious = false
        break
      }
      if (likelyFirst(word, hintSets) || likelyLast(word, hintSets)) {
        suspicious = false
        break
      }
    }
    if (!suspicious) continue
    return prefixWords
  }
  return words
}

function shouldKeepAsNameWord (word, normalized, canonical, hintSets) {
  if (typeof word !== 'string') return false
  if (likelyFirst(word, hintSets) || likelyLast(word, hintSets)) return true
  if (likelySuffix(word, hintSets) || INITIAL_NAME_PART_PATTERN.test(word)) return true
  if (typeof canonical !== 'string') return false
  if (NAME_PARTICLE_WORDS.has(canonical)) return true
  return false
}

function findJobTailStart (words, normalizedWords, canonicalWords, startIndex, hintSets) {
  if (!Array.isArray(words) || !Array.isArray(normalizedWords) || !Array.isArray(canonicalWords)) return null
  let idx = Math.min(Math.max(startIndex, 0), words.length - 1)
  let removalIndex = idx + 1
  let removedAny = false

  while (idx >= 2) {
    const word = words[idx]
    const normalized = normalizedWords[idx] || ''
    const canonical = canonicalWords[idx] || ''

    if (shouldKeepAsNameWord(word, normalized, canonical, hintSets)) {
      removalIndex = idx + 1
      break
    }

    if (
      JOB_TITLE_CORE_WORDS.has(canonical) ||
      JOB_TITLE_MODIFIER_WORDS.has(canonical) ||
      JOB_TITLE_CONNECTORS.has(canonical) ||
      JOB_TITLE_PREPOSITIONS.has(canonical) ||
      canonical === 'the' ||
      canonical === 'a' ||
      canonical === 'an'
    ) {
      removalIndex = idx
      removedAny = true
      idx--
      continue
    }

    if (!likelyFirst(word, hintSets) && !likelyLast(word, hintSets) && !likelySuffix(word, hintSets) && !INITIAL_NAME_PART_PATTERN.test(word)) {
      removalIndex = idx
      removedAny = true
      idx--
      continue
    }

    break
  }

  if (!removedAny) return null
  if (removalIndex < 2) removalIndex = 2
  if (removalIndex >= words.length) return null
  return removalIndex
}

function detectJobTitleTail (words, hintSets) {
  if (!Array.isArray(words) || words.length < 3) return null
  const normalizedWords = words.map(word => normalizeEntity(word))
  const canonicalWords = normalizedWords.map(value => (typeof value === 'string' ? value.replace(/-/g, '') : ''))

  for (let i = 2; i < canonicalWords.length; i++) {
    const canonical = canonicalWords[i]
    if (!canonical) continue
    if (!JOB_TITLE_PREPOSITIONS.has(canonical)) continue
    const start = findJobTailStart(words, normalizedWords, canonicalWords, i, hintSets)
    if (typeof start === 'number') return start
  }

  for (let i = canonicalWords.length - 1; i >= 2; i--) {
    const canonical = canonicalWords[i]
    if (!canonical) continue
    if (!JOB_TITLE_CORE_WORDS.has(canonical) && !JOB_TITLE_MODIFIER_WORDS.has(canonical)) continue
    const start = findJobTailStart(words, normalizedWords, canonicalWords, i, hintSets)
    if (typeof start === 'number') return start
  }

  return null
}

function trimTrailingNonNameWords (words, rawSegment, followingText, hintSets) {
  if (!Array.isArray(words)) return []
  const trimmed = words.slice()
  const raw = typeof rawSegment === 'string' ? rawSegment : ''
  const follow = typeof followingText === 'string' ? followingText : ''
  const rawHasComma = raw.includes(',')

  if (trimmed.length >= 2 && rawHasComma) {
    let workingRaw = raw
    while (trimmed.length > 1) {
      const match = workingRaw.match(/,([^,]*)$/)
      if (!match) break
      const preceding = workingRaw.slice(0, match.index)
      const trailingPart = match[1]
      const trailingWords = String(trailingPart || '')
        .split(/[\s\u00A0]+/)
        .map(cleanNameCandidate)
        .filter(Boolean)
      if (!trailingWords.length) {
        workingRaw = preceding
        continue
      }
      const trailingContainsName = trailingWords.some(word => {
        if (!word) return false
        if (likelyFirst(word, hintSets) || likelyLast(word, hintSets)) return true
        if (likelySuffix(word, hintSets) || INITIAL_NAME_PART_PATTERN.test(word)) return true
        return false
      })
      if (trailingContainsName) {
        workingRaw = preceding
        continue
      }
      let removal = 0
      const maxRemovable = Math.max(0, trimmed.length - 1)
      while (removal < trailingWords.length && removal < maxRemovable) {
        const candidate = trimmed[trimmed.length - 1 - removal]
        if (typeof candidate !== 'string') break
        if (likelySuffix(candidate, hintSets) || INITIAL_NAME_PART_PATTERN.test(candidate)) {
          removal = 0
          break
        }
        removal++
      }
      if (removal === 0) break
      trimmed.splice(trimmed.length - removal, removal)
      workingRaw = preceding
    }
  }

  const hasLowercaseTail = startsWithLowercaseContinuation(follow)
  if (trimmed.length >= 2 && raw) {
    let removalIndex = null
    for (const match of raw.matchAll(SENTENCE_BOUNDARY_FOLLOW_PATTERN)) {
      const nextWord = cleanNameCandidate(match[2])
      if (!nextWord) continue
      const normalizedNext = normalizeEntity(nextWord)
      if (!normalizedNext) continue
      if (!SENTENCE_STARTER_WORDS.has(normalizedNext)) continue
      if (INITIAL_NAME_PART_PATTERN.test(nextWord)) continue
      if (likelyFirst(nextWord, hintSets) || likelyLast(nextWord, hintSets) || likelySuffix(nextWord, hintSets)) continue
      for (let i = trimmed.length - 1; i >= 0; i--) {
        const candidate = cleanNameCandidate(trimmed[i])
        if (!candidate) continue
        if (normalizeEntity(candidate) === normalizedNext) {
          removalIndex = removalIndex === null ? i : Math.max(removalIndex, i)
          break
        }
      }
    }
    if (removalIndex !== null && removalIndex >= 0) {
      trimmed.splice(removalIndex)
    }
  }
  while (trimmed.length >= 2) {
    const lastWord = trimmed[trimmed.length - 1]
    if (typeof lastWord !== 'string') break
    const normalized = normalizeEntity(lastWord)
    if (!normalized) break
    const hasBoundary = hasSentenceBoundaryBeforeWord(raw, lastWord, hintSets)
    const inSentenceStarters = SENTENCE_STARTER_WORDS.has(normalized)
    const shouldDrop = (hasBoundary && inSentenceStarters) || (hasLowercaseTail && inSentenceStarters)
    if (!shouldDrop) break
    if (/-/.test(lastWord)) break
    if (likelyFirst(lastWord, hintSets) || likelyLast(lastWord, hintSets) || INITIAL_NAME_PART_PATTERN.test(lastWord) || likelySuffix(lastWord, hintSets)) break
    trimmed.pop()
  }

  if (trimmed.length >= 3) {
    const jobStart = detectJobTitleTail(trimmed, hintSets)
    if (typeof jobStart === 'number' && jobStart < trimmed.length) {
      trimmed.splice(jobStart)
    }
  }
  return trimmed
}

function trimSentenceStarterTail (name, hintSets) {
  if (typeof name !== 'string') return name
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length < 2) return name
  const trimmed = words.slice()
  let changed = false
  while (trimmed.length >= 2) {
    const lastWord = trimmed[trimmed.length - 1]
    if (typeof lastWord !== 'string') break
    const normalized = normalizeEntity(lastWord)
    if (!normalized) break
    if (!SENTENCE_STARTER_WORDS.has(normalized)) break
    if (INITIAL_NAME_PART_PATTERN.test(lastWord)) break
    if (likelyFirst(lastWord, hintSets) || likelyLast(lastWord, hintSets) || likelySuffix(lastWord, hintSets)) break
    trimmed.pop()
    changed = true
  }
  if (!changed) return name
  if (trimmed.length === 0) return name
  return trimmed.join(' ')
}

function wordLooksSuspicious (word, hintSets) {
  const cleaned = cleanNameCandidate(word)
  if (!cleaned) return true
  if (!GENERIC_NAME_PART_PATTERN.test(cleaned)) return true
  if (INITIAL_NAME_PART_PATTERN.test(cleaned)) return false
  if (likelySuffix(cleaned, hintSets)) return false
  const hasTrailingUpper = TRAILING_UPPER_WORD_PATTERN.test(cleaned)
  const isAllUpper = ALL_UPPER_WORD_PATTERN.test(cleaned)
  if (!hasTrailingUpper && !isAllUpper) return false
  if (likelyFirst(cleaned, hintSets) || likelyLast(cleaned, hintSets)) return false
  return true
}

function filterLikelyNameParts (parts, hintSets) {
  const filtered = []
  for (const part of Array.isArray(parts) ? parts : []) {
    if (typeof part !== 'string') continue
    const cleanedPart = part.replace(/\s+/g, ' ').trim()
    if (!cleanedPart) continue
    const words = cleanedPart.split(/\s+/).filter(Boolean)
    if (words.length < 2) continue
    let suspicious = false
    for (const word of words) {
      if (wordLooksSuspicious(word, hintSets)) {
        suspicious = true
        break
      }
    }
    if (suspicious) continue
    filtered.push(capitalizeFirstLetter(cleanedPart))
  }
  return filtered
}

function trimHonorificPrefixes (words) {
  if (!Array.isArray(words)) return []
  let start = 0
  while (start < words.length - 1) {
    const normalized = normalizeEntity(words[start])
    if (!normalized) break
    if (!HONORIFIC_PREFIXES.has(normalized)) break
    start++
  }
  return start > 0 ? words.slice(start) : words.slice()
}

function mergeHonorificPairs (names, hintSets) {
  if (!Array.isArray(names) || names.length < 2) return names
  const merged = []
  for (let i = 0; i < names.length; i++) {
    const current = names[i]
    const next = names[i + 1]
    const combined = tryMergeHonorificPair(current, next, hintSets)
    if (combined) {
      merged.push(combined)
      i++
    } else if (typeof current === 'string') {
      merged.push(current)
    }
  }
  return merged
}

function tryMergeHonorificPair (current, next, hintSets) {
  if (typeof current !== 'string' || typeof next !== 'string') return null
  const currentWords = current.split(/\s+/).filter(Boolean)
  const nextWords = next.split(/\s+/).filter(Boolean)
  if (currentWords.length < 2 || nextWords.length < 2) return null
  const prefix = normalizeEntity(currentWords[0])
  if (!HONORIFIC_PREFIXES.has(prefix)) return null
  const firstWord = currentWords[1]
  if (!likelyFirst(firstWord, hintSets)) return null
  const nextPrefix = normalizeEntity(nextWords[0])
  if (HONORIFIC_PREFIXES.has(nextPrefix)) return null
  const mergedName = `${currentWords.slice(1).join(' ')} ${next}`.replace(/\s+/g, ' ').trim()
  if (!mergedName || mergedName.split(/\s+/).length < 2) return null
  return capitalizeFirstLetter(mergedName)
}

function extractNamesFromCapitalizedLists (text, seen, hintSets, keepSet, removalSet) {
  if (typeof text !== 'string') return []
  const names = []
  for (const match of text.matchAll(NAME_LIST_PATTERN)) {
    const block = match[1]
    if (!block) continue
    const rawParts = block.split(NAME_LIST_SPLIT_PATTERN)
    const cleanedParts = []
    let offset = 0
    for (const rawPart of rawParts) {
      const start = block.indexOf(rawPart, offset)
      offset = start === -1 ? offset : start + rawPart.length
      const cleaned = cleanNameCandidate(rawPart)
      if (!cleaned) continue
      const following = start === -1 ? '' : block.slice(offset)
      cleanedParts.push({ cleaned, raw: rawPart, following })
    }
    if (cleanedParts.length < 2) continue
    if (!hasListContext(text, match.index, cleanedParts.length)) continue
    for (const { cleaned, raw: rawPart, following } of cleanedParts) {
      if (!cleaned || !/\s/.test(cleaned) || /\d/.test(cleaned)) continue
      let words = cleaned.split(/\s+/).filter(Boolean)
      if (words.length < 2) continue
      words = trimTrailingNonNameWords(words, rawPart, following, hintSets)
      if (words.length < 2) continue
      if (words.some(word => wordLooksSuspicious(word, hintSets))) continue
      if (words.length >= 4) {
        const splitRuns = splitLikelyNameRuns(words, hintSets)
        if (Array.isArray(splitRuns) && splitRuns.length >= 2) {
          let added = false
          for (const name of splitRuns) {
            const nameWords = name.split(/\s+/).filter(Boolean)
            const trimmedNameWords = trimTrailingNonNameWords(nameWords, name, '', hintSets)
            if (trimmedNameWords.length < 2) continue
            const trimmedName = trimmedNameWords.join(' ')
            const normalized = normalizeEntity(trimmedName)
            if (!normalized) continue
            const tokens = normalized.split(' ').filter(Boolean)
            if (tokens.some(word => NAME_LIST_STOP_WORDS.has(word))) continue
            if (keepSet) keepSet.add(normalized)
            if (seen.has(normalized)) continue
            names.push(trimmedName)
            seen.add(normalized)
            added = true
          }
          if (added) continue
        }
      }
      const lowerWords = words.map(w => w.toLowerCase())
      if (lowerWords.some(w => NAME_LIST_STOP_WORDS.has(w))) continue
      const candidateName = words.join(' ')
      const normalized = normalizeEntity(candidateName)
      if (!normalized || seen.has(normalized)) continue
      if (keepSet) keepSet.add(normalized)
      names.push(candidateName)
      seen.add(normalized)
    }
  }
  if (hintSets) {
    for (const match of text.matchAll(DENSE_NAME_SEQUENCE_PATTERN)) {
      const block = match[1]
      if (!block) continue
      const denseWords = block.split(/\s+/).map(cleanNameCandidate).filter(Boolean)
      if (denseWords.length < 4) continue
      const split = splitLikelyNameRuns(denseWords, hintSets)
      if (!split) continue
      for (const candidate of split) {
        const candidateWords = candidate.split(/\s+/).filter(Boolean)
        const trimmedCandidateWords = trimTrailingNonNameWords(candidateWords, candidate, '', hintSets)
        if (trimmedCandidateWords.length < 2) continue
        const trimmedCandidate = trimmedCandidateWords.join(' ')
        const normalized = normalizeEntity(trimmedCandidate)
        if (!normalized) continue
        const tokens = normalized.split(' ').filter(Boolean)
        if (tokens.some(word => NAME_LIST_STOP_WORDS.has(word))) continue
        if (keepSet) keepSet.add(normalized)
        if (seen.has(normalized)) continue
        names.push(trimmedCandidate)
        seen.add(normalized)
      }
      if (removalSet) {
        const normalizedWords = denseWords.map(word => normalizeEntity(word)).filter(Boolean)
        const normalizedBlock = normalizedWords.join(' ')
        if (normalizedBlock && !keepSet?.has(normalizedBlock)) {
          removalSet.add(normalizedBlock)
        }
        for (const word of normalizedWords) {
          if (word.includes('-')) {
            for (const fragment of word.split('-')) {
              if (!fragment) continue
              if (keepSet?.has(fragment)) continue
              removalSet.add(fragment)
            }
          }
        }
        const maxLength = 4
        for (let start = 0; start < normalizedWords.length; start++) {
          let phrase = ''
          for (let end = start; end < Math.min(normalizedWords.length, start + maxLength); end++) {
            phrase = phrase ? `${phrase} ${normalizedWords[end]}` : normalizedWords[end]
            if (!phrase) continue
            if (keepSet?.has(phrase)) continue
            removalSet.add(phrase)
          }
        }
      }
    }
  }
  return names
}

function splitViaSecondary (words, secondaryMap) {
  if (!secondaryMap || secondaryMap.size === 0) return null
  const matches = []
  for (const word of words) {
    const key = normalizeEntity(word)
    if (!key) return null
    const match = secondaryMap.get(key)
    if (!match) return null
    matches.push(match)
  }
  return matches.length > 1 ? matches : null
}

function attemptHeuristicSplit (words, hintSets) {
  if (!Array.isArray(words) || words.length < 2) return null
  if (!words.every(startsWithUpper)) return null
  if (words.length > 3) return null
  const suffixCount = words.filter(word => likelySuffix(word, hintSets)).length
  if (suffixCount) return null
  const firstCount = words.filter(word => likelyFirst(word, hintSets)).length
  const lastCount = words.filter(word => likelyLast(word, hintSets)).length
  if (firstCount >= 2 && lastCount === 0) {
    return words.map(capitalizeFirstLetter)
  }
  return null
}

function scoreNameSegment (segment, hintSets) {
  if (!Array.isArray(segment) || segment.length < 2 || segment.length > 4) return null
  if (!segment.every(part => GENERIC_NAME_PART_PATTERN.test(part))) return null
  const cleaned = segment.map(cleanNameCandidate).filter(Boolean)
  if (cleaned.length !== segment.length) return null
  if (cleaned.some(word => wordLooksSuspicious(word, hintSets))) return null
  const first = cleaned[0]
  const last = cleaned[cleaned.length - 1]
  if (!startsWithUpper(first) || !startsWithUpper(last)) return null
  if (likelySuffix(first, hintSets)) return null
  if (INITIAL_NAME_PART_PATTERN.test(last)) return null

  const firstIsFirst = likelyFirst(first, hintSets)
  const lastIsLast = likelyLast(last, hintSets)
  if (!firstIsFirst && INITIAL_NAME_PART_PATTERN.test(first)) return null
  if (!lastIsLast && !GENERIC_NAME_PART_PATTERN.test(last)) return null

  let score = 0
  score += firstIsFirst ? 2 : 1
  score += lastIsLast ? 2 : 1

  let hasMiddleInitial = false
  for (let i = 1; i < cleaned.length - 1; i++) {
    const word = cleaned[i]
    if (!startsWithUpper(word)) return null
    if (likelySuffix(word, hintSets)) {
      score += 0.25
      continue
    }
    if (INITIAL_NAME_PART_PATTERN.test(word)) {
      hasMiddleInitial = true
      score += 0.5
      continue
    }
    if (likelyFirst(word, hintSets) || likelyLast(word, hintSets) || GENERIC_NAME_PART_PATTERN.test(word)) {
      score += 0.25
      continue
    }
    return null
  }
  if (hasMiddleInitial && cleaned.length < 3) return null
  return { score, name: cleaned.join(' ') }
}

function splitLikelyNameRuns (words, hintSets) {
  if (!Array.isArray(words) || words.length < 4) return null
  if (!words.every(part => GENERIC_NAME_PART_PATTERN.test(part))) return null
  const firstSignals = words.filter(word => likelyFirst(word, hintSets) || INITIAL_NAME_PART_PATTERN.test(word)).length
  if (firstSignals < 2 && words.length < 6) return null

  const dp = new Array(words.length + 1).fill(null)
  dp[words.length] = { score: 0, names: [] }

  for (let i = words.length - 1; i >= 0; i--) {
    let best = null
    for (let size = 2; size <= 4; size++) {
      const end = i + size
      if (end > words.length) break
      const segment = scoreNameSegment(words.slice(i, end), hintSets)
      if (!segment) continue
      const next = dp[end]
      if (!next) continue
      const totalScore = segment.score + next.score
      if (!best || totalScore > best.score) {
        best = { score: totalScore, names: [segment.name, ...next.names] }
      }
    }
    dp[i] = best
  }

  if (!dp[0] || dp[0].names.length < 2) return null
  if (!dp[0].names.every(name => name.trim().split(/\s+/).length >= 2)) return null

  return dp[0].names
    .map(name => name.replace(/\s+/g, ' ').trim())
    .map(name => name.replace(/[.]+$/g, ''))
    .map(capitalizeFirstLetter)
}

function splitNameListByConjunction (text, hintSets, secondaryMap) {
  if (typeof text !== 'string') return null
  if (!LIST_CONJUNCTION_SPLIT_PATTERN.test(text)) return null
  const segments = text
    .split(LIST_CONJUNCTION_SPLIT_PATTERN)
    .map(segment => segment.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (segments.length < 2) return null

  const results = []
  const seen = new Set()

  for (const segment of segments) {
    const words = segment
      .split(/\s+/)
      .map(cleanNameCandidate)
      .filter(Boolean)
    if (!words.length) continue

    const filtered = words.filter(word => {
      const normalized = normalizeEntity(word)
      return normalized && !LIST_CONJUNCTION_SET.has(normalized)
    })
    if (!filtered.length) continue

    const trimmed = trimTrailingNonNameWords(filtered, segment, '', hintSets)
    if (!trimmed.length) continue

    const split = splitNameWords(trimmed, hintSets, secondaryMap)
    if (Array.isArray(split) && split.length) {
      for (const name of split) {
        const key = normalizeEntity(name)
        if (!key || seen.has(key)) continue
        seen.add(key)
        results.push(name)
      }
      continue
    }

    if (trimmed.length >= 2 && trimmed.every(word => !wordLooksSuspicious(word, hintSets))) {
      const candidate = capitalizeFirstLetter(trimmed.join(' '))
      const key = normalizeEntity(candidate)
      if (key && !seen.has(key)) {
        seen.add(key)
        results.push(candidate)
      }
      continue
    }

    if (trimmed.length === 1) {
      const [single] = trimmed
      if (single && (likelyFirst(single, hintSets) || likelyLast(single, hintSets))) {
        const candidate = capitalizeFirstLetter(single)
        const key = normalizeEntity(candidate)
        if (key && !seen.has(key)) {
          seen.add(key)
          results.push(candidate)
        }
      }
    }
  }

  return results.length >= 2 ? results : null
}

function splitNameWords (words, hintSets, secondaryMap) {
  if (!Array.isArray(words)) return null
  const sanitized = words.map(cleanNameCandidate).filter(Boolean)
  if (sanitized.length <= 1) return null

  let working = sanitized
  if (working.length > 3) {
    const trimmed = trimHonorificPrefixes(working)
    if (trimmed.length >= 2) working = trimmed
  }

  const secondarySplit = splitViaSecondary(working, secondaryMap)
  if (secondarySplit) return secondarySplit

  const heuristicSplit = attemptHeuristicSplit(working, hintSets)
  if (heuristicSplit) return heuristicSplit

  const denseSplit = splitLikelyNameRuns(working, hintSets)
  if (denseSplit) return denseSplit

  return null
}

function buildSecondaryMap (names) {
  const map = new Map()
  for (const name of dedupeNameList(names)) {
    const key = normalizeEntity(name)
    if (!key || map.has(key)) continue
    map.set(key, capitalizeFirstLetter(name))
  }
  return map
}

function normalizeSecondaryConfig (raw) {
  if (!raw) return null
  if (Array.isArray(raw)) return { people: dedupeNameList(raw) }
  if (typeof raw === 'function') return { fetcher: raw }
  if (typeof raw !== 'object') return null
  const out = {}
  if (Array.isArray(raw.people)) out.people = dedupeNameList(raw.people)
  if (typeof raw.fetcher === 'function') out.fetcher = raw.fetcher
  if (typeof raw.endpoint === 'string' && raw.endpoint.trim()) {
    out.endpoint = raw.endpoint.trim()
    if (typeof raw.method === 'string') out.method = raw.method.trim()
    if (raw.headers && typeof raw.headers === 'object') out.headers = { ...raw.headers }
    if (typeof raw.field === 'string' && raw.field.trim()) out.field = raw.field.trim()
    if (Number.isFinite(Number(raw.timeoutMs))) out.timeoutMs = Number(raw.timeoutMs)
    if (Number.isFinite(Number(raw.minConfidence))) out.minConfidence = Number(raw.minConfidence)
  }
  return Object.keys(out).length ? out : null
}

async function fetchSecondaryPeople (text, secondaryHints, timeLeft) {
  if (!secondaryHints) return []
  const timeRemaining = typeof timeLeft === 'function' ? timeLeft() : Infinity
  if (timeRemaining <= 0) return []
  if (Array.isArray(secondaryHints.people) && secondaryHints.people.length) {
    return dedupeNameList(secondaryHints.people)
  }
  if (typeof secondaryHints.fetcher === 'function') {
    try {
      const res = await secondaryHints.fetcher(text)
      return dedupeNameList(Array.isArray(res) ? res : res?.people)
    } catch (err) {
      logger.warn('secondary ner fetcher failed', err)
      return []
    }
  }
  if (!secondaryHints.endpoint) return []
  const minConfidence = Number.isFinite(Number(secondaryHints.minConfidence)) ? Number(secondaryHints.minConfidence) : 0
  const method = typeof secondaryHints.method === 'string' ? secondaryHints.method.toUpperCase() : 'POST'
  const headers = { 'content-type': 'application/json', ...(secondaryHints.headers || {}) }
  const field = typeof secondaryHints.field === 'string' && secondaryHints.field.trim() ? secondaryHints.field.trim() : 'text'
  const timeoutMs = Number.isFinite(Number(secondaryHints.timeoutMs)) ? Number(secondaryHints.timeoutMs) : 2000
  if (timeRemaining < timeoutMs * 0.75) return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = method === 'GET' ? undefined : JSON.stringify({ [field]: text })
    const res = await undiciFetch(secondaryHints.endpoint, { method, headers, body, signal: controller.signal })
    if (!res.ok) {
      logger.warn('secondary ner request failed', { status: res.status })
      return []
    }
    let data = null
    try { data = await res.json() } catch (err) {
      logger.warn('secondary ner parse failed', err)
      return []
    }
    const names = extractPeopleFromSecondary(data, minConfidence)
    return dedupeNameList(names)
  } catch (err) {
    if (err?.name !== 'AbortError') logger.warn('secondary ner fetch failed', err)
    return []
  } finally {
    clearTimeout(timer)
  }
}

function extractPeopleFromSecondary (data, minConfidence = 0) {
  const out = []
  const push = (val) => {
    if (typeof val !== 'string') return
    const trimmed = val.trim()
    if (trimmed) out.push(trimmed)
  }
  const handleEntity = (entity) => {
    if (!entity || typeof entity !== 'object') return
    const label = String(entity.label || entity.label_ || entity.type || entity.category || '').toUpperCase()
    if (label && label !== 'PERSON') return
    const score = entity.score ?? entity.confidence ?? entity.prob ?? entity.probability
    if (typeof score === 'number' && Number.isFinite(minConfidence) && score < minConfidence) return
    push(entity.text || entity.name || entity.value)
  }
  if (!data) return out
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') push(item)
      else handleEntity(item)
    }
    return out
  }
  if (typeof data !== 'object') return out
  if (Array.isArray(data.people)) data.people.forEach(push)
  if (Array.isArray(data.names)) data.names.forEach(push)
  if (Array.isArray(data.ents)) data.ents.forEach(handleEntity)
  if (Array.isArray(data.entities)) data.entities.forEach(handleEntity)
  if (Array.isArray(data.results)) data.results.forEach(handleEntity)
  if (Array.isArray(data.docs)) {
    for (const doc of data.docs) {
      if (Array.isArray(doc?.ents)) doc.ents.forEach(handleEntity)
      if (Array.isArray(doc?.entities)) doc.entities.forEach(handleEntity)
    }
  }
  if (data.entities && typeof data.entities === 'object') {
    const personList = data.entities.PERSON || data.entities.person || data.entities.people
    if (Array.isArray(personList)) personList.forEach(push)
  }
  return out
}


function hasCountryTag (term) {
  if (!term || !Array.isArray(term.terms)) return false
  return term.terms.some(entry => Array.isArray(entry.tags) && entry.tags.includes('Country'))
}

function findNextCountryIndex (terms, startIndex) {
  if (!Array.isArray(terms)) return null
  for (let i = startIndex; i < terms.length; i++) {
    if (hasCountryTag(terms[i])) return i
  }
  return null
}

function splitCountrySequence (text) {
  if (typeof text !== 'string' || !text.trim()) return null
  let termData = []
  try {
    termData = nlp(text).terms().json()
  } catch {
    return null
  }
  if (!Array.isArray(termData) || !termData.length) return null
  const groups = []
  let buffer = []
  const flush = () => {
    if (!buffer.length) return
    const candidate = buffer.join(' ').trim()
    if (candidate) groups.push(candidate)
    buffer = []
  }
  for (let i = 0; i < termData.length; i++) {
    const term = termData[i]
    if (!hasCountryTag(term)) {
      flush()
      continue
    }
    buffer.push(term.text)
    const normalizedBuffer = normalizeEntity(buffer.join(' '))
    const nextIdx = findNextCountryIndex(termData, i + 1)
    if (nextIdx === null) {
      flush()
      continue
    }
    const nextTerm = termData[nextIdx]
    const normalizedWithNext = normalizeEntity([...buffer, nextTerm.text].join(' '))
    if (normalizedWithNext && MULTI_WORD_COUNTRY_NAMES.has(normalizedWithNext)) {
      continue
    }
    if (normalizedBuffer && MULTI_WORD_COUNTRY_PREFIXES.has(normalizedBuffer)) {
      continue
    }
    flush()
  }
  flush()
  return groups.length > 1 ? groups : null
}

function splitByPlaceConjunction (text) {
  if (typeof text !== 'string') return []
  const trimmed = text.trim()
  if (!trimmed) return []
  const normalized = normalizeEntity(trimmed)
  if (normalized && MULTI_WORD_COUNTRY_NAMES.has(normalized)) return [trimmed]
  if (!PLACE_CONJUNCTION_SPLIT_PATTERN.test(trimmed)) return [trimmed]
  const parts = trimmed.split(PLACE_CONJUNCTION_SPLIT_PATTERN).map(part => part.trim()).filter(Boolean)
  return parts.length ? parts : [trimmed]
}

function splitPlaceSegments (raw) {
  if (typeof raw !== 'string') return []
  const sanitized = raw.replace(/\s+/g, ' ').trim()
  if (!sanitized) return []
  const initialParts = sanitized.split(PLACE_PUNCTUATION_SPLIT_PATTERN).map(part => part.trim()).filter(Boolean)
  const parts = initialParts.length ? initialParts : [sanitized]
  const segments = []
  for (const part of parts) {
    const normalized = normalizeEntity(part)
    if (!normalized) continue
    if (MULTI_WORD_COUNTRY_NAMES.has(normalized)) {
      segments.push(part)
      continue
    }
    const conjunctionParts = splitByPlaceConjunction(part)
    for (const chunk of conjunctionParts) {
      const cleanedChunk = chunk.trim()
      if (!cleanedChunk) continue
      const normalizedChunk = normalizeEntity(cleanedChunk)
      if (normalizedChunk && MULTI_WORD_COUNTRY_NAMES.has(normalizedChunk)) {
        segments.push(cleanedChunk)
        continue
      }
      const splitCountries = splitCountrySequence(cleanedChunk)
      if (Array.isArray(splitCountries) && splitCountries.length) {
        for (const name of splitCountries) {
          const trimmedName = String(name || '').trim()
          if (trimmedName) segments.push(trimmedName)
        }
        continue
      }
      segments.push(cleanedChunk)
    }
  }
  return segments
}

function isLikelyNonPlaceTail (word, tagsSet) {
  if (typeof word !== 'string') return false
  const tags = tagsSet instanceof Set ? tagsSet : new Set(Array.isArray(tagsSet) ? tagsSet : [])
  if (tags.has('Place') || tags.has('Country') || tags.has('City') || tags.has('Region')) return false
  if (tags.has('Preposition') || tags.has('Conjunction') || tags.has('Determiner') || tags.has('Pronoun') || tags.has('Adverb')) return true
  if (tags.has('Verb') || tags.has('Gerund') || tags.has('Infinitive')) return true
  return false
}

function collectTermTags (text) {
  if (typeof text !== 'string') return []
  const trimmed = text.trim()
  if (!trimmed) return []
  try {
    const doc = nlp(trimmed)
    return doc.terms().json().map(item => {
      const tagSet = new Set()
      if (Array.isArray(item?.terms)) {
        for (const term of item.terms) {
          if (Array.isArray(term?.tags)) {
            for (const tag of term.tags) tagSet.add(tag)
          }
        }
      }
      return tagSet
    })
  } catch {
    return []
  }
}

function wordLooksLikePerson (word, hintSets, tagsSet) {
  if (typeof word !== 'string') return false
  const normalized = normalizeEntity(word)
  if (!normalized) return false
  const tags = tagsSet instanceof Set ? tagsSet : new Set(Array.isArray(tagsSet) ? tagsSet : [])
  if (tags.has('Place') || tags.has('Country') || tags.has('City') || tags.has('Region')) return false
  if (tags.has('Person') || tags.has('FirstName') || tags.has('LastName') || tags.has('MaleName') || tags.has('FemaleName')) return true
  if (hintSets) {
    if (likelyFirst(word, hintSets) || likelyLast(word, hintSets) || likelySuffix(word, hintSets)) return true
  }
  try {
    const doc = nlp(word)
    if (doc.has('#Place') || doc.has('#Country') || doc.has('#City') || doc.has('#Region')) return false
    if (doc.has('#Person') || doc.has('#LastName') || doc.has('#FirstName')) return true
  } catch {}
  return false
}

function trimPlaceTailWords (words, hintSets, tagsArray, personTokenSet) {
  if (!Array.isArray(words)) return { words: [], tags: [], extras: [] }
  const trimmed = words.slice()
  const extras = []
  let tags = Array.isArray(tagsArray) && tagsArray.length === trimmed.length
    ? tagsArray.map(set => (set instanceof Set ? new Set(set) : new Set(Array.isArray(set) ? set : [])))
    : collectTermTags(trimmed.join(' '))

  const recalcTags = () => {
    tags = collectTermTags(trimmed.join(' '))
  }

  const removeTail = (count, record = false) => {
    if (!Number.isInteger(count) || count <= 0 || trimmed.length < count) return false
    if (record) {
      const segmentWords = trimmed.slice(trimmed.length - count)
      const segment = segmentWords.join(' ').replace(/\s+/g, ' ').trim()
      if (segment) extras.unshift(segment)
    }
    trimmed.splice(trimmed.length - count, count)
    recalcTags()
    return true
  }

  while (trimmed.length > 1) {
    let handled = false
    for (const pattern of KNOWN_ORGANIZATION_TAIL_PATTERNS) {
      const len = pattern.length
      if (trimmed.length <= len) continue
      const tailWords = trimmed.slice(-len)
      const normalizedTail = tailWords.map(word => normalizeEntity(word))
      let match = true
      for (let i = 0; i < len; i++) {
        if (normalizedTail[i] !== pattern[i]) {
          match = false
          break
        }
      }
      if (match) {
        removeTail(len, true)
        handled = true
        break
      }
    }
    if (handled) continue
    const lastWord = trimmed[trimmed.length - 1]
    const normalizedLast = normalizeEntity(lastWord)
    if (trimmed.length > 1 && TRAILING_LOCATION_ABBREVIATIONS.has(normalizedLast)) {
      removeTail(1, true)
      continue
    }
    break
  }

  while (trimmed.length > 1) {
    const idx = trimmed.length - 1
    const word = trimmed[idx]
    if (typeof word !== 'string') {
      removeTail(1)
      continue
    }
    const normalizedWord = normalizeEntity(word)
    if (!normalizedWord) {
      removeTail(1)
      continue
    }
    const normalizedPhrase = normalizeEntity(trimmed.join(' '))
    if (normalizedPhrase && (MULTI_WORD_COUNTRY_NAMES.has(normalizedPhrase) || KNOWN_PLACE_PHRASES.has(normalizedPhrase))) break
    const tagSet = tags[idx] instanceof Set ? tags[idx] : new Set(Array.isArray(tags[idx]) ? tags[idx] : [])
    if (PLACE_TAIL_STOP_WORDS.has(normalizedWord)) {
      removeTail(1)
      continue
    }
    if (personTokenSet && personTokenSet.has(normalizedWord)) {
      removeTail(1)
      continue
    }
    if (wordLooksLikePerson(word, hintSets, tagSet)) {
      removeTail(1)
      continue
    }
    if (isLikelyNonPlaceTail(word, tagSet)) {
      removeTail(1)
      continue
    }
    break
  }

  return { words: trimmed, tags, extras }
}
function cleanPlaceSegment (segment, hintSets, personTokenSet) {
  if (typeof segment !== 'string') return null
  const normalizedSpace = segment.replace(/\s+/g, ' ').trim()
  if (!normalizedSpace) return null
  const words = normalizedSpace.split(/\s+/)
  const initialTags = collectTermTags(normalizedSpace)
  const { words: trimmedWords, tags, extras } = trimPlaceTailWords(words, hintSets, initialTags, personTokenSet)
  const cleaned = trimmedWords.join(' ').trim()
  if (!cleaned && (!extras || !extras.length)) return null
  const finalTags = cleaned ? tags : []
  return { text: cleaned || null, tags: finalTags, extras }
}
function isValidPlaceCandidate (candidate, tagSets) {
  if (typeof candidate !== 'string') return false
  const trimmed = candidate.trim()
  if (!trimmed) return false
  const normalized = normalizeEntity(trimmed)
  if (!normalized) return false
  if (MULTI_WORD_COUNTRY_NAMES.has(normalized) || KNOWN_PLACE_PHRASES.has(normalized) || TRAILING_LOCATION_ABBREVIATIONS.has(normalized)) return true
  try {
    const doc = nlp(trimmed)
    if (doc.has('#Place') || doc.has('#Country') || doc.has('#City') || doc.has('#Region')) return true
  } catch {}
  const tags = Array.isArray(tagSets) && tagSets.length ? tagSets : collectTermTags(trimmed)
  if (tags.some(set => set instanceof Set && (set.has('Place') || set.has('Country') || set.has('City') || set.has('Region')))) return true
  if (/\b(?:more|latest|live|update)\b/i.test(trimmed)) return false
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length === 1) return false
  return true
}
function expandAndCleanPlaces (values, hintSets, personTokenSet) {
  const out = []
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue
    const baseSegments = splitPlaceSegments(value)
    const queue = (Array.isArray(baseSegments) && baseSegments.length) ? [...baseSegments] : [value]
    while (queue.length) {
      const segment = queue.shift()
      if (typeof segment !== 'string') continue
      const cleaned = cleanPlaceSegment(segment, hintSets, personTokenSet)
      if (!cleaned) continue
      const { text, tags, extras } = cleaned
      if (text && isValidPlaceCandidate(text, tags)) out.push(text)
      if (Array.isArray(extras) && extras.length) {
        for (const extra of extras) {
          if (typeof extra === 'string' && extra.trim()) queue.unshift(extra)
        }
      }
    }
  }
  return out
}
function cleanOrganizationValue (value) {
  if (typeof value !== 'string') return { text: null, extras: [] }
  let sanitized = value.replace(/\s+/g, ' ').trim()
  if (!sanitized) return { text: null, extras: [] }
  let words = sanitized.split(/\s+/)
  const extras = []
  let modified = true

  while (modified && words.length > 0) {
    modified = false
    if (words.length > 1) {
      const normalizedLast = normalizeEntity(words[words.length - 1])
      if (TRAILING_LOCATION_ABBREVIATIONS.has(normalizedLast)) {
        words = words.slice(0, -1)
        modified = true
        continue
      }
    }
    for (const pattern of KNOWN_ORGANIZATION_TAIL_PATTERNS) {
      const len = pattern.length
      if (words.length <= len) continue
      const tailWords = words.slice(-len)
      const normalizedTail = tailWords.map(word => normalizeEntity(word))
      let match = true
      for (let i = 0; i < len; i++) {
        if (normalizedTail[i] !== pattern[i]) {
          match = false
          break
        }
      }
      if (match) {
        extras.unshift(tailWords.join(' '))
        words = words.slice(0, -len)
        modified = true
        break
      }
    }
  }

  const text = words.join(' ').trim()
  return { text: text || null, extras }
}

function expandAndCleanOrgs (values) {
  const out = []
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue
    const queue = [value]
    while (queue.length) {
      const current = queue.shift()
      if (typeof current !== 'string') continue
      const cleaned = cleanOrganizationValue(current)
      if (!cleaned) continue
      if (cleaned.text) out.push(cleaned.text)
      if (Array.isArray(cleaned.extras) && cleaned.extras.length) {
        for (const extra of cleaned.extras) {
          if (typeof extra === 'string' && extra.trim()) queue.unshift(extra)
        }
      }
    }
  }
  return out
}
function buildPersonTokenSet (names) {
  const tokens = new Set()
  for (const name of Array.isArray(names) ? names : []) {
    if (typeof name !== 'string') continue
    const trimmed = name.trim()
    if (!trimmed) continue
    let skip = false
    try {
      const doc = nlp(trimmed)
      if (doc.has('#Place') || doc.has('#Country') || doc.has('#City') || doc.has('#Region')) skip = true
    } catch {}
    if (skip) continue
    const parts = trimmed.split(/\s+/).map(cleanNameCandidate).filter(Boolean)
    for (const part of parts) {
      const normalizedPart = normalizeEntity(part)
      if (!normalizedPart) continue
      tokens.add(normalizedPart)
    }
  }
  return tokens
}

function maybeSplitPerson (entity, rawText, hintSets, secondaryMap, fullContext) {
  const raw = typeof rawText === 'string' ? rawText : ''
  let fallback = raw.trim()
  if (!fallback && typeof entity?.text === 'string') fallback = entity.text.trim()
  if (!fallback) return []

  const sanitizedFallback = fallback.replace(/\.(?=\s|$)/g, '').replace(/\s+/g, ' ').trim()
  let canonical = sanitizedFallback
  if (entity.person && (entity.person.honorific || entity.person.firstName || entity.person.middleName || entity.person.lastName)) {
    const parts = [entity.person.honorific, entity.person.firstName, entity.person.middleName, entity.person.lastName]
      .filter(Boolean)
      .map(part => capitalizeFirstLetter(String(part).trim()))
    const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
    if (joined && (!sanitizedFallback || sanitizedFallback === sanitizedFallback.toLowerCase())) {
      canonical = /-/.test(entity.text) ? sanitizedFallback : joined
    }
  }
  const canonicalWords = String(canonical || '').split(/\s+/).map(cleanNameCandidate).filter(Boolean)
  const canonicalContext = canonical === sanitizedFallback ? fallback : canonical
  let trimmedCanonicalWords = trimTrailingNonNameWords(canonicalWords, canonicalContext, '', hintSets)
  trimmedCanonicalWords = trimCommaDelimitedTail(trimmedCanonicalWords, fullContext, hintSets)
  const canonicalCandidate = trimmedCanonicalWords.join(' ')
  let fallbackWords = sanitizedFallback
    .split(/\s+/)
    .map(cleanNameCandidate)
    .filter(Boolean)
  fallbackWords = trimTrailingNonNameWords(fallbackWords, raw, '', hintSets)
  fallbackWords = trimCommaDelimitedTail(fallbackWords, fullContext, hintSets)
  const fallbackCandidate = fallbackWords.join(' ')
  const safeCanonical = (canonicalCandidate || fallbackCandidate || sanitizedFallback || fallback).trim()

  const punctuationSplit = maybeSplitByPunctuationSeparators(sanitizedFallback)
  if (punctuationSplit) {
    const extracted = []
    for (const segment of punctuationSplit) {
      const segmentWords = segment
        .split(/\s+/)
        .map(cleanNameCandidate)
        .filter(Boolean)
      if (!segmentWords.length) continue
      const trimmedSegmentWords = trimTrailingNonNameWords(segmentWords, segment, '', hintSets)
      if (!trimmedSegmentWords.length) continue
      const split = splitNameWords(trimmedSegmentWords, hintSets, secondaryMap)
      if (split?.length) {
        extracted.push(...split)
        continue
      }
      if (trimmedSegmentWords.length >= 2) {
        const normalizedSegment = trimmedSegmentWords.join(' ')
        if (normalizedSegment) extracted.push(capitalizeFirstLetter(normalizedSegment))
        continue
      }
      if (trimmedSegmentWords.length === 1) {
        const [single] = trimmedSegmentWords
        if (likelyFirst(single, hintSets) || likelyLast(single, hintSets)) {
          extracted.push(capitalizeFirstLetter(single))
        }
      }
    }
    if (extracted.length) return extracted
  }

  const spacingSplit = maybeSplitBySpacing(raw)
  if (spacingSplit) {
    const filteredSpacing = filterLikelyNameParts(spacingSplit, hintSets)
    if (filteredSpacing.length >= 2) return filteredSpacing
  }

  const words = fallbackWords
  if (words.length <= 1) return [safeCanonical]

  const split = splitNameWords(words, hintSets, secondaryMap)
  if (split) return split

  const conjunctionSplit = splitNameListByConjunction(sanitizedFallback, hintSets, secondaryMap)
  if (conjunctionSplit) return conjunctionSplit

  return [safeCanonical]
}

export default async function entityParser (nlpInput, pluginHints = DEFAULT_HINTS, timeLeft = () => Infinity) {
  const doc = nlp(nlpInput)
  const hints = coerceHints(pluginHints)
  const hintSets = buildHintSets(hints)

  const entityToString = (e) => {
    if (Array.isArray(e?.terms) && e.terms.length) {
      let raw = ''
      for (let i = 0; i < e.terms.length; i++) {
        const term = e.terms[i]
        const text = typeof term.text === 'string' ? term.text : ''
        const trimmed = text.trim()
        if (!trimmed) {
          if (typeof term.pre === 'string') raw += term.pre
          if (typeof term.post === 'string') raw += term.post
          continue
        }
        const pre = typeof term.pre === 'string' ? term.pre : (raw ? ' ' : '')
        raw += pre + trimmed
        if (typeof term.post === 'string') raw += term.post
      }
      const cleaned = raw.trim()
      if (cleaned) return cleaned
    }
    if (typeof e?.text === 'string') return e.text.trim()
    return null
  }

  const dedupeEntities = (arr, stripAll = false) => {
    const out = []
    const seen = new Set()
    for (const s of arr) {
      const str = stripPossessive(String(s || '').trim(), stripAll)
      if (!str) continue
      const key = normalizeEntity(str)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(capitalizeFirstLetter(str))
    }
    return out
  }

  const secondaryPeople = await fetchSecondaryPeople(nlpInput, hints.secondary, timeLeft)
  const secondaryMap = buildSecondaryMap(secondaryPeople)

  const result = {}
  doc.people().parse()
  const compromisePeople = doc.people().json().flatMap(p => {
    const text = entityToString(p)
    if (!text) return []
    return maybeSplitPerson(p, text, hintSets, secondaryMap, nlpInput)
  })

  let combinedPeople = compromisePeople
  const denseKeep = new Set()
  const denseRemovals = new Set()
  if (secondaryPeople.length) combinedPeople = combinedPeople.concat(secondaryPeople)

  const seenList = new Set(combinedPeople.map(name => normalizeEntity(name)).filter(Boolean))
  const listNames = extractNamesFromCapitalizedLists(nlpInput, seenList, hintSets, denseKeep, denseRemovals)
  if (denseRemovals.size) {
    combinedPeople = combinedPeople.filter(name => {
      const key = normalizeEntity(name)
      if (!key) return false
      if (denseKeep.has(key)) return true
      if (denseRemovals.has(key)) return false
      return true
    })
  }
  if (listNames.length) combinedPeople = combinedPeople.concat(listNames)

  combinedPeople = mergeHonorificPairs(combinedPeople, hintSets)
  combinedPeople = combinedPeople.map(name => trimSentenceStarterTail(name, hintSets))

  let people = dedupeEntities(combinedPeople, true)
  const multiWordFirsts = new Set()
  for (const name of people) {
    const normalized = normalizeEntity(name)
    const parts = normalized.split(' ').filter(Boolean)
    if (parts.length > 1) multiWordFirsts.add(parts[0])
  }
  people = people.filter(name => {
    const normalized = normalizeEntity(name)
    if (!normalized) return false
    if (PERSON_NAME_STOP_WORDS.has(normalized)) return false
    if (/\d/.test(normalized)) return false
    if (!/\s/.test(name) && multiWordFirsts.has(normalized)) return false
    return true
  })
  const seen = new Set(people.map(name => normalizeEntity(name)))

  if (hints.first.length && hints.last.length) {
    const haystack = normalizeEntity(nlpInput)
    for (const f of hints.first) {
      for (const l of hints.last) {
        const raw = `${f} ${l}`
        const key = normalizeEntity(raw)
        if (haystack.includes(key) && !seen.has(key)) {
          people.push(capitalizeFirstLetter(raw))
          seen.add(key)
        }
      }
    }
  }

  people = dedupeEntities(people, true)
  if (people.length > 1) {
    const normalizedPeople = people
      .map(name => {
        const normalized = normalizeEntity(name).replace(/\s+/g, ' ').trim()
        if (!normalized) return null
        const tokens = normalized.split(' ').filter(Boolean)
        return { original: name, normalized, tokens }
      })
      .filter(Boolean)

    const normalizedCounts = new Map()
    const normalizedSet = new Set()
    const prefixSet = new Set()
    const suffixSet = new Set()

    for (const { normalized, tokens } of normalizedPeople) {
      normalizedSet.add(normalized)
      normalizedCounts.set(normalized, (normalizedCounts.get(normalized) || 0) + 1)
      for (let i = 1; i < tokens.length; i++) {
        const prefix = tokens.slice(0, i).join(' ')
        const suffix = tokens.slice(i).join(' ')
        if (prefix) prefixSet.add(prefix)
        if (suffix) {
          suffixSet.add(suffix)
          const firstSuffix = tokens[i]
          if (typeof firstSuffix === 'string' && firstSuffix.includes('-')) {
            for (const fragment of firstSuffix.split('-')) {
              if (fragment) suffixSet.add(fragment)
            }
          }
        }
      }
    }

    const filtered = []
    const outputSet = new Set()

    const containsStopWord = (tokens) => tokens.some(word => NAME_LIST_STOP_WORDS.has(word))

    for (const { original, normalized, tokens } of normalizedPeople) {
      normalizedCounts.set(normalized, (normalizedCounts.get(normalized) || 0) - 1)
      if (!original || !tokens.length) continue
      if (outputSet.has(normalized)) continue
      if (containsStopWord(tokens)) continue

      let skipOriginal = false
      if (tokens.length >= 3) {
        for (let splitIdx = 1; splitIdx < tokens.length; splitIdx++) {
          const left = tokens.slice(0, splitIdx).join(' ')
          const right = tokens.slice(splitIdx).join(' ')
          if (!left || !right) continue

          const leftReady = outputSet.has(left) || normalizedSet.has(left) || suffixSet.has(left) || (normalizedCounts.get(left) || 0) > 0
          const rightReady = outputSet.has(right) || normalizedSet.has(right) || prefixSet.has(right) || (normalizedCounts.get(right) || 0) > 0

          if (leftReady && rightReady) {
            skipOriginal = true
            break
          }
        }
      }

      if (skipOriginal) continue

      filtered.push(original)
      outputSet.add(normalized)
    }

    people = filtered
  }
  const personTokenSet = buildPersonTokenSet(people)
  let placeKeySet = null
  if (timeLeft() >= 1000) {
    const rawPlaces = doc.places().json().map(entityToString)
    const expandedPlaces = expandAndCleanPlaces(rawPlaces, hintSets, personTokenSet)
    const dedupedPlaces = dedupeEntities(expandedPlaces)
    result.places = dedupedPlaces
    if (dedupedPlaces.length) {
      placeKeySet = new Set(dedupedPlaces.map(name => normalizeEntity(name)).filter(Boolean))
    }
  }

  if (placeKeySet) {
    people = people.filter(name => {
      const key = normalizeEntity(name)
      return key && !placeKeySet.has(key)
    })
  }

  result.people = people
  if (timeLeft() >= 900) {
    const rawOrgs = doc.organizations().json().map(entityToString)
    const cleanedOrgs = expandAndCleanOrgs(rawOrgs)
    result.orgs = dedupeEntities(cleanedOrgs)
  }
  if (timeLeft() >= 800) result.topics = dedupeEntities(doc.topics().json().map(entityToString))
  return result
}







