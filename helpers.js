
/**
 * sets the default options
 *
 * @param {Object} options - the options object
 *
 * @return {Object} options with defaults set if options are not specified
 *
 */

import _ from 'lodash'

export function setDefaultOptions (options = {}) {
  const defaults = {
    enabled: [],
    puppeteer: {
      launch: {
        headless: true,
        defaultViewport: null,
        handleSIGINT: false
      },
      goto: { waitUntil: 'networkidle2' },
      setBypassCSP: true
    },
    striptags: [],
    blockedResourceTypes: [],
    skippedResources: [],
    title: {},
    nlp: { plugins: [] },
    regex: {
      unlikelyCandidatesRe: /combx|modal|comment|disqus|foot|header|menu|meta|nav|rss|shoutbox|sponsor|social|teaserlist|time|tweet|twitter/i,
      okMaybeItsACandidateRe: /and|article|body|column|main|story|entry|^post/im,
      positiveRe: /article|body|content|entry|hentry|page|pagination|post|section|chapter|description|main|blog|text/i,
      negativeRe: /combx|comment|contact|foot|footer|footnote|link|media|meta|promo|related|scroll|shoutbox|sponsor|utility|tags|widget/i,
      divToPElementsRe: /<(a|blockquote|dl|div|img|ol|p|pre|table|ul)/i,
      replaceBrsRe: /(<br[^>]*>[ \n\r\t]*){2,}/gi,
      replaceFontsRe: /<(\/?)font[^>]*>/gi,
      trimRe: /^\s+|\s+$/g,
      normalizeRe: /\s{2,}/g,
      killBreaksRe: /(<br\s*\/?>(\s|&nbsp;?)*){1,}/g,
      videoRe: /http:\/\/(www\.)?(youtube|vimeo|youku|tudou|56|yinyuetai)\.com/i,
      attributeRe: /blog|post|article/i
    }
  }

  return _.defaultsDeep({}, options, defaults)
}

export function capitalizeFirstLetter (string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

export function toTitleCase (str) {
  return str.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
  })
}

let debug
const dbg = (debug) ? console.log : function () {}

let cleanRules = []

export function setCleanRules (rules) {
  cleanRules = rules
}

/**
 * Prepare the HTML document for readability to process it.
 * This includes things like stripping javascript, CSS, and handling terrible markup.
 *
 * @param {String} document
 *
 * @return {Void}
 **/
export function prepDocument (document) {
  const frames = document.getElementsByTagName('frame')
  if (frames.length > 0) {
    let bestFrame = null
    let bestFrameSize = 0

    Array.prototype.slice.call(frames, 0).forEach(function (frame) {
      const frameSize = frame.offsetWidth + frame.offsetHeight
      let canAccessFrame = false
        try {
          if (frame.contentWindow.document.body) {
            canAccessFrame = true
          }
        } catch {
          // ignore access errors
        }

      if (canAccessFrame && frameSize > bestFrameSize) {
        bestFrame = frame
        bestFrameSize = frameSize
      }
    })

    if (bestFrame) {
      const newBody = document.createElement('body')
      newBody.innerHTML = bestFrame.contentWindow.document.body.innerHTML
      newBody.style.overflow = 'scroll'
      document.body = newBody

      const frameset = document.getElementsByTagName('frameset')[0]
      if (frameset) {
        frameset.parentNode.removeChild(frameset)
      }
    }
  }

  // Strip out all <script> tags, as they *should* be useless
  const scripts = document.getElementsByTagName('script');
  [].forEach.call(scripts, function (node) {
    node.parentNode.removeChild(node)
  })

  // turn all double br's into p's
  // note, this is pretty costly as far as processing goes. Maybe optimize later.
  // document.body.innerHTML = document.body.innerHTML.replace(regexps.replaceBrsRe, '</p><p>').replace(regexps.replaceFontsRe, '<$1span>');
}

