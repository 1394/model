/* eslint-disable require-jsdoc */
// const locals = {}
const {QUERYDEBUGLOG} = process.env

const escapeString = require('./escape_string')

const debugLog = (tag, ...args) => {
  if (QUERYDEBUGLOG) {
    console.log(` ${tag} :::`+'*'.repeat(30))
    console.dir(args, {depth: 5})
    console.log(` ${tag} END`+'*'.repeat(26)+'\n\n')
  }
}

const convert = (val, {withEscapeString} = {}) => {
  if (typeof(val) === 'boolean') {
    return val ? 1 : 0
  }
  if (typeof(val) === 'string') {
    // return `'${escapeString(val)}'`
    return withEscapeString ? `'${escapeString(val)}'` : escapeString(val)
    // return `"${val.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}"`
  }
  if (val instanceof Date) {
    return val.toUTCString()
  }
  if (val instanceof Buffer) {
    return val.toString('hex')
  }
  if (Array.isArray(val)) {
    return convertArray(val)
  }
  if (typeof(val) === 'undefined' || val === null) {
    return 'NULL'
  }
  if (typeof(val) === 'object' && val) {
    return JSON.stringify(val)
  }
  if (typeof(val) === 'number') {
    return val
  }
  console.dir({val})
  throw new Error(`unknown type of value in request!`)
}

const convertArray = (val) => {
  const cnv = (arr) => {
    return '(' + arr.map((el) => {
      if (Array.isArray(el)) {
        return cnv(el)
      } else {
        return convert(el)
      }
    }).join(',') + ')'
  }
  return cnv(val)
}

class Query {
  constructor(delim = '`', query) {
    this.delim = delim
    if (query instanceof Query) {
      this.chain = query.chain
    } else {
      this.chain = new Map()
    }
    this.chain._push = (k, v) => {
      const arr = this.chain.get(k) || []
      if (Array.isArray(arr)) {
        arr.push(v)
        this.chain.set(k, arr)
      }
    }
  }

  wrap(s) {
    if (!s.includes(this.delim)) {
      return `${this.delim}${s}${this.delim}`
    } else {
      return s
    }
  }

  wrapDot(s) {
    return s
    // if (s.includes(this.delim)) {
    //   return s
    // } else {
    //   if (s.includes('.')) {
    //     s = s.split('.')
    //     return s.map((el, idx) => (s.length - 1) === idx ? el : this.wrap(el)).join('.')
    //   } else {
    //     return this.wrap(s)
    //   }
    // }
  }

  _set(k, v) {
    if (typeof k !== 'string' && !v) {
      this.chain.set(...(Object.entries(k)[0]))
    } else {
      this.chain.set(k, v)
    }
  }

  _get(k) {
    debugLog('get', k, this.chain.get(k))
    return this.chain.has(k) && this.chain.get(k)
  }

  isMode(mode) {
    return this._get('mode') === mode
  }

  setMode(mode) {
    debugLog('setMode', mode)
    this.chain.set('mode', mode)
  }

  reset() {
    debugLog('reset!')
    this.chain.clear()
  }

  select() {
    debugLog('select')
    this.setMode('select')
    return this
  }

  /**
   * select mode
   * @param {*} name
   * @param {*} fields
   * @param {*} tables
   * @return {Query}
   */
  from(name, fields) {
    debugLog('from', {name, fields})
    if (this.isMode('insert')) {
      throw new Error('cant run [from] in :insert mode')
    }
    this.chain.set('table', name)
    this.chain.set('fields', fields)
    debugLog('from chain', this.chain.get('fields'))
    return this
  }

  extraFrom(tables) {
    debugLog('extraFrom', tables)
    if (Array.isArray(tables) && tables.length) {
      this.chain.set('tables', tables)
    }
    if (typeof(tables) === 'string' && tables.length) {
      this.chain.set('tables', [tables])
    }
  }


  table(name) {
    debugLog('table', {name})
    // if (this.isMode('select')) {
    //   throw new Error('cant run [table] in :select mode')
    // }
    this.chain.set('table', name)
    return this
  }

  into(name) {
    debugLog('info', {name})
    if (this.isMode('select')) {
      throw new Error('cant run into in :select mode')
    }
    this.chain.set('table', name)
    return this
  }

  field(f) {
    debugLog('field', f)
    if (!this.isMode('select')) {
      throw new Error('cant run field[s] not in :select mode')
    }
    this.chain._push('fields', f)
    return this
  }

  fields(fields) {
    debugLog('fields', fields)
    const f = this.chain.get('fields')
    this.chain.set('fields', f.concat(fields))
    return this
  }

  update() {
    this.reset()
    this.setMode('update')
    return this
  }

  insert() {
    this.reset()
    this.setMode('insert')
    return this
  }

  delete() {
    this.reset()
    this.setMode('delete')
    return this
  }

  limit(limit) {
    this._set({limit})
    return this
  }

  offset(offset) {
    this._set({offset})
    return this
  }

  join(table, alias, where, mode) {
    debugLog('join', {table, alias, where, mode})
    this.chain._push('join', {table, alias, where, mode})
    return this
  }

  distinct(distinct) {
    this._set({distinct})
    return this
  }

  set(k, v) {
    const fields = this.chain.get('setFields') || {}
    fields[k] = v
    this.chain.set('setFields', fields)
    return this
  }

  setFields(fields) {
    if (this.isMode('select')) {
      throw new Error('cant run setFields in :select mode')
    }
    this._set({setFields: fields})
    return this
  }

