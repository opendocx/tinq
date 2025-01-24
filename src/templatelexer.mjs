
export const ChunkMode = { RAW, TEXT } // future: MARKDOWN, HTML or TAGGED

export class Templater {
  constructor (options) {
    this.options = options
  }

  parse (text, mode = ChunkMode.RAW) {

    let chunks = this.chunk(text, mode)
    let result
    try {
      // if any block-level paired fields are on a lines by themselves, remove the CR/LF following those fields
      // (but leave block-level content fields alone)
      const tweaked = text.replace(_blockFieldRE, _blockFieldReplacer)
      // TODO: improve this approach with something that captures & retains each field offset
      const templateSplit = tweaked.split(_fieldRE)
      if (templateSplit.length < 2) { // no fields
        result = [text]
      } else {
        result = base.parseContentArray(templateSplit, bIncludeExpressions, bIncludeListPunctuation)
        // number the fields after-the-fact
        numberFields(result)
      }
    } catch (err) {
      result = (typeof err === 'string') ? new Error(err) : err
    }
    return result

  }

  chunk (text, mode = ChunkMode.RAW) {
    if (mode === ChunkMode.RAW) {
      // raw templates are processed entirely as a single chunk
      return [text]
    }

    // normalize line endings
    text = text
      .replace(/\r\n/g, '\n') // replace windows line breaks with unix
      .replace(/\r/g, '\n') // replace mac line breaks with unix

    if (mode === ChunkMode.TEXT) {
      // plain text templates are chunked based on fields that are on a line by themselves (experimental?)
      return text.split(textChunkRE)
    }

    throw new Error(`Invalid chunk mode '${mode}'`)
  }
}

const textChunkRE = /^\s*\{\[.+?\]\}$/m

// const _blockFieldRE = /(?<=\n|\r|^)\{\s*\[([^{}]*?)\]\s*\}(\r\n|\n|\r)/g
// positive lookbehind breaks every browser but chrome! (as of mid 2019)
const _blockFieldRE = /^\s*\{\[([^{}]*?)\]\}$/gm
const _fieldRE  = /\{(\[.*?\])\}/
const _fieldsRE = /\{\[(.*?)\]\}/g

function numberFields (parsedContentArray, startAt = 0) {
  for (const contentItem of parsedContentArray) {
    if (contentItem && typeof contentItem === 'object') {
      if (contentItem.type !== OD.Content || contentItem.expr !== '_punc') {
        contentItem.id = (++startAt).toString()
      }
      if (Array.isArray(contentItem.contentArray) && contentItem.contentArray.length > 0) {
        startAt = numberFields(contentItem.contentArray, startAt)
      }
    }
  }
  return startAt
}

function _blockFieldReplacer (match, fieldText, eol, offset, string) {
  var cleaned = `{[${fieldText}]}`
  if (!fieldText.match(/^if|\?|else|:|list|#|end|\//)) {
    cleaned += eol
  }
  return cleaned
}
