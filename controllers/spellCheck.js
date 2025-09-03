import retext from 'retext'
import spell from 'retext-spell'
import dictionary from 'dictionary-en-gb'
import report from 'vfile-reporter-json'

export default function spellCheck (text, options) {
  text = text.replace(/[0-9]{1,}[a-zA-Z]{1,}/gi, '')

  return new Promise(function (resolve, reject) {
    if (typeof options === 'undefined') {
      options = {
        dictionary: dictionary
      }
    }

    if (typeof options.dictionary === 'undefined') {
      options.dictionary = dictionary
    }

    retext()
      .use(spell, options)
      .process(text, function (error, file) {
        if (error) {
          reject(error)
        }

        let results = JSON.parse(report(file))
        results = results[0].messages
        resolve(results)
      })
  })
}
