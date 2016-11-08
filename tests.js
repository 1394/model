'use strict';

const model = require('./model')

const co = require('co')

model.setConfig({
	db:{
		host: "localhost",
		user: "root",
		password: "b91f8707a23f3371",
		database: "me_shared",
		driver: "mysql",
		connectionLimit: 50
	},
	debug:{models:true}
})


var table;

Promise.all( Array(100).fill(1).map( (el,i)=>{
	console.log('i = ',i)
	table = new model('items');
	return table.find().limit(20).do()
}))
.then( res =>{
	// console.log('res = ',res)
	process.exit(0)
})
.catch(console.error)
