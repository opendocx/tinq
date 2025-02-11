import { format as dateFnsFormat } from 'date-fns'
import numeral from 'numeral'
import numWords from 'number-to-words-en'
import deepEqual from 'fast-deep-equal'
import { parseListExample } from './scope.mjs'
import { unEscapeQuotes, isIterable } from './utils.mjs'

// define built-in filters
export default {
  // regular (scalar value) filters
  upper, lower, initcap, titlecaps, format, cardinal, ordinal, ordsuffix, else: else_filter, contains, punc, keepsections, 
  // list (array) filters
  sort, filter, find, any, every, map, group, reduce,
}

function upper (input) {
  if (!input) return input
  if (typeof input !== 'string') input = input.toString()
  return input.toUpperCase()
}

function lower (input) {
  if (!input) return input
  if (typeof input !== 'string') input = input.toString()
  return input.toLowerCase()
}

function initcap (input, forceLower = false) {
  if (!input) return input
  if (typeof input !== 'string') input = input.toString()
  if (forceLower) input = input.toLowerCase()
  return input.charAt(0).toUpperCase() + input.slice(1)
}

// const TitleCapRegEx_AsciiOnly = /(^|[^'’]|\W['’])\b([a-z])/gm // not only [a-z], but also \W and \b are ASCII only!
// without \b and \W, this is harder to do...
const TitleCapRegEx = /^\p{Ll}|(?:\s|(?:^|.)\p{P})\p{Ll}/gmu
// 1st case: ^\p{Ll}  - char 0 is lowercase letter
// 2nd case: \s\p{Ll} - char n is whitespace, char n+1 is lowercase letter
// 3rd case: ^\p{P}\p{Ll} - char 0 is punctuation, char 1 lowercase letter
// 4th case: .\p{P}\p{Ll} - char n is ANYTHING (.), char n+1 is punctuation, char n+2 is lowercase letter
//      >> in this case additional logic is required to decide whether it's an exceptional case or not!
const UnicodeWordChar = /\p{L}|\p{N}/u

function titlecaps (input, forceLower = false) {
  if (!input) return input
  if (typeof input !== 'string') input = input.toString()
  if (forceLower) input = input.toLowerCase()
  return input.replace(TitleCapRegEx, s => {
    // console.log(s)
    if (s.length === 3) { // 4th case above
      return (s[1] === "'" || s[1] === '’') && UnicodeWordChar.test(s[0])
        ? s // EXCEPTION for possessives and mid-word contractions: don't capitalize
        : s.slice(0, 2) + s[2].toUpperCase() // otherwise - do capitalize
    }
    return s.toUpperCase() // all other cases
  })
}

class DateFormatFixer {
  constructor (oldDateFormat) {
    this.formatStr = oldDateFormat
  }

  fixed () {
    return this
      .replaceAll('YY', 'yy')
      .replaceAll('D', 'd')
      .replaceAll('[', '\'')
      .replaceAll(']', '\'')
      .formatStr
  }

  replaceAll (find, replaceWith) {
    return new DateFormatFixer(
      this.formatStr.replace(
        new RegExp(find.replace(DateFormatFixer.escRE, '\\$&'), 'g'),
        replaceWith
      )
    )
  }
}
DateFormatFixer.escRE = /[.*+?^${}()|[\]\\]/g

function format (input, generalFmt, negativeFmt, zeroFmt) {
  if (input === null || typeof input === 'undefined') return input
  if (input instanceof Date) {
    // fix up format string to accommodate differences between date-fns 1.3 and current:
    const newFormat = new DateFormatFixer(generalFmt).fixed()
    return dateFnsFormat(input, newFormat)
  }
  if (typeof input === 'boolean' || input instanceof Boolean) {
    input = input.valueOf()
    if (generalFmt || negativeFmt) {
      generalFmt = generalFmt ? String(generalFmt) : ''
      negativeFmt = negativeFmt ? String(negativeFmt) : ''
      return input ? generalFmt : negativeFmt
    } // else
    return input ? 'true' : 'false'
  }
  // else number
  const num = Number(input)
  if (!isFinite(num)) return null
  let fmtStr
  if (num === 0) {
    fmtStr = zeroFmt || generalFmt || '0,0'
  } else if (num < 0) {
    fmtStr = negativeFmt || generalFmt || '0,0'
  } else {
    fmtStr = generalFmt || '0,0'
  }
  if (fmtStr === 'cardinal') {
    return numWords.toWords(num, { useCommas: false })
  }
  if (fmtStr === 'ordinal') {
    return numWords.toWordsOrdinal(num, { useCommas: false })
  }
  if (fmtStr.toLowerCase() === 'a') {
    return base26(num, fmtStr === 'A')
  }
  return numeral(num).format(fmtStr)
}

