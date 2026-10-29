// SPDX-License-Identifier: MPL-2.0

import { ExternalFile } from './scope.mjs'
import { isDate, dateFormat } from './utils.mjs'

export class DataAggregator {
  constructor () {
    this.data = {}
    this.stack = [this.data]
  }

  empty () {
    return this.stack.length === 0
  }

  pushObject (ident) {
    const currentFrame = this.peek()
    let pushedObj
    if (Array.isArray(currentFrame)) {
      currentFrame._ident = ident // used for XML output and ignored for JSON
      pushedObj = currentFrame[currentFrame.index]
      if (!pushedObj) {
        pushedObj = currentFrame[currentFrame.index] = {}
      }
    } else {
      pushedObj = currentFrame[ident]
      if (!pushedObj) {
        pushedObj = currentFrame[ident] = {}
      }
    }
    this.push(pushedObj)
  }

  popObject () {
    const poppedFrame = this.pop()
    const currentFrame = this.peek()
    if (Array.isArray(currentFrame)) {
      currentFrame.index = currentFrame.index + 1
    }
    return poppedFrame
  }

  pushList (ident) {
    const currentFrame = this.peek()
    let pushedArray
    if (Array.isArray(currentFrame)) {
      throw new Error('Data aggregation error: Cannot push a list onto a list')
    } else {
      pushedArray = currentFrame[ident]
      if (!pushedArray) {
        pushedArray = currentFrame[ident] = []
      }
      pushedArray.index = 0
    }
    this.push(pushedArray)
  }

  popList () {
    const poppedFrame = this.pop()
    if (!Array.isArray(poppedFrame)) {
      throw new Error(`Data aggregation error: expected array frame, got ${typeof poppedFrame} instead`)
    }
    return poppedFrame
  }

  set (ident, value) {
    const currentFrame = this.peek()
    if (ident in currentFrame) {
      if ((currentFrame[ident] && currentFrame[ident].valueOf()) !== (value && value.valueOf())) {
        throw new Error('Data aggregation error: mutation?')
      }
    } else {
      currentFrame[ident] = value
    }
  }

  push (frame) {
    this.stack.push(frame)
  }

  pop () {
    return this.stack.pop()
  }

  peek () {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null
  }

  toJson (composeTextExternals = false) {
    return JSON.stringify(this.data, (key, value) => {
      if (value instanceof ExternalFile) {
        if (typeof value.data === 'string' && composeTextExternals) {
          return value.data
        }
        let uri = `tinq://ExternalFile/${value.id}`
        if (value.KeepSections) {
          uri += '?KeepSections=true'
        }
        return uri
      } // else
      return value
    })
  }

  toXml (elementName = 'top', composeTextExternals = false) {
    return '<?xml version="1.0"?>' + this.serializeXmlElement(elementName, this.data, composeTextExternals)
  }

  serializeXmlElement (ident, value, cte) {
    const name = validXmlNameRegex.test(ident) ? ident : encodeToValidXmlName(ident)
    if (value === '' || value === null || value === undefined /* || (Array.isArray(value) && value.length === 0) */) {
      return `<${name}/>`
    } // else
    return `<${name}>${this.serializeXmlValue(value, cte)}</${name}>`
  }

  serializeXmlValue (value, cte) {
    const valueType = Array.isArray(value.valueOf()) ? 'array' : isDate(value) ? 'date' : typeof value.valueOf()
    switch (valueType) {
      case 'string':
        return escapeXml(value)
      case 'date':
        return dateFormat(value) // 'yyyy-MM-dd')
      case 'number':
        return value.toString()
      case 'boolean':
        return value ? 'true' : 'false'
      case 'object':
        return this.serializeXmlObject(value, cte)
      case 'array': {
        const itemIdent = value._ident
        return value.map(item => this.serializeXmlElement(itemIdent, item, cte)).join('')
      }
    }
  }

  serializeXmlObject (obj, cte) {
    if (obj instanceof ExternalFile) {
      if (typeof obj.data === 'string' && cte) {
        return obj.data
      } // else
      let uri = `oxpt://DocumentAssembler/insert/${obj.id}`
      if (obj.KeepSections) {
        uri += '?KeepSections=true'
      }
      return uri
    } // else
    var sb = []
    for (var key in obj) {
      sb.push(this.serializeXmlElement(key, obj[key]))
    }
    return sb.join('')
  }
}

const escapeXml = function (str) {
  str = str.valueOf()
  if (typeof str !== 'string') {
    console.log(`Unexpected: while aggregating, escapeXml called on a ${typeof str}!`)
    str = String(str)
  }
  return str.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '&': return '&amp;'
      case '\'': return '&apos;'
      case '"': return '&quot;'
    }
  })
}

const validXmlNameRegex = /^[a-zA-Z_][\w.-]*$/

const encodeToValidXmlName = function (input) {
  return input.split('').map(char => {
    const code = char.charCodeAt(0);
    if ((code >= 65 && code <= 90) || // A-Z
        (code >= 97 && code <= 122) || // a-z
        (code >= 48 && code <= 57) || // 0-9
        char === '.' || char === '-' || char === '_') {
      return char
    } else {
      return '_' + code.toString(16).toUpperCase()
    }
  }).join('')
}