/***
 * grabArticle - Using a variety of metrics (content score, classname, element types), find the content that is
 *               most likely to be the stuff a user wants to read. Then return it wrapped up in a div.
 *
 * @return {jQuery}
 **/
export function grabArticle (document, preserveUnlikelyCandidates, regexps) {
  /**
   * First, node prepping. Trash nodes that look cruddy (like ones with the class name "comment", etc), and turn divs
   * into P tags where they have been used inappropriately (as in, where they contain no other block level elements.)
   *
   * Note: Assignment from index for performance. See http://www.peachpit.com/articles/article.aspx?p=31567&seqNum=5
   * TODO: Shouldn't this be a reverse traversal?
   **/
  const nodes = document.getElementsByTagName('*')
  for (let i = 0; i < nodes.length; ++i) {
    const node = nodes[i]
    // Remove unlikely candidates */
    let continueFlag = false
    if (!preserveUnlikelyCandidates) {
      const unlikelyMatchString = node.className + '\n' + node.id
      if (unlikelyMatchString.search(regexps.unlikelyCandidatesRe) !== -1 && unlikelyMatchString.search(regexps.okMaybeItsACandidateRe) === -1 && node.tagName !== 'HTML' && node.tagName !== 'BODY') {
        dbg('Removing unlikely candidate - ' + unlikelyMatchString)
        node.parentNode.removeChild(node)
        continueFlag = true
      }
    }

    // Turn all divs that don't have children block level elements into p's
    if (!continueFlag && node.tagName === 'DIV') {
      if (node.innerHTML.search(regexps.divToPElementsRe) === -1) {
        dbg('Altering div to p')
        const newNode = document.createElement('p')
        newNode.innerHTML = node.innerHTML
        node.parentNode.replaceChild(newNode, node)
      } else {
        // EXPERIMENTAL
        Array.prototype.slice.call(node.childNodes).forEach(function (childNode) {
          if (childNode.nodeType === 3 /* TEXT_NODE */) {
            const nextSibling = childNode.nextSibling
            if (nextSibling && nextSibling.tagName === 'BR') {
              dbg('replacing text node followed by br with a p tag with the same content.')
              const p = document.createElement('p')
              p.innerHTML = childNode.nodeValue
              childNode.parentNode.removeChild(nextSibling)
              childNode.parentNode.replaceChild(p, childNode)
            } else {
              // use span instead of p. Need more tests.
              dbg('replacing text node with a span tag with the same content.')
              const span = document.createElement('span')
              span.innerHTML = childNode.nodeValue
              childNode.parentNode.replaceChild(span, childNode)
            }
          }
        })
      }
    }
  }

  /**
   * Loop through all paragraphs, and assign a score to them based on how content-y they look.
   * Then add their score to their parent node.
   *
   * A score is determined by things like number of commas, class names, etc. Maybe eventually link density.
   **/
  const allParagraphs = document.getElementsByTagName('p')
  const candidates = []

  for (let i = 0; i < allParagraphs.length; ++i) {
    const paragraph = allParagraphs[i]
    const parentNode = paragraph.parentNode
    const grandParentNode = parentNode.parentNode
    const innerText = getInnerText(paragraph, true, regexps)

    // If this paragraph is less than 25 characters, don't even count it.
    if (innerText.length < 25) continue

    // Initialize readability data for the parent.
    if (typeof parentNode.readability === 'undefined') {
      initializeNode(parentNode, regexps)
      candidates.push(parentNode)
    }

    // Initialize readability data for the grandparent.
    if (typeof grandParentNode.readability === 'undefined') {
      initializeNode(grandParentNode, regexps)
      candidates.push(grandParentNode)
    }

    let contentScore = 0

    // Add a point for the paragraph itself as a base. */
    ++contentScore

    // Add points for any commas within this paragraph */
    contentScore += innerText.replace('，', ',').split(',').length

    // For every 100 characters in this paragraph, add another point. Up to 3 points. */
    contentScore += Math.min(Math.floor(innerText.length / 100), 3)

    // Add the score to the parent. The grandparent gets half. */
    parentNode.readability.contentScore += contentScore
    grandParentNode.readability.contentScore += contentScore / 2
  }

  /**
   * After we've calculated scores, loop through all of the possible candidate nodes we found
   * and find the one with the highest score.
   **/
  let topCandidate = null
  candidates.forEach(function (candidate) {
    /**
     * Scale the final candidates score based on link density. Good content should have a
     * relatively small link density (5% or less) and be mostly unaffected by this operation.
     **/
    candidate.readability.contentScore = candidate.readability.contentScore * (1 - getLinkDensity(candidate, regexps))

    dbg('Candidate: ' + candidate + ' (' + candidate.className + ':' + candidate.id + ') with score ' + candidate.readability.contentScore)

    if (!topCandidate || candidate.readability.contentScore > topCandidate.readability.contentScore) topCandidate = candidate
  })

  /**
   * If we still have no top candidate, just use the body as a last resort.
   * We also have to copy the body node so it is something we can modify.
   **/
  if (topCandidate === null || topCandidate.tagName === 'BODY') {
    // With no top candidate, bail out if no body tag exists as last resort.
    if (!document.body) {
      return new Error('No body tag was found.')
    }
    topCandidate = document.createElement('DIV')
    topCandidate.innerHTML = document.body.innerHTML
    document.body.innerHTML = ''
    document.body.appendChild(topCandidate)
    initializeNode(topCandidate, regexps)
  }

  /**
   * Now that we have the top candidate, look through its siblings for content that might also be related.
   * Things like preambles, content split by ads that we removed, etc.
   **/
  const articleContent = document.createElement('DIV')
  articleContent.id = 'readability-content'
  const siblingScoreThreshold = Math.max(10, topCandidate.readability.contentScore * 0.2)
  const siblingNodes = topCandidate.parentNode.childNodes
  for (let i = 0, il = siblingNodes.length; i < il; i++) {
    const siblingNode = siblingNodes[i]
    let append = false

    dbg('Looking at sibling node: ' + siblingNode + ' (' + siblingNode.className + ':' + siblingNode.id + ')' + ((typeof siblingNode.readability !== 'undefined') ? (' with score ' + siblingNode.readability.contentScore) : ''))
    dbg('Sibling has score ' + (siblingNode.readability ? siblingNode.readability.contentScore : 'Unknown'))

    if (siblingNode === topCandidate) {
      append = true
    }

    if (typeof siblingNode.readability !== 'undefined' && siblingNode.readability.contentScore >= siblingScoreThreshold) {
      append = true
    }

    if (siblingNode.nodeName === 'P') {
      const linkDensity = getLinkDensity(siblingNode, regexps)
      const nodeContent = getInnerText(siblingNode, true, regexps)
      const nodeLength = nodeContent.length

      if (nodeLength > 80 && linkDensity < 0.25) {
        append = true
      } else if (nodeLength < 80 && linkDensity === 0 && nodeContent.search(/\.( |$)/) !== -1) {
        append = true
      }
    }

    if (append) {
      dbg('Appending node: ' + siblingNode)

      /* Append sibling and subtract from our list because it removes the node when you append to another node */
      articleContent.appendChild(siblingNode)
      i--
      il--
    }
  }

  /**
   * So we have all of the content that we need. Now we clean it up for presentation.
   **/
  prepArticle(articleContent, regexps)

  return articleContent
}