function base26 (input, upper) {
  if (input === null || typeof input === 'undefined') return input
  const places = []
  let quotient = Number(input)
  if (!isFinite(quotient)) return null
  let remain, dec
  while (quotient !== 0) {
    dec = quotient - 1
    quotient = Math.floor(dec / 26)
    remain = dec % 26
    places.unshift(remain + 1)
  }
  const codes = places.map(n => n + (upper ? 64 : 96))
  return String.fromCharCode.apply(null, codes)
}

function cardinal (input) {
  if (input === null || typeof input === 'undefined') return input
  const num = Number(input)
  if (!isFinite(num)) return null
  return numWords.toWords(num, { useCommas: false })
}

function ordinal (input) {
  if (input === null || typeof input === 'undefined') return input
  const num = Number(input)
  if (!isFinite(num)) return null
  return numWords.toWordsOrdinal(num, { useCommas: false })
}

function ordsuffix (input) {
  if (input === null || typeof input === 'undefined') return input
  if (typeof input !== 'number') input = Number(input)
  if (!isFinite(input)) return null
  // English-language exception for 11th, 12th, 13th, 111th, 112th, 113th, 211th, 212th, 213th, etc.
  if (~~(input % 100 / 10) === 1) return 'th'
  switch (input % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

function else_filter (input, unansweredFmt) {
  if (input === null || typeof input === 'undefined') return unansweredFmt
  if (typeof input === 'number') {
    if (!isFinite(input)) return unansweredFmt
  }
  return input
}
else_filter.ident = 'else' // canonical name for normalization

function contains (input, value) {
  if (input === null || typeof input === 'undefined' || input === '') return false
  const inputPrimitive = input.valueOf()
  if (typeof inputPrimitive === 'string') {
    return inputPrimitive.includes(value)
  }
  // if (input instanceof Scope) throw new Error('Unexpected scope as contains input')
  if (!isIterable(input)) return false
  value = value && value.valueOf()
  for (const item of input) {
    if (deepEqual(item && item.valueOf(), value)) {
      return true
    }
  }
  return false
}

function punc (inputList, example = '1, 2, and 3') {
  if (!inputList) return inputList
  // if (inputList instanceof Scope) throw new Error('Unexpected scope as punc input')
  if (!inputList || !Array.isArray(inputList) || !inputList.length) return inputList
  const parsed = parseListExample(example)
  if (parsed) {
    // inputList may be the actual source array (the context stack has not yet been pushed!)
    // so make a shallow copy before adding any custom properties onto the array
    inputList = [...inputList]
    inputList['punc'] = parsed
  }
  return inputList
}

function keepsections (input) {
  if (!input) return input
  if (typeof input !== 'object') return input
  const newInput = input.valueOf()
  if (newInput && (!newInput.contentType || newInput.contentType === 'docx')) {
    newInput.KeepSections = true
  } else {
    console.log('keepsections filter used on something other than a DOCX insert/indirect')
  }
  return newInput
}

// runtime implementation of list filters:

function sort (arrayScope) {
  if (arrayScope.type !== 'array') {
    throw new Error('sort filter requires an array scope')
  }
  const array = arrayScope.valueOf()
  if (!array.length || arguments.length < 2) return array
  const sortBy = []
  let i = 1 // skip first (scope) argument; rest are sort keys
  while (i < arguments.length) {
    // TODO: what is argument at this point?
    const sortKeyLambda = arguments[i++]
    sortBy.push({
      descending: sortKeyLambda.descending,
      evaluator: sortKeyLambda
    })
  }
  function compare (a, b, depth) {
    if (!depth) {
      depth = 0
    }
    if (depth >= sortBy.length) { return 0 }
    const valA = sortBy[depth].evaluator(a) // sort expressions must only refer to stuff in the current list item
    const valB = sortBy[depth].evaluator(b)
    if (valA < valB) { return sortBy[depth].descending ? 1 : -1 }
    if (valA > valB) { return sortBy[depth].descending ? -1 : 1 }
    return compare(a, b, depth + 1)
  }
  return array.slice().sort(compare)
}
sort.listFilter = true
sort.keyFilter = true

function filter (arrayScope, predicate) {
  return callArrayFunc(Array.prototype.filter, arrayScope, predicate, 'filter')
}
filter.listFilter = true

function find (arrayScope, predicate) {
  if (arrayScope.type === 'null' || !arrayScope.length) return null
  return callArrayFunc(Array.prototype.find, arrayScope, predicate, 'find')
}
find.listFilter = true

function any (arrayScope, predicate) {
  if (arrayScope.type === 'null' || !arrayScope.length) return false
  return callArrayFunc(Array.prototype.some, arrayScope, predicate, 'any')
}
any.aliases = ['some']
any.ident = 'any' // canonical name for normalization
any.listFilter = true
any.rtlFilter = true

function every (arrayScope, predicate) {
  if (arrayScope.type === 'null' || !arrayScope.length) return true
  return callArrayFunc(Array.prototype.every, arrayScope, predicate, 'every')
}
every.aliases = ['all']
every.ident = 'every' // canonical name for normalization
every.listFilter = true
every.rtlFilter = true

function map (arrayScope, mapLambda) {
  return callArrayFunc(Array.prototype.map, arrayScope, mapLambda, 'map')
}
map.listFilter = true

function group (arrayScope, groupLambda) {
  if (arrayScope.type === 'null') return arrayScope.valueOf()
  if (arrayScope.type !== 'array') {
    throw new Error('group filter requires an array scope')
  }
  const array = arrayScope.valueOf()
  // const parentScope = arrayScope._parent
  let grouped
  if (array.length === 0) {
    grouped = []
  } else {
    grouped = array.reduce(
      (result, item, index) => {
        let key = groupLambda(arrayScope.getOwnScope(index))
        key = key && key.valueOf() // ensure wrapped primitives and dates are unwrapped too
        let bucket = result.find(b => b._key === key)
        if (!bucket) {
          bucket = { _key: key, _values: [] }
          result.push(bucket)
        }
        bucket._values.push(item)
        return result
      },
      []
    )
  }
  return grouped
}
group.listFilter = true

function reduce (arrayScope, reducerLambda, initValue = undefined) {
  if (arrayScope.type === 'null') return arrayScope.valueOf()
  if (arrayScope.type !== 'array') {
    throw new Error('reduce filter requires an array scope')
  }
  const array = arrayScope.valueOf()
  // const parentScope = arrayScope._parent
  let reduced
  if (array.length === 0) {
    reduced = initValue
  } else {
    const input0 = array[0]
    const yobj0 = input0 && input0.__yobj
    const list = Scope.pushList(array, yobj0 && yobj0.getParentEffective())
    reduced = array.items.reduce(
      (result, item, index) => {
        if (index === 0 && initValue === undefined) {
          return item
        } // else
        const reducerItemFrame = arrayScope.getOwnScope(index)
        reducerItemFrame._result = result
        return reducerLambda(reducerItemFrame)
      },
      initValue
    )
  }
  return reduced
}
reduce.listFilter = true
// reduce.immediateArgs = [1]

// helper functions

// callArrayFunc accepts an "array scope" and returns a regular array
function callArrayFunc (func, arrayScope, predicateLambda, funcName) {
  if (arrayScope.type === 'null') return arrayScope.valueOf()
  if (arrayScope.type !== 'array') {
    throw new Error('list filters require an array scope')
  }
  const array = arrayScope.valueOf()
  // const parentScope = arrayScope._parent
  if (!predicateLambda) {
    throw new Error('no predicate supplied to callArrayFunc')
  }
  if (typeof predicateLambda !== 'function') {
    let filter = 'a list'
    if (funcName) {
      filter = 'the ' + funcName
    }
    throw new Error(`Invalid argument passed to ${filter} filter: ${predicateLambda}`)
  }
  const result = func.call(array, (item, index) => (
    predicateLambda(arrayScope.getOwnScope(index))
  ))
  return result
}
