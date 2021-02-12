/* eslint-disable require-jsdoc */
'use strict'

const internals = {
  pools: {},
  driver: require('mysql2'),
}

const injectConnectOptions = function(instance, sql) {
  instance.justStarted = false
  console.log('SET AUTOCOMMIT=0;')
  if (typeof sql === 'string') {
    sql = 'SET AUTOCOMMIT=0;' + sql
  } else {
    if (typeof sql.sql === 'string') {
      sql.sql = 'SET AUTOCOMMIT=0;' + sql.sql
    }
  }
}

class DBService {
  constructor(cfg, debug, options) {
    if (!cfg) {
      console.dir({cfg, debug, options}, {depth: 5})
      throw new Error('error - try instance DBService without config!')
    }
    this.cfg = cfg
    this.justStarted = true
    options = options || {}
    this.cfg.connectionLimit = this.cfg.connectionLimit || 4
    this.db = this.cfg.database
    this.debug = debug
    if (!internals.pools[this.cfg.database]) {
      internals.pools[this.cfg.database] = internals.driver.createPool(this.cfg)
    }
    this.pools = internals.pools
    if (options.serviceConn) {
      const serviceCfg = Object.assign({}, this.cfg)
      delete serviceCfg.database
      const serviceConn = internals.driver.createConnection(serviceCfg)
      this.serviceConn = (sql) => {
        if (this.justStarted) {
          sql = injectConnectOptions(this, sql)
        }
        return new Promise((resolve, reject) => {
          serviceConn.query(sql, (err, result) => {
            err ? reject(err) : resolve(result)
          })
        })
      }
    }
    this.connCounter = 0
    return this
  }

  getPool() {
    return this.pools[this.db]
  }

  logTime(startTime, info) {
    const diffMs = Date.now() - startTime
    if (diffMs > 15000) {
      console.error(`[${diffMs/1000}sec]SLOOOOOOW REQ: ${info}`)
    } else {
      this.debug && console.log(`${info} >>>>> execute in ${Date.now() - startTime}ms`)
    }
  }

  getConn() {
    const me = this
    return new Promise(function(resolve, reject) {
      me.getPool().getConnection((err, conn) => {
        err ? reject(err, conn) : resolve(conn)
      })
    })
  }

  doConn(conn, opts) {
    const me = this
    const startTime = Date.now()
    const info = opts.values ? `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` : `DB.${this.cfg.database}.${opts.sql || opts}`
    return new Promise(function(resolve, reject) {
      conn.query(opts, function(err, results, fields) {
        me.logTime(startTime, info)
        if (err) {
          conn && conn.release()
          return reject(err, conn)
        }
        conn.release()
        return resolve(results, fields, conn)
      })
    })
  }

  query(conn, opts) {
    this.debug && console.log('dbservice.query opts:', opts)
    return new Promise((resolve, reject) => {
      return conn.query(opts, (err, rows, fields) => {
        if (err) {
          return reject(err)
        }
        return resolve({rows, fields, conn})
      })
    })
  }

  withTimeout(promiseFn, msTime = 15000) {
    return Promise.race([
      promiseFn(),
      new Promise(
        (_, reject) =>
          setTimeout(() => reject(
            new Error(` [ERROR: withTimeout] timeout exceed ${msTime}`)
          ),
          msTime)
      ),
    ])
  }

  async do(opts) {
    const me = this
    const startTime = Date.now()
    const info = opts.values ?
      `DB.${this.cfg.database}.${opts.sql || opts} with values ${opts.values}` :
      `DB.${this.cfg.database}.${opts.sql || opts}`
    const conn = await this.getConn()
    let result
    const {wrapBefore, wrapAfter, returnConnection, foundRows} = opts
    if (returnConnection) {
      me.logTime(startTime, info)
      return this.query(conn, opts)
    }
    if (foundRows && opts.sql.toLowerCase().trim().indexOf('select ') === 0) {
      const sql = opts.sql.trim().split(' ')
      const s = sql.shift()
      sql.unshift(
        typeof foundRows === 'string' ?
          `${s} SQL_CALC_FOUND_ROWS ${foundRows}.id,` :
          `${s} SQL_CALC_FOUND_ROWS *,`
      )
      opts.sql = sql.join(' ')
      if (this.debug) {
        console.log('*******[dbservice.do]*******')
        console.dir(opts)
        console.log('*******[dbservice.do END]***\n')
      }
      result = await this.query(conn, opts)
      // result = await this.withTimeout(() => this.query(conn, opts))
      // console.dir({result})

      result.count = await this.query(conn, 'SELECT FOUND_ROWS() AS count').then(({rows}) => rows[0].count)
      conn.release()
      me.logTime(startTime, info)
      return result
    }
    if (wrapBefore || wrapAfter) {
      if (wrapBefore) {
        result.wrapBefore = await this.query(conn, wrapBefore)
      }
      result.rows = await this.query(conn, opts)
      if (wrapAfter) {
        result.wrapAfter = await this.query(conn, wrapAfter)
      }
      conn.release()
      me.logTime(startTime, info)
      return result
    }
    result = await this.query(conn, opts).then(({rows}) => rows)
    conn.release()
    me.logTime(startTime, info)
    return result
  }
}

module.exports = DBService
