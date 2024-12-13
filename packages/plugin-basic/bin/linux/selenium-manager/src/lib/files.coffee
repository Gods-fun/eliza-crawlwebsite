path = require 'path'
mkdirp = require 'mkdirp'
home = path.resolve process.env.HOME, '.selenium'

exports = module.exports = {}

exports.binDir = path.resolve home, 'bin'

exports.seleniumServer = path.resolve exports.binDir, 'selenium-server-standalone-2.35.0.jar'
exports.chromedriver = path.resolve exports.binDir, 'chromedriver'
exports.sauceConnect = path.resolve exports.binDir, 'Sauce-Connect.jar'
exports.chromedriverVerbose = path.resolve exports.binDir, 'chromedriververbose'

exports.logDir = path.resolve home, 'log'
exports.seleniumLog = path.resolve exports.logDir, 'selenium.log'

mkdirp.sync exports.binDir
mkdirp.sync exports.logDir
