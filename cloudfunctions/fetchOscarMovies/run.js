const { main } = require('./index.js');
main({}, {}).then(res => console.log('Result:', res)).catch(console.error);