/**
 * Remove the style attribute on every e and under.
 *
 * @param {jQuery} element
 * @return {Void}
 **/
function cleanStyles (e) {
  if (!e) return

  // Remove any root styles, if we're able.
  if (typeof e.removeAttribute === 'function' && e.className !== 'readability-styled') e.removeAttribute('style')

  // Go until there are no more child nodes
  let cur = e.firstChild
  while (cur) {
    if (cur.nodeType === 1) {
      // Remove style attribute(s) :
      if (cur.className !== 'readability-styled') {
        cur.removeAttribute('style')
      }
      cleanStyles(cur)
    }
    cur = cur.nextSibling
  }
}

/**
 * Remove extraneous break tags from a node.
 *
 * @param {jQuery} element
 * @return {Void}
 **/
function killBreaks (e, regexps) {
  e.innerHTML = e.innerHTML.replace(regexps.killBreaksRe, '<br />')
}

/**
 * Get the inner text of a node - cross browser compatibly.
 * This also strips out any excess whitespace to be found.
 *
 * @param {jQuery} element
 * @return {String}
 **/
function getInnerText (e, normalizeSpaces, regexps) {
  let textContent = ''

  normalizeSpaces = (typeof normalizeSpaces === 'undefined') ? true : normalizeSpaces

  textContent = e.textContent.trim()

  if (normalizeSpaces) return textContent.replace(regexps.normalizeRe, ' ')
  else return textContent
}

