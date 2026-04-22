function hashToBucket(value) {
  var hash = 0
  for (var i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) % 100
  }
  return hash
}

function isInBucket(openid, percentage) {
  if (!openid || typeof openid !== 'string') return false
  if (typeof percentage !== 'number' || isNaN(percentage) || percentage <= 0) return false
  if (percentage >= 100) return true
  return hashToBucket(openid) < percentage
}

module.exports = {
  isInBucket,
}
