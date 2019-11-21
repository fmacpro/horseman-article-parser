## Functions

<dl>
<dt><a href="#parseArticle">parseArticle(options, socket)</a> ⇒ <code>Object</code></dt>
<dd><p>main article parser module export function</p>
</dd>
<dt><a href="#articleParser">articleParser(options, socket)</a> ⇒ <code>Object</code></dt>
<dd><p>article scraping function</p>
</dd>
<dt><a href="#spellCheck">spellCheck(text, options)</a> ⇒ <code>Object</code></dt>
<dd><p>checks the spelling of the article</p>
</dd>
<dt><a href="#getRawText">getRawText(html)</a> ⇒ <code>String</code></dt>
<dd><p>takes the article body and returns the raw text of the article</p>
</dd>
<dt><a href="#getFormattedText">getFormattedText(html, title, baseurl, options)</a> ⇒ <code>String</code></dt>
<dd><p>takes the article body and the derived title and returns the formatted text of the article with links made absolute.</p>
</dd>
<dt><a href="#getHtmlText">getHtmlText(text)</a> ⇒ <code>String</code></dt>
<dd><p>takes the formatted article body text and returns the &quot;clean&quot; html text of the article</p>
</dd>
<dt><a href="#htmlCleaner">htmlCleaner(html, options)</a> ⇒ <code>String</code></dt>
<dd><p>takes a string of html and runs it through <a href="https://github.com/dave-kennedy/clean-html">clean-html</a></p>
</dd>
<dt><a href="#keywordParser">keywordParser(html, options)</a> ⇒ <code>Object</code></dt>
<dd><p>takes a string of html and runs it through <a href="https://github.com/retextjs/retext-keywords">retext-keywords</a> and returns keyword and keyphrase suggestions</p>
</dd>
<dt><a href="#lighthouseAnalysis">lighthouseAnalysis(options)</a> ⇒ <code>Object</code></dt>
<dd><p>runs a google lighthouse audit on the target article</p>
</dd>
<dt><a href="#getTitle">getTitle(document)</a> ⇒ <code>String</code></dt>
<dd><p>gets the best available title for the article</p>
</dd>
<dt><a href="#findMetaTitle">findMetaTitle(document)</a> ⇒ <code>String</code></dt>
<dd><p>gets the best available meta title of the article</p>
</dd>
<dt><a href="#prepDocument">prepDocument(document)</a> ⇒ <code>Void</code></dt>
<dd><p>Prepare the HTML document for readability to process it.
This includes things like stripping javascript, CSS, and handling terrible markup.</p>
</dd>
<dt><a href="#cleanStyles">cleanStyles(element)</a> ⇒ <code>Void</code></dt>
<dd><p>Remove the style attribute on every e and under.</p>
</dd>
<dt><a href="#killBreaks">killBreaks(element)</a> ⇒ <code>Void</code></dt>
<dd><p>Remove extraneous break tags from a node.</p>
</dd>
<dt><a href="#getInnerText">getInnerText(element)</a> ⇒ <code>String</code></dt>
<dd><p>Get the inner text of a node - cross browser compatibly.
This also strips out any excess whitespace to be found.</p>
</dd>
<dt><a href="#getCharCount">getCharCount(element, string)</a> ⇒ <code>Number</code></dt>
<dd><p>Get the number of times a string s appears in the node e.</p>
</dd>
<dt><a href="#getLinkDensity">getLinkDensity(element)</a> ⇒ <code>Number</code></dt>
<dd><p>Get the density of links as a percentage of the content
This is the amount of text that is inside a link divided by the total text in the node.</p>
</dd>
<dt><a href="#getClassWeight">getClassWeight(element)</a> ⇒ <code>Number</code></dt>
<dd><p>Get an elements class/id weight. Uses regular expressions to tell if this
element looks good or bad.</p>
</dd>
<dt><a href="#clean">clean(element, string)</a> ⇒ <code>Void</code></dt>
<dd><p>Clean a node of all elements of type &quot;tag&quot;.
(Unless it&#39;s a youtube/vimeo video. People love movies.)</p>
</dd>
<dt><a href="#cleanConditionally">cleanConditionally()</a> ⇒ <code>Void</code></dt>
<dd><p>Clean an element of all tags of type &quot;tag&quot; if they look fishy.
&quot;Fishy&quot; is an algorithm based on content length, classnames, link density, number of images &amp; embeds, etc.</p>
</dd>
<dt><a href="#fixLinks">fixLinks(element)</a> ⇒ <code>Void</code></dt>
<dd><p>Converts relative urls to absolute for images and links</p>
</dd>
<dt><a href="#cleanHeaders">cleanHeaders(element)</a> ⇒ <code>Void</code></dt>
<dd><p>Clean out spurious headers from an Element. Checks things like classnames and link density.</p>
</dd>
<dt><a href="#cleanSingleHeader">cleanSingleHeader(element)</a> ⇒ <code>Void</code></dt>
<dd><p>Remove the header that doesn&#39;t have next sibling.</p>
</dd>
<dt><a href="#prepArticle">prepArticle(element)</a> ⇒ <code>Void</code></dt>
<dd><p>Cleans the article content</p>
</dd>
<dt><a href="#initializeNode">initializeNode(element)</a> ⇒ <code>Void</code></dt>
<dd><p>Initialize a node with the readability object. Also checks the
className/id for special names to add to its score.</p>
</dd>
</dl>

<a name="parseArticle"></a>

## parseArticle(options, socket) ⇒ <code>Object</code>
main article parser module export function

**Kind**: global function  
**Returns**: <code>Object</code> - article parser results object  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | the options object |
| socket | <code>Object</code> | the optional socket |

<a name="articleParser"></a>

## articleParser(options, socket) ⇒ <code>Object</code>
article scraping function

**Kind**: global function  
**Returns**: <code>Object</code> - article parser results object  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | the options object |
| socket | <code>Object</code> | the optional socket |

<a name="spellCheck"></a>

## spellCheck(text, options) ⇒ <code>Object</code>
checks the spelling of the article

**Kind**: global function  
**Returns**: <code>Object</code> - object containing potentially misspelled words  

| Param | Type | Description |
| --- | --- | --- |
| text | <code>String</code> | the string of text to run the spellcheck against |
| options | <code>Object</code> | [retext-spell options](https://github.com/retextjs/retext-spell) |
| options.dictionary | <code>Array</code> | by default is set to [en-gb](https://github.com/wooorm/dictionaries/tree/master/dictionaries/en-GB). |

<a name="getRawText"></a>

## getRawText(html) ⇒ <code>String</code>
takes the article body and returns the raw text of the article

**Kind**: global function  
**Returns**: <code>String</code> - raw text of the article in lower case  

| Param | Type | Description |
| --- | --- | --- |
| html | <code>String</code> | the html string to process |

<a name="getFormattedText"></a>

## getFormattedText(html, title, baseurl, options) ⇒ <code>String</code>
takes the article body and the derived title and returns the formatted text of the article with links made absolute.

**Kind**: global function  
**Returns**: <code>String</code> - formatted text of the article  

| Param | Type | Description |
| --- | --- | --- |
| html | <code>String</code> | the body html string to process |
| title | <code>String</code> | the title string to process |
| baseurl | <code>String</code> | the base url of the page being scraped |
| options | <code>Object</code> | the [htmltotext](https://github.com/werk85/node-html-to-text) formatting options |

<a name="getHtmlText"></a>

## getHtmlText(text) ⇒ <code>String</code>
takes the formatted article body text and returns the "clean" html text of the article

**Kind**: global function  
**Returns**: <code>String</code> - the clean html text of the article  

| Param | Type | Description |
| --- | --- | --- |
| text | <code>String</code> | the formatted text string to process |

<a name="htmlCleaner"></a>

## htmlCleaner(html, options) ⇒ <code>String</code>
takes a string of html and runs it through [clean-html](https://github.com/dave-kennedy/clean-html)

**Kind**: global function  
**Returns**: <code>String</code> - the cleaned html  

| Param | Type | Description |
| --- | --- | --- |
| html | <code>String</code> | the html to clean |
| options | <code>Object</code> | the [clean-html options](https://github.com/dave-kennedy/clean-html#options) |

<a name="keywordParser"></a>

## keywordParser(html, options) ⇒ <code>Object</code>
takes a string of html and runs it through [retext-keywords](https://github.com/retextjs/retext-keywords) and returns keyword and keyphrase suggestions

**Kind**: global function  
**Returns**: <code>Object</code> - the keyword and keyphrase suggestions  

| Param | Type | Description |
| --- | --- | --- |
| html | <code>String</code> | the html to process |
| options | <code>Object</code> | the [retext-keywords options](https://github.com/retextjs/retext-keywords#api) |

<a name="lighthouseAnalysis"></a>

## lighthouseAnalysis(options) ⇒ <code>Object</code>
runs a google lighthouse audit on the target article

**Kind**: global function  
**Returns**: <code>Object</code> - the google lighthouse analysis  

| Param | Type | Description |
| --- | --- | --- |
| options | <code>Object</code> | the article parser options object |
| options.puppeteer.launch | <code>Object</code> | the pupperteer launch options |

<a name="getTitle"></a>

## getTitle(document) ⇒ <code>String</code>
gets the best available title for the article

**Kind**: global function  
**Returns**: <code>String</code> - the title of the article  

| Param | Type | Description |
| --- | --- | --- |
| document | <code>String</code> | the html document |

<a name="findMetaTitle"></a>

## findMetaTitle(document) ⇒ <code>String</code>
gets the best available meta title of the article

**Kind**: global function  
**Returns**: <code>String</code> - the best available meta title of the article  

| Param | Type | Description |
| --- | --- | --- |
| document | <code>String</code> | the html document |

<a name="prepDocument"></a>

## prepDocument(document) ⇒ <code>Void</code>
Prepare the HTML document for readability to process it.
This includes things like stripping javascript, CSS, and handling terrible markup.

**Kind**: global function  

| Param | Type |
| --- | --- |
| document | <code>String</code> | 

<a name="cleanStyles"></a>

## cleanStyles(element) ⇒ <code>Void</code>
Remove the style attribute on every e and under.

**Kind**: global function  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

<a name="killBreaks"></a>

## killBreaks(element) ⇒ <code>Void</code>
Remove extraneous break tags from a node.

**Kind**: global function  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

<a name="getInnerText"></a>

## getInnerText(element) ⇒ <code>String</code>
Get the inner text of a node - cross browser compatibly.
This also strips out any excess whitespace to be found.

**Kind**: global function  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

<a name="getCharCount"></a>

## getCharCount(element, string) ⇒ <code>Number</code>
Get the number of times a string s appears in the node e.

**Kind**: global function  
**Returns**: <code>Number</code> - (integer)  

| Param | Type | Description |
| --- | --- | --- |
| element | <code>jQuery</code> |  |
| string | <code>string</code> | character to split on. Default is "," |

<a name="getLinkDensity"></a>

## getLinkDensity(element) ⇒ <code>Number</code>
Get the density of links as a percentage of the content
This is the amount of text that is inside a link divided by the total text in the node.

**Kind**: global function  
**Returns**: <code>Number</code> - (float)  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

<a name="getClassWeight"></a>

## getClassWeight(element) ⇒ <code>Number</code>
Get an elements class/id weight. Uses regular expressions to tell if this
element looks good or bad.

**Kind**: global function  
**Returns**: <code>Number</code> - (Integer)  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

<a name="clean"></a>

## clean(element, string) ⇒ <code>Void</code>
Clean a node of all elements of type "tag".
(Unless it's a youtube/vimeo video. People love movies.)

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| element | <code>jQuery</code> |  |
| string |  | tag to clean |

<a name="cleanConditionally"></a>

## cleanConditionally() ⇒ <code>Void</code>
Clean an element of all tags of type "tag" if they look fishy.
"Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.

**Kind**: global function  
<a name="cleanConditionally..p"></a>

### cleanConditionally~p
If there are not very many commas, and the number of
non-paragraph elements is more than paragraphs or other ominous signs, remove the element.

**Kind**: inner constant of [<code>cleanConditionally</code>](#cleanConditionally)  
<a name="fixLinks"></a>

## fixLinks(element) ⇒ <code>Void</code>
Converts relative urls to absolute for images and links

**Kind**: global function  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

<a name="cleanHeaders"></a>

## cleanHeaders(element) ⇒ <code>Void</code>
Clean out spurious headers from an Element. Checks things like classnames and link density.

**Kind**: global function  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

<a name="cleanSingleHeader"></a>

## cleanSingleHeader(element) ⇒ <code>Void</code>
Remove the header that doesn't have next sibling.

**Kind**: global function  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

<a name="prepArticle"></a>

## prepArticle(element) ⇒ <code>Void</code>
Cleans the article content

**Kind**: global function  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

<a name="initializeNode"></a>

## initializeNode(element) ⇒ <code>Void</code>
Initialize a node with the readability object. Also checks the
className/id for special names to add to its score.

**Kind**: global function  

| Param | Type |
| --- | --- |
| element | <code>jQuery</code> | 