/**
 * Get the number of times a string s appears in the node e.
 *
 * @param {jQuery} element
 * @param {string} string - character to split on. Default is ","
 * @return {Number} (integer)
 **/
function getCharCount (e, s, regexps) {
  s = s || ','
  return getInnerText(e, true, regexps).split(s).length
}

/**
 * Get the density of links as a percentage of the content
 * This is the amount of text that is inside a link divided by the total text in the node.
 *
 * @param {jQuery} element
 * @return {Number} (float)
 **/
function getLinkDensity (e, regexps) {
  const links = e.getElementsByTagName('a')

  const textLength = getInnerText(e, true, regexps).length
  let linkLength = 0
  for (let i = 0, il = links.length; i < il; i++) {
    const href = links[i].getAttribute('href')
    // hack for <h2><a href="#menu"></a></h2> / <h2><a></a></h2>
    if (!href || (href.length > 0 && href[0] === '#')) continue
    linkLength += getInnerText(links[i], true, regexps).length
  }
  return linkLength / textLength
}

/**
 * Get an elements class/id weight. Uses regular expressions to tell if this
 * element looks good or bad.
 *
 * @param {jQuery} element
 * @return {Number} (Integer)
 **/
function getClassWeight (e, regexps) {
  let weight = 0

  /* Look for a special classname */
  if (e.className !== '') {
    if (e.className.search(regexps.negativeRe) !== -1) weight -= 25

    if (e.className.search(regexps.positiveRe) !== -1) weight += 25
  }

  /* Look for a special ID */
  if (typeof (e.id) === 'string' && e.id !== '') {
    if (e.id.search(regexps.negativeRe) !== -1) weight -= 25

    if (e.id.search(regexps.positiveRe) !== -1) weight += 25
  }

  return weight
}

/**
 * Clean a node of all elements of type "tag".
 * (Unless it's a youtube/vimeo video. People love movies.)
 *
 * @param {jQuery} element
 * @param string tag to clean
 * @return {Void}
 **/
function clean (e, tag, regexps) {
  const targetList = e.getElementsByTagName(tag)
  const isEmbed = (tag === 'object' || tag === 'embed')

  for (let y = targetList.length - 1; y >= 0; y--) {
    // ------- user clean handler -----------------
    let validRule = false
    for (let i = 0; i < cleanRules.length; i++) {
      if (cleanRules[i](targetList[y], tag) === true) {
        validRule = true
        break
      }
    }

    if (validRule) {
      continue
    }
    // ------- end user clean handler -----------------

    /* Allow youtube and vimeo videos through as people usually want to see those. */
    if (isEmbed) {
      if (targetList[y].innerHTML.search(regexps.videoRe) !== -1) {
        continue
      }
    }

    targetList[y].parentNode.removeChild(targetList[y])
  }
}

