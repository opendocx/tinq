import assert from "node:assert"

const RAW = "RAW"
const TEXT = "TEXT"
const MARKDOWN = "MD"
const JSON = "JSON" // chunking has already been done externally and is serialized to JSON

export const ChunkMode = { RAW, TEXT, JSON } // future: MARKDOWN, maybe also TEXT, HTML, XML, or TAGGED

export class TemplateLexer {
  constructor (options) {
    this.options = options
    this.reset()
  }

  reset () {
    this.text = ''
    this.index = 0
    this.fieldNum = 0
    this.tokens = []
  }

  /**
   * The template lexer is what tokenizes a template, which means it turns a template
   * into a flat array structure enumerating the (numbered) fields in the template and
   * the content OUTSIDE/between fields (if present).
   * If the document includes different logical levels (sections, paragraphs, etc.),
   * nested arrays will indicate this level structure.
   */
  lex (text, mode = ChunkMode.RAW) {
    this.reset()
    if (typeof text === 'string') {
      if (mode === ChunkMode.RAW) {
        this.lexRawChunk(text)
      } else if (mode === ChunkMode.TEXT) {
        this.lexTextChunk(text)
      } else {
        let chunks = this.chunk(text, mode) // ALWAYS THROWS at this point
        // but in the future we would need a generic way to designate chunks
      }
    } else if (typeof text === 'object') {
      if (mode !== ChunkMode.JSON) {
        throw new Error(`Invalid chunk mode '${mode}' -- not expecting JSON`)
      }
      // tokenize already-chunked field json, e.g. from a docx template
      this.lexContentArray(text)
    }
    return this.tokens
  }

  chunk (text, mode = ChunkMode.RAW) {
    throw new Error(`Invalid chunk mode '${mode}'`)
    // other chunk modes will have different rules for how things get recursively chunked.
    // For example, if we were chunking in "Markdown" mode, we might utilize a markdown parser
    // first to parse the markdown, and then chunk it according to markdown entities such as
    // paragraphs, list items, table cells, etc.  The idea is that the lexer uses these "chunks"
    // to add PushLevel and PopLevel tokens to the token stream, and the parser later uses these tokens
    // to enforce particular rules about what kinds of fields are allowed or required to be
    // at the same level/matched in the same chunk as other fields. (if/endif, list/endlist matching)
  }

  lexRawChunk (chunk) {
    const matches = chunk.matchAll(_fieldsRE)
    for (const match of matches) {
      // insert quasi token to represent content before that field, advance this.index past quasi
      if (match.index > this.index) {
        this.quasiToken(chunk.slice(this.index, match.index))
        this.index = match.index
      }
      // insert field token to represent field, advance this.index past field
      this.fieldToken(match[1])
      this.index += match[0].length
    }
    // insert quasi token to represent content from this.index to end of chunk, advance this.index
    if (chunk.length > this.index) {
      this.quasiToken(chunk.slice(this.index, chunk.length))
      this.index = chunk.length
    }
  }

  lexTextChunk (chunk) {
    let match
    while ((match = _fieldsRE.exec(chunk)) !== null) {
      // take note of whether field is at the beginning of a line or not
      let bol = false
      let eol = false
      if (match.index === this.index) {
        bol = true
      } else if (chunk.charAt(match.index - 1) === '\n') {
        bol = true
      }
      // take note of whether the field is followed by a line break or not
      if (_fieldsRE.lastIndex < chunk.length && chunk.charAt(_fieldsRE.lastIndex) === '\n') {
        eol = true
      }
      // insert quasi token to represent content before the field, advance this.index past quasi
      if (match.index > this.index) {
        this.quasiToken(chunk.slice(this.index, match.index))
        this.index = match.index
      }
      // insert field token to represent field, advance this.index past field
      this.fieldToken(match[1], undefined, bol && eol)
      this.index += match[0].length
      if (bol && eol && this.index < chunk.length) { // if field is alone on line, it consumes the line break after it
        this.index++
        _fieldsRE.lastIndex++
      }
    }
    // insert quasi token to represent content from this.index to end of chunk, advance this.index
    if (chunk.length > this.index) {
      this.quasiToken(chunk.slice(this.index, chunk.length))
      this.index = chunk.length
    }
  }

  fieldToken (text, fieldNum = undefined, soloLine = undefined) {
    const field = splitFieldComment(text)
    const newToken = {
      token: 'Field',
      index: this.index,
      text: field.text,
    }
    if (field.comment !== undefined) {
      newToken.rawText = text
      newToken.comment = field.comment
      newToken.commentPrefix = field.commentPrefix
      newToken.commentIndex = field.commentIndex
    }
    if (numbered(field.text)) {
      this.fieldNum++
      if (fieldNum) {
        if (fieldNum.toString() !== this.fieldNum.toString()) {
          debugger
          // throw new Error('unexpected field numbering')
        }
      }
      newToken.fieldNum = fieldNum || this.fieldNum
    }
    if (soloLine) {
      newToken.soloLine = true
    }
    this.tokens.push(newToken)
  }

  quasiToken (text) {
    this.tokens.push({
      token: 'Quasi',
      index: this.index,
      text
    })
  }

  lexContentArray (contentArray) {
    // contentArray can be either an array of strings (as from a text template split via regex)
    // or an array of objects with field text and field IDs (as extracted from a DOCX template)
    // In the latter case (array of objects), sub-arrays indicate discreet blocks of content
    // (paragraphs, table cells, etc.)??
    for (const item of contentArray) {
      this.lexContentItem(item)
    }
  }

  lexContentItem (contentItem) {
    if (Array.isArray(contentItem)) {
      // if there's a sub-array, that item must be its own valid sequence of fields
      // with appropriately matched ifs/endifs and/or lists/endlists
      this.fieldToken('level')
      this.lexContentArray(contentItem)
      this.fieldToken('endlevel')
    } else {
      this.lexToken(contentItem)
    }
  }

  lexToken (contentArrayItem) {
    if (typeof contentArrayItem === 'string') {
      if (contentArrayItem) { // ignore empty strings
        const content = getFieldContent(contentArrayItem)
        if (content) { // it's a field
          this.fieldToken(content)
        } else { // not a field means it's static text
          this.quasiToken(contentArrayItem)
        }
      }
    } else { // field object, e.g. extracted from DOCX
      this.fieldToken(contentArrayItem.content, contentArrayItem.id)
    }
  }

}

const _fieldsRE = /\{\[(.*?)\]\}/g
const _curlyquotes = /[“”]/g
const _zws = /[\u{200B}\u{200C}]/gu

function getFieldContent (text) {
  if (text.slice(0, 1) === '[' && text.slice(-1) === ']') {
    return text.slice(1, -1).replace(_curlyquotes, '"').replace(_zws, '')
  }
  return null
}

function splitFieldComment (text) {
  let quote = null
  let escaped = false

  for (let i = 0; i < text.length - 1; i++) {
    const ch = text.charAt(i)

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '/' && text.charAt(i + 1) === '/') {
      let prefixStart = i
      while (prefixStart > 0 && isHorizontalWhitespace(text.charAt(prefixStart - 1))) {
        prefixStart--
      }
      return {
        text: text.slice(0, prefixStart),
        comment: text.slice(i + 2),
        commentPrefix: text.slice(prefixStart, i + 2),
        commentIndex: i + 2,
      }
    }
  }

  return { text }
}

function isHorizontalWhitespace (ch) {
  return ch === ' ' || ch === '\t'
}

const UNNUMBERED = ['level', 'endlevel', '_punc']
function numbered (text) {
  return !UNNUMBERED.includes(text)
}
