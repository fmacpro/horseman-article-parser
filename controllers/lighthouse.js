import lighthouseImport from 'lighthouse'
const lighthouse = lighthouseImport.default || lighthouseImport

export default async function lighthouseAnalysis (browser, options, socket) {
  socket.emit('parse:status', 'Starting Lighthouse')

  const results = await lighthouse(options.url, {
    port: (new URL(browser.wsEndpoint())).port,
    output: 'json'
  })

  socket.emit('parse:status', 'Lighthouse Analysis Complete')
  return results.lhr
}