/**
 * Clean an element of all tags of type "tag" if they look fishy.
 * "Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.
 *
 * @return {Void}
 **/
function cleanConditionally (e, tag, regexps) {
  const tagsList = e.getElementsByTagName(tag)
  const curTagsLength = tagsList.length

  /**
   * Gather counts for other typical elements embedded within.
   * Traverse backwards so we can remove nodes at the same time without effecting the traversal.
   *
   * TODO: Consider taking into account original contentScore here.
   **/
  for (let i = curTagsLength - 1; i >= 0; i--) {
    const weight = getClassWeight(tagsList[i], regexps)

    dbg('Cleaning Conditionally ' + tagsList[i] + ' (' + tagsList[i].className + ':' + tagsList[i].id + ')' + ((typeof tagsList[i].readability !== 'undefined') ? (' with score ' + tagsList[i].readability.contentScore) : ''))

    if (weight < 0) {
      tagsList[i].parentNode.removeChild(tagsList[i])
    } else if (getCharCount(tagsList[i], ',', regexps) < 10) {
      /**
       * If there are not very many commas, and the number of
       * non-paragraph elements is more than paragraphs or other ominous signs, remove the element.
       **/

      const p = tagsList[i].getElementsByTagName('p').length
      const img = tagsList[i].getElementsByTagName('img').length
      const li = tagsList[i].getElementsByTagName('li').length - 100
      const input = tagsList[i].getElementsByTagName('input').length

      let embedCount = 0
      const embeds = tagsList[i].getElementsByTagName('embed')
      for (let ei = 0, il = embeds.length; ei < il; ei++) {
        if (embeds[ei].src && embeds[ei].src.search(regexps.videoRe) === -1) {
          embedCount++
        }
      }

      const linkDensity = getLinkDensity(tagsList[i], regexps)
      const contentLength = getInnerText(tagsList[i], true, regexps).length
      let toRemove = false

      if (img > p && img > 1) {
        toRemove = true
      } else if (li > p && tag !== 'ul' && tag !== 'ol') {
        toRemove = true
      } else if (input > Math.floor(p / 3)) {
        toRemove = true
      } else if (contentLength < 25 && (img === 0 || img > 2)) {
        toRemove = true
      } else if (weight < 25 && linkDensity > 0.2) {
        toRemove = true
      } else if (weight >= 25 && linkDensity > 0.5) {
        toRemove = true
      } else if ((embedCount === 1 && contentLength < 75) || embedCount > 1) {
        toRemove = true
      }

      if (toRemove) {
        tagsList[i].parentNode.removeChild(tagsList[i])
      }
    }
  }
}

/**
 * Converts relative urls to absolute for images and links
 *
 * @param {jQuery} element
 *
 * @return {Void}
 *
 **/
function fixLinks (e) {
  if (!e.ownerDocument.originalURL) {
    return
  }

  function fixLink (link) {
    const fixed = new URL(link, e.ownerDocument.originalURL)
    return fixed.toString()
  }

  let i
  const imgs = e.getElementsByTagName('img')
  for (i = imgs.length - 1; i >= 0; --i) {
    const src = imgs[i].getAttribute('src')
    if (src) {
      imgs[i].setAttribute('src', fixLink(src))
    }
  }

  const as = e.getElementsByTagName('a')
  for (i = as.length - 1; i >= 0; --i) {
    const href = as[i].getAttribute('href')
    if (href) {
      as[i].setAttribute('href', fixLink(href))
    }
  }
}

/**
 * Clean out spurious headers from an Element. Checks things like classnames and link density.
 *
 * @param {jQuery} element
 * @return {Void}
 **/
function cleanHeaders (e, regexps) {
  for (let headerIndex = 1; headerIndex < 7; headerIndex++) {
    const headers = e.getElementsByTagName('h' + headerIndex)
    for (let i = headers.length - 1; i >= 0; --i) {
      if (getClassWeight(headers[i], regexps) < 0 || getLinkDensity(headers[i], regexps) > 0.33) {
        headers[i].parentNode.removeChild(headers[i])
      }
    }
  }
}

