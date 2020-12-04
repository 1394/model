module.exports = {
  env: {
    browser: true,
    node: true,
    es6: true,
  },
  globals: {
    Ext: 'readable',
    Xpand: 'readable',
    Fabric: 'readable',
    TurndownService: 'readable',
    showdown: 'readable',
  },
  extends: 'google',
  parserOptions: {
    ecmaVersion: 2020,
  },
  rules: {
    'prefer-const': 'error',
    'max-len': ['error', {code: 120}],
    'semi': ['error', 'never'],
    'comma-dangle': ['error', {
      'arrays': 'always-multiline',
      'objects': 'always-multiline',
      'imports': 'always-multiline',
      'exports': 'always-multiline',
      'functions': 'never',
    }],
    'camelcase': 0,
    'indent': ['error', 2],
    'no-undef': ['error'],
  },
}
