import { retext } from 'retext'
import retextLanguage from 'retext-language'
import { franc } from 'franc'

// Minimal ISO-639-3 to ISO-639-1 mapping for common languages
const ISO3_TO_1 = {
  afr: 'af', ara: 'ar', ben: 'bn', bul: 'bg', cat: 'ca', ces: 'cs', dan: 'da',
  deu: 'de', ell: 'el', eng: 'en', est: 'et', eus: 'eu', fin: 'fi', fra: 'fr',
  heb: 'he', hin: 'hi', hrv: 'hr', hun: 'hu', ind: 'id', ita: 'it', jpn: 'ja',
  kor: 'ko', lit: 'lt', lav: 'lv', nld: 'nl', pol: 'pl', por: 'pt', ron: 'ro',
  rus: 'ru', slk: 'sk', slv: 'sl', spa: 'es', srp: 'sr', swe: 'sv', tam: 'ta',
  tel: 'te', tha: 'th', tur: 'tr', ukr: 'uk', urd: 'ur', vie: 'vi', zho: 'zh'
}

function iso3to1(code) {
  return ISO3_TO_1[code] || null
}

/**
 * Detect language of provided text.
 * Returns ISO-639-1 and ISO-639-3 codes.
 * Defaults to English if detection fails.
 * @param {string} text raw text input
 * @returns {{iso6391: string, iso6393: string}}
 */
export default async function detectLanguage(text) {
  let iso6393 = 'eng'
  if (typeof text === 'string' && text.trim()) {
    try {
      const file = await retext().use(retextLanguage).process(text)
      if (file.data && file.data.language && file.data.language !== 'und') {
        iso6393 = file.data.language
      } else {
        const f = franc(text)
        if (f && f !== 'und') iso6393 = f
      }
    } catch {
      try {
        const f = franc(text)
        if (f && f !== 'und') iso6393 = f
      } catch {}
    }
  }
  const iso6391 = iso3to1(iso6393) || 'en'
  return { iso6391, iso6393 }
}