/**
 * Remove the header that doesn't have next sibling.
 *
 * @param {jQuery} element
 * @return {Void}
 **/

function cleanSingleHeader (e) {
  for (let headerIndex = 1; headerIndex < 7; headerIndex++) {
    const headers = e.getElementsByTagName('h' + headerIndex)
    for (let i = headers.length - 1; i >= 0; --i) {
      if (headers[i].nextSibling === null) {
        headers[i].parentNode.removeChild(headers[i])
      }
    }
  }
}

/**
 * Cleans the article content
 *
 * @param {jQuery} element
 * @return {Void}
 **/

function prepArticle (articleContent, regexps) {
  cleanStyles(articleContent)
  killBreaks(articleContent, regexps)

  /* Clean out junk from the article content */
  clean(articleContent, 'form', regexps)
  clean(articleContent, 'object', regexps)
  if (articleContent.getElementsByTagName('h1').length === 1) {
    clean(articleContent, 'h1', regexps)
  }
  /**
   * If there is only one h2, they are probably using it
   * as a header and not a subheader, so remove it since we already have a header.
   ***/
  if (articleContent.getElementsByTagName('h2').length === 1) clean(articleContent, 'h2', regexps)

  clean(articleContent, 'iframe', regexps)

  cleanHeaders(articleContent, regexps)

  /* Do these last as the previous stuff may have removed junk that will affect these */
  cleanConditionally(articleContent, 'table', regexps)
  cleanConditionally(articleContent, 'ul', regexps)
  cleanConditionally(articleContent, 'div', regexps)

  /* Remove extra paragraphs */
  const articleParagraphs = articleContent.getElementsByTagName('p')
  for (let i = articleParagraphs.length - 1; i >= 0; i--) {
    const imgCount = articleParagraphs[i].getElementsByTagName('img').length
    const embedCount = articleParagraphs[i].getElementsByTagName('embed').length
    const objectCount = articleParagraphs[i].getElementsByTagName('object').length

    if (imgCount === 0 && embedCount === 0 && objectCount === 0 && getInnerText(articleParagraphs[i], true, regexps) === '') {
      articleParagraphs[i].parentNode.removeChild(articleParagraphs[i])
    }
  }

  cleanSingleHeader(articleContent)

    try {
      articleContent.innerHTML = articleContent.innerHTML.replace(/<br[^>]*>\s*<p/gi, '<p')
    } catch {
      dbg('Cleaning innerHTML of breaks failed. This is an IE strict-block-elements bug. Ignoring.')
    }

  fixLinks(articleContent)
}

/**
 * Initialize a node with the readability object. Also checks the
 * className/id for special names to add to its score.
 *
 * @param {jQuery} element
 * @return {Void}
 **/
function initializeNode (node, regexps) {
  node.readability = { contentScore: 0 }

  switch (node.tagName) {
    case 'ARTICLE':
      node.readability.contentScore += 10
      break

    case 'SECTION':
      node.readability.contentScore += 8
      break

    case 'DIV':
      node.readability.contentScore += 5
      break

    case 'PRE':
    case 'TD':
    case 'BLOCKQUOTE':
      node.readability.contentScore += 3
      break

    case 'ADDRESS':
    case 'OL':
    case 'UL':
    case 'DL':
    case 'DD':
    case 'DT':
    case 'LI':
    case 'FORM':
      node.readability.contentScore -= 3
      break

    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
    case 'TH':
      node.readability.contentScore -= 5
      break
  }

  if (node.attributes.itemscope) {
    node.readability.contentScore += 5
    if (node.attributes.itemtype &&
      regexps.attributeRe.test(node.getAttribute('itemtype'))) {
      node.readability.contentScore += 30
    }
  }

  node.readability.contentScore += getClassWeight(node, regexps)
}
