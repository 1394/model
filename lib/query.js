/* eslint-disable require-jsdoc */
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
  // console.log('convert', val, typeof val)
  if (typeof(val) === 'boolean') {
    return val ? 1 : 0
  }
  if (typeof(val) === 'string') {
    return withEscapeString ? `\'${escapeString(val)}\'` : escapeString(val)
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
        return convert(el, {withEscapeString: true})
      }
    }).join(',') + ')'
  }
  return cnv(val)
}

class Query {
  constructor(delim = '`', query) {
    this.delim = delim
    if (query instanceof Query) {
      this.chain = new Map(query.chain)
    } else {
      this.chain = new Map()
    }
    this.chain._push = (k, v) => {
      const arr = this.chain.get(k) || []
      if (Array.isArray(arr)) {
        arr.push(v)
        this.chain.set(k, arr)
      } else {
        throw new Error('chain._push try to push in not Array!!!')
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

  isMode(...modes) {
    return modes.find((mode) => mode === this._get('mode'))
  }

  setMode(mode) {
    debugLog('setMode', mode)
    this.chain.set('mode', mode)
  }

  reset() {
    debugLog('reset!')
    this.chain.clear()
  }

  /**
   * select mode
   * @param {*} name
   * @param {*} fields
   * @param {*} tables
   * @return {Query}
   */
  select(name, fields) {
    debugLog('select', {name, fields})
    if (this.isMode('insert', 'update')) {
      throw new Error(`cant run [select] in :${this.chain.get('mode')} mode`)
    }
    this.setMode('select')
    this.chain.set('table', name)
    this.chain.set('fields', fields || [`${name}.*`])
    debugLog('select chain', this.chain.get('fields'))
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
    return this
  }

  /**
   * ???
   * @param {*} name
   * @return {Query}
   */
  table(name) {
    debugLog('table', {name})
    this.chain.set('table', name)
    return this
  }

  field(f) {
    debugLog('field', f)
    if (!this.isMode('select')) {
      throw new Error('cant run field[s] not in :select mode')
    }
    if (Array.isArray(f)) {
      const fields = this._get('fields')
      this.chain.set('fields', fields.concat(f))
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

  update(name) {
    this.reset()
    this.setMode('update')
    this.chain.set('table', name)
    return this
  }

  insert(name) {
    this.reset()
    this.setMode('insert')
    this.chain.set('table', name)
    return this
  }

  delete(name) {
    this.reset()
    this.setMode('delete')
    this.chain.set('table', name)
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

  join(table, where, mode, alias) {
    debugLog('join', {table, alias, where, mode})
    this.chain._push('join', {table, alias, where, mode})
    return this
  }

  distinct(field) {
    if (typeof field === 'string') {
      this.chain.set('distinct', `DISTINCT ${field}`)
    } else {
      this.chain.set('distinct', `DISTINCT ${this._get('table')}.id`)
    }
    console.log('this.chain', this.chain.get('distinct'))
    return this
  }

  set(k, v) {
    const fields = this.chain.get('setFields') || {}
    fields[k] = v
    this.chain.set('setFields', fields)
    return this
  }

  insertFields(fields) {
    if (this.isMode('select')) {
      throw new Error('cant run setFields in :select mode')
    }
    this._set('insertFields', fields)
    return this
  }

  updateFields(fields) {
    if (this.isMode('select')) {
      throw new Error('cant run setFields in :select mode')
    }
    this._set('updateFields', fields)
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
    if (this.isMode('insert')) {
      throw new Error(`cant run [where] in :${this._get('mode')} mode`)
    }
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
      where = where.split(' in ?').join(' IN ?')
    }
    // if (where.includes(' IN ?')) {
    //   where = where.split(' IN ?').join(' IN (?)')
    // }
    return [where, vals]
  }

  convertVal(v, opts) {
    const r = convert(v, opts)
    // console.log('convertVal', r, typeof r)
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
    const distinct = this._get('distinct')
    console.log('distinct', distinct)
    distinct && r.push(distinct + ',')
    const fields = this._get('fields')
    debugLog('chain + fields', this.chain, fields)
    if (Array.isArray(fields)) {
      r.push(this.wrapAsNames(fields).join(','))
    } else if (typeof fields === 'string') {
      r.push(fields)
    } else {
      // eslint-disable-next-line max-len
      throw new Error('fields must be defined as array or as string! select("items", "items.id, items.name" || ["items.id", "items.name"])')
    }

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
    const vals = []
    const d = Object.entries(this._get('updateFields'))
      .map(([k, v]) => {
        if (typeof v === 'object' && v && v.sql) {
          return `${k} = ${v.sql}`
        } else {
          vals.push(v)
          return `${me.wrap(k)} = ?`
        }
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
      whereVals.forEach((v) => vals.push(v))
      r.push('WHERE ' + where)
    }
    this.chain.set('values', vals)
    return {text: r.join(' '), values: vals}
  }

  _doInsert() {
    const me = this
    const table = this.wrap(this._get('table'))
    const tables = this._get('tables')
    const fieldData = this._get('insertFields')
    const isFieldArray = Array.isArray(fieldData)
    const convertVals = (keys, rec) => keys.map((k) => {
      if (rec.hasOwnProperty(k)) {
        return rec[k]
      } else {
        throw new Error(`all records in insertFields must have the same property names and number of properties`)
      }
    })
    const keys = Object.keys(isFieldArray ? fieldData[0] : fieldData)
    const wrappedKeys = keys.map((e) => me.wrap.call(me, e))
    const vals = (isFieldArray ? fieldData : [fieldData]).map((el) => convertVals(keys, el))
    const r = [`INSERT INTO ${table}${Array.isArray(tables) ? ','+tables.map(me.wrap).join(',') : ''}`]
    r.push(`(${wrappedKeys.join(',')})`)
    r.push(`VALUES ${vals.map(() => '?').join(',')}`)
    return {text: r.join(' '), values: vals}
  }

  _doDelete() {
    const table = this.wrap(this._get('table'))
    const r = [`DELETE FROM ${table}`]
    if (this._get('where')) {
      const [where, vals] = this._assembleWhereParams()
      this.chain.set('values', vals)
      r.push('WHERE ' + where)
    }
    this._get('order') && r.push('ORDER BY ' + this._get('order').join(', '))
    this._get('limit') && r.push('LIMIT ' + this._get('limit'))
    return {text: r.join(' '), values: this._get('values')}
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
    if (mode === 'delete') {
      r.result = this._doDelete()
    }
    if (QUERYDEBUGLOG) {
      if (r.result) {
        debugLog(r.result.text)
        debugLog(r.result.values)
      } else {
        debugLog('empty query')
      }
    }
    return r.result ? r.result : {text: '', values: []}
  }

  toString() {
    const me = this
    let {text, values} = this.toParam()
    if (!text.includes('?')) {
      return text
    }
    let cursor = 0
    text = text.split('?')
    const result = text.map((el, idx) => {
      const res = (text.length - 1) === idx ? el : el + me.convertVal(values[cursor++], {withEscapeString: true})
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
