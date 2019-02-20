# @dmitri.leto/model changelog
## 1.1.51
* fix error message in Record.js
## 1.1.50
* Added check for the presence of a field in the record when trying to access via the .get method
## 1.1.49
* when calling the .where method with Object as a parameter, the values can be array. for example, in the case of .where({id: [1, 2, 3]}) a "WHERE id IN (1,2,3)" query will be constructed
