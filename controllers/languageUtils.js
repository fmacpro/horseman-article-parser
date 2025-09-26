const STRIP_DIACRITICS = /\p{M}/gu

export function normalizeToken (value) {
  if (!value || typeof value !== 'string') return ''
  return value
    .normalize('NFD')
    .replace(STRIP_DIACRITICS, '')
    .toLowerCase()
    .trim()
}

const ISO6393_TO_1 = {
  eng: 'en',
  fre: 'fr',
  fra: 'fr',
  spa: 'es',
  esl: 'es',
  deu: 'de',
  ger: 'de',
  ita: 'it',
  por: 'pt',
  nld: 'nl'
}

export function normalizeLanguageCode (input) {
  if (!input) return 'en'
  if (typeof input === 'string') {
    const lowered = input.toLowerCase()
    if (lowered.length === 2) return lowered
    if (ISO6393_TO_1[lowered]) return ISO6393_TO_1[lowered]
    return lowered.slice(0, 2)
  }
  if (typeof input === 'object') {
    const { iso6391, iso6393 } = input || {}
    if (typeof iso6391 === 'string' && iso6391) return normalizeLanguageCode(iso6391)
    if (typeof iso6393 === 'string' && iso6393) return normalizeLanguageCode(iso6393)
  }
  return 'en'
}

const STOPWORD_LISTS = {
  en: [
    'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'before', 'being', 'but',
    'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'for', 'from', 'further', 'had', 'has',
    'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into',
    'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off',
    'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should',
    'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
    'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
    'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'you', 'your', 'yours', 'yourself',
    'yourselves'
  ],
  fr: [
    'a', 'afin', 'ainsi', 'alors', 'apres', 'aucun', 'au', 'aucune', 'aujourd', 'hui', 'aussi', 'autre', 'autres',
    'aux', 'avant', 'avec', 'avoir', 'beaucoup', 'car', 'ce', 'cela', 'ces', 'cet', 'cette', 'ceux', 'chez', 'ci',
    'comme', 'comment', 'dans', 'de', 'des', 'du', 'elle', 'elles', 'en', 'encore', 'entre', 'est', 'et', 'eu', 'faire',
    'fait', 'fois', 'ici', 'il', 'ils', 'je', 'jusqu', 'la', 'le', 'les', 'leur', 'leurs', 'lors', 'lui', 'ma', 'mais',
    'me', 'mes', 'moi', 'moins', 'mon', 'ne', 'ligne', 'point', 'nos', 'notre', 'nous', 'on', 'ou', 'par', 'parce', 'pas', 'selon', 'peu', 'plus', 'dune', 'pour', 'pourquoi', 'qu', 'que', 'quel', 'quelle', 'quelles', 'quels', 'qui', 'quoi', 'sans', 'se', 'ses', 'si',
    'sont', 'son', 'sous', 'sur', 'ta', 'te', 'tes', 'toi', 'ton', 'tous', 'tout', 'tres', 'tu', 'un', 'une', 'vos',
    'votre', 'vous', 'y'
  ],
  es: [
    'a', 'acerca', 'ademas', 'al', 'algo', 'algunas', 'algunos', 'ante', 'antes', 'aqui', 'asi', 'como', 'con',
    'contra', 'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'dos', 'el', 'ella', 'ellas', 'ellos', 'en', 'entre',
    'era', 'eramos', 'eran', 'es', 'esta', 'estaba', 'estamos', 'estan', 'estas', 'este', 'esto', 'estos', 'fue',
    'fueron', 'ha', 'hace', 'hacia', 'han', 'hasta', 'hay', 'la', 'las', 'lo', 'los', 'mas', 'mientras', 'muy', 'no',
    'nos', 'nosotros', 'o', 'para', 'pero', 'por', 'porque', 'que', 'se', 'sin', 'sobre', 'su', 'sus', 'tambien', 'te',
    'tiene', 'tienen', 'todo', 'un', 'una', 'uno', 'ya', 'y'
  ]
}

const STOPWORD_SETS = Object.fromEntries(
  Object.entries(STOPWORD_LISTS).map(([code, words]) => [code, buildStopwordSet(words)])
)

function buildStopwordSet (words) {
  const set = new Set()
  for (const word of words) {
    const normalized = normalizeToken(word)
    if (normalized) set.add(normalized)
  }
  return set
}

export function getStopwordSet (lang) {
  const code = normalizeLanguageCode(lang)
  return STOPWORD_SETS[code] || STOPWORD_SETS.en
}

export function isAllCapsWord (value) {
  if (!value || typeof value !== 'string') return false
  const letters = value.replace(/[^A-Z\p{Lu}]/gu, '')
  if (letters.length === 0) return false
  return value === value.toUpperCase()
}