  order(field, dir) {
    debugLog('order', {field, dir})
    if (typeof(dir) === 'boolean') {
      dir = dir ? 'ASC' : 'DESC'
    } else {
      if (field.includes(' ')) {
        const [a, b] = field.split(' ')
        field = this.wrapDot(a)
        dir = ['ASC', 'asc'].includes(b) ? 'ASC' : 'DESC'
      } else {
        dir = 'ASC'
      }
    }
    this.chain._push('order', `${this.wrapDot(field)} ${dir}`)
    return this
  }

  group(by) {
    this._set('group', by)
    return this
  }

  having(by) {
    this._set('having', by)
    return this
  }

  where(where, ...vals) {
    debugLog('where', {where, vals})
    this.chain._push('where', [where, vals])
    return this
  }

  _assembleWhereParams() {
    let where = this._get('where')
    let vals = []
    where = where.map(([wh, v]) => {
      debugLog('assembleWhereParams', {wh, v})
      if (v.length) {
        vals = vals.concat(v)
      }
      return wh
    }).join(' AND ')
    if (where.includes(' in ?')) {
      where = where.split(' in ?').join(' IN (?)')
    }
    if (where.includes(' IN ?')) {
      where = where.split(' IN ?').join(' IN (?)')
    }
    return [where, vals]
  }

  convertVal(v) {
    const r = convert(v)
    console.log('convertVal', {v, r})
    return r
  }

  wrapAsNames(fields) {
    const me = this
    return fields.map((el) => {
      if ([' as ', ' AS '].includes(el) && !el.includes(',')) {
        el = el.split(' as ').length > 1 ? el.split(' as ') : el.split(' AS ')
        return me.wrapDot(el[0]) + ' AS ' + el[1]
      } else {
        return el.includes(',') ? el : me.wrapDot(el)
      }
    })
  }

  _doSelect() {
    const r = ['SELECT']
    const fields = this._get('fields')
    debugLog('chain + fields', this.chain, fields)

    r.push(this.wrapAsNames(fields).join(','))

    const table = this._get('table')
    const tables = this._get('tables')
    if (tables) {
      r.push(`FROM ${this.wrapDot(table)}, ${this.wrapDot(tables)}`)
    } else {
      r.push(`FROM ${this.wrapDot(table)}`)
    }

    const join = this._get('join')
    if (join) {
      r.push(join.map(({table, alias, where, mode}) => {
        table = alias ? table + ' AS ' + alias : table
        return `${mode ? mode.toUpperCase() + ' ' : ''}JOIN ${table} ON ${where}`
      }).join(' '))
    }
    if (this._get('where')) {
      const [where, vals] = this._assembleWhereParams()
      this.chain.set('values', vals)
      r.push('WHERE ' + where)
    }
    this._get('group') && r.push('GROUP BY ' + this._get('group'))
    this._get('having') && r.push('HAVING ' + this._get('having'))
    this._get('order') && r.push('ORDER BY ' + this._get('order').join(', '))
    this._get('limit') && r.push(`LIMIT ${this._get('limit')}`)
    this._get('offset') && r.push(`OFFSET ${this._get('offset')}`)
    return {text: r.join(' '), values: this._get('values')}
  }

  _doUpdate() {
    const me = this
    const table = this.wrap(this._get('table'))
    let vals = []
    const d = Object.entries(this._get('setFields'))
      .map(([k, v]) => {
        vals.push(me.convertVal(v))
        return `${me.wrapDot(k)} = ?`
      }).join(',')
    const r = [`UPDATE ${table}`]
    const join = this._get('join')
    if (join) {
      r.push(join.map(({table, alias, where, mode}) => {
        table = alias ? table + ' AS ' + alias : table
        return `${mode ? mode.toUpperCase() + ' ' : ''}JOIN ${table} ON ${where}`
      }).join(' '))
    }
    r.push('SET')
    r.push(d)
    if (this._get('where')) {
      const [where, whereVals] = this._assembleWhereParams()
      vals = vals.concat(whereVals)
      r.push('WHERE ' + where)
    }
    this.chain.set('values', vals)
    return {text: r.join(' '), values: vals}
  }

  _doInsert() {
    const me = this
    const table = this.wrap(this._get('table'))
    const d = Object.entries(this._get('setFields')).reduce((acc, [k, v]) => {
      acc.keys.push(me.wrapDot(k))
      acc.vals.push(me.convertVal(v))
      return acc
    }, {keys: [], vals: []})
    const r = [`INSERT INTO ${table}`]
    r.push(`(${d.keys.join(',')})`)
    r.push(`VALUES(${d.vals.map(() => '?').join(',')})`)
    return {text: r.join(' '), values: d.vals}
  }

  // from / where / select / group / having / order / limit
  toParam() {
    const mode = this._get('mode')
    const r = {}
    if (mode === 'select') {
      r.result = this._doSelect()
    }
    if (mode === 'update') {
      r.result = this._doUpdate()
    }
    if (mode === 'insert') {
      r.result = this._doInsert()
    }
    if (QUERYDEBUGLOG) {
      // debugLog('*'.repeat(30)+'QUERYDEBUGLOG'+'*'.repeat(30))
      if (r.result) {
        debugLog(r.result.text)
        debugLog(r.result.values)
      } else {
        debugLog('empty query')
      }
      // debugLog('*'.repeat(30)+'QUERYDEBUGLOG END'+'*'.repeat(26)+'\n')
    }
    return r.result ? r.result : {text: '', values: []}
  }

  toString() {
    let {text, values} = this.toParam()
    if (!text.includes('?')) {
      return text
    }
    let cursor = 0
    text = text.split('?')
    const result = text.map((el, idx) => {
      const res = (text.length - 1) === idx ? el : el + convert(values[cursor++], {withEscapeString: true})
      return res
    }).join('')
    debugLog('toString result', result)
    return result
  }

  clone() {
    return new Query(this.delim, this)
  }
}

module.exports = Query
