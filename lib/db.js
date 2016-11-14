'use strict';

const mysql = require('mysql');

const internals = {
  pools: {}
}

const DB = function(cfg, debug){
  if(!cfg.databases || !cfg.databases.length){
    throw new Error('cant find databases in config!')
  }

  if(cfg.default){
    internals.default = cfg.default;
    console.log('setup default db : ',internals.default)
  }

  internals.debug = debug;
  cfg.databases.forEach( function(dbCfg){
    createPool( dbCfg, debug )
  },internals)

  return internals
};

const createPool = function (cfg, debug){
  console.log('db cfg = ',cfg)
  cfg.connectionLimit = cfg.connectionLimit || 20;
  let db = cfg.database;

  if(cfg.default){
    this.default = cfg.database
    console.log('setup default db : ',this.default)
  }
  this.pools[db]  = mysql.createPool(cfg);

  this.pools[db].connCounter = 0;

  this.pools[db].on('connection', function (connection) {
    this.pools[db].connCounter = this.pools[db]._connectionQueue.length;
  }.bind(this))
}.bind(internals)

internals.getPool = function getPool(db){
  let pool = this.pools[db] || this.pools[this.default]
  if(!pool){
    throw new Error('cant find pool for database : %s , please check config or define default database in common config or database config!',db)
  }
  return pool
}.bind(internals)



// module.exports.connection = DB;

internals.do = function ( opts, db) {

    var me = this;

    if(me.debug){
      
      let info = opts.values ? `DB.${me.dbname}.${opts.sql || opts} with values ${opts.values}` : `DB.${me.dbname}.${opts.sql || opts}`
      console.time(info)

      return new Promise( function(resolve,reject){

        me.getPool( db ).getConnection( (err,conn) => {
          if(err){
            reject(err);
            return;
          }
          conn.query(opts,function(err,results,fields){
            console.timeEnd(info)
            if(err){
              reject(err)
            }
            conn.release();
            resolve(results,fields)
          })

        })

      })
      // .then( function(result){console.timeEnd(info);return result})
      

    }else{

      return new Promise( function(resolve,reject){

        me.getPool( db ).getConnection( (err,conn) => {
          if(err){
            reject(err);
            return;
          }
          conn.query(opts,function(err,results,fields){
            conn.release();
            err ? reject(err) : resolve(results,fields)
          })

        })

        // me.conn.query(opts,function(err,results,fields){
        //   err ? reject(err) : resolve(results,fields)
        // })

      })

    }

}.bind(internals)

internals.exec = function ( db, opts,callback,scope) {

  var me = this;

  if(me.debug)console.log('DB.prototype.exec : sql : %s with values %s',opts.sql, opts.values)

  me.getPool( db ).getConnection( (err,conn) => {
    if(err){
      callback.call(scope,err,[])
      return
    }

    conn.query(opts,(err,results)=>{
      callback.call(scope,err,results)
    })

  })

}.bind(internals)


module.exports = DB;
